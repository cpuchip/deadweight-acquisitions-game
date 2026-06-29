import Phaser from 'phaser'
import { baseState } from '../state/baseStore'
import { resourceMarket } from '../state/marketStore'
import { RESOURCE_SELL_PRICES, type ResourceType } from '../world/worldConfig'
import { type ResourceMarket, makeMarket, currentPrice, sell, recover } from '../world/market'
import { investCapacity } from '../world/infrastructure'
import { type Composition } from '../world/composition'
import { blendOre } from '../world/processing'
import { AUTOMINER_PURCHASE_COST, STATION_MINER_SLOT_CAP } from './AutoMiner'
import { getPrice } from '../world/pricingSeam'
import { SERVICE_SLOT_COUNT } from '../world/serviceSlots'
import { HANGAR_BAY_COUNT } from '../world/hangarBays'

const RESOURCE_TYPES: ResourceType[] = ['iron', 'ice', 'silicates', 'rare-metals']

export type LeverKey = 'solar' | 'propellant' | 'foundry'
const LEVER_RESOURCE: Record<LeverKey, ResourceType> = {
  solar:      'silicates',
  propellant: 'ice',
  foundry:    'iron',
}

export const BASE_TEXTURE_KEY = 'base'
export const BASE_STORAGE_CAPACITY = 2000
// Each silo-expansion purchase raises the total-tonnage cap by this much.
export const SILO_CAPACITY_INCREMENT = 1000
// Raw-ore silo: holds mined ore upstream of processing (Phase 5).
export const ORE_SILO_CAPACITY = 1500
export const ORE_SILO_INCREMENT = 1000
const EMPTY_COMPOSITION: Composition = { iron: 0, ice: 0, silicates: 0, 'rare-metals': 0 }
export const STARTING_CREDITS = 750
export const SHIP_COMMISSION_COST = 500
// Keplerian constant for the base's orbit around the planet. Matches the world
// ORBITAL_K for a consistent feel; tunable here if the base should orbit slower.
export const BASE_ORBIT_K = 500

const OUTER_R = 32
const INNER_R = 20
const TEXTURE_SIZE = OUTER_R * 2 + 4
const TEXTURE_CX = TEXTURE_SIZE / 2
const TEXTURE_CY = TEXTURE_SIZE / 2

export function generateBaseTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(BASE_TEXTURE_KEY)) return
  const gfx = scene.make.graphics({ x: 0, y: 0 })
  gfx.fillStyle(0x44aaff, 1)
  gfx.fillCircle(TEXTURE_CX, TEXTURE_CY, INNER_R)
  gfx.lineStyle(2, 0x88ccff, 1)
  gfx.strokeCircle(TEXTURE_CX, TEXTURE_CY, OUTER_R)
  gfx.generateTexture(BASE_TEXTURE_KEY, TEXTURE_SIZE, TEXTURE_SIZE)
  gfx.destroy()
}

// --- Modular station art (asset-harness `dwa_station` atlas; 160px square cells) ---
// The base renders as a central `hub` plus four radiating modules. Each radiating
// module is shown only when its backing infrastructure is owned, so the station
// visibly grows as the player invests.
export const STATION_ATLAS_KEY = 'dwa_station'
const MODULE_DISPLAY = 44                     // on-screen px per 160px cell
const MODULE_SCALE = MODULE_DISPLAY / 160
const CELL = MODULE_DISPLAY                    // adjacent-cell centre offset (edges touch)
// Hit-area radius (container-local px) covering the whole assembly so a click
// anywhere on the station selects the base, not just the hub centre.
const STATION_HIT_RADIUS = CELL + MODULE_DISPLAY / 2 + 6

interface ModuleDef {
  frame: string
  dx: number
  dy: number
  angle: number                               // rotation so the module's port faces the hub (tunable, visual-verified)
  isVisible: (b: Base) => boolean
}

