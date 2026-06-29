import Phaser from 'phaser'
import { nanoid } from 'nanoid'
import { selectedShip, type ShipState } from '../state/shipStore'
import type { ResourceType } from '../world/worldConfig'
import type { Base } from './Base'
import type { Asteroid } from './Asteroid'
import type { AutoMiner } from './AutoMiner'
import { makeDefaultLoadout, type AttachmentPoint } from '../state/attachmentTypes'
import { MINER_DEPLOY_PROXIMITY } from './AutoMiner'

export const SHIP_TEXTURE_KEY = 'ship'
// Generated atlas (asset-harness). When loaded, the hauler renders from this instead of the
// fallback triangle. The atlas art points "up"; in-game heading 0 = east, so a +90° render
// offset is applied, and the large frame is scaled down to SHIP_DISPLAY_LENGTH.
export const SHIP_ATLAS_KEY = 'dwa_ships'
export const SHIP_ATLAS_FRAME = 'hauler'
const SHIP_DISPLAY_LENGTH = 36   // px along the travel axis for the atlas sprite
const SHIP_ART_ANGLE_OFFSET = 90 // atlas art faces up; heading 0 faces east
export const SHIP_SPEED = 180          // world units per second
export const SHIP_TURN_RATE = 180      // degrees per second
export const ARRIVAL_RADIUS = 20       // world units — used for base arrival
export const DRAG_ORDER_THRESHOLD = 5  // screen pixels
export const UNLOAD_DURATION = 3       // seconds

export const ATTACHMENT_UNLOAD_DURATION = 1.5  // seconds; faster than cargo bay
export const UNLOAD_BAR_WIDTH = 32
export const UNLOAD_BAR_HEIGHT = 4
export const UNLOAD_BAR_Y_OFFSET = 18
export const ATTACH_BAR_Y_OFFSET = UNLOAD_BAR_Y_OFFSET + UNLOAD_BAR_HEIGHT + 4
export const ATTACH_BAR_COLOR = 0xffaa44

// Slot indicator markers drawn in a row below the hull.
export const SLOT_INDICATOR_Y_OFFSET = 14
export const SLOT_MARKER_SIZE = 5
export const SLOT_MARKER_GAP = 3
const SLOT_COLOR_MINER = 0x88ccee
const SLOT_COLOR_NET = 0xffcc44
const SLOT_COLOR_STORE = 0x99aabb
const SLOT_COLOR_EMPTY = 0x445566

export const MAX_UPGRADE_LEVEL = 3
export const CARGO_CAPACITY_TIERS = [200, 350, 550, 800] as const
export const CARGO_UPGRADE_COSTS  = [300, 600, 1000]     as const
export const UPGRADE_HANGAR_DURATION = 6  // seconds; halved by pressurization

export const HAULER_FUEL_MAX = 300
export const HAULER_FUEL_DRAIN_PER_SEC = 3
export const HAULER_FUEL_EMERGENCY_RESERVE = 100
export const HAULER_BATTERY_MAX = 100
export const HAULER_BATTERY_CHARGE_RATE = 0.5
export const HAULER_RCS_MAX = 100
export const HAULER_RCS_DRAIN_MANEUVER = 2
// Time a hauler spends maneuvering to attach/recover an autominer onto an
// attachment point. RCS is consumed during this hold via HAULER_RCS_DRAIN_MANEUVER.
export const HAULER_ATTACH_MANEUVER_MS = 1500
export const HAULER_FIELD_CHARGE_FUEL_RATE = 5
export const HAULER_FIELD_CHARGE_BATTERY_RATE = 20

export function generateShipTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(SHIP_TEXTURE_KEY)) return
  const w = 24
  const h = 16
  const gfx = scene.make.graphics({ x: 0, y: 0 })
  // Triangle pointing east (right): tip at (w, h/2), base at (0, 0) and (0, h)
  gfx.fillStyle(0x88ddff, 1)
  gfx.fillTriangle(w, h / 2, 0, 0, 0, h)
  gfx.lineStyle(1, 0xffffff, 0.5)
  gfx.strokeTriangle(w, h / 2, 0, 0, 0, h)
  gfx.generateTexture(SHIP_TEXTURE_KEY, w, h)
  gfx.destroy()
}

