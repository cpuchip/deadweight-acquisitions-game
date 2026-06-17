import Phaser from 'phaser'
import { shipHasFreeMediumSlot, selectDispatchTarget, selectHaulerForDesignation } from './dispatchLogic'
import type { AttachmentPayload } from '../state/attachmentTypes'
import { nanoid } from 'nanoid'
import { get } from 'svelte/store'
import { spaceActive } from '../state/mpStore'
import { generateWorld, generateCompanyAsteroid } from '../world/worldGenerator'
import { computeServiceSlots, SERVICE_SLOT_COUNT, type SlotPosition } from '../world/serviceSlots'
import { computeHangarBays, HANGAR_BAY_COUNT, HANGAR_PRESSURIZED_FACTOR, type HangarPosition } from '../world/hangarBays'
import {
  ASTEROID_TEXTURE_SIZE,
  RESOURCE_COLORS,
  COMPANY_ARRIVAL_BASE_INTERVAL,
  COMPANY_ARRIVAL_MIN_INTERVAL,
  COMPANY_ASTEROID_MAX_COUNT,
  ORBITAL_K,
  SHIP_PARK_RADIUS,
  SHIP_PARK_ORBIT_RATE,
  AUTO_DISPATCH_INTERVAL,
  type ResourceType,
} from '../world/worldConfig'
import { Asteroid } from '../entities/Asteroid'
import { Base, generateBaseTexture } from '../entities/Base'
import { Planet, generatePlanetTexture } from '../entities/Planet'
import {
  Ship,
  generateShipTexture,
  DRAG_ORDER_THRESHOLD,
  CARGO_CAPACITY_TIERS,
  CARGO_UPGRADE_COSTS,
  MAX_UPGRADE_LEVEL,
  UPGRADE_HANGAR_DURATION,
  HAULER_FUEL_MAX,
  HAULER_RCS_MAX,
  HAULER_BATTERY_MAX,
  HAULER_FIELD_CHARGE_FUEL_RATE,
  HAULER_FIELD_CHARGE_BATTERY_RATE,
  HAULER_ATTACH_MANEUVER_MS,
} from '../entities/Ship'

import {
  AutoMiner,
  generateAutoMinerTexture,
  MINER_INITIAL_NETS,
  MINER_DEPLOY_DURATION_MS,
  MINER_DEPLOY_PROXIMITY,
  RESUPPLY_DURATION_MS,
  ATTACH_FAILURE_PROB,
  ATTACH_MAX_RETRIES,
  ATTACH_DRIFT_DURATION_MS,
  ATTACH_RETRY_DELAY_MS,
  ATTACH_COOLDOWN_MS,
  CONDITION_DEGRADE_PER_FAIL,
  CONDITION_MAX_PENALTY,
  CONDITION_CAP_THRESHOLD,
  CATASTROPHIC_FAIL_PROB,
  MINER_REPAIR_DURATION_MS,
  MINER_BATTERY_MAX,
  MINER_BATTERY_DRAIN_BEACONING,
  MINER_RCS_MAX,
  MINER_RCS_DRAIN_PER_ATTACH,
  conditionPenaltyFraction,
  type AutoMinerState,
} from '../entities/AutoMiner'
import {
  CargoNet,
  generateCargoNetTexture,
  NET_LEAKAGE_FRACTION,
  NET_COLLECT_DURATION_MS,
  TETHER_LINE_COLOR,
  TETHER_LINE_ALPHA,
} from '../entities/CargoNet'
import { gameState, type SaveState } from '../state/gameState'
import { commandQueue, type GameCommand } from '../state/commandStore'
import { selectedAsteroid, selectedShip } from '../state/shipStore'
import { basePanelOpen, stationUsage } from '../state/baseStore'
import { fleetSummary } from '../state/fleetStore'
import { designationQueue, type MiningDesignation } from '../state/designationStore'
import {
  activeBeacons,
  autoMinerSummary,
  attachNotifications,
  minerAvailability,
  type BeaconData,
  type AttachNotification,
} from '../state/autoMinerStore'
import { GameSaveService } from '../services/GameSaveService'
import { getPrice } from '../world/pricingSeam'

const NOTIFICATION_DURATION_MS = 4000
const WORLD_SIZE = 8500
const MAX_ZOOM = 2
const PAN_SPEED = 500 // world units per second
const STAR_TEXTURE_SIZE = 2048
const BASE_X = 0
const BASE_Y = 650   // GEO orbit south of planet (planet center at 0,0)
const AUTO_SAVE_INTERVAL = 60 // real-world seconds

const STAR_LAYERS = [
  { key: 'stars-far',  count: 88, parallax: 0.07, brightMin: 120, largeChance: 0.00 },
  { key: 'stars-mid',  count: 60, parallax: 0.10, brightMin: 160, largeChance: 0.00 },
  { key: 'stars-near', count: 32, parallax: 0.14, brightMin: 200, largeChance: 0.40 },
] as const

const SELECTION_RING_COLOR = 0x44ffaa
const SELECTION_RING_RADIUS = 20
const SELECTION_RING_ALPHA = 0.8

const PROXIMITY_PLANET_RADIUS = 600
const PROXIMITY_BASE_RADIUS = 250
const PROXIMITY_ASTEROID_RADIUS = 120
const PROXIMITY_MIN_SPEED = 0.25

const MINIMAP_SIZE = 180
const MINIMAP_MARGIN = 10
const MINIMAP_ALPHA = 0.65
const MINIMAP_DOT_PLANET = 6
const MINIMAP_DOT_BASE = 4
const MINIMAP_DOT_SHIP = 3
const MINIMAP_DOT_ASTEROID = 2
const MINIMAP_COLOR_BG = 0x050a14
const MINIMAP_COLOR_BORDER = 0x334466
const MINIMAP_COLOR_PLANET = 0x3a6090
const MINIMAP_COLOR_BASE = 0x88ccff
const MINIMAP_COLOR_ASTEROID = 0x777788
const MINIMAP_COLOR_COMPANY = 0x44ffdd
const MINIMAP_COLOR_SHIP = 0xffee44
const MINIMAP_COLOR_BEACON = 0xffaa44

export class SpaceScene extends Phaser.Scene {
  private starLayers: Phaser.GameObjects.TileSprite[] = []
  private asteroids: Asteroid[] = []
  private asteroidMap: Map<string, Asteroid> = new Map()
  private ships: Ship[] = []
  private autoMiners: AutoMiner[] = []
  private autoMinerMap: Map<string, AutoMiner> = new Map()
  private cargoNets: CargoNet[] = []
  private cargoNetMap: Map<string, CargoNet> = new Map()
  private shipMinerRecoveryTargets: Map<string, string> = new Map()
  // shipId -> orphaned cargo-net id the ship is travelling to collect.
  private shipNetRecoveryTargets: Map<string, string> = new Map()
  // Ships currently performing the timed attach/recovery maneuver (one-shot guard).
  private shipAttachManeuver: Map<string, number> = new Map() // shipId -> maneuver start (ms)
  // asteroidId -> scene time (ms) until which the asteroid is undeployable after an
  // attach-retry exhaustion. Transient (not persisted). See ATTACH_COOLDOWN_MS.
  private attachCooldowns: Map<string, number> = new Map()
  private attachRetryCount: Map<string, number> = new Map()
  private base!: Base
  private selectedShip: Ship | null = null
  private selectedAutoMinerEntity: AutoMiner | null = null
  private selectedCargoNetEntity: CargoNet | null = null
  private tetherGfx: Phaser.GameObjects.Graphics | null = null
  private selectionRing: Phaser.GameObjects.Graphics | null = null
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd!: {
    up: Phaser.Input.Keyboard.Key
    down: Phaser.Input.Keyboard.Key
    left: Phaser.Input.Keyboard.Key
    right: Phaser.Input.Keyboard.Key
  }
  private isDragging = false
  private dragLastX = 0
  private dragLastY = 0
  private rightDownX = 0
  private rightDownY = 0
  private minZoom = 0.1
  private gameClock = 0
  private autoSaveAccumulator = 0
  private companyArrivalAccumulator = 0
  private followCam = false
  private minimap!: Phaser.GameObjects.Graphics
  private slotPositions: SlotPosition[] = []
  private slotOccupants: Array<string | null> = []
  private hangarPositions: HangarPosition[] = []
  private hangarOccupants: Array<string | null> = []
  private shipPendingUpgrades: Map<string, 'cargo'> = new Map()
  private shipPendingDesignationAsteroid: Map<string, string> = new Map()
  private designations: MiningDesignation[] = []
  private minerRepairs: Map<string, { slotIndex: number }> = new Map()
  private beforeUnloadHandler!: () => void

  constructor() {
    super({ key: 'SpaceScene' })
  }

  create(): void {
    spaceActive.set(true) // the SP game is running — show the SP HUD overlay
    this.gameClock = 0
    this.autoSaveAccumulator = 0
    this.buildStarLayers()
    this.generateAsteroidTextures()
    generateShipTexture(this)
    generateBaseTexture(this)
    generatePlanetTexture(this)
    generateAutoMinerTexture(this)
    generateCargoNetTexture(this)
    this.tetherGfx = this.add.graphics()
    this.spawnPlanet()

    const save = GameSaveService.load()
    if (save !== null) {
      this.loadFromSave(save)
    } else {
      this.spawnBase()
      this.spawnWorld()
      this.spawnStarterShip()
    }

    this.minimap = this.add.graphics()
    this.minimap.setScrollFactor(0)
    this.minimap.setDepth(1000)

    this.setupCamera()
    this.setupInput()
    this.scale.on('resize', (size: Phaser.Structs.Size) => this.onResize(size))

    this.beforeUnloadHandler = () => {
      GameSaveService.save(this.buildSaveState())
    }
    window.addEventListener('beforeunload', this.beforeUnloadHandler)

    this.time.addEvent({
      delay: AUTO_DISPATCH_INTERVAL * 1000,
      callback: this.autoDispatch,
      callbackScope: this,
      loop: true,
    })
  }

  shutdown(): void {
    window.removeEventListener('beforeunload', this.beforeUnloadHandler)
  }