// Layout mirrors samples-2026-06-21-station/base_layout.png: solar N, dock S,
// tank W, habitat E. Angles are best-guess and confirmed during visual checkpoint.
const STATION_MODULES: ModuleDef[] = [
  { frame: 'solar',   dx: 0,     dy: -CELL, angle: 0,   isVisible: b => b.solarCapacity > 0 },
  { frame: 'dock',    dx: 0,     dy: CELL,  angle: 0,   isVisible: b => b.ownedDockCount > 0 },
  { frame: 'tank',    dx: -CELL, dy: 0,     angle: 90,  isVisible: b => b.propellantCapacity > 0 },
  { frame: 'habitat', dx: CELL,  dy: 0,     angle: -90, isVisible: b => b.ownedHangarCount > 0 },
]

export class Base extends Phaser.GameObjects.Container {
  storageCapacity: number
  storage: Partial<Record<ResourceType, number>>
  credits: number
  readonly ships: string[]
  ownedDockCount: number
  ownedHangarCount: number
  hangarPressurized: boolean
  stationMinerSlotCount: number
  stationMinerIds: string[]
  autoDesignate: boolean
  orbitalRadius: number
  orbitalAngle: number
  markets: Record<ResourceType, ResourceMarket>
  solarCapacity: number
  propellantCapacity: number
  foundryCapacity: number
  oreQuantity: number
  oreComposition: Composition
  oreSiloCapacity: number
  scannerCount: number
  // Radiating-module sprites paired with their ownership predicate; toggled in pushToStore.
  private moduleSync: { sprite: Phaser.GameObjects.Image; isVisible: () => boolean }[] = []

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y)
    // Orbit the planet (world center) through the construction point.
    this.orbitalRadius = Math.max(Math.hypot(x, y), 1)
    this.orbitalAngle = Math.atan2(y, x)
    this.storageCapacity = BASE_STORAGE_CAPACITY
    this.storage = {}
    this.credits = STARTING_CREDITS
    this.ships = []
    this.ownedDockCount = 0
    this.ownedHangarCount = 0
    this.hangarPressurized = false
    this.stationMinerSlotCount = 0
    this.stationMinerIds = []
    this.autoDesignate = false
    this.markets = {
      iron:          makeMarket(RESOURCE_SELL_PRICES.iron),
      ice:           makeMarket(RESOURCE_SELL_PRICES.ice),
      silicates:     makeMarket(RESOURCE_SELL_PRICES.silicates),
      'rare-metals': makeMarket(RESOURCE_SELL_PRICES['rare-metals']),
    }
    this.solarCapacity = 0
    this.propellantCapacity = 0
    this.foundryCapacity = 0
    this.oreQuantity = 0
    this.oreComposition = { ...EMPTY_COMPOSITION }
    this.oreSiloCapacity = ORE_SILO_CAPACITY
    this.scannerCount = 0
    this.buildStation(scene)
    scene.add.existing(this)
    // Container-local hit area covers the whole assembly, so clicking any module
    // (not just the hub) selects the base.
    this.setInteractive(
      new Phaser.Geom.Circle(0, 0, STATION_HIT_RADIUS),
      Phaser.Geom.Circle.Contains,
    )
    this.pushToStore()
    this.pushMarketToStore()
  }

  /**
   * Builds the station as child sprites of this container. When the generated
   * atlas is present, renders hub + four radiating modules; otherwise falls back
   * to the programmatic circle so the base always renders and stays selectable.
   */
  private buildStation(scene: Phaser.Scene): void {
    if (!scene.textures.exists(STATION_ATLAS_KEY)) {
      this.add(scene.make.image({ x: 0, y: 0, key: BASE_TEXTURE_KEY, add: false }))
      return
    }
    const hub = scene.make.image({ x: 0, y: 0, key: STATION_ATLAS_KEY, frame: 'hub', add: false })
    hub.setScale(MODULE_SCALE)
    this.add(hub)
    for (const m of STATION_MODULES) {
      const sprite = scene.make.image({ x: m.dx, y: m.dy, key: STATION_ATLAS_KEY, frame: m.frame, add: false })
      sprite.setScale(MODULE_SCALE)
      sprite.setAngle(m.angle)
      sprite.setVisible(m.isVisible(this))
      this.add(sprite)
      this.moduleSync.push({ sprite, isVisible: () => m.isVisible(this) })
    }
  }

  /** Re-evaluates each radiating module's visibility against current ownership. */
  private syncModules(): void {
    for (const m of this.moduleSync) m.sprite.setVisible(m.isVisible())
  }

  /** Advances the base along its orbit and repositions it (planet at world center). */
  advanceOrbit(dt: number): void {
    this.orbitalAngle += (BASE_ORBIT_K / this.orbitalRadius ** 1.5) * dt
    this.setPosition(
      Math.cos(this.orbitalAngle) * this.orbitalRadius,
      Math.sin(this.orbitalAngle) * this.orbitalRadius,
    )
  }

  totalStored(): number {
    return Object.values(this.storage).reduce((sum, n) => sum + (n ?? 0), 0)
  }

  /**
   * Silo is full once stored tonnage reaches capacity. Full does not block an
   * in-flight unload (the silo soft-caps and may transiently exceed capacity);
   * it halts new acquisition (auto-designate) upstream instead.
   */
  isSiloFull(): boolean {
    return this.totalStored() >= this.storageCapacity
  }

  acceptCargo(cargo: Partial<Record<ResourceType, number>>): void {
    for (const [type, qty] of Object.entries(cargo) as [ResourceType, number][]) {
      if (qty > 0) {
        this.storage[type] = (this.storage[type] ?? 0) + qty
      }
    }
    this.pushToStore()
  }

  registerShip(id: string): void {
    this.ships.push(id)
    this.pushToStore()
  }

  sellResource(type: ResourceType): void {
    const qty = this.storage[type] ?? 0
    if (qty <= 0) return
    const { revenue, market } = sell(this.markets[type], qty)
    this.markets[type] = market
    this.storage[type] = 0
    this.credits += revenue
    this.pushToStore()
    this.pushMarketToStore()
  }

  /** Spends all of a lever's resource from the silo to raise its capacity. No-op if none held. */
  investInfrastructure(lever: LeverKey): boolean {
    const resource = LEVER_RESOURCE[lever]
    const qty = this.storage[resource] ?? 0
    if (qty <= 0) return false
    this.storage[resource] = 0
    if (lever === 'solar') this.solarCapacity = investCapacity(this.solarCapacity, qty)
    else if (lever === 'propellant') this.propellantCapacity = investCapacity(this.propellantCapacity, qty)
    else this.foundryCapacity = investCapacity(this.foundryCapacity, qty)
    this.pushToStore()
    return true
  }

  /** Advances per-resource sell-price recovery (pressure decays toward zero). */
  recoverMarkets(dt: number): void {
    for (const type of RESOURCE_TYPES) {
      this.markets[type] = recover(this.markets[type], dt)
    }
  }

  /** Overlays market-event multipliers onto the static baselines (1 = no event). */
  applyEventMultipliers(mult: Record<ResourceType, number>): void {
    for (const type of RESOURCE_TYPES) {
      this.markets[type].baseline = RESOURCE_SELL_PRICES[type] * (mult[type] ?? 1)
    }
  }

  pushMarketToStore(): void {
    resourceMarket.set({
      iron:          { current: currentPrice(this.markets.iron),          baseline: this.markets.iron.baseline },
      ice:           { current: currentPrice(this.markets.ice),           baseline: this.markets.ice.baseline },
      silicates:     { current: currentPrice(this.markets.silicates),     baseline: this.markets.silicates.baseline },
      'rare-metals': { current: currentPrice(this.markets['rare-metals']), baseline: this.markets['rare-metals'].baseline },
    })
  }

  chargeDockFee(isPublic: boolean): void {
    if (!isPublic) return  // owned dock — no fee
    this.credits -= getPrice('dock-cargo-drop')
    this.pushToStore()
  }

  chargeHangarFee(hangarSlotIndex: number | null): void {
    if (hangarSlotIndex === null) return
    if (hangarSlotIndex < this.ownedHangarCount) return  // owned hangar — no fee
    this.credits -= getPrice('hangar-service')
    this.pushToStore()
  }

  purchaseMinerSlot(): boolean {
    if (this.stationMinerSlotCount >= STATION_MINER_SLOT_CAP) return false
    if (this.credits < getPrice('station-miner-slot')) return false
    this.credits -= getPrice('station-miner-slot')
    this.stationMinerSlotCount++
    this.pushToStore()
    return true
  }

  storeAutoMiner(id: string): boolean {
    if (this.stationMinerIds.length >= this.stationMinerSlotCount) return false
    this.stationMinerIds.push(id)
    this.pushToStore()
    return true
  }

  retrieveAutoMiner(): string | null {
    if (this.stationMinerIds.length === 0) return null
    const id = this.stationMinerIds.shift()!
    this.pushToStore()
    return id
  }

  purchaseOwnedDock(): boolean {
    if (this.ownedDockCount >= SERVICE_SLOT_COUNT) return false
    if (this.credits < getPrice('owned-dock-purchase')) return false
    this.credits -= getPrice('owned-dock-purchase')
    this.ownedDockCount++
    this.pushToStore()
    return true
  }

  purchaseHangar(): boolean {
    if (this.ownedHangarCount >= HANGAR_BAY_COUNT) return false
    if (this.credits < getPrice('owned-hangar-purchase')) return false
    this.credits -= getPrice('owned-hangar-purchase')
    this.ownedHangarCount++
    this.pushToStore()
    return true
  }

  purchasePressurization(): boolean {
    if (this.hangarPressurized) return false
    if (this.ownedHangarCount < 1) return false
    if (this.credits < getPrice('pressurization-upgrade')) return false
    this.credits -= getPrice('pressurization-upgrade')
    this.hangarPressurized = true
    this.pushToStore()
    return true
  }

  commissionShip(): boolean {
    if (this.credits < SHIP_COMMISSION_COST) return false
    this.credits -= SHIP_COMMISSION_COST
    this.pushToStore()
    return true
  }

  purchaseMiner(): boolean {
    if (this.credits < AUTOMINER_PURCHASE_COST) return false
    this.credits -= AUTOMINER_PURCHASE_COST
    this.pushToStore()
    return true
  }

  purchaseSiloCapacity(): boolean {
    if (this.credits < getPrice('silo-capacity-upgrade')) return false
    this.credits -= getPrice('silo-capacity-upgrade')
    this.storageCapacity += SILO_CAPACITY_INCREMENT
    this.pushToStore()
    return true
  }

  // --- Raw-ore silo (Phase 5) ---

  /** Ore silo is full once stored ore reaches capacity (soft cap — see acceptOre). */
  isOreSiloFull(): boolean {
    return this.oreQuantity >= this.oreSiloCapacity
  }

  /** Blends a delivered ore batch into the silo (always accepted; may transiently over-cap). */
  acceptOre(qty: number, composition: Composition): void {
    if (qty <= 0) return
    const blended = blendOre(this.oreQuantity, this.oreComposition, qty, composition)
    this.oreQuantity = blended.quantity
    this.oreComposition = blended.composition
  }

  /** Removes up to `amount` ore for processing; returns the amount actually drained (composition unchanged). */
  drainOre(amount: number): number {
    const drained = Math.min(amount, this.oreQuantity)
    this.oreQuantity -= drained
    if (this.oreQuantity <= 1e-6) {
      this.oreQuantity = 0
      this.oreComposition = { ...EMPTY_COMPOSITION }
    }
    return drained
  }

  purchaseScanner(): boolean {
    if (this.credits < getPrice('scanner-purchase')) return false
    this.credits -= getPrice('scanner-purchase')
    this.scannerCount++
    this.pushToStore()
    return true
  }

  purchaseOreSiloCapacity(): boolean {
    if (this.credits < getPrice('ore-silo-capacity-upgrade')) return false
    this.credits -= getPrice('ore-silo-capacity-upgrade')
    this.oreSiloCapacity += ORE_SILO_INCREMENT
    this.pushToStore()
    return true
  }

  pushToStore(): void {
    this.syncModules()
    baseState.set({
      storage: { ...this.storage },
      storageCapacity: this.storageCapacity,
      credits: this.credits,
      fleetSize: this.ships.length,
      stationMinerCount: this.stationMinerIds.length,
      stationMinerSlotCount: this.stationMinerSlotCount,
      ownedDockCount: this.ownedDockCount,
      ownedHangarCount: this.ownedHangarCount,
      hangarPressurized: this.hangarPressurized,
      autoDesignate: this.autoDesignate,
      scannerCount: this.scannerCount,
    })
  }
}