export const PARTICLE_TEXTURE_KEY = 'fx-particle'
// Generated flame sprite (asset-harness vfx) for the thruster plume; additive on black, so it
// drops onto the ADD-blend emitter directly. Falls back to the procedural dot if absent.
export const FLAME_TEXTURE_KEY = 'fx-flame'

/** Soft round dot used (tinted) for both thruster exhaust and RCS puffs. */
export function generateParticleTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(PARTICLE_TEXTURE_KEY)) return
  const size = 12
  const c = size / 2
  const gfx = scene.make.graphics({ x: 0, y: 0 })
  // Layered translucent circles approximate a soft radial falloff.
  gfx.fillStyle(0xffffff, 0.25)
  gfx.fillCircle(c, c, c)
  gfx.fillStyle(0xffffff, 0.45)
  gfx.fillCircle(c, c, c * 0.6)
  gfx.fillStyle(0xffffff, 1)
  gfx.fillCircle(c, c, c * 0.3)
  gfx.generateTexture(PARTICLE_TEXTURE_KEY, size, size)
  gfx.destroy()
}

// Exhaust plume geometry/timing.
const EXHAUST_OFFSET = 24        // world units behind the hull center (plume sits further back)
const EXHAUST_SPREAD = 5         // degrees of cone half-angle (fallback soft-dot emitter only)
const PLUME_LENGTH = 72          // billboard plume length (world units) behind the nozzle
const PLUME_WIDTH = 15           // billboard plume width (world units) — slim
// RCS puff timing/geometry.
const RCS_PUFF_INTERVAL = 0.28   // seconds between maneuvering puffs
const RCS_FLANK_OFFSET = 7       // world units to the side of the hull