  private loadFromSave(save: SaveState): void {
    gameState.worldSeed = save.worldSeed
    gameState.gameClock = save.gameClock
    this.gameClock = save.gameClock

    // Restore asteroids from save (bypasses generateWorld — IDs and depletion are in save)
    this.asteroids = save.asteroids.map(data => new Asteroid(this, data))
    this.asteroidMap = new Map(this.asteroids.map(a => [a.id, a]))

    // Restore base
    this.base = new Base(this, BASE_X, BASE_Y)
    this.base.storage = { ...save.base.storage }
    this.base.credits = save.base.credits
    this.base.ownedDockCount = save.base.ownedDockCount ?? 0
    this.base.ownedHangarCount = save.base.ownedHangarCount ?? 0
    this.base.hangarPressurized = save.base.hangarPressurized ?? false
    this.base.stationMinerSlotCount = save.base.stationMinerSlotCount ?? 0
    this.base.stationMinerIds = [...(save.base.stationMinerIds ?? [])]
    this.base.autoDesignate = save.base.autoDesignate ?? false
    this.base.pushToStore()

    this.add
      .text(BASE_X, BASE_Y + 40, 'BASE', {
        color: '#88ccff',
        fontSize: '12px',
        fontFamily: 'monospace',
      })
      .setOrigin(0.5, 0)
    this.initSlots()
    this.initHangars()

    // Restore AutoMiners
    for (const snap of save.autoMiners) {
      const miner = new AutoMiner(this, snap.id)
      miner.state = snap.state
      miner.condition = snap.condition ?? 1
      miner.battery = snap.battery ?? MINER_BATTERY_MAX
      miner.rcsFuel = snap.rcsFuel ?? MINER_RCS_MAX
      miner.beaconReason = snap.beaconReason ?? null
      miner.asteroidId = snap.asteroidId
      miner.spareNetCount = snap.spareNetCount
      miner.activeNetFill = snap.activeNetFill
      miner.tetheredNetIds = [...snap.tetheredNetIds]

      if (snap.asteroidId !== null) {
        const asteroid = this.asteroidMap.get(snap.asteroidId)
        if (asteroid) {
          miner.setPosition(asteroid.x, asteroid.y - 20)
          miner.setVisible(true)
        } else {
          console.warn(`AutoMiner ${snap.id}: asteroid ${snap.asteroidId} not found, skipping`)
          miner.destroy()
          continue
        }
      } else if (snap.freeOrbitalRadius !== null && snap.freeOrbitalAngle !== null) {
        miner.freeOrbitalRadius = snap.freeOrbitalRadius
        miner.freeOrbitalAngle = snap.freeOrbitalAngle
        miner.setPosition(
          Math.cos(snap.freeOrbitalAngle) * snap.freeOrbitalRadius,
          Math.sin(snap.freeOrbitalAngle) * snap.freeOrbitalRadius - 20,
        )
        miner.setVisible(true)
      }

      this.autoMiners.push(miner)
      this.autoMinerMap.set(miner.id, miner)
      this.attachMinerEvents(miner)
    }

    // Restore CargoNets (only full-tethered nets are persisted)
    for (const snap of save.cargoNets) {
      const net = new CargoNet(
        this,
        snap.resourceType as import('../world/worldConfig').ResourceType,
        snap.quantity,
        snap.asteroidId,
        snap.id,
      )
      net.state = snap.state
      net.designatedForCollection = snap.designatedForCollection ?? false
      if (snap.freeOrbitalRadius != null && snap.freeOrbitalAngle != null) {
        // Orphaned net: restore its free-orbit position.
        net.freeOrbitalRadius = snap.freeOrbitalRadius
        net.freeOrbitalAngle = snap.freeOrbitalAngle
        net.setPosition(
          Math.cos(snap.freeOrbitalAngle) * snap.freeOrbitalRadius,
          Math.sin(snap.freeOrbitalAngle) * snap.freeOrbitalRadius,
        )
      } else if (snap.asteroidId) {
        const asteroid = this.asteroidMap.get(snap.asteroidId)
        if (asteroid) {
          const siblingCount = this.cargoNets.filter(n => n.asteroidId === snap.asteroidId).length
          const angle = (siblingCount / 4) * Math.PI * 2
          net.setPosition(asteroid.x + Math.cos(angle) * 18, asteroid.y + Math.sin(angle) * 18)
        }
      }
      this.cargoNets.push(net)
      this.cargoNetMap.set(net.id, net)
    }

    // Reposition nets belonging to free-orbiting miners (their asteroid is no longer in scene)
    for (const net of this.cargoNets) {
      const owningMiner = this.autoMiners.find(m => m.tetheredNetIds.includes(net.id))
      if (owningMiner && owningMiner.freeOrbitalRadius !== null) {
        const idx = owningMiner.tetheredNetIds.indexOf(net.id)
        const count = owningMiner.tetheredNetIds.length
        const angle = (idx / Math.max(1, count)) * Math.PI * 2
        net.setPosition(owningMiner.x + Math.cos(angle) * 18, owningMiner.y + Math.sin(angle) * 18)
        net.setVisible(true)
      }
    }

    // Restore ships — loop 1: create entities and reconstruct slot occupancy
    for (const snap of save.ships) {
      const ship = new Ship(
        this,
        snap.x,
        snap.y,
        snap.name,
        { x: BASE_X, y: BASE_Y },
        this.base,
        snap.id,
      )
      ship.heading = snap.heading
      ship.shipState = snap.shipState
      ship.target = snap.target
      ship.cargoContents = { ...snap.cargoContents }
      ship.unloadTimer = snap.unloadTimer
      ship.attachUnloadTimer = snap.attachUnloadTimer
      // Resume the timed attach-unload if mid-unload with nets or a carried miner aboard.
      ship.attachUnloadActive =
        snap.shipState === 'unloading' &&
        snap.attachmentPoints.some(ap => ap.payload?.kind === 'cargo-net' || ap.payload?.kind === 'auto-miner')
      ship.thrusterFuel = snap.thrusterFuel ?? HAULER_FUEL_MAX
      ship.rcsFuel = snap.rcsFuel ?? HAULER_RCS_MAX
      ship.battery = snap.battery ?? HAULER_BATTERY_MAX
      ship.chargeToggle = snap.chargeToggle ?? false
      ship.cargoUpgradeLevel = snap.cargoUpgradeLevel
      ship.cargoCapacity = CARGO_CAPACITY_TIERS[snap.cargoUpgradeLevel]
      ship.attachmentPoints = snap.attachmentPoints
      ship.setAngle(snap.heading)

      if (snap.asteroidTargetId !== null) {
        ship.asteroidTarget = this.asteroidMap.get(snap.asteroidTargetId) ?? null
      }
      ship.waitOrbitalAngle = snap.waitOrbitalAngle

      // Restore dock slot assignment
      const savedSlot = snap.dockSlotIndex ?? null
      if (savedSlot !== null && savedSlot >= 0 && savedSlot < this.slotOccupants.length) {
        ship.dockSlotIndex = savedSlot
        this.slotOccupants[savedSlot] = ship.id
      }

      // Restore hangar slot assignment
      const savedHangarSlot = snap.hangarSlotIndex ?? null
      if (savedHangarSlot !== null && savedHangarSlot >= 0 && savedHangarSlot < this.hangarOccupants.length) {
        ship.hangarSlotIndex = savedHangarSlot
        ship.hangarServiceTimer = snap.hangarServiceTimer ?? 0
        this.hangarOccupants[savedHangarSlot] = ship.id
      }

      this.ships.push(ship)
      this.base.registerShip(ship.id)
      this.attachShipEvents(ship)
    }

    // Rescue ships stuck in mid-animation states — loop 2: runs after slot occupancy is reconstructed
    for (const ship of this.ships) {
      if (ship.shipState === 'in-hangar') {
        // Hangar service timers are not resumed across sessions; rescue to idle and release slot
        this.releaseHangarSlot(ship)
        ship.shipState = 'idle'
        ship.pushToStore()
      } else if (ship.shipState === 'coasting') {
        ship.shipState = 'traveling-to-base'
        ship.target = { x: this.base.x, y: this.base.y }
        ship.pushToStore()
      } else if (ship.shipState === 'fetching-station-miner') {
        ship.shipState = 'idle'
        ship.target = null
        ship.pushToStore()
      } else if (ship.shipState === 'collecting-nets') {
        this.departShipForBase(ship)
      } else if (ship.shipState === 'resupplying-miner' && ship.asteroidTarget !== null) {
        // Complete the resupply immediately
        const miner = this.autoMiners.find(m => m.asteroidId === ship.asteroidTarget!.id)
        const netStoreSlot = ship.attachmentPoints.find(ap => ap.payload?.kind === 'net-store')
        const transferred =
          netStoreSlot?.payload?.kind === 'net-store'
            ? Math.min(MINER_INITIAL_NETS + 1, netStoreSlot.payload.currentNets)
            : 0
        if (miner && transferred > 0 && netStoreSlot?.payload?.kind === 'net-store') {
          netStoreSlot.payload.currentNets -= transferred
          miner.spareNetCount += transferred - 1
          miner.state = 'mining'
        }
        ship.shipState = 'waiting-at-asteroid'
      } else if (ship.shipState === 'resupplying-miner') {
        ship.shipState = 'waiting-at-asteroid'
      } else if (ship.shipState === 'responding-to-beacon' || ship.shipState === 'loading-miner') {
        ship.shipState = 'idle'
        ship.asteroidTarget = null
        // Clear any pre-assigned auto-miner slot so the miner can re-beacon
        for (const ap of ship.attachmentPoints) {
          if (ap.payload?.kind === 'auto-miner') {
            const miner = this.autoMinerMap.get(ap.payload.minerId)
            if (miner && miner.state === 'in-transit') {
              miner.state = 'standby-beaconing'
              miner.beaconReason = 'depleted'
              miner.setVisible(true)
            }
            ap.payload = null
          }
        }
      }
    }

    // Rescue drifting miners: treat as standby-beaconing (retry is lost but miner is recoverable)
    // Rescue station-repair miners: timer is not resumed; try re-store or eject to beacon
    for (const miner of this.autoMiners) {
      if (miner.state === 'drifting') {
        miner.state = 'standby-beaconing'
        miner.beaconReason = 'stuck'
      } else if (miner.state === 'station-repair') {
        if (this.base.storeAutoMiner(miner.id)) {
          miner.state = 'station-stored'
        } else {
          miner.freeOrbitalRadius = BASE_Y
          miner.freeOrbitalAngle = Math.atan2(BASE_Y, BASE_X) + 0.15
          miner.setPosition(
            Math.cos(miner.freeOrbitalAngle) * miner.freeOrbitalRadius,
            Math.sin(miner.freeOrbitalAngle) * miner.freeOrbitalRadius - 20,
          )
          miner.state = 'standby-beaconing'
          miner.beaconReason = 'depleted'
          miner.setVisible(true)
        }
      }
    }

    // Populate active beacons from miners still beaconing after rescue
    const beaconList: BeaconData[] = []
    for (const miner of this.autoMiners) {
      if (miner.state === 'standby-beaconing') {
        beaconList.push({ id: miner.id, x: miner.x, y: miner.y })
        miner.startBeacon()
      }
    }
    activeBeacons.set(beaconList)

    // Restore designations; drop any whose asteroid is gone; demote claimed with missing ship
    const shipIds = new Set(this.ships.map(s => s.id))
    const asteroidIds = new Set(this.asteroids.map(a => a.id))
    this.designations = (save.designations ?? [])
      .filter(d => asteroidIds.has(d.asteroidId))
      .map(d => {
        if (d.status === 'claimed' && d.claimedByShipId !== null && !shipIds.has(d.claimedByShipId)) {
          return { ...d, status: 'queued' as const, claimedByShipId: null }
        }
        return { ...d }
      })
    designationQueue.set([...this.designations])
  }

  private buildSaveState(): SaveState {
    return {
      schemaVersion: 21,
      worldSeed: gameState.worldSeed,
      gameClock: this.gameClock,
      base: {
        storage: { ...this.base.storage },
        credits: this.base.credits,
        ownedDockCount: this.base.ownedDockCount,
        ownedHangarCount: this.base.ownedHangarCount,
        hangarPressurized: this.base.hangarPressurized,
        stationMinerSlotCount: this.base.stationMinerSlotCount,
        stationMinerIds: [...this.base.stationMinerIds],
        autoDesignate: this.base.autoDesignate,
      },
      asteroids: this.asteroids.map(a => ({
        id: a.id,
        x: a.x,
        y: a.y,
        orbitalRadius: a.orbitalRadius,
        orbitalAngle: a.orbitalAngle,
        resourceType: a.resourceType,
        sizeCategory: a.sizeCategory,
        currentQuantity: a.currentQuantity,
        maxQuantity: a.maxQuantity,
        isCompany: a.isCompany,
      })),
      ships: this.ships.map(s => ({
        id: s.id,
        name: s.shipName,
        x: s.x,
        y: s.y,
        heading: s.heading,
        shipState: s.shipState,
        target: s.target,
        asteroidTargetId: s.asteroidTarget?.id ?? null,
        cargoContents: { ...s.cargoContents },
        cargoCapacity: s.cargoCapacity,
        cargoUpgradeLevel: s.cargoUpgradeLevel,
        attachmentPoints: s.attachmentPoints,
        unloadTimer: s.unloadTimer,
        attachUnloadTimer: s.attachUnloadTimer,
        waitOrbitalAngle: s.waitOrbitalAngle,
        dockSlotIndex: s.dockSlotIndex,
        hangarSlotIndex: s.hangarSlotIndex,
        hangarServiceTimer: s.hangarServiceTimer,
        thrusterFuel: s.thrusterFuel,
        rcsFuel: s.rcsFuel,
        battery: s.battery,
        chargeToggle: s.chargeToggle,
      })),
      autoMiners: this.autoMiners.map(m => ({
        id: m.id,
        state: m.state,
        condition: m.condition,
        asteroidId: m.asteroidId,
        freeOrbitalRadius: m.freeOrbitalRadius,
        freeOrbitalAngle: m.freeOrbitalAngle,
        technologyLevel: m.technologyLevel,
        spareNetCount: m.spareNetCount,
        activeNetFill: m.activeNetFill,
        tetheredNetIds: [...m.tetheredNetIds],
        battery: m.battery,
        rcsFuel: m.rcsFuel,
        beaconReason: m.beaconReason,
      })),
      cargoNets: this.cargoNets
        .filter(n => n.state === 'full-tethered')
        .map(n => ({
          id: n.id,
          state: n.state,
          resourceType: n.resourceType,
          quantity: n.quantity,
          asteroidId: n.asteroidId,
          freeOrbitalRadius: n.freeOrbitalRadius,
          freeOrbitalAngle: n.freeOrbitalAngle,
          designatedForCollection: n.designatedForCollection,
        })),
      designations: this.designations.map(d => ({
        id: d.id,
        asteroidId: d.asteroidId,
        status: d.status,
        claimedByShipId: d.claimedByShipId,
      })),
    }
  }

  private generateAsteroidTextures(): void {
    const resourceTypes = Object.keys(RESOURCE_COLORS) as ResourceType[]
    for (const type of resourceTypes) {
      const key = `asteroid-${type}`
      if (this.textures.exists(key)) continue
      const color = RESOURCE_COLORS[type]
      const s = ASTEROID_TEXTURE_SIZE
      const r = s / 2
      const gfx = this.make.graphics({ x: 0, y: 0 })
      gfx.fillStyle(color, 1)
      gfx.fillCircle(r, r, r)
      gfx.lineStyle(1, 0xffffff, 0.25)
      gfx.strokeCircle(r, r, r - 1)
      gfx.generateTexture(key, s, s)
      gfx.destroy()
    }
  }

  private spawnPlanet(): void {
    new Planet(this)
  }

  private spawnWorld(): void {
    const seed = Math.floor(Math.random() * 0x100000000)
    gameState.worldSeed = seed
    const asteroidData = generateWorld(seed)
    this.asteroids = asteroidData.map(data => new Asteroid(this, data))
    this.asteroidMap = new Map(this.asteroids.map(a => [a.id, a]))
  }

  private spawnBase(): void {
    this.base = new Base(this, BASE_X, BASE_Y)
    this.add
      .text(BASE_X, BASE_Y + 40, 'BASE', {
        color: '#88ccff',
        fontSize: '12px',
        fontFamily: 'monospace',
      })
      .setOrigin(0.5, 0)
    this.initSlots()
    this.initHangars()
  }

  private initSlots(): void {
    this.slotPositions = computeServiceSlots(BASE_X, BASE_Y)
    this.slotOccupants = Array(SERVICE_SLOT_COUNT).fill(null)
    const gfx = this.add.graphics()
    gfx.lineStyle(1, 0x88ccff, 0.25)
    for (const slot of this.slotPositions) {
      gfx.strokeCircle(slot.x, slot.y, 8)
    }
  }

  private initHangars(): void {
    this.hangarPositions = computeHangarBays(BASE_X, BASE_Y)
    this.hangarOccupants = Array(HANGAR_BAY_COUNT).fill(null)
    const gfx = this.add.graphics()
    gfx.lineStyle(1, 0xffaa44, 0.30)
    for (const bay of this.hangarPositions) {
      gfx.strokeCircle(bay.x, bay.y, 12)
    }
  }

