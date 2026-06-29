import type { ResourceType, SizeCategory } from '../world/worldConfig'
import type { Composition } from '../world/composition'
import type { MarketEvent } from '../world/marketEvents'
import type { ShipState } from './shipStore'
import type { AttachmentPoint } from './attachmentTypes'
import type { AutoMinerState, BeaconReason } from '../entities/AutoMiner'
import type { CargoNetState } from '../entities/CargoNet'

export interface AsteroidSnapshot {
  id: string
  x: number
  y: number
  orbitalRadius: number
  orbitalAngle: number
  resourceType: ResourceType
  composition: Composition
  scanned: boolean
  sizeCategory: SizeCategory
  currentQuantity: number
  maxQuantity: number
  isCompany: boolean
}

export interface CargoNetSnapshot {
  id: string
  state: CargoNetState
  resourceType: string
  composition: Composition
  quantity: number
  asteroidId: string | null
  freeOrbitalRadius: number | null
  freeOrbitalAngle: number | null
  designatedForCollection: boolean
}

export interface AutoMinerSnapshot {
  id: string
  state: AutoMinerState
  condition: number
  asteroidId: string | null
  freeOrbitalRadius: number | null
  freeOrbitalAngle: number | null
  technologyLevel: number
  spareNetCount: number
  activeNetFill: number
  tetheredNetIds: string[]
  battery: number
  beaconReason: BeaconReason
  activeResourceType: ResourceType | null
  activeComposition: Composition | null
}

export interface ShipSnapshot {
  id: string
  name: string
  x: number
  y: number
  heading: number
  shipState: ShipState
  target: { x: number; y: number } | null
  asteroidTargetId: string | null
  cargoContents: Partial<Record<ResourceType, number>>
  cargoCapacity: number
  cargoUpgradeLevel: number
  attachmentPoints: AttachmentPoint[]
  unloadTimer: number
  attachUnloadTimer: number
  waitOrbitalAngle: number | null
  dockSlotIndex: number | null
  dockIsPublic: boolean
  hangarSlotIndex: number | null
  hangarServiceTimer: number
  thrusterFuel: number
  rcsFuel: number
  battery: number
  chargeToggle: boolean
  isScanJob: boolean
}

export interface BaseSnapshot {
  storage: Partial<Record<ResourceType, number>>
  storageCapacity: number
  marketPressure: Partial<Record<ResourceType, number>>
  solarCapacity: number
  propellantCapacity: number
  foundryCapacity: number
  oreQuantity: number
  oreComposition: Composition
  oreSiloCapacity: number
  credits: number
  ownedDockCount: number
  ownedHangarCount: number
  hangarPressurized: boolean
  stationMinerSlotCount: number
  stationMinerIds: string[]
  autoDesignate: boolean
  orbitalAngle: number
  scannerCount: number
}

export interface MiningDesignationSnapshot {
  id: string
  asteroidId: string
  kind: 'mine' | 'scan'
  status: 'queued' | 'claimed' | 'fulfilled'
  claimedByShipId: string | null
}

export interface SaveState {
  schemaVersion: number
  worldSeed: number
  gameClock: number
  base: BaseSnapshot
  asteroids: AsteroidSnapshot[]
  ships: ShipSnapshot[]
  autoMiners: AutoMinerSnapshot[]
  cargoNets: CargoNetSnapshot[]
  designations: MiningDesignationSnapshot[]
  marketEvents: { active: MarketEvent[]; nextEventAt: number; seed: number }
}

// Template defaults for a fresh state. `storageCapacity` mirrors
// BASE_STORAGE_CAPACITY in entities/Base.ts (kept as a literal to avoid pulling
// Phaser into this widely-imported state module); keep the two in sync.
export const gameState: SaveState = {
  schemaVersion: 1,
  worldSeed: 0,
  gameClock: 0,
  base: { storage: {}, storageCapacity: 2000, marketPressure: {}, solarCapacity: 0, propellantCapacity: 0, foundryCapacity: 0, oreQuantity: 0, oreComposition: { iron: 0, ice: 0, silicates: 0, 'rare-metals': 0 }, oreSiloCapacity: 1500, credits: 0, ownedDockCount: 0, ownedHangarCount: 0, hangarPressurized: false, stationMinerSlotCount: 0, stationMinerIds: [], autoDesignate: false, orbitalAngle: Math.PI / 2, scannerCount: 0 },
  asteroids: [],
  ships: [],
  autoMiners: [],
  cargoNets: [],
  designations: [],
  marketEvents: { active: [], nextEventAt: 0, seed: 0 },
}