export class Ship extends Phaser.Physics.Arcade.Sprite {
  readonly id: string
  readonly shipName: string
  cargoCapacity: number
  cargoUpgradeLevel: number
  readonly basePosition: { x: number; y: number }
  readonly base: Base
  cargoContents: Partial<Record<ResourceType, number>>
  shipState: ShipState
  target: { x: number; y: number } | null
  heading: number   // degrees, 0 = east
  attachmentPoints: AttachmentPoint[]
  asteroidTarget: Asteroid | null
  isScanJob: boolean = false // travelling to the asteroidTarget to scan it, not mine it
  speedMultiplier = 1.0
  unloadTimer: number
  attachUnloadTimer: number = 0
  attachUnloadActive: boolean = false
  waitOrbitalAngle: number | null = null
  dockSlotIndex: number | null = null
  dockIsPublic: boolean = false // docked at a public (fee) dock vs a free owned one
  hangarSlotIndex: number | null = null
  hangarServiceTimer: number = 0
  minerTarget: AutoMiner | null = null
  thrusterFuel: number
  rcsFuel: number
  battery: number
  chargeToggle: boolean
  collectSlotProgress: Map<number, number> = new Map()
  private progressBarGfx: Phaser.GameObjects.Graphics | null = null
  private attachUnloadGfx: Phaser.GameObjects.Graphics | null = null
  private slotGfx: Phaser.GameObjects.Graphics | null = null
  private exhaustEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null
  private exhaustPlume: Phaser.GameObjects.Image | null = null
  private rcsEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null
  private rcsPuffCooldown = 0
  private artAngleOffset = 0  // render offset for atlas art orientation (0 for fallback)
  private baseScale = 1       // spawn (1.0×) reference scale; fly-by looming multiplies this
  isSelected: boolean

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    name: string,
    basePosition: { x: number; y: number },
    base: Base,
    id?: string,
  ) {
    super(
      scene, x, y,
      scene.textures.exists(SHIP_ATLAS_KEY) ? SHIP_ATLAS_KEY : SHIP_TEXTURE_KEY,
      scene.textures.exists(SHIP_ATLAS_KEY) ? SHIP_ATLAS_FRAME : undefined,
    )
    this.id = id ?? nanoid()
    this.shipName = name
    this.cargoCapacity = CARGO_CAPACITY_TIERS[0]
    this.cargoUpgradeLevel = 0
    this.basePosition = basePosition
    this.base = base
    this.cargoContents = {}
    this.shipState = 'idle'
    this.target = null
    this.heading = 0
    this.attachmentPoints = makeDefaultLoadout()
    this.asteroidTarget = null
    this.unloadTimer = 0
    this.thrusterFuel = HAULER_FUEL_MAX
    this.rcsFuel = HAULER_RCS_MAX
    this.battery = HAULER_BATTERY_MAX
    this.chargeToggle = false
    this.isSelected = false

    scene.add.existing(this)
    scene.physics.add.existing(this)
    this.setOrigin(0.5, 0.5)
    if (this.texture.key === SHIP_ATLAS_KEY) {
      this.artAngleOffset = SHIP_ART_ANGLE_OFFSET
      this.setScale(SHIP_DISPLAY_LENGTH / this.height)
    }
    this.baseScale = this.scaleX
    this.setAngle(this.heading + this.artAngleOffset)
    this.setInteractive()
  }

  /** Applies the fly-by looming factor on top of the spawn scale (1.0 = cruise). */
  setFlybyScale(factor: number): void {
    this.setScale(this.baseScale * factor)
  }

  issueMoveTo(worldX: number, worldY: number): void {
    this.target = { x: worldX, y: worldY }
    this.shipState = 'moving'
    this.pushToStore()
  }

  /** True while the hull is under main-thruster transit (burns thrusterFuel). */
  private inTransit(): boolean {
    return (
      this.shipState === 'traveling-to-asteroid' ||
      this.shipState === 'traveling-to-base' ||
      this.shipState === 'responding-to-beacon' ||
      this.shipState === 'traveling-to-hangar' ||
      this.shipState === 'fetching-station-miner' ||
      this.shipState === 'moving'
    )
  }

  /** True while the hull is holding position on RCS (drains rcsFuel). */
  private inManeuver(): boolean {
    return (
      this.shipState === 'entering-hangar' ||
      this.shipState === 'deploying-miner' ||
      this.shipState === 'waiting-at-asteroid' ||
      this.shipState === 'collecting-nets' ||
      this.shipState === 'resupplying-miner' ||
      this.shipState === 'loading-miner'
    )
  }

  updateSteering(dt: number): void {
    const isTransit = this.inTransit()
    if (isTransit) {
      if (this.thrusterFuel <= 0) {
        this.setVelocity(0, 0)
        this.thrusterFuel = HAULER_FUEL_EMERGENCY_RESERVE
        this.shipState = 'coasting'
        this.pushToStore()
        this.emit('fuel-dry')
        return
      }
      this.thrusterFuel = Math.max(0, this.thrusterFuel - HAULER_FUEL_DRAIN_PER_SEC * dt)
      this.battery = Math.min(HAULER_BATTERY_MAX, this.battery + HAULER_BATTERY_CHARGE_RATE * dt)
    }
    switch (this.shipState) {
      case 'moving':
        this.steerTowardTarget(dt, ARRIVAL_RADIUS, () => this.arriveIdle())
        break
      case 'traveling-to-base':
        this.steerTowardTarget(dt, ARRIVAL_RADIUS, () => this.beginUnloading())
        break
      case 'unloading':
        this.updateUnloading(dt)
        break
      case 'traveling-to-asteroid':
        // SpaceScene updates this.target each frame to the asteroid's current position.
        // On arrival, SpaceScene detects the deploying-miner state and calls performDeploy.
        this.steerTowardTarget(dt, MINER_DEPLOY_PROXIMITY, () => {
          this.setVelocity(0, 0)
          this.shipState = this.isScanJob ? 'scanning' : 'deploying-miner'
          this.pushToStore()
        })
        break
      case 'responding-to-beacon':
        // SpaceScene updates this.target each frame to the miner's current position.
        // On arrival, transitions to loading-miner; SpaceScene detects and calls performRecovery.
        this.steerTowardTarget(dt, MINER_DEPLOY_PROXIMITY, () => {
          this.setVelocity(0, 0)
          this.shipState = 'loading-miner'
          this.pushToStore()
        })
        break
      case 'in-hangar':
        this.setVelocity(0, 0)
        this.updateHangarService(dt)
        break
      case 'traveling-to-hangar':
        this.steerTowardTarget(dt, ARRIVAL_RADIUS, () => {
          this.setVelocity(0, 0)
          this.shipState = 'entering-hangar'
          this.pushToStore()
        })
        break
      case 'fetching-station-miner':
        // SpaceScene detects proximity to base and calls handleFetchStationMinerArrival.
        // This steer handles movement; the callback is a safe fallback that should not fire.
        this.steerTowardTarget(dt, ARRIVAL_RADIUS, () => this.arriveIdle())
        break
      case 'entering-hangar':
        this.setVelocity(0, 0)
        this.rcsFuel = Math.max(0, this.rcsFuel - HAULER_RCS_DRAIN_MANEUVER * dt)
        break
      case 'deploying-miner':
      case 'scanning':
      case 'waiting-at-asteroid':
      case 'collecting-nets':
      case 'resupplying-miner':
      case 'loading-miner':
        this.setVelocity(0, 0)
        this.rcsFuel = Math.max(0, this.rcsFuel - HAULER_RCS_DRAIN_MANEUVER * dt)
        break
      case 'coasting':
        this.setVelocity(0, 0)
        break
      case 'idle':
        this.setVelocity(0, 0)
        break
    }
  }

  enterHangar(slotPos: { x: number; y: number }, duration: number): void {
    this.setPosition(slotPos.x, slotPos.y)
    this.hangarServiceTimer = duration
    this.shipState = 'in-hangar'
    this.setVelocity(0, 0)
    this.pushToStore()
  }

  private updateHangarService(dt: number): void {
    this.hangarServiceTimer -= dt
    if (this.hangarServiceTimer <= 0) {
      this.hangarServiceTimer = 0
      this.shipState = 'idle'
      this.pushToStore()
      this.emit('hangar-service-complete')
    }
  }

  private steerTowardTarget(
    dt: number,
    arrivalRadius: number,
    onArrive: () => void,
  ): void {
    if (this.target === null) {
      this.setVelocity(0, 0)
      this.shipState = 'idle'
      this.pushToStore()
      return
    }

    const dist = Phaser.Math.Distance.Between(this.x, this.y, this.target.x, this.target.y)
    if (dist < arrivalRadius) {
      this.setVelocity(0, 0)
      onArrive()
      return
    }

    const targetAngleDeg = Phaser.Math.RadToDeg(
      Phaser.Math.Angle.Between(this.x, this.y, this.target.x, this.target.y)
    )
    const diff = Phaser.Math.Angle.ShortestBetween(this.heading, targetAngleDeg)
    const maxTurn = SHIP_TURN_RATE * dt
    this.heading = Phaser.Math.Angle.WrapDegrees(
      this.heading + Phaser.Math.Clamp(diff, -maxTurn, maxTurn)
    )
    this.setAngle(this.heading + this.artAngleOffset)
    this.scene.physics.velocityFromAngle(this.heading, SHIP_SPEED * this.speedMultiplier, this.body!.velocity)
  }

  private arriveIdle(): void {
    this.shipState = 'idle'
    this.target = null
    this.isScanJob = false
    this.pushToStore()
  }

  beginCollecting(): void {
    this.collectSlotProgress.clear() // callers must init progress entries AFTER this call
    this.shipState = 'collecting-nets'
    this.setVelocity(0, 0)
    this.pushToStore()
  }

  departForBase(slotTarget?: { x: number; y: number }): void {
    this.collectSlotProgress.clear()
    this.shipState = 'traveling-to-base'
    // Fall back to the live base position (the base orbits); the scene also
    // re-targets in-flight ships each frame to track the moving slot/base.
    this.target = slotTarget ? { ...slotTarget } : { x: this.base.x, y: this.base.y }
    this.asteroidTarget = null
    this.isScanJob = false
    this.waitOrbitalAngle = null
    this.minerTarget = null
    this.pushToStore()
  }

  private beginUnloading(): void {
    this.emit('begin-unloading')
    this.shipState = 'unloading'
    this.target = null
    this.collectSlotProgress.clear() // drop stale collection progress; unload sets its own
    const hasCargoContents = Object.values(this.cargoContents).some(v => (v ?? 0) > 0)
    if (hasCargoContents) {
      this.unloadTimer = 0
      this.progressBarGfx = this.scene.add.graphics()
      this.progressBarGfx.setDepth(this.depth + 1)
    } else {
      this.unloadTimer = UNLOAD_DURATION
    }
    // A cargo-net slot, or a carried (in-transit) auto-miner, is a timed
    // attachment-unload item handled one-per-interval by the scene.
    const hasAttachItems = this.attachmentPoints.some(
      ap => ap.payload?.kind === 'cargo-net' || ap.payload?.kind === 'auto-miner',
    )
    if (hasAttachItems) {
      this.attachUnloadActive = true
      this.attachUnloadTimer = 0
      this.attachUnloadGfx = this.scene.add.graphics()
      this.attachUnloadGfx.setDepth(this.depth + 1)
    } else {
      this.attachUnloadActive = false
      this.attachUnloadTimer = ATTACHMENT_UNLOAD_DURATION
    }
    this.pushToStore()
  }

  /**
   * Called by the scene after each attachment net is drained: re-arm the per-net
   * timer if more nets remain, otherwise end the attach-unload phase.
   */
  armNextAttachUnload(hasMore: boolean): void {
    if (hasMore) {
      this.attachUnloadTimer = 0
    } else {
      this.attachUnloadActive = false
      this.collectSlotProgress.clear()
      if (this.attachUnloadGfx !== null) {
        this.attachUnloadGfx.destroy()
        this.attachUnloadGfx = null
      }
    }
    this.pushToStore()
  }

  private updateUnloading(dt: number): void {
    // Draw attachment net bar (above cargo bar)
    if (this.attachUnloadGfx !== null) {
      const fill = Math.min(this.attachUnloadTimer / ATTACHMENT_UNLOAD_DURATION, 1)
      const barX = this.x - UNLOAD_BAR_WIDTH / 2
      const barY = this.y - ATTACH_BAR_Y_OFFSET
      this.attachUnloadGfx.clear()
      this.attachUnloadGfx.fillStyle(0x222222, 0.7)
      this.attachUnloadGfx.fillRect(barX, barY, UNLOAD_BAR_WIDTH, UNLOAD_BAR_HEIGHT)
      this.attachUnloadGfx.fillStyle(ATTACH_BAR_COLOR, 1)
      this.attachUnloadGfx.fillRect(barX, barY, UNLOAD_BAR_WIDTH * fill, UNLOAD_BAR_HEIGHT)
    }

    // Draw cargo bay bar
    if (this.progressBarGfx !== null) {
      const fill = Math.min(this.unloadTimer / UNLOAD_DURATION, 1)
      const barX = this.x - UNLOAD_BAR_WIDTH / 2
      const barY = this.y - UNLOAD_BAR_Y_OFFSET
      this.progressBarGfx.clear()
      this.progressBarGfx.fillStyle(0x222222, 0.7)
      this.progressBarGfx.fillRect(barX, barY, UNLOAD_BAR_WIDTH, UNLOAD_BAR_HEIGHT)
      this.progressBarGfx.fillStyle(0x88ccff, 1)
      this.progressBarGfx.fillRect(barX, barY, UNLOAD_BAR_WIDTH * fill, UNLOAD_BAR_HEIGHT)
    }

    // Silo soft-caps: in-flight cargo always unloads (never stranded), even if it
    // pushes the silo transiently over capacity. Back-pressure is applied upstream
    // by halting new acquisition (auto-designate) once the silo is full.

    // Advance attachment timer — one item drains per ATTACHMENT_UNLOAD_DURATION.
    // The scene drains an item on each tick and re-arms via armNextAttachUnload.
    if (this.attachUnloadActive) {
      this.attachUnloadTimer = Math.min(this.attachUnloadTimer + dt, ATTACHMENT_UNLOAD_DURATION)
      // Show per-slot progress on the current item (first net, else first miner).
      this.collectSlotProgress.clear()
      let curIdx = this.attachmentPoints.findIndex(ap => ap.payload?.kind === 'cargo-net')
      if (curIdx === -1) curIdx = this.attachmentPoints.findIndex(ap => ap.payload?.kind === 'auto-miner')
      if (curIdx !== -1) this.collectSlotProgress.set(curIdx, this.attachUnloadTimer / ATTACHMENT_UNLOAD_DURATION)
      if (this.attachUnloadTimer >= ATTACHMENT_UNLOAD_DURATION) {
        this.emit('attachment-unload-tick')
      }
    }

    // Advance cargo timer
    this.unloadTimer += dt
    this.pushToStore()
    if (this.unloadTimer < UNLOAD_DURATION) return
    if (this.attachUnloadActive) return

    this.base.acceptCargo(this.cargoContents)
    this.cargoContents = {}
    this.unloadTimer = 0
    this.destroyProgressBar()
    this.shipState = 'idle'
    this.pushToStore()
    this.emit('unload-complete')
  }

  private destroyProgressBar(): void {
    if (this.progressBarGfx !== null) {
      this.progressBarGfx.destroy()
      this.progressBarGfx = null
    }
    if (this.attachUnloadGfx !== null) {
      this.attachUnloadGfx.destroy()
      this.attachUnloadGfx = null
    }
  }

  /**
   * Draws a row of markers below the hull, one per attachment point, so the
   * payload aboard each slot is legible: empty (faint outline), reserved/incoming
   * (hollow, colored by target kind), carried auto-miner (cyan), cargo-net
   * (amber), net-store (grey). Called each frame; follows the hull.
   */
  destroy(fromScene?: boolean): void {
    this.destroyProgressBar()
    if (this.slotGfx !== null) {
      this.slotGfx.destroy()
      this.slotGfx = null
    }
    if (this.exhaustPlume !== null) {
      this.exhaustPlume.destroy()
      this.exhaustPlume = null
    }
    if (this.exhaustEmitter !== null) {
      this.exhaustEmitter.destroy()
      this.exhaustEmitter = null
    }
    if (this.rcsEmitter !== null) {
      this.rcsEmitter.destroy()
      this.rcsEmitter = null
    }
    super.destroy(fromScene)
  }

  private ensureEmitters(): void {
    if (this.exhaustPlume !== null || this.exhaustEmitter !== null) return
    if (!this.scene.textures.exists(PARTICLE_TEXTURE_KEY)) return
    if (this.scene.textures.exists(FLAME_TEXTURE_KEY)) {
      // Generated flame as a stretched additive billboard: a directional jet straight out the
      // back (not a radial puff). Origin near the hot end so it attaches at the nozzle.
      this.exhaustPlume = this.scene.add
        .image(0, 0, FLAME_TEXTURE_KEY)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setOrigin(0.5, 0.15)
        .setVisible(false)
        .setDepth(this.depth - 1)
    } else {
      // Fallback: the procedural soft-dot exhaust (tinted) when the flame sprite is absent.
      this.exhaustEmitter = this.scene.add.particles(0, 0, PARTICLE_TEXTURE_KEY, {
        lifespan: 420,
        speed: { min: 30, max: 70 },
        scale: { start: 0.55, end: 0 },
        alpha: { start: 0.85, end: 0 },
        tint: [0xffffff, 0xffd27f, 0xff8a3c],
        blendMode: 'ADD',
        frequency: 28,
        quantity: 1,
        emitting: false,
      })
      this.exhaustEmitter.setDepth(this.depth - 1)
    }
    this.rcsEmitter = this.scene.add.particles(0, 0, PARTICLE_TEXTURE_KEY, {
      lifespan: 260,
      speed: { min: 10, max: 30 },
      scale: { start: 0.3, end: 0 },
      alpha: { start: 0.7, end: 0 },
      tint: [0xcfe8ff, 0xffffff],
      blendMode: 'ADD',
      emitting: false,
    })
    this.rcsEmitter.setDepth(this.depth - 1)
  }

  /**
   * Drive thruster exhaust and RCS-puff particles from the current motion state.
   * Called each frame by the scene after updateSteering. Exhaust streams behind
   * the hull while in transit; RCS fires intermittent flank puffs while
   * maneuvering (holding station on RCS).
   */
  updateThrusters(dt: number): void {
    this.ensureEmitters()
    if (this.rcsEmitter === null) return

    const rad = Phaser.Math.DegToRad(this.heading)

    // Continuous exhaust plume behind the hull while thrusting.
    if (this.inTransit()) {
      const rearX = this.x - Math.cos(rad) * EXHAUST_OFFSET
      const rearY = this.y - Math.sin(rad) * EXHAUST_OFFSET
      if (this.exhaustPlume !== null) {
        // Directional billboard: local +Y points along (heading+180), i.e. straight out the back;
        // flicker the length a little for life.
        const flick = 0.8 + Math.random() * 0.35
        this.exhaustPlume.setPosition(rearX, rearY)
        this.exhaustPlume.setAngle(this.heading + 90)
        this.exhaustPlume.setDisplaySize(PLUME_WIDTH, PLUME_LENGTH * flick)
        this.exhaustPlume.setAlpha(0.8 + Math.random() * 0.2)
        this.exhaustPlume.setVisible(true)
      } else if (this.exhaustEmitter !== null) {
        this.exhaustEmitter.setPosition(rearX, rearY)
        const back = this.heading + 180
        this.exhaustEmitter.setEmitterAngle({ min: back - EXHAUST_SPREAD, max: back + EXHAUST_SPREAD })
        this.exhaustEmitter.emitting = true
      }
    } else {
      if (this.exhaustPlume !== null) this.exhaustPlume.setVisible(false)
      if (this.exhaustEmitter !== null) this.exhaustEmitter.emitting = false
    }

    // Intermittent RCS puffs from a flank while maneuvering on RCS.
    if (this.inManeuver()) {
      this.rcsPuffCooldown -= dt
      if (this.rcsPuffCooldown <= 0) {
        this.rcsPuffCooldown = RCS_PUFF_INTERVAL
        const side = Math.random() < 0.5 ? 1 : -1
        const px = this.x + Math.cos(rad + Math.PI / 2) * RCS_FLANK_OFFSET * side
        const py = this.y + Math.sin(rad + Math.PI / 2) * RCS_FLANK_OFFSET * side
        this.rcsEmitter.explode(Phaser.Math.Between(1, 3), px, py)
      }
    } else {
      this.rcsPuffCooldown = 0
    }
  }

  drawSlotIndicators(): void {
    if (this.slotGfx === null) {
      this.slotGfx = this.scene.add.graphics()
      this.slotGfx.setDepth(this.depth + 1)
    }
    const g = this.slotGfx
    g.clear()

    const n = this.attachmentPoints.length
    const s = SLOT_MARKER_SIZE
    const totalW = n * s + (n - 1) * SLOT_MARKER_GAP
    let mx = this.x - totalW / 2
    const my = this.y + SLOT_INDICATOR_Y_OFFSET

    for (let i = 0; i < n; i++) {
      const p = this.attachmentPoints[i].payload
      const progress = this.collectSlotProgress.get(i)
      const color =
        p?.kind === 'auto-miner' || (p?.kind === 'reserved' && p.forKind === 'auto-miner') ? SLOT_COLOR_MINER
        : p?.kind === 'net-store' ? SLOT_COLOR_STORE
        : p === null ? SLOT_COLOR_EMPTY
        : SLOT_COLOR_NET // cargo-net or reserved-for-net
      if (progress !== undefined) {
        // Operation in progress: outline + fill. Loading fills bottom-up; unloading
        // drains (empties) the slot as it goes.
        const c = p === null ? SLOT_COLOR_NET : color
        g.lineStyle(1, c, 0.9)
        g.strokeRect(mx, my, s, s)
        const clamped = Math.min(Math.max(progress, 0), 1)
        const fh = s * (this.shipState === 'unloading' ? 1 - clamped : clamped)
        g.fillStyle(c, 1)
        g.fillRect(mx, my + (s - fh), s, fh)
      } else if (p === null) {
        g.lineStyle(1, SLOT_COLOR_EMPTY, 0.5)
        g.strokeRect(mx, my, s, s)
      } else if (p.kind === 'reserved') {
        g.lineStyle(1, color, 0.9)
        g.strokeRect(mx, my, s, s)
      } else {
        g.fillStyle(color, p.kind === 'net-store' ? 0.9 : 1)
        g.fillRect(mx, my, s, s)
      }
      mx += s + SLOT_MARKER_GAP
    }
  }

  select(): void {
    this.isSelected = true
    this.pushToStore()
  }

  deselect(): void {
    this.isSelected = false
    selectedShip.set(null)
  }

  pushToStore(): void {
    if (!this.isSelected) return
    selectedShip.set({
      id: this.id,
      name: this.shipName,
      state: this.shipState,
      cargoCapacity: this.cargoCapacity,
      cargoUpgradeLevel: this.cargoUpgradeLevel,
      cargoContents: { ...this.cargoContents },
      // Reservations are in-flight claims, not real payloads — serialize as empty
      // so a reloaded slot is released (the target miner/net re-advertises).
      attachmentPoints: this.attachmentPoints.map(ap => ({
        ...ap,
        payload: ap.payload && ap.payload.kind !== 'reserved' ? { ...ap.payload } : null,
      })),
      unloadProgress: this.shipState === 'unloading'
        ? Math.min(this.unloadTimer / UNLOAD_DURATION, 1)
        : 0,
      attachUnloadProgress: Math.min(this.attachUnloadTimer / ATTACHMENT_UNLOAD_DURATION, 1),
      collectSlotProgress: Object.fromEntries(this.collectSlotProgress) as Record<number, number>,
      thrusterFuel: this.thrusterFuel,
      rcsFuel: this.rcsFuel,
      battery: this.battery,
      chargeToggle: this.chargeToggle,
    })
  }
}