  /** Pushes station capacity/usage to the UI store (change-guarded). */
  private pushStationUsage(): void {
    const docksInUse = this.slotOccupants.filter(o => o !== null).length
    const publicDocksInUse = this.slotOccupants.filter((o, i) => o !== null && i >= this.base.ownedDockCount).length
    const hangarsInUse = this.hangarOccupants.filter(o => o !== null).length
    const publicHangarsInUse = this.hangarOccupants.filter((o, i) => o !== null && i >= this.base.ownedHangarCount).length
    const usage = {
      minersStored: this.base.stationMinerIds.length,
      minerSlots: this.base.stationMinerSlotCount,
      docksInUse,
      docksTotal: SERVICE_SLOT_COUNT,
      publicDocksInUse,
      hangarsInUse,
      hangarsTotal: HANGAR_BAY_COUNT,
      publicHangarsInUse,
    }
    const key = JSON.stringify(usage)
    if (key === this.lastStationUsageKey) return
    this.lastStationUsageKey = key
    stationUsage.set(usage)
  }

  private lastStationUsageKey = ''

  private assignDockSlot(ship: Ship): SlotPosition | null {
    const idx = this.slotOccupants.findIndex(occ => occ === null)
    if (idx < 0) return null
    this.slotOccupants[idx] = ship.id
    ship.dockSlotIndex = idx
    return this.slotPositions[idx]
  }

  private releaseDockSlot(ship: Ship): void {
    const idx = ship.dockSlotIndex
    if (idx !== null && idx >= 0 && idx < this.slotOccupants.length) {
      this.slotOccupants[idx] = null
    }
    ship.dockSlotIndex = null
  }

  private departShipForBase(ship: Ship): void {
    const slot = this.assignDockSlot(ship)
    ship.departForBase(slot ?? undefined)
  }

  private assignHangarSlot(ship: Ship): HangarPosition | null {
    const idx = this.hangarOccupants.findIndex(occ => occ === null)
    if (idx < 0) return null
    this.hangarOccupants[idx] = ship.id
    ship.hangarSlotIndex = idx
    return this.hangarPositions[idx]
  }

  private releaseHangarSlot(ship: Ship): void {
    const idx = ship.hangarSlotIndex
    if (idx !== null && idx >= 0 && idx < this.hangarOccupants.length) {
      this.hangarOccupants[idx] = null
    }
    ship.hangarSlotIndex = null
  }

  beginHangarService(ship: Ship, baseDuration: number): boolean {
    const slotPos = this.assignHangarSlot(ship)
    if (slotPos === null) return false
    const isOwnedBay = ship.hangarSlotIndex !== null && ship.hangarSlotIndex < this.base.ownedHangarCount
    const duration = (isOwnedBay && this.base.hangarPressurized)
      ? baseDuration * HANGAR_PRESSURIZED_FACTOR
      : baseDuration
    ship.enterHangar(slotPos, duration)
    return true
  }

  private spawnStarterShip(): void {
    const ship = new Ship(this, BASE_X, BASE_Y, 'Hauler-01', { x: BASE_X, y: BASE_Y }, this.base)

    // Pre-load one AutoMiner on the first medium attachment point
    const miner = new AutoMiner(this)
    this.autoMiners.push(miner)
    this.autoMinerMap.set(miner.id, miner)
    this.attachMinerEvents(miner)
    const mediumSlot = ship.attachmentPoints.find(ap => ap.size === 'medium' && ap.payload === null)
    if (mediumSlot) {
      mediumSlot.payload = { kind: 'auto-miner', minerId: miner.id }
    }

    this.ships.push(ship)
    this.base.registerShip(ship.id)
    this.attachShipEvents(ship)
  }

  private attachShipInput(ship: Ship): void {
    ship.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (!pointer.leftButtonDown()) return
      this.selectShip(ship)
    })
  }

  private attachShipEvents(ship: Ship): void {
    this.attachShipInput(ship)
    ship.on('begin-unloading', () => this.processNetUnloading(ship))
    ship.on('attachment-unload-tick', () => this.processAttachmentUnloadTick(ship))
    ship.on('fuel-dry', () => {
      this.pushAttachNotification(`${ship.shipName} out of fuel — coasting`, true)
      this.time.delayedCall(1000, () => {
        if (ship.shipState === 'coasting') {
          // Release any designation this ship had claimed (so it re-queues) and go
          // home via departShipForBase, which clears asteroidTarget — leaving a
          // stale target would permanently block that asteroid's dispatch.
          const claimed = this.designations.find(d => d.claimedByShipId === ship.id)
          if (claimed) this.releaseDesignation(claimed.id)
          this.departShipForBase(ship)
        }
      })
    })
    ship.on('unload-complete', () => {
      this.base.chargeDockFee(ship.dockSlotIndex)
      this.releaseDockSlot(ship)
      if (ship.thrusterFuel < HAULER_FUEL_MAX || ship.rcsFuel < HAULER_RCS_MAX) {
        this.base.credits -= getPrice('dock-refuel')
        this.base.pushToStore()
        ship.thrusterFuel = HAULER_FUEL_MAX
        ship.rcsFuel = HAULER_RCS_MAX
      }
      ship.battery = HAULER_BATTERY_MAX
      ship.pushToStore()
    })
    ship.on('hangar-service-complete', () => {
      this.base.chargeHangarFee(ship.hangarSlotIndex)
      this.releaseHangarSlot(ship)
      const pendingStat = this.shipPendingUpgrades.get(ship.id)
      if (pendingStat) {
        this.shipPendingUpgrades.delete(ship.id)
        this.applyUpgradeStat(ship, pendingStat)
      }
    })
  }

  private attachMinerEvents(miner: AutoMiner): void {
    miner.on('net-ejected', (net: CargoNet) => {
      this.cargoNets.push(net)
      this.cargoNetMap.set(net.id, net)
    })
    miner.on('beacon-emitted', (data: BeaconData) => {
      activeBeacons.update(beacons => {
        const idx = beacons.findIndex(b => b.id === data.id)
        if (idx >= 0) {
          const updated = [...beacons]
          updated[idx] = data
          return updated
        }
        return [...beacons, data]
      })
    })
  }

  private beginCollecting(ship: Ship, miner: AutoMiner, onComplete?: () => void): void {
    const complete = onComplete ?? (() => this.departShipForBase(ship))

    const fullNetIds = miner.tetheredNetIds.filter(id => {
      const net = this.cargoNetMap.get(id)
      return net?.state === 'full-tethered'
    })

    // Build indexed list of empty medium slots so we can track progress per slot
    const emptyMediumSlotPairs = ship.attachmentPoints
      .map((ap, idx) => ({ ap, idx }))
      .filter(({ ap }) => ap.size === 'medium' && ap.payload === null)

    const collectCount = Math.min(fullNetIds.length, emptyMediumSlotPairs.length)

    if (collectCount === 0) {
      complete()
      return
    }

    // Reserve the target medium slots for the duration of the collection
    // animation (prevents double-booking); each becomes a real cargo-net payload
    // when its net's tween completes.
    for (let i = 0; i < collectCount; i++) {
      emptyMediumSlotPairs[i].ap.payload = { kind: 'reserved', forKind: 'cargo-net', targetId: fullNetIds[i] }
    }

    // beginCollecting clears collectSlotProgress; init progress entries after the call
    ship.beginCollecting()
    for (let i = 0; i < collectCount; i++) {
      ship.collectSlotProgress.set(emptyMediumSlotPairs[i].idx, 0)
    }

    let pending = collectCount
    for (let i = 0; i < collectCount; i++) {
      const netId = fullNetIds[i]
      const net = this.cargoNetMap.get(netId)!
      const slot = emptyMediumSlotPairs[i].ap
      const slotIdx = emptyMediumSlotPairs[i].idx
      this.tweens.add({
        targets: net,
        x: ship.x,
        y: ship.y,
        delay: i * NET_COLLECT_DURATION_MS,
        duration: NET_COLLECT_DURATION_MS,
        ease: 'Power2',
        onUpdate: (tween) => {
          ship.collectSlotProgress.set(slotIdx, tween.progress)
          ship.pushToStore()
        },
        onComplete: () => {
          // Convert the reservation into the real carried-net payload on pickup.
          slot.payload = { kind: 'cargo-net', netId }
          // Apply leakage exactly once at full-tethered → in-transit transition
          net.quantity = Math.floor(net.quantity * (1 - NET_LEAKAGE_FRACTION))
          net.state = 'in-transit'
          net.setVisible(false)
          miner.tetheredNetIds = miner.tetheredNetIds.filter(id => id !== netId)
          ship.pushToStore()
          pending--
          if (pending === 0) {
            complete()
          }
        },
      })
    }
  }

  private processNetUnloading(ship: Ship): void {
    for (const ap of ship.attachmentPoints) {
      // cargo-net slots are handled by the attachment unload timer (processAttachmentNets)
      if (ap.payload?.kind === 'auto-miner') {
        const miner = this.autoMinerMap.get(ap.payload.minerId)
        if (miner) {
          for (const netId of miner.tetheredNetIds) {
            const net = this.cargoNetMap.get(netId)
            if (net) {
              this.base.acceptCargo({ [net.resourceType]: net.quantity })
              this.cargoNetMap.delete(net.id)
              this.cargoNets = this.cargoNets.filter(n => n.id !== net.id)
              if (this.selectedCargoNetEntity === net) this.selectedCargoNetEntity = null
              net.destroy()
            }
          }
          miner.tetheredNetIds = []
          // In-transit miner storage is handled by the timed attachment-unload
          // phase (processAttachmentUnloadTick), not instantly here.
        }
      }
    }

    // Refill NetStore after unload
    const netStoreSlot = ship.attachmentPoints.find(ap => ap.payload?.kind === 'net-store')
    if (netStoreSlot?.payload?.kind === 'net-store') {
      netStoreSlot.payload.currentNets = netStoreSlot.payload.maxNets
    }

    this.base.pushToStore()
    ship.pushToStore()
  }

  /**
   * Processes one attachment item per ~1.5 s timer during unload, then re-arms:
   * drains a cargo-net if any, otherwise stores+recharges one in-transit miner
   * into station storage (when a slot is free). An in-transit miner that cannot
   * be stored (storage full) is left on the hauler for the idle-carrier loop.
   */
  private processAttachmentUnloadTick(ship: Ship): void {
    const netAp = ship.attachmentPoints.find(a => a.payload?.kind === 'cargo-net')
    if (netAp && netAp.payload?.kind === 'cargo-net') {
      const net = this.cargoNetMap.get(netAp.payload.netId)
      if (net) {
        this.base.acceptCargo({ [net.resourceType]: net.quantity })
        this.cargoNetMap.delete(net.id)
        this.cargoNets = this.cargoNets.filter(n => n.id !== net.id)
        if (this.selectedCargoNetEntity === net) this.selectedCargoNetEntity = null
        net.destroy()
      }
      netAp.payload = null
    } else {
      // No nets left: store one in-transit miner this tick (if storage is free).
      const minerAp = ship.attachmentPoints.find(
        a => a.payload?.kind === 'auto-miner' &&
             this.autoMinerMap.get(a.payload.minerId)?.state === 'in-transit',
      )
      if (minerAp && minerAp.payload?.kind === 'auto-miner') {
        const miner = this.autoMinerMap.get(minerAp.payload.minerId)
        if (miner && this.base.storeAutoMiner(miner.id)) {
          this.rechargeMinerAtStation(miner)
          miner.state = 'station-stored'
          miner.setVisible(false)
          minerAp.payload = null
          miner.pushToStore()
        }
      }
    }
    ship.armNextAttachUnload(this.shipHasUnloadItem(ship))
    this.base.pushToStore()
    ship.pushToStore()
  }

  /** True if the ship still has an attachment item to unload (net, or storable miner). */
  private shipHasUnloadItem(ship: Ship): boolean {
    const hasNet = ship.attachmentPoints.some(a => a.payload?.kind === 'cargo-net')
    if (hasNet) return true
    if (this.base.stationMinerIds.length >= this.base.stationMinerSlotCount) return false
    return ship.attachmentPoints.some(
      a => a.payload?.kind === 'auto-miner' &&
           this.autoMinerMap.get(a.payload.minerId)?.state === 'in-transit',
    )
  }

  private autoDispatch(): void {
    // An idle hauler should never retain an asteroid target; a stale one (e.g. from
    // an out-of-fuel divert) would permanently mark that asteroid "already
    // dispatched" and block its designation. Clear defensively.
    for (const ship of this.ships) {
      if (ship.shipState === 'idle' && ship.asteroidTarget !== null) ship.asteroidTarget = null
    }

    // Idle carriers at base: recharge their in-transit miners (so a drained miner
    // is never redeployed) and store them in station storage when possible. Runs
    // before dispatch so deployment uses charged miners. Deployment itself is
    // designation-driven only — there is no auto-deploy to arbitrary asteroids.
    for (const ship of this.ships) {
      if (ship.shipState !== 'idle') continue
      if (Phaser.Math.Distance.Between(ship.x, ship.y, BASE_X, BASE_Y) >= PROXIMITY_BASE_RADIUS) continue
      for (const ap of ship.attachmentPoints) {
        if (ap.payload?.kind !== 'auto-miner') continue
        const miner = this.autoMinerMap.get(ap.payload.minerId)
        if (!miner || miner.state !== 'in-transit') continue
        this.rechargeMinerAtStation(miner)
        if (this.base.storeAutoMiner(miner.id)) {
          miner.state = 'station-stored'
          miner.setVisible(false)
          ap.payload = null
          miner.pushToStore()
        }
      }
    }

    // Reconcile fulfilled designations: if the asteroid still exists but no miner
    // is attached to it any more (recovered, low-battery, or destroyed), revert to
    // queued so a replacement is (re)dispatched. Depleted asteroids are retired
    // elsewhere, so their designations are already gone.
    let reconciled = false
    for (const d of this.designations) {
      if (d.status !== 'fulfilled') continue
      if (!this.asteroidMap.has(d.asteroidId)) continue
      if (this.autoMiners.some(m => m.asteroidId === d.asteroidId)) continue
      d.status = 'queued'
      d.claimedByShipId = null
      reconciled = true
    }
    if (reconciled) designationQueue.set([...this.designations])

    // Fulfil queued mining designations
    for (const designation of [...this.designations]) {
      if (designation.status !== 'queued') continue
      const asteroid = this.asteroidMap.get(designation.asteroidId)
      if (!asteroid) {
        this.retireDesignationsForAsteroid(designation.asteroidId)
        continue
      }
      // Leave the designation queued while the asteroid is in its post-exhaustion
      // cooldown, rather than dispatching a hauler that would just fail again.
      if (this.isAsteroidOnCooldown(designation.asteroidId)) continue
      // Skip if a ship is already heading to this asteroid or fetching miner for it
      const alreadyDispatched =
        this.ships.some(s => s.asteroidTarget?.id === designation.asteroidId) ||
        [...this.shipPendingDesignationAsteroid.values()].includes(designation.asteroidId)
      if (alreadyDispatched) continue

      const hauler = selectHaulerForDesignation(
        this.ships,
        this.base.stationMinerIds.length > 0,
        minerId => {
          const m = this.autoMinerMap.get(minerId)
          return !!m && m.tetheredNetIds.length === 0 && m.activeNetFill === 0
        },
      )
      if (!hauler) continue

      if (!this.claimDesignation(designation.id, hauler.id)) continue

      const hasMiner = hauler.attachmentPoints.some(
        ap => ap.size === 'medium' && ap.payload?.kind === 'auto-miner',
      )

      if (hasMiner) {
        hauler.asteroidTarget = asteroid
        hauler.target = { x: asteroid.x, y: asteroid.y }
        hauler.shipState = 'traveling-to-asteroid'
        hauler.pushToStore()
      } else {
        // Check if the station-stored miner is below condition threshold — if so, repair instead
        const storedMinerId = this.base.stationMinerIds[0]
        const storedMiner = storedMinerId ? this.autoMinerMap.get(storedMinerId) : null
        if (storedMiner && storedMiner.condition < CONDITION_CAP_THRESHOLD) {
          this.releaseDesignation(designation.id)
          this.initiateRepair(storedMinerId)
          continue
        }
        this.shipPendingDesignationAsteroid.set(hauler.id, designation.asteroidId)
        hauler.target = { x: this.base.x, y: this.base.y }
        hauler.shipState = 'fetching-station-miner'
        hauler.pushToStore()
      }
    }

    for (const miner of this.autoMiners) {
      // Free-orbiting miner: use existing beacon-response flow (initiateRespondToBeacon
      // self-guards against double-claim via isMinerBeingRecovered).
      if (miner.freeOrbitalRadius !== null && miner.state === 'standby-beaconing') {
        this.initiateRespondToBeacon(miner.id)
        continue
      }

      if (!miner.asteroidId) continue
      const asteroid = this.asteroidMap.get(miner.asteroidId)
      if (!asteroid) continue

      const shipEnRoute = this.ships.some(s => s.asteroidTarget?.id === miner.asteroidId)
      if (shipEnRoute) continue

      if (miner.state === 'standby-beaconing') {
        this.dispatchToAsteroid(asteroid)
      } else if (miner.state === 'net-starved') {
        this.dispatchToAsteroid(asteroid)
      } else if (miner.state === 'mining' || miner.state === 'ejecting-net') {
        const fullNets = miner.tetheredNetIds.filter(id => this.cargoNetMap.get(id)?.state === 'full-tethered')
        if (fullNets.length > 0) this.dispatchToAsteroid(asteroid)
      }
    }

    // Dispatch haulers to collect player-designated orphaned nets.
    for (const net of this.cargoNets) {
      if (net.designatedForCollection && net.freeOrbitalRadius !== null && net.state === 'full-tethered') {
        this.initiateCollectOrphanNet(net.id)
      }
    }

    // Un-stick haulers waiting at an asteroid that has nothing actionable left
    // (its miner was destroyed on a re-attach, went dark, or was recovered, and
    // there are no collectable nets) — they would otherwise wait forever.
    for (const ship of this.ships) {
      if (ship.shipState !== 'waiting-at-asteroid' || !ship.asteroidTarget) continue
      if (this.shipAttachManeuver.has(ship.id)) continue // mid attach maneuver
      const aId = ship.asteroidTarget.id
      const asteroidGone = !this.asteroidMap.has(aId)
      const hasActionableMiner = this.autoMiners.some(
        m => m.asteroidId === aId &&
          (m.state === 'mining' || m.state === 'net-starved' || m.state === 'ejecting-net' ||
           m.state === 'attaching' || m.state === 'deploying' || m.state === 'drifting' ||
           m.state === 'standby-beaconing'),
      )
      const hasCollectableNets = this.autoMiners.some(
        m => m.asteroidId === aId &&
          m.tetheredNetIds.some(id => this.cargoNetMap.get(id)?.state === 'full-tethered'),
      )
      if (asteroidGone || (!hasActionableMiner && !hasCollectableNets)) {
        this.departShipForBase(ship)
      }
    }

    // (Removed the unconditional "deploy carried miners to nearest asteroid" loop:
    // deployment is now designation-driven only, and idle carriers recharge/store
    // their miners at base via the loop at the top of this method.)
  }

  private dispatchToAsteroid(asteroid: Asteroid): void {
    const nearest = selectDispatchTarget(this.ships, asteroid)
    if (!nearest) return
    nearest.asteroidTarget = asteroid
    nearest.target = { x: asteroid.x, y: asteroid.y }
    nearest.shipState = 'traveling-to-asteroid'
    nearest.pushToStore()
  }

  private performAtAsteroidRecovery(ship: Ship, miner: AutoMiner): void {
    miner.asteroidId = null
    miner.state = 'in-transit'
    miner.beaconReason = null
    miner.setVisible(false)
    // Any nets that did not fit are orphaned to free-orbit (recoverable), not lost.
    this.orphanRemainingNets(miner)
    miner.stopBeacon()
    activeBeacons.update(beacons => beacons.filter(b => b.id !== miner.id))
    miner.pushToStore()
    this.departShipForBase(ship)
  }

  private drawTethers(): void {
    if (!this.tetherGfx) return
    this.tetherGfx.clear()
    this.tetherGfx.lineStyle(1, TETHER_LINE_COLOR, TETHER_LINE_ALPHA)
    for (const miner of this.autoMiners) {
      if (!miner.visible) continue
      for (const netId of miner.tetheredNetIds) {
        const net = this.cargoNetMap.get(netId)
        if (net && net.visible) {
          this.tetherGfx.lineBetween(miner.x, miner.y, net.x, net.y)
        }
      }
    }
  }

  private selectShip(ship: Ship): void {
    if (this.selectedShip === ship) return
    this.clearSelection()
    this.selectedShip = ship
    this.selectionRing = this.add.graphics()
    this.selectionRing.setDepth(ship.depth - 1)
    this.drawSelectionRing()
    ship.select()
  }

  private clearSelection(): void {
    this.cancelFollowCam()
    if (this.selectedShip) {
      this.selectedShip.deselect()
      this.selectedShip = null
    }
    if (this.selectionRing) {
      this.selectionRing.destroy()
      this.selectionRing = null
    }
    if (this.selectedAutoMinerEntity) {
      this.selectedAutoMinerEntity.deselect()
      this.selectedAutoMinerEntity = null
    }
    if (this.selectedCargoNetEntity) {
      this.selectedCargoNetEntity.deselect()
      this.selectedCargoNetEntity = null
    }
    selectedAsteroid.set(null)
  }

  private drawSelectionRing(): void {
    if (!this.selectionRing || !this.selectedShip) return
    this.selectionRing.clear()
    this.selectionRing.lineStyle(2, SELECTION_RING_COLOR, SELECTION_RING_ALPHA)
    this.selectionRing.strokeCircle(
      this.selectedShip.x,
      this.selectedShip.y,
      SELECTION_RING_RADIUS,
    )
  }

  private toggleFollowCam(): void {
    if (!this.selectedShip) return
    if (this.followCam) {
      this.cancelFollowCam()
    } else {
      this.followCam = true
      this.cameras.main.startFollow(this.selectedShip, false, 1, 1)
    }
  }

  private cancelFollowCam(): void {
    this.followCam = false
    this.cameras.main.stopFollow()
  }

  private computeSpeedMultiplier(ship: Ship): number {
    let m = 1.0

    const dPlanet = Math.sqrt(ship.x * ship.x + ship.y * ship.y)
    if (dPlanet < PROXIMITY_PLANET_RADIUS) {
      m = Math.min(m, Math.max(PROXIMITY_MIN_SPEED, dPlanet / PROXIMITY_PLANET_RADIUS))
    }

    const dBase = Phaser.Math.Distance.Between(ship.x, ship.y, BASE_X, BASE_Y)
    if (dBase < PROXIMITY_BASE_RADIUS) {
      m = Math.min(m, Math.max(PROXIMITY_MIN_SPEED, dBase / PROXIMITY_BASE_RADIUS))
    }

    for (const asteroid of this.asteroids) {
      const dAst = Phaser.Math.Distance.Between(ship.x, ship.y, asteroid.x, asteroid.y)
      if (dAst < PROXIMITY_ASTEROID_RADIUS) {
        m = Math.min(m, Math.max(PROXIMITY_MIN_SPEED, dAst / PROXIMITY_ASTEROID_RADIUS))
      }
    }

    return m
  }

  private drawMinimap(): void {
    const zoom = this.cameras.main.zoom
    const hw = this.scale.width / 2
    const hh = this.scale.height / 2
    const targetX = this.scale.width - MINIMAP_SIZE - MINIMAP_MARGIN
    const targetY = MINIMAP_MARGIN
    const drawX = hw + (targetX - hw) / zoom
    const drawY = hh + (targetY - hh) / zoom
    const drawSize = MINIMAP_SIZE / zoom

    this.minimap.clear()

    this.minimap.fillStyle(MINIMAP_COLOR_BG, MINIMAP_ALPHA)
    this.minimap.fillRect(drawX, drawY, drawSize, drawSize)
    this.minimap.lineStyle(1 / zoom, MINIMAP_COLOR_BORDER, 0.9)
    this.minimap.strokeRect(drawX, drawY, drawSize, drawSize)

    const wx = (worldX: number) => drawX + (worldX / WORLD_SIZE + 0.5) * drawSize
    const wy = (worldY: number) => drawY + (worldY / WORLD_SIZE + 0.5) * drawSize

    this.minimap.fillStyle(MINIMAP_COLOR_PLANET, 0.9)
    this.minimap.fillCircle(wx(0), wy(0), MINIMAP_DOT_PLANET / zoom)

    this.minimap.fillStyle(MINIMAP_COLOR_BASE, 1)
    const baseHalf = MINIMAP_DOT_BASE / zoom / 2
    this.minimap.fillRect(wx(BASE_X) - baseHalf, wy(BASE_Y) - baseHalf, MINIMAP_DOT_BASE / zoom, MINIMAP_DOT_BASE / zoom)

    for (const asteroid of this.asteroids) {
      const color = asteroid.isCompany ? MINIMAP_COLOR_COMPANY : MINIMAP_COLOR_ASTEROID
      this.minimap.fillStyle(color, 0.85)
      this.minimap.fillCircle(wx(asteroid.x), wy(asteroid.y), MINIMAP_DOT_ASTEROID / zoom)
    }

    for (const ship of this.ships) {
      this.minimap.fillStyle(MINIMAP_COLOR_SHIP, 1)
      this.minimap.fillCircle(wx(ship.x), wy(ship.y), MINIMAP_DOT_SHIP / zoom)
    }

    for (const miner of this.autoMiners) {
      if (miner.state === 'standby-beaconing') {
        this.minimap.fillStyle(MINIMAP_COLOR_BEACON, 1)
        this.minimap.fillCircle(wx(miner.x), wy(miner.y), MINIMAP_DOT_ASTEROID / zoom)
      }
    }
  }

  private companyArrivalInterval(): number {
    const natural = this.asteroids.filter(a => !a.isCompany)
    if (natural.length === 0) return COMPANY_ARRIVAL_MIN_INTERVAL
    const totalMax = natural.reduce((sum, a) => sum + a.maxQuantity, 0)
    const totalCurrent = natural.reduce((sum, a) => sum + a.currentQuantity, 0)
    const fraction = totalMax > 0 ? totalCurrent / totalMax : 0
    return COMPANY_ARRIVAL_MIN_INTERVAL +
      (COMPANY_ARRIVAL_BASE_INTERVAL - COMPANY_ARRIVAL_MIN_INTERVAL) * fraction
  }

  private trySpawnCompanyAsteroid(): void {
    const liveCount = this.asteroids.filter(a => a.isCompany).length
    if (liveCount >= COMPANY_ASTEROID_MAX_COUNT) return
    const seed = Math.floor(Math.random() * 0x100000000)
    const data = generateCompanyAsteroid(seed)
    const asteroid = new Asteroid(this, data)
    this.asteroids.push(asteroid)
    this.asteroidMap.set(asteroid.id, asteroid)
    if (this.base.autoDesignate) {
      this.addDesignation(asteroid.id)
    }
  }

  private buildStarLayers(): void {
    const { width, height } = this.scale

    for (const layer of STAR_LAYERS) {
      const gfx = this.make.graphics({ x: 0, y: 0 })
      for (let i = 0; i < layer.count; i++) {
        const x = Phaser.Math.Between(0, STAR_TEXTURE_SIZE - 1)
        const y = Phaser.Math.Between(0, STAR_TEXTURE_SIZE - 1)
        const brightness = Phaser.Math.Between(layer.brightMin, 255)
        const size = Math.random() < layer.largeChance ? 2 : 1
        gfx.fillStyle(Phaser.Display.Color.GetColor(brightness, brightness, brightness), 1)
        gfx.fillRect(x, y, size, size)
      }
      gfx.generateTexture(layer.key, STAR_TEXTURE_SIZE, STAR_TEXTURE_SIZE)
      gfx.destroy()

      const sprite = this.add.tileSprite(0, 0, width, height, layer.key)
      sprite.setOrigin(0, 0)
      sprite.setScrollFactor(0)
      this.starLayers.push(sprite)
    }
  }

  private setupCamera(): void {
    const cam = this.cameras.main
    const half = WORLD_SIZE / 2
    cam.setBounds(-half, -half, WORLD_SIZE, WORLD_SIZE)
    this.minZoom = this.computeMinZoom()
    cam.setZoom(Math.max(1, this.minZoom))
    cam.centerOn(0, 0)
  }

  private computeMinZoom(): number {
    return Math.max(this.scale.width / WORLD_SIZE, this.scale.height / WORLD_SIZE)
  }

  private drainCommandQueue(): void {
    const commands = get(commandQueue)
    if (commands.length === 0) return
    commandQueue.set([])
    for (const cmd of commands) {
      this.handleCommand(cmd)
    }
  }

  private handleCommand(cmd: GameCommand): void {
    if (cmd.type === 'sellResource') {
      this.base.sellResource(cmd.resourceType)
    } else if (cmd.type === 'commissionShip') {
      this.commissionNewShip()
    } else if (cmd.type === 'manualSave') {
      GameSaveService.save(this.buildSaveState())
    } else if (cmd.type === 'upgradeShip') {
      this.initiateShipUpgrade(cmd.shipId, cmd.stat)
    } else if (cmd.type === 'resupplyMiner') {
      this.initiateResupplyMiner(cmd.minerId)
    } else if (cmd.type === 'respondToBeacon') {
      this.initiateRespondToBeacon(cmd.minerId)
    } else if (cmd.type === 'purchaseMiner') {
      this.performPurchaseMiner(cmd.haulerId)
    } else if (cmd.type === 'collectNets') {
      this.initiateCollectNets(cmd.haulerId, cmd.asteroidId)
    } else if (cmd.type === 'purchaseMinerSlot') {
      this.base.purchaseMinerSlot()
    } else if (cmd.type === 'purchaseOwnedDock') {
      this.base.purchaseOwnedDock()
    } else if (cmd.type === 'purchaseHangar') {
      this.base.purchaseHangar()
    } else if (cmd.type === 'purchasePressurization') {
      this.base.purchasePressurization()
    } else if (cmd.type === 'designateAsteroid') {
      this.addDesignation(cmd.asteroidId)
    } else if (cmd.type === 'undesignateAsteroid') {
      this.removeDesignation(cmd.asteroidId)
    } else if (cmd.type === 'collectNet') {
      const net = this.cargoNetMap.get(cmd.netId)
      if (net && net.freeOrbitalRadius !== null && net.state === 'full-tethered') {
        net.designatedForCollection = true
        net.pushToStore()
      }
    } else if (cmd.type === 'repairMiner') {
      this.initiateRepair(cmd.minerId)
    } else if (cmd.type === 'toggleAutoDesignate') {
      this.base.autoDesignate = !this.base.autoDesignate
      this.base.pushToStore()
    } else if (cmd.type === 'toggleMinerCharge') {
      const ship = this.ships.find(s => s.id === cmd.shipId)
      if (ship) {
        ship.chargeToggle = !ship.chargeToggle
        ship.pushToStore()
      }
    }
  }

  private initiateCollectNets(haulerId: string, asteroidId: string): void {
    const ship = this.ships.find(s => s.id === haulerId)
    const asteroid = this.asteroidMap.get(asteroidId)
    if (!ship || !asteroid || ship.shipState !== 'idle') return

    ship.asteroidTarget = asteroid
    ship.target = { x: asteroid.x, y: asteroid.y }
    ship.shipState = 'traveling-to-asteroid'
    ship.pushToStore()
  }

  private asteroidHasTetheredNets(asteroid: Asteroid): boolean {
    return this.autoMiners.some(m => m.asteroidId === asteroid.id && m.tetheredNetIds.length > 0)
  }

  private initiateResupplyMiner(minerId: string): void {
    const miner = this.autoMinerMap.get(minerId)
    if (!miner) return
    const ship = this.ships.find(
      s => s.shipState === 'waiting-at-asteroid' && s.asteroidTarget?.id === miner.asteroidId,
    )
    if (!ship) return
    const netStoreSlot = ship.attachmentPoints.find(ap => ap.payload?.kind === 'net-store')
    if (!netStoreSlot || netStoreSlot.payload?.kind !== 'net-store') return
    if (netStoreSlot.payload.currentNets < 1) return
    this.beginResupply(ship, miner)
  }

  private beginResupply(ship: Ship, miner: AutoMiner): void {
    ship.shipState = 'resupplying-miner'
    ship.pushToStore()

    this.time.delayedCall(RESUPPLY_DURATION_MS, () => {
      const netStoreSlot = ship.attachmentPoints.find(ap => ap.payload?.kind === 'net-store')
      const transferred =
        netStoreSlot?.payload?.kind === 'net-store'
          ? Math.min(MINER_INITIAL_NETS + 1, netStoreSlot.payload.currentNets)
          : 0

      if (transferred > 0 && netStoreSlot?.payload?.kind === 'net-store') {
        netStoreSlot.payload.currentNets -= transferred
        miner.spareNetCount += transferred - 1
        miner.state = 'mining'
        miner.pushToStore()
      } else if (miner.tetheredNetIds.length > 0) {
        this.beginCollecting(ship, miner)
        return
      }

      ship.shipState = 'waiting-at-asteroid'
      ship.pushToStore()
    })
  }

  private initiateRespondToBeacon(minerId: string): void {
    const miner = this.autoMinerMap.get(minerId)
    if (!miner || (miner.state !== 'standby-beaconing' && miner.state !== 'stuck' && miner.state !== 'dark')) return

    // Idempotency: do not dispatch a second hauler to a miner already being
    // recovered by any path (beacon recovery, a reserved/holding slot, or a
    // waiting hauler mid at-asteroid maneuver).
    if (this.isMinerBeingRecovered(minerId)) return

    // Only consider idle haulers that have a free medium slot, so a full idle
    // hauler nearest the beacon does not block recovery by others.
    const nearestIdle = this.ships
      .filter(s => s.shipState === 'idle' && shipHasFreeMediumSlot(s))
      .reduce<Ship | null>((best, s) => {
        if (!best) return s
        const dBest = Phaser.Math.Distance.Between(best.x, best.y, miner.x, miner.y)
        const dS = Phaser.Math.Distance.Between(s.x, s.y, miner.x, miner.y)
        return dS < dBest ? s : best
      }, null)
    if (!nearestIdle) return

    // Reserve the slot (do not write the real miner payload) until the hauler
    // actually reaches and recovers the miner.
    if (!this.claimFreeMediumSlot(nearestIdle, { kind: 'reserved', forKind: 'auto-miner', targetId: miner.id })) return

    nearestIdle.asteroidTarget = null
    nearestIdle.target = { x: miner.x, y: miner.y }
    nearestIdle.shipState = 'responding-to-beacon'
    nearestIdle.pushToStore()
    this.shipMinerRecoveryTargets.set(nearestIdle.id, miner.id)
  }

  /** Dispatches the nearest idle hauler with a free slot to collect an orphaned net. */
  private initiateCollectOrphanNet(netId: string): void {
    const net = this.cargoNetMap.get(netId)
    if (!net || net.freeOrbitalRadius === null || net.state !== 'full-tethered') return
    // Idempotency: not already being collected.
    if ([...this.shipNetRecoveryTargets.values()].includes(netId)) return

    const nearestIdle = this.ships
      .filter(s => s.shipState === 'idle' && shipHasFreeMediumSlot(s))
      .reduce<Ship | null>((best, s) => {
        if (!best) return s
        const dBest = Phaser.Math.Distance.Between(best.x, best.y, net.x, net.y)
        const dS = Phaser.Math.Distance.Between(s.x, s.y, net.x, net.y)
        return dS < dBest ? s : best
      }, null)
    if (!nearestIdle) return

    if (!this.claimFreeMediumSlot(nearestIdle, { kind: 'reserved', forKind: 'cargo-net', targetId: netId })) return

    nearestIdle.asteroidTarget = null
    nearestIdle.target = { x: net.x, y: net.y }
    nearestIdle.shipState = 'responding-to-beacon'
    nearestIdle.pushToStore()
    this.shipNetRecoveryTargets.set(nearestIdle.id, netId)
  }

  /** Collects an orphaned net onto the arriving hauler (resolves its reservation). */
  private collectOrphanNet(ship: Ship, netId: string): void {
    const net = this.cargoNetMap.get(netId)
    if (!net || net.state !== 'full-tethered') {
      this.departShipForBase(ship)
      return
    }
    if (!this.resolveReservation(ship, netId, { kind: 'cargo-net', netId })) {
      // No slot available — leave the net orphaned and re-requestable.
      net.designatedForCollection = false
      net.pushToStore()
      this.departShipForBase(ship)
      return
    }
    net.quantity = Math.floor(net.quantity * (1 - NET_LEAKAGE_FRACTION))
    net.state = 'in-transit'
    net.freeOrbitalRadius = null
    net.freeOrbitalAngle = null
    net.designatedForCollection = false
    net.setVisible(false)
    net.pushToStore()
    this.departShipForBase(ship)
  }

  private handleLoadingMiner(ship: Ship): void {
    // Orphaned-net collection target takes priority (shares the recovery states).
    const netId = this.shipNetRecoveryTargets.get(ship.id)
    if (netId) {
      this.shipNetRecoveryTargets.delete(ship.id)
      this.collectOrphanNet(ship, netId)
      return
    }

    // performRecovery attaches the miner first (its own ~1.5s maneuver step), then
    // collects any tethered nets as separate per-item steps.
    this.performRecovery(ship)
  }

  private removeDepletedAsteroid(asteroid: Asteroid, miner: AutoMiner): void {
    // Handle any ship already waiting at this asteroid before clearing asteroidId
    const waitingShip = this.ships.find(
      s => s.shipState === 'waiting-at-asteroid' && s.asteroidTarget?.id === asteroid.id,
    )
    // If a hauler is loitering here with a free slot, opportunistically recover the
    // miner (plus as many of its nets as fit; the rest orphan to free-orbit) rather
    // than abandoning it. Otherwise just collect its nets and leave it beaconing.
    let minerRecovered = false
    if (waitingShip) {
      waitingShip.asteroidTarget = null
      const freeSlot = waitingShip.attachmentPoints.find(ap => ap.size === 'medium' && ap.payload === null)
      if (freeSlot) {
        freeSlot.payload = { kind: 'auto-miner', minerId: miner.id }
        this.beginCollecting(waitingShip, miner, () => this.performAtAsteroidRecovery(waitingShip, miner))
        minerRecovered = true
      } else {
        this.beginCollecting(waitingShip, miner)
      }
    }

    if (!minerRecovered) {
      // Detach miner into free orbit using asteroid's current orbital parameters
      miner.freeOrbitalRadius = asteroid.orbitalRadius
      miner.freeOrbitalAngle = asteroid.orbitalAngle
      miner.asteroidId = null
    }

    // Detach any other miners still referencing this asteroid (e.g. net-starved, attaching, drifting).
    // Must run before asteroid.destroy() so orbitalRadius/Angle are still valid.
    for (const otherMiner of this.autoMiners) {
      if (otherMiner === miner || otherMiner.asteroidId !== asteroid.id) continue
      otherMiner.freeOrbitalRadius = asteroid.orbitalRadius
      otherMiner.freeOrbitalAngle = asteroid.orbitalAngle
      otherMiner.asteroidId = null
      if (otherMiner.state !== 'standby-beaconing') {
        otherMiner.state = 'standby-beaconing'
        otherMiner.beaconReason = 'depleted'
        otherMiner.startBeacon()
      }
      otherMiner.pushToStore()
    }

    // Cancel ships traveling to this asteroid
    for (const ship of this.ships) {
      if (ship.asteroidTarget?.id === asteroid.id && ship.shipState === 'traveling-to-asteroid') {
        ship.asteroidTarget = null
        ship.shipState = 'idle'
        ship.target = null
        ship.pushToStore()
      }
    }

    // Auto-retire any designations for this depleted asteroid
    this.retireDesignationsForAsteroid(asteroid.id)

    // Remove asteroid from scene
    this.asteroids = this.asteroids.filter(a => a.id !== asteroid.id)
    this.asteroidMap.delete(asteroid.id)
    asteroid.destroy()
  }

  private performRecovery(ship: Ship): void {
    const minerId = this.shipMinerRecoveryTargets.get(ship.id)
    this.shipMinerRecoveryTargets.delete(ship.id)
    if (!minerId) {
      this.departShipForBase(ship)
      return
    }
    const miner = this.autoMinerMap.get(minerId)
    // If the miner was already recovered by another hauler (no longer in a
    // recoverable state), release this ship's reservation and leave — never
    // create a duplicate reference to the same miner.
    if (!miner || (miner.state !== 'standby-beaconing' && miner.state !== 'stuck' && miner.state !== 'dark')) {
      this.releaseReservationFor(ship, minerId)
      this.departShipForBase(ship)
      return
    }
    // Step 1: attach the miner (its own completion). If no slot can hold it, leave
    // the miner recoverable (re-beacon) rather than dropping it.
    if (!this.resolveReservation(ship, minerId, { kind: 'auto-miner', minerId })) {
      miner.state = 'standby-beaconing'
      miner.beaconReason = 'depleted'
      miner.startBeacon()
      miner.pushToStore()
      this.departShipForBase(ship)
      return
    }
    miner.freeOrbitalRadius = null
    miner.freeOrbitalAngle = null
    miner.state = 'in-transit'
    miner.beaconReason = null
    miner.setVisible(false)
    miner.stopBeacon()
    activeBeacons.update(beacons => beacons.filter(b => b.id !== minerId))
    miner.pushToStore()
    ship.minerTarget = miner

    // Step 2: collect any tethered nets as separate per-item steps (beginCollecting
    // no-ops if none), then orphan whatever did not fit and head home.
    this.beginCollecting(ship, miner, () => {
      this.orphanRemainingNets(miner)
      this.departShipForBase(ship)
    })
  }

  private performDeploy(ship: Ship): void {
    const asteroid = ship.asteroidTarget
    if (!asteroid) {
      ship.shipState = 'waiting-at-asteroid'
      ship.pushToStore()
      return
    }

    const slotIndex = ship.attachmentPoints.findIndex(
      ap => ap.size === 'medium' && ap.payload?.kind === 'auto-miner',
    )
    if (slotIndex === -1) {
      ship.shipState = 'waiting-at-asteroid'
      ship.pushToStore()
      return
    }

    const slot = ship.attachmentPoints[slotIndex]
    if (slot.payload?.kind !== 'auto-miner') return

    const miner = this.autoMinerMap.get(slot.payload.minerId)
    if (!miner) {
      ship.attachmentPoints[slotIndex] = { ...slot, payload: null }
      ship.shipState = 'waiting-at-asteroid'
      ship.pushToStore()
      return
    }

    // Backstop: never deploy a second miner onto an asteroid that already has one
    // (e.g. an un-designate/re-designate race dispatched a duplicate). Keep this
    // miner, re-mark the asteroid as being mined, and return to base.
    if (this.autoMiners.some(m => m !== miner && m.asteroidId === asteroid.id)) {
      this.retireDesignationsForAsteroid(asteroid.id)
      this.designations.push({ id: nanoid(), asteroidId: asteroid.id, status: 'fulfilled', claimedByShipId: null })
      designationQueue.set([...this.designations])
      ship.asteroidTarget = null
      this.departShipForBase(ship)
      return
    }

    // Transfer nets from NetStore: MINER_INITIAL_NETS spares + 1 active = total MINER_INITIAL_NETS + 1
    const netStoreSlot = ship.attachmentPoints.find(
      ap => ap.payload?.kind === 'net-store',
    )
    let transferred = 0
    if (netStoreSlot?.payload?.kind === 'net-store') {
      const desired = MINER_INITIAL_NETS + 1
      transferred = Math.min(desired, netStoreSlot.payload.currentNets)
      netStoreSlot.payload.currentNets -= transferred
    }
    miner.spareNetCount = Math.max(0, transferred - 1)  // last net is active net
    miner.activeNetFill = 0

    // Clear attachment slot
    ship.attachmentPoints[slotIndex] = { ...slot, payload: null }

    // Reveal miner at ship position, tween to asteroid
    miner.asteroidId = asteroid.id
    miner.state = 'deploying'
    miner.setPosition(ship.x, ship.y)
    miner.setVisible(true)

    // Ensure a fulfilled designation marks this asteroid as being mined, even if
    // the claimed designation was removed by an un-designate mid-delivery (so it
    // cannot be re-designated and a second miner stacked on top).
    const claimedDesig = this.designations.find(d => d.claimedByShipId === ship.id)
    if (claimedDesig) {
      this.fulfillDesignation(claimedDesig.id)
    } else if (!this.designations.some(d => d.asteroidId === asteroid.id)) {
      this.designations.push({ id: nanoid(), asteroidId: asteroid.id, status: 'fulfilled', claimedByShipId: null })
      designationQueue.set([...this.designations])
    }

    const destX = asteroid.x
    const destY = asteroid.y - 20
    this.attachRetryCount.set(ship.id, ATTACH_MAX_RETRIES)
    this.tweens.add({
      targets: miner,
      x: destX,
      y: destY,
      duration: MINER_DEPLOY_DURATION_MS,
      ease: 'Power2',
      onComplete: () => {
        miner.state = 'attaching'
        miner.pushToStore()
        this.beginAttachAttempt(ship, miner, asteroid)
      },
    })

    ship.shipState = 'waiting-at-asteroid'
    ship.pushToStore()
  }

  private beginAttachAttempt(ship: Ship, miner: AutoMiner, asteroid: Asteroid): void {
    if (!miner.active || ship.shipState !== 'waiting-at-asteroid') {
      this.attachRetryCount.delete(ship.id)
      return
    }

    if (asteroid.currentQuantity <= 0) {
      miner.state = 'standby-beaconing'
      miner.beaconReason = 'depleted'
      miner.startBeacon()
      miner.pushToStore()
      this.attachRetryCount.delete(ship.id)
      this.retireDesignationsForAsteroid(asteroid.id)
      return
    }

    miner.rcsFuel = Math.max(0, miner.rcsFuel - MINER_RCS_DRAIN_PER_ATTACH)

    const effectiveFailProb = ATTACH_FAILURE_PROB + CONDITION_MAX_PENALTY * conditionPenaltyFraction(miner.condition)
    if (Math.random() >= effectiveFailProb) {
      miner.state = 'mining'
      miner.beaconReason = null
      miner.pushToStore()
      this.attachRetryCount.delete(ship.id)
      return
    }

    miner.condition = Math.max(0, miner.condition - CONDITION_DEGRADE_PER_FAIL)

    if (miner.condition < CONDITION_CAP_THRESHOLD && Math.random() < CATASTROPHIC_FAIL_PROB) {
      this.pushAttachNotification('Miner destroyed — catastrophic attach failure', true)
      this.attachRetryCount.delete(ship.id)
      // Miner gone: the fulfilled reconcile in autoDispatch reverts the asteroid's
      // designation to queued so a replacement is dispatched. No cooldown — a
      // healthy miner could still attach here.
      this.autoMiners = this.autoMiners.filter(m => m.id !== miner.id)
      this.autoMinerMap.delete(miner.id)
      miner.destroy()
      ship.shipState = 'traveling-to-base'
      ship.target = { x: BASE_X, y: BASE_Y }
      ship.pushToStore()
      return
    }

    miner.state = 'drifting'
    miner.pushToStore()

    const remaining = (this.attachRetryCount.get(ship.id) ?? 1) - 1
    this.attachRetryCount.set(ship.id, remaining)

    const attemptNum = ATTACH_MAX_RETRIES - remaining
    this.pushAttachNotification(
      `Miner attach failed (attempt ${attemptNum}/${ATTACH_MAX_RETRIES})${remaining > 0 ? ' — retrying' : ''}`,
      false,
    )

    this.tweens.add({
      targets: miner,
      x: miner.x + 25,
      y: miner.y + 15,
      duration: ATTACH_DRIFT_DURATION_MS,
      ease: 'Power1',
    })

    if (remaining > 0) {
      this.time.delayedCall(ATTACH_RETRY_DELAY_MS, () => {
        miner.setPosition(asteroid.x, asteroid.y - 20)
        miner.state = 'attaching'
        miner.pushToStore()
        this.beginAttachAttempt(ship, miner, asteroid)
      })
    } else {
      this.time.delayedCall(ATTACH_RETRY_DELAY_MS, () => {
        this.handleAttachExhaustion(ship, miner, asteroid)
      })
    }
  }

  private handleAttachExhaustion(ship: Ship, miner: AutoMiner, asteroid: Asteroid): void {
    this.attachRetryCount.delete(ship.id)

    // The deploy failed: mark the asteroid undeployable for a cooldown so it is not
    // immediately re-targeted. The designation reverts to queued via the fulfilled
    // reconcile in autoDispatch (the miner detaches below) and the cooldown gates
    // re-dispatch until the window passes — i.e. temporary, then retryable.
    this.attachCooldowns.set(asteroid.id, this.time.now + ATTACH_COOLDOWN_MS)

    const freeSlot = ship.attachmentPoints.find(ap => ap.size === 'medium' && ap.payload === null)
    if (freeSlot) {
      freeSlot.payload = { kind: 'auto-miner', minerId: miner.id }
      miner.state = 'in-transit'
      miner.beaconReason = null
      miner.asteroidId = null
      miner.setVisible(false)
    } else {
      // No slot to recover into: miner stays at the asteroid as 'stuck', beaconing
      // for manual recovery. The hauler still returns to base.
      console.warn(`handleAttachExhaustion: no free medium slot on ship ${ship.id}, miner ${miner.id} — stuck`)
      miner.state = 'stuck'
      miner.beaconReason = 'stuck'
      miner.startBeacon()
    }

    miner.pushToStore()

    // The hauler is done here regardless of outcome — send it home rather than
    // leaving it stranded in waiting-at-asteroid.
    this.departShipForBase(ship)

    this.pushAttachNotification(
      `Miner attach exhausted — ${asteroid.resourceType} asteroid`,
      true,
    )
  }

  private initiateRepair(minerId: string): boolean {
    const miner = this.autoMinerMap.get(minerId)
    if (!miner || miner.state !== 'station-stored') return false

    const cost = Math.round((1.0 - miner.condition) * 100) * getPrice('repair-per-condition-point')

    const slotIndex = this.hangarOccupants.findIndex(occ => occ === null)
    if (slotIndex === -1) return false

    if (this.base.credits < cost) return false

    this.base.credits -= cost
    this.hangarOccupants[slotIndex] = minerId
    this.base.stationMinerIds = this.base.stationMinerIds.filter(id => id !== minerId)
    this.base.pushToStore()

    miner.state = 'station-repair'
    miner.pushToStore()

    const isOwnedBay = slotIndex < this.base.ownedHangarCount
    const duration = isOwnedBay && this.base.hangarPressurized
      ? MINER_REPAIR_DURATION_MS * HANGAR_PRESSURIZED_FACTOR
      : MINER_REPAIR_DURATION_MS

    this.minerRepairs.set(minerId, { slotIndex })
    this.time.delayedCall(duration, () => this.completeRepair(minerId))
    return true
  }

  private completeRepair(minerId: string): void {
    const repair = this.minerRepairs.get(minerId)
    if (!repair) return
    this.minerRepairs.delete(minerId)
    this.hangarOccupants[repair.slotIndex] = null

    const miner = this.autoMinerMap.get(minerId)
    if (!miner) return

    miner.condition = 1.0

    if (this.base.storeAutoMiner(minerId)) {
      miner.state = 'station-stored'
      miner.beaconReason = null
    } else {
      // No storage slot free — eject to orbit near base for beacon recovery
      miner.freeOrbitalRadius = BASE_Y
      miner.freeOrbitalAngle = Math.atan2(BASE_Y, BASE_X) + 0.15
      miner.setPosition(
        Math.cos(miner.freeOrbitalAngle) * miner.freeOrbitalRadius,
        Math.sin(miner.freeOrbitalAngle) * miner.freeOrbitalRadius - 20,
      )
      miner.state = 'standby-beaconing'
      miner.beaconReason = 'depleted'
      miner.setVisible(true)
      miner.startBeacon()
    }

    miner.pushToStore()
  }

  private pushAttachNotification(message: string, exhausted: boolean): void {
    const entry: AttachNotification = { id: nanoid(), message, exhausted }
    attachNotifications.update(ns => [...ns, entry])
    this.time.delayedCall(NOTIFICATION_DURATION_MS, () => {
      attachNotifications.update(ns => ns.filter(n => n.id !== entry.id))
    })
  }

  private commissionNewShip(): void {
    if (!this.base.commissionShip()) return
    const index = this.ships.length + 1
    const name = `Hauler-${String(index).padStart(2, '0')}`
    const offset = 40 + (index % 4) * 20
    const angle = (index * 90) % 360
    const spawnX = BASE_X + Math.cos(Phaser.Math.DegToRad(angle)) * offset
    const spawnY = BASE_Y + Math.sin(Phaser.Math.DegToRad(angle)) * offset
    const ship = new Ship(this, spawnX, spawnY, name, { x: BASE_X, y: BASE_Y }, this.base)
    this.ships.push(ship)
    this.base.registerShip(ship.id)
    this.attachShipEvents(ship)
  }

  private performPurchaseMiner(haulerId: string): void {
    const ship = this.ships.find(s => s.id === haulerId)
    if (!ship) return
    const slot = ship.attachmentPoints.find(ap => ap.size === 'medium' && ap.payload === null)
    if (!slot) return
    if (!this.base.purchaseMiner()) return

    const miner = new AutoMiner(this)
    miner.setPosition(ship.x, ship.y)
    this.autoMiners.push(miner)
    this.autoMinerMap.set(miner.id, miner)
    this.attachMinerEvents(miner)

    const idx = ship.attachmentPoints.indexOf(slot)
    ship.attachmentPoints[idx] = { ...slot, payload: { kind: 'auto-miner', minerId: miner.id } }
    ship.pushToStore()
  }

  private initiateShipUpgrade(shipId: string, stat: 'cargo'): void {
    const ship = this.ships.find(s => s.id === shipId)
    if (!ship) return
    if (ship.shipState !== 'idle') return
    if (stat === 'cargo') {
      if (ship.cargoUpgradeLevel >= MAX_UPGRADE_LEVEL) return
      const cost = CARGO_UPGRADE_COSTS[ship.cargoUpgradeLevel]
      if (this.base.credits < cost) return
      const slotPos = this.assignHangarSlot(ship)
      if (slotPos === null) return  // no bay available
      this.base.credits -= cost
      this.base.pushToStore()
      this.shipPendingUpgrades.set(ship.id, stat)
      ship.target = { ...slotPos }
      ship.shipState = 'traveling-to-hangar'
      ship.pushToStore()
    }
  }

  private handleHangarEntry(ship: Ship): void {
    const slotIdx = ship.hangarSlotIndex
    if (slotIdx === null) {
      ship.shipState = 'idle'
      ship.pushToStore()
      return
    }
    const slotPos = this.hangarPositions[slotIdx]
    const isOwnedPressurized = slotIdx < this.base.ownedHangarCount && this.base.hangarPressurized
    const duration = UPGRADE_HANGAR_DURATION * (isOwnedPressurized ? HANGAR_PRESSURIZED_FACTOR : 1)
    ship.enterHangar(slotPos, duration)
  }

  private applyUpgradeStat(ship: Ship, stat: 'cargo'): void {
    if (stat === 'cargo') {
      if (ship.cargoUpgradeLevel >= MAX_UPGRADE_LEVEL) return
      ship.cargoUpgradeLevel++
      ship.cargoCapacity = CARGO_CAPACITY_TIERS[ship.cargoUpgradeLevel]
    }
    ship.pushToStore()
  }

  private handleFetchStationMinerArrival(ship: Ship): void {
    const asteroidId = this.shipPendingDesignationAsteroid.get(ship.id)
    this.shipPendingDesignationAsteroid.delete(ship.id)

    const designation = this.designations.find(
      d => d.claimedByShipId === ship.id,
    )

    const minerId = this.base.retrieveAutoMiner()
    if (!minerId || !asteroidId) {
      // Storage empty or pending asteroid lost — release designation and go idle
      if (designation) this.releaseDesignation(designation.id)
      ship.shipState = 'idle'
      ship.target = null
      ship.pushToStore()
      return
    }

    const miner = this.autoMinerMap.get(minerId)
    if (!miner) {
      if (designation) this.releaseDesignation(designation.id)
      ship.shipState = 'idle'
      ship.target = null
      ship.pushToStore()
      return
    }

    const freeSlot = ship.attachmentPoints.find(ap => ap.size === 'medium' && ap.payload === null)
    if (!freeSlot) {
      // No free slot; put miner back and release designation
      this.base.storeAutoMiner(minerId)
      if (designation) this.releaseDesignation(designation.id)
      ship.shipState = 'idle'
      ship.target = null
      ship.pushToStore()
      return
    }

    miner.state = 'in-transit'
    miner.setVisible(false)
    freeSlot.payload = { kind: 'auto-miner', minerId }
    miner.pushToStore()

    const asteroid = this.asteroidMap.get(asteroidId)
    if (!asteroid) {
      if (designation) this.releaseDesignation(designation.id)
      ship.shipState = 'idle'
      ship.target = null
      ship.pushToStore()
      return
    }

    ship.asteroidTarget = asteroid
    ship.target = { x: asteroid.x, y: asteroid.y }
    ship.shipState = 'traveling-to-asteroid'
    ship.pushToStore()
  }

  addDesignation(asteroidId: string): void {
    if (this.designations.some(d => d.asteroidId === asteroidId)) return
    // Do not designate an asteroid that already has a miner deployed/deploying there
    // (e.g. after an un-designate mid-delivery left it mined but un-designated).
    if (this.autoMiners.some(m => m.asteroidId === asteroidId)) return
    const entry: MiningDesignation = { id: nanoid(), asteroidId, status: 'queued', claimedByShipId: null }
    this.designations.push(entry)
    designationQueue.set([...this.designations])
  }

  removeDesignation(asteroidId: string): void {
    this.designations = this.designations.filter(d => d.asteroidId !== asteroidId)
    designationQueue.set([...this.designations])
  }

  claimDesignation(id: string, shipId: string): boolean {
    const entry = this.designations.find(d => d.id === id)
    if (!entry || entry.status === 'claimed') return false
    entry.status = 'claimed'
    entry.claimedByShipId = shipId
    designationQueue.set([...this.designations])
    return true
  }

  releaseDesignation(id: string): void {
    const idx = this.designations.findIndex(d => d.id === id)
    if (idx < 0) return
    const entry = this.designations[idx]
    if (entry.status !== 'claimed') return
    this.designations.splice(idx, 1)
    entry.status = 'queued'
    entry.claimedByShipId = null
    this.designations.push(entry)
    designationQueue.set([...this.designations])
  }

  fulfillDesignation(id: string): void {
    const entry = this.designations.find(d => d.id === id)
    if (!entry) return
    // Keep the entry bound to its asteroid ("being mined") so it cannot be
    // re-designated; retireDesignationsForAsteroid removes it on depletion.
    entry.status = 'fulfilled'
    entry.claimedByShipId = null
    designationQueue.set([...this.designations])
  }

  retireDesignationsForAsteroid(asteroidId: string): void {
    const had = this.designations.some(d => d.asteroidId === asteroidId)
    if (!had) return
    this.designations = this.designations.filter(d => d.asteroidId !== asteroidId)
    designationQueue.set([...this.designations])
  }

  // ── Attachment slot claiming (single authoritative path) ──────────────────

  /** Assigns a payload to the first free medium slot. Returns true on success. */
  private claimFreeMediumSlot(ship: Ship, payload: AttachmentPayload): boolean {
    const slot = ship.attachmentPoints.find(ap => ap.size === 'medium' && ap.payload === null)
    if (!slot) return false
    slot.payload = payload
    return true
  }

  /**
   * Converts a reservation for `targetId` on `ship` into a real payload. Falls
   * back to any free medium slot if the reservation is missing. Returns true if
   * the payload was placed.
   */
  private resolveReservation(ship: Ship, targetId: string, payload: AttachmentPayload): boolean {
    const reserved = ship.attachmentPoints.find(
      ap => ap.payload?.kind === 'reserved' && ap.payload.targetId === targetId,
    )
    if (reserved) {
      reserved.payload = payload
      return true
    }
    return this.claimFreeMediumSlot(ship, payload)
  }

  /**
   * Orphans a miner's remaining (uncollected) full-tethered nets when it is
   * recovered without them: each net is placed in its own free-orbit, kept
   * visible and full-tethered, and detached from the miner. Orphaned nets are
   * recoverable via the player "designate for collection" action — never hidden
   * or destroyed.
   */
  private orphanRemainingNets(miner: AutoMiner): void {
    if (miner.tetheredNetIds.length === 0) return
    const r = Math.max(Math.hypot(miner.x, miner.y), 1)
    let a = Math.atan2(miner.y, miner.x)
    for (const netId of miner.tetheredNetIds) {
      const net = this.cargoNetMap.get(netId)
      if (!net) continue
      net.freeOrbitalRadius = r
      net.freeOrbitalAngle = a
      net.asteroidId = null
      net.setVisible(true)
      net.setPosition(Math.cos(a) * r, Math.sin(a) * r)
      net.pushToStore()
      a += 0.04 // fan out so multiple orphaned nets do not overlap exactly
    }
    miner.tetheredNetIds = []
  }

  /** Clears any reserved slot on `ship` targeting `targetId` (→ empty). */
  private releaseReservationFor(ship: Ship, targetId: string): void {
    for (const ap of ship.attachmentPoints) {
      if (ap.payload?.kind === 'reserved' && ap.payload.targetId === targetId) ap.payload = null
    }
  }

  /**
   * True if a miner is already being recovered by any path: an en-route beacon
   * recovery, a slot already holding or reserved for it, or a waiting hauler mid
   * at-asteroid attach maneuver at the miner's asteroid. Single authoritative
   * guard so a Dispatch cannot double-claim a miner.
   */
  private isMinerBeingRecovered(minerId: string): boolean {
    if ([...this.shipMinerRecoveryTargets.values()].includes(minerId)) return true
    for (const ship of this.ships) {
      for (const ap of ship.attachmentPoints) {
        const p = ap.payload
        if (p?.kind === 'auto-miner' && p.minerId === minerId) return true
        if (p?.kind === 'reserved' && p.forKind === 'auto-miner' && p.targetId === minerId) return true
      }
    }
    const miner = this.autoMinerMap.get(minerId)
    if (miner?.asteroidId) {
      for (const ship of this.ships) {
        if (this.shipAttachManeuver.has(ship.id) && ship.asteroidTarget?.id === miner.asteroidId) return true
      }
    }
    return false
  }

  /** Recharges a miner's battery to full at the station, charging electricity. */
  private rechargeMinerAtStation(miner: AutoMiner): void {
    if (miner.battery >= MINER_BATTERY_MAX) return
    const deficit = MINER_BATTERY_MAX - miner.battery
    this.base.credits -= Math.round(deficit * getPrice('electricity-per-battery-unit'))
    miner.battery = MINER_BATTERY_MAX
    this.base.pushToStore()
  }

  /** True while the asteroid is in its post-exhaustion undeployable cooldown window. */
  private isAsteroidOnCooldown(asteroidId: string): boolean {
    const until = this.attachCooldowns.get(asteroidId)
    if (until === undefined) return false
    if (until <= this.time.now) {
      this.attachCooldowns.delete(asteroidId)
      return false
    }
    return true
  }

  private setupInput(): void {
    const keyboard = this.input.keyboard!

    this.cursors = keyboard.createCursorKeys()
    this.wasd = {
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    }

    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.HOME).on('down', () => {
      this.cameras.main.pan(0, 0, 300, 'Power2')
    })

    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC).on('down', () => {
      this.clearSelection()
      basePanelOpen.set(false)
    })

    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F).on('down', () => {
      this.toggleFollowCam()
    })

    this.input.on(
      'pointerdown',
      (pointer: Phaser.Input.Pointer, targets: Phaser.GameObjects.GameObject[]) => {
        if (pointer.rightButtonDown() || pointer.middleButtonDown()) {
          if (this.followCam) this.cancelFollowCam()
          this.isDragging = true
          this.dragLastX = pointer.x
          this.dragLastY = pointer.y
          if (pointer.rightButtonDown()) {
            this.rightDownX = pointer.x
            this.rightDownY = pointer.y
          }
        }

        if (pointer.leftButtonDown()) {
          const mmLeft = this.scale.width - MINIMAP_SIZE - MINIMAP_MARGIN
          const mmTop = MINIMAP_MARGIN
          if (
            pointer.x >= mmLeft && pointer.x <= mmLeft + MINIMAP_SIZE &&
            pointer.y >= mmTop && pointer.y <= mmTop + MINIMAP_SIZE
          ) {
            if (this.followCam) this.cancelFollowCam()
            const worldX = (pointer.x - mmLeft - MINIMAP_SIZE / 2) * (WORLD_SIZE / MINIMAP_SIZE)
            const worldY = (pointer.y - mmTop - MINIMAP_SIZE / 2) * (WORLD_SIZE / MINIMAP_SIZE)
            this.cameras.main.pan(worldX, worldY, 300, 'Power2')
            return
          }

          const hitShip = targets.some(t => t instanceof Ship)
          if (!hitShip) {
            const hitCargoNet = targets.find(t => t instanceof CargoNet) as CargoNet | undefined
            if (hitCargoNet) {
              this.clearSelection()
              this.selectedCargoNetEntity = hitCargoNet
              hitCargoNet.select()
            } else {
              const hitAutoMiner = targets.find(t => t instanceof AutoMiner) as AutoMiner | undefined
              if (hitAutoMiner && hitAutoMiner.state !== 'in-transit') {
                this.clearSelection()
                this.selectedAutoMinerEntity = hitAutoMiner
                hitAutoMiner.select()
              } else {
                const hitBase = targets.find(t => t instanceof Base)
                if (hitBase) {
                  selectedAsteroid.set(null)
                  if (this.selectedAutoMinerEntity) {
                    this.selectedAutoMinerEntity.deselect()
                    this.selectedAutoMinerEntity = null
                  }
                  basePanelOpen.set(true)
                } else {
                  const hitAsteroid = targets.find(t => t instanceof Asteroid) as Asteroid | undefined
                  if (hitAsteroid) {
                    if (
                      this.selectedShip &&
                      this.selectedShip.shipState === 'idle' &&
                      this.asteroidHasTetheredNets(hitAsteroid)
                    ) {
                      const haulerId = this.selectedShip.id
                      commandQueue.update(q => [...q, { type: 'collectNets', haulerId, asteroidId: hitAsteroid.id }])
                    } else {
                      this.clearSelection()
                      hitAsteroid.selectSelf()
                    }
                  } else {
                    this.clearSelection()
                    basePanelOpen.set(false)
                  }
                }
              }
            }
          }
        }
      },
    )

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.isDragging) return
      const cam = this.cameras.main
      cam.scrollX -= (pointer.x - this.dragLastX) / cam.zoom
      cam.scrollY -= (pointer.y - this.dragLastY) / cam.zoom
      this.dragLastX = pointer.x
      this.dragLastY = pointer.y
    })

    this.input.on(
      'pointerup',
      (pointer: Phaser.Input.Pointer) => {
        if (!pointer.rightButtonDown() && !pointer.middleButtonDown()) {
          this.isDragging = false
        }

        if (pointer.rightButtonReleased()) {
          const dx = pointer.x - this.rightDownX
          const dy = pointer.y - this.rightDownY
          if (Math.sqrt(dx * dx + dy * dy) < DRAG_ORDER_THRESHOLD && this.selectedShip) {
            this.selectedShip.issueMoveTo(pointer.worldX, pointer.worldY)
          }
        }
      },
    )

    this.game.canvas.addEventListener('contextmenu', (e) => e.preventDefault())

    this.input.on(
      'wheel',
      (
        _pointer: Phaser.Input.Pointer,
        _objects: Phaser.GameObjects.GameObject[],
        _deltaX: number,
        deltaY: number,
      ) => {
        const cam = this.cameras.main
        cam.zoom = Phaser.Math.Clamp(cam.zoom + (deltaY > 0 ? -0.1 : 0.1), this.minZoom, MAX_ZOOM)
      },
    )
  }

  private onResize(size: Phaser.Structs.Size): void {
    for (const layer of this.starLayers) {
      layer.setSize(size.width, size.height)
    }
    this.minZoom = this.computeMinZoom()
    const cam = this.cameras.main
    if (cam.zoom < this.minZoom) cam.setZoom(this.minZoom)
  }

  update(_time: number, delta: number): void {
    this.drainCommandQueue()
    this.pushStationUsage()

    const dt = delta / 1000
    this.gameClock += dt

    this.autoSaveAccumulator += dt
    if (this.autoSaveAccumulator >= AUTO_SAVE_INTERVAL) {
      this.autoSaveAccumulator = 0
      GameSaveService.save(this.buildSaveState())
    }

    this.companyArrivalAccumulator += dt
    if (this.companyArrivalAccumulator >= this.companyArrivalInterval()) {
      this.companyArrivalAccumulator = 0
      this.trySpawnCompanyAsteroid()
    }

    const cam = this.cameras.main
    const speed = PAN_SPEED * dt

    const left = this.cursors.left.isDown || this.wasd.left.isDown
    const right = this.cursors.right.isDown || this.wasd.right.isDown
    const up = this.cursors.up.isDown || this.wasd.up.isDown
    const down = this.cursors.down.isDown || this.wasd.down.isDown

    if (!this.followCam) {
      if (left) cam.scrollX -= speed
      else if (right) cam.scrollX += speed

      if (up) cam.scrollY -= speed
      else if (down) cam.scrollY += speed
    }

    for (let i = 0; i < this.starLayers.length; i++) {
      this.starLayers[i].tilePositionX = cam.scrollX * STAR_LAYERS[i].parallax
      this.starLayers[i].tilePositionY = cam.scrollY * STAR_LAYERS[i].parallax
    }

    for (const asteroid of this.asteroids) {
      asteroid.updateOrbit(dt)
    }

    // Update deployed miner positions to follow their asteroid.
    // Only include states where the miner should track its asteroid per-frame.
    // Do NOT include 'drifting' or other states that manage their own position via tweens.
    const deployedStates = new Set<AutoMinerState>([
      'attaching', 'mining', 'ejecting-net', 'net-starved', 'standby-beaconing', 'stuck', 'dark',
    ])
    for (const miner of this.autoMiners) {
      if (miner.asteroidId && deployedStates.has(miner.state)) {
        const asteroid = this.asteroidMap.get(miner.asteroidId)
        if (asteroid) {
          miner.setPosition(asteroid.x, asteroid.y - 20)
        }
      }
    }

    // Run AutoMiner mining tick; detect asteroid depletion
    for (const miner of this.autoMiners) {
      if (miner.state === 'mining' && miner.asteroidId) {
        const asteroid = this.asteroidMap.get(miner.asteroidId)
        if (asteroid) {
          miner.updateMining(dt, asteroid)
          if (asteroid.currentQuantity <= 0 && this.asteroidMap.has(asteroid.id)) {
            this.removeDepletedAsteroid(asteroid, miner)
          }
        }
      }
    }

    // Drain beaconing/stuck miner battery
    for (const miner of this.autoMiners) {
      if (miner.state === 'standby-beaconing' || miner.state === 'stuck') {
        miner.battery = Math.max(0, miner.battery - MINER_BATTERY_DRAIN_BEACONING * dt)
        if (miner.battery <= 0) {
          miner.stopBeacon()
          miner.state = 'dark'
          activeBeacons.update(beacons => beacons.filter(b => b.id !== miner.id))
          miner.pushToStore()
        }
      }
    }

    // Field recharge: ships with chargeToggle on transfer fuel to attached miner's battery
    for (const ship of this.ships) {
      if (!ship.chargeToggle || ship.shipState !== 'waiting-at-asteroid') continue
      const minerSlot = ship.attachmentPoints.find(ap => ap.payload?.kind === 'auto-miner')
      if (!minerSlot || !minerSlot.payload || minerSlot.payload.kind !== 'auto-miner') continue
      const miner = this.autoMinerMap.get(minerSlot.payload.minerId)
      if (!miner || miner.battery >= MINER_BATTERY_MAX) continue
      ship.thrusterFuel = Math.max(0, ship.thrusterFuel - HAULER_FIELD_CHARGE_FUEL_RATE * dt)
      miner.battery = Math.min(MINER_BATTERY_MAX, miner.battery + HAULER_FIELD_CHARGE_BATTERY_RATE * dt)
      miner.pushToStore()
      ship.pushToStore()
    }

    // Update free-orbiting miner positions (asteroid depleted, miner detached)
    for (const miner of this.autoMiners) {
      if (miner.freeOrbitalRadius !== null && miner.freeOrbitalAngle !== null) {
        miner.freeOrbitalAngle += (ORBITAL_K / Math.max(miner.freeOrbitalRadius, 1) ** 1.5) * dt
        miner.setPosition(
          Math.cos(miner.freeOrbitalAngle) * miner.freeOrbitalRadius,
          Math.sin(miner.freeOrbitalAngle) * miner.freeOrbitalRadius - 20,
        )
      }
    }

    // Update orphaned (free-orbiting) net positions
    for (const net of this.cargoNets) {
      if (net.freeOrbitalRadius !== null && net.freeOrbitalAngle !== null) {
        net.freeOrbitalAngle += (ORBITAL_K / Math.max(net.freeOrbitalRadius, 1) ** 1.5) * dt
        net.setPosition(
          Math.cos(net.freeOrbitalAngle) * net.freeOrbitalRadius,
          Math.sin(net.freeOrbitalAngle) * net.freeOrbitalRadius,
        )
      }
    }

    // Update tethered net positions to orbit their miner
    for (const miner of this.autoMiners) {
      const count = miner.tetheredNetIds.length
      for (let i = 0; i < count; i++) {
        const net = this.cargoNetMap.get(miner.tetheredNetIds[i])
        if (net && net.state === 'full-tethered') {
          const angle = (i / Math.max(1, count)) * Math.PI * 2
          net.setPosition(miner.x + Math.cos(angle) * 18, miner.y + Math.sin(angle) * 18)
        }
      }
    }

    // Detect miner state transitions requiring Hauler action
    for (const miner of this.autoMiners) {
      const waitingShip = this.ships.find(
        s => s.shipState === 'waiting-at-asteroid' && s.asteroidTarget?.id === miner.asteroidId,
      )
      if (!waitingShip) continue

      // Skip while this ship is mid attach maneuver (one-shot guard set below).
      if (this.shipAttachManeuver.has(waitingShip.id)) continue

      // Attachment-time capacity check: ship must have at least one free medium slot before
      // attempting any collection or recovery. If full, depart immediately so a capable ship
      // can be dispatched on the next autoDispatch tick.
      if (!shipHasFreeMediumSlot(waitingShip)) {
        this.departShipForBase(waitingShip)
        continue
      }

      if (miner.state === 'net-starved') {
        // Resupply takes priority over collection when NetStore has nets
        const netStoreSlot = waitingShip.attachmentPoints.find(ap => ap.payload?.kind === 'net-store')
        if (netStoreSlot?.payload?.kind === 'net-store' && netStoreSlot.payload.currentNets >= 1) {
          this.beginResupply(waitingShip, miner)
        } else {
          // NetStore empty — fall back to collecting any full-tethered nets
          this.beginCollecting(waitingShip, miner)
        }
      } else if (miner.state === 'standby-beaconing') {
        const freeSlot = waitingShip.attachmentPoints.find(ap => ap.size === 'medium' && ap.payload === null)
        if (freeSlot) {
          // Reserve the slot now (claims it + drives attach progress), then grab the
          // miner after the maneuver (RCS drains while waiting-at-asteroid).
          freeSlot.payload = { kind: 'reserved', forKind: 'auto-miner', targetId: miner.id }
          this.shipAttachManeuver.set(waitingShip.id, this.time.now)
          this.time.delayedCall(HAULER_ATTACH_MANEUVER_MS, () => {
            this.shipAttachManeuver.delete(waitingShip.id)
            if (waitingShip.shipState !== 'waiting-at-asteroid' || miner.state !== 'standby-beaconing') {
              this.releaseReservationFor(waitingShip, miner.id)
              return
            }
            if (!this.resolveReservation(waitingShip, miner.id, { kind: 'auto-miner', minerId: miner.id })) {
              this.departShipForBase(waitingShip)
              return
            }
            this.beginCollecting(waitingShip, miner, () => this.performAtAsteroidRecovery(waitingShip, miner))
          })
        } else {
          this.departShipForBase(waitingShip)
        }
      } else if (miner.state === 'mining' || miner.state === 'ejecting-net') {
        const fullNets = miner.tetheredNetIds.filter(id => this.cargoNetMap.get(id)?.state === 'full-tethered')
        if (fullNets.length > 0) this.beginCollecting(waitingShip, miner)
      }
    }

    this.drawTethers()

    for (const ship of this.ships) {
      // Keep ship target locked to orbiting asteroid
      if (ship.shipState === 'traveling-to-asteroid' && ship.asteroidTarget) {
        ship.target = { x: ship.asteroidTarget.x, y: ship.asteroidTarget.y }
      }
      // Orbit asteroid while parked
      if (
        ship.asteroidTarget &&
        this.asteroidMap.has(ship.asteroidTarget.id) && (
          ship.shipState === 'waiting-at-asteroid' ||
          ship.shipState === 'collecting-nets' ||
          ship.shipState === 'resupplying-miner'
        )
      ) {
        const ast = ship.asteroidTarget
        if (ship.waitOrbitalAngle === null) {
          ship.waitOrbitalAngle = Math.atan2(ship.y - ast.y, ship.x - ast.x)
        }
        ship.waitOrbitalAngle += SHIP_PARK_ORBIT_RATE * dt
        ship.setPosition(
          ast.x + Math.cos(ship.waitOrbitalAngle) * SHIP_PARK_RADIUS,
          ast.y + Math.sin(ship.waitOrbitalAngle) * SHIP_PARK_RADIUS,
        )
      // Orbit free-orbiting miner while collecting its nets
      } else if (ship.minerTarget && ship.shipState === 'collecting-nets') {
        const m = ship.minerTarget
        if (ship.waitOrbitalAngle === null) {
          ship.waitOrbitalAngle = Math.atan2(ship.y - m.y, ship.x - m.x)
        }
        ship.waitOrbitalAngle += SHIP_PARK_ORBIT_RATE * dt
        ship.setPosition(
          m.x + Math.cos(ship.waitOrbitalAngle) * SHIP_PARK_RADIUS,
          m.y + Math.sin(ship.waitOrbitalAngle) * SHIP_PARK_RADIUS,
        )
      }
      // Keep responding-to-beacon target locked to the moving miner/net it recovers
      if (ship.shipState === 'responding-to-beacon') {
        const minerId = this.shipMinerRecoveryTargets.get(ship.id)
        if (minerId) {
          const miner = this.autoMinerMap.get(minerId)
          if (miner) ship.target = { x: miner.x, y: miner.y }
        }
        const netId = this.shipNetRecoveryTargets.get(ship.id)
        if (netId) {
          const net = this.cargoNetMap.get(netId)
          if (net) ship.target = { x: net.x, y: net.y }
        }
      }
      ship.speedMultiplier = this.computeSpeedMultiplier(ship)
      ship.updateSteering(dt)
      // Drive attach-maneuver progress onto the reserved miner slot (per-slot fill).
      const maneuverStart = this.shipAttachManeuver.get(ship.id)
      if (maneuverStart !== undefined) {
        const prog = Math.min((this.time.now - maneuverStart) / HAULER_ATTACH_MANEUVER_MS, 1)
        const idx = ship.attachmentPoints.findIndex(
          ap => ap.payload?.kind === 'reserved' && ap.payload.forKind === 'auto-miner',
        )
        if (idx !== -1) ship.collectSlotProgress.set(idx, prog)
      }
      ship.drawSlotIndicators()
      // Detect arrival: steerTowardTarget transitioned to deploying-miner
      if (ship.shipState === 'deploying-miner') {
        this.performDeploy(ship)
      }
      // Detect arrival: steerTowardTarget transitioned to loading-miner.
      // Hold in this state for the attach maneuver (RCS drains via updateSteering)
      // before actually attaching the miner.
      if (ship.shipState === 'loading-miner' && !this.shipAttachManeuver.has(ship.id)) {
        this.shipAttachManeuver.set(ship.id, this.time.now)
        this.time.delayedCall(HAULER_ATTACH_MANEUVER_MS, () => {
          this.shipAttachManeuver.delete(ship.id)
          if (ship.shipState === 'loading-miner') this.handleLoadingMiner(ship)
        })
      }
      // Detect arrival: steerTowardTarget transitioned to entering-hangar
      if (ship.shipState === 'entering-hangar') {
        this.handleHangarEntry(ship)
      }
      // Detect arrival at base for station-miner fetch
      if (ship.shipState === 'fetching-station-miner') {
        const dBase = Phaser.Math.Distance.Between(ship.x, ship.y, this.base.x, this.base.y)
        if (dBase < PROXIMITY_BASE_RADIUS) {
          this.handleFetchStationMinerArrival(ship)
        }
      }
    }

    let idle = 0, active = 0, returning = 0, coasting = 0
    for (const ship of this.ships) {
      const s = ship.shipState
      if (s === 'coasting') coasting++
      else if (s === 'idle' || s === 'moving') idle++
      else if (s === 'traveling-to-base' || s === 'unloading' || s === 'in-hangar' || s === 'traveling-to-hangar' || s === 'fetching-station-miner') returning++
      else active++
    }
    fleetSummary.set({ idle, active, returning, coasting })

    let mining = 0, netStarved = 0, beaconing = 0, dark = 0, stuck = 0
    for (const miner of this.autoMiners) {
      if (miner.state === 'mining' || miner.state === 'ejecting-net') mining++
      else if (miner.state === 'net-starved') netStarved++
      else if (miner.state === 'standby-beaconing') beaconing++
      else if (miner.state === 'dark') dark++
      else if (miner.state === 'stuck') stuck++
    }
    autoMinerSummary.set({ mining, netStarved, beaconing, dark, stuck })

    // Compute miner availability vs designation demand
    const idleShipIds = new Set(this.ships.filter(s => s.shipState === 'idle').map(s => s.id))
    let carried = 0
    for (const miner of this.autoMiners) {
      if (miner.state !== 'in-transit') continue
      const onIdleShip = this.ships.some(
        s => idleShipIds.has(s.id) &&
             s.attachmentPoints.some(ap => ap.payload?.kind === 'auto-miner' && ap.payload.minerId === miner.id),
      )
      if (onIdleShip) carried++
    }
    const stored = this.base.stationMinerIds.length
    const available = carried + stored
    const demanded = this.designations.filter(d => d.status === 'queued' || d.status === 'claimed').length
    minerAvailability.set({ available, demanded, shortage: available < demanded })

    if (this.selectedShip && this.selectionRing) {
      this.drawSelectionRing()
    }

    this.drawMinimap()
  }
}
