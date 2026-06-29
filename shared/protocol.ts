// Wire protocol shared by the multiplayer client and server.
// Plain data only — no Phaser, no DOM. Imported by both the Vite client bundle
// and the tsx Node server.

import type { ResourceType, SizeCategory } from '../src/world/worldConfig'

export type { ResourceType, SizeCategory }

export type MatchPhase = 'lobby' | 'running' | 'ended'

/** A hauler's coarse, render-friendly state. Haulers no longer mine — they carry a
 * miner out to deploy, then shuttle the nets it ejects back to base. */
export type ShipPhase =
  | 'idle'
  | 'to-asteroid'
  | 'deploying'
  | 'collecting'
  | 'to-orphan'
  | 'to-base'
  | 'unloading'

/** A deployed AutoMiner's state. */
export type MinerState = 'mining' | 'net-starved' | 'depleted'

export interface MinerSnap {
  id: string
  x: number
  y: number
  asteroidId: string
  resourceType: ResourceType
  /** tethered nets waiting for the hauler (each ~NET_CAPACITY ore) */
  netsReady: number
  state: MinerState
  /** mechanical condition 0..1 — wears with use, repaired by a servicing hauler */
  condition: number
  /** battery 0..MINER_BATTERY_MAX — drains while mining, recharged by a servicing hauler */
  battery: number
}

/** Free-floating nets left behind when a miner is recalled/lost with ore still
 * buffered — they drift as salvage until a hauler recovers them. */
export interface OrphanNetSnap {
  id: string
  x: number
  y: number
  resourceType: ResourceType
  /** ore still aboard the drifting nets */
  amount: number
}

/** Live view of one resource's sell market. `current` already reflects any active
 * market event (the event multiplier is folded into the baseline server-side). */
export interface MarketPrice {
  /** live per-unit sell price right now (baseline depressed by recent sell-pressure) */
  current: number
  /** standing value absent depression — moves with market events */
  baseline: number
  /** accumulated recent-sales pressure (0 = price rested at baseline) */
  pressure: number
}

/** A global market event shifting one resource's baseline for a window. */
export interface MarketEventSnap {
  resourceType: ResourceType
  type: 'spike' | 'glut' | 'drought'
  /** baseline multiplier while active (>1 raises price, <1 lowers it) */
  multiplier: number
  /** sim time at which the event ends */
  endTime: number
}

export interface AsteroidSnap {
  id: string
  x: number
  y: number
  resourceType: ResourceType
  sizeCategory: SizeCategory
  currentQuantity: number
  maxQuantity: number
  /** corpId that has claimed this rock, or null if free. Depleted rocks stay null. */
  claimedBy: string | null
  /** true for company asteroids (the richer rocks that arrive over time) */
  isCompany: boolean
  /** large (high-yield) rocks are unknown until a ship scouts near them; smaller
   * rocks are always true. Drives the 'unknown' sprite + the "scan to reveal" panel. */
  scanned: boolean
}

export interface ShipSnap {
  id: string
  /** display name, e.g. "Hauler-01" */
  name: string
  x: number
  y: number
  /** facing in radians, for rendering the hull */
  angle: number
  phase: ShipPhase
  cargo: number
  cargoCapacity: number
  /** 0..MAX_CARGO_LEVEL — drives cargoCapacity via the tier table */
  cargoLevel: number
  cargoResource: ResourceType | null
  /** the asteroid this hauler is servicing (deploying to / shuttling for) */
  targetAsteroidId: string | null
  /** true while carrying a miner out to deploy it */
  carryingMiner: boolean
  /** miners loaded in the bay (0..MINER_SLOTS) — for the attachment-point display */
  minersAboard: number
  /** 0..1 progress of the current timed action (deploying / collecting / unloading) */
  progress: number
  /** thruster fuel remaining (0..HAULER_FUEL_MAX); tops off at base for a fee */
  fuel: number
  /** battery charge (0..HAULER_BATTERY_MAX); recharges while parked */
  battery: number
}

export interface CorpSnap {
  id: string
  name: string
  /** 0xRRGGBB hull/base tint, assigned on join */
  color: number
  baseX: number
  baseY: number
  credits: number
  /** resources held in base storage, awaiting sale */
  storage: Partial<Record<ResourceType, number>>
  storageCapacity: number
  /** per-resource live sell market (dynamic pricing — faithful to SP) */
  prices: Record<ResourceType, MarketPrice>
  /** total AutoMiners owned (deployed + idle in inventory) */
  minerCount: number
  /** miners currently deployed at asteroids */
  miners: MinerSnap[]
  /** drifting nets left by recalled/lost miners, awaiting recovery */
  orphanNets: OrphanNetSnap[]
  /** auto-claim the best unclaimed asteroid when a miner + hauler are free */
  autoDesignate: boolean
  /** cumulative credits spent on station services (refuel + repair) */
  serviceSpend: number
  /** station miner-slot cap — you can own at most this many AutoMiners */
  minerSlots: number
  /** owned docks (cheaper refuel) / hangars (cheaper repair) / pressurized bay */
  ownedDocks: number
  ownedHangars: number
  pressurized: boolean
  /** cumulative tons DELIVERED to base across the whole match */
  tonnage: number
  /** tons delivered in the current quota period (the elimination metric) */
  periodTonnage: number
  ships: ShipSnap[]
  alive: boolean
  online: boolean
}

export interface WorldSnapshot {
  /** server sim time in seconds */
  t: number
  phase: MatchPhase
  /** host has paused the match — sim + quota clock are frozen */
  paused: boolean
  /** seed used to generate the shared field (so clients can match RNG if needed) */
  seed: number
  worldRadius: number
  period: number
  /** the rising tonnage floor a corp must clear this period to be safe */
  quota: number
  /** sim time at which the current period closes and the lowest corp is cut */
  periodEndsAt: number
  asteroids: AsteroidSnap[]
  corps: CorpSnap[]
  winnerCorpId: string | null
  /** active global market events (spike/glut/drought) shifting resource baselines */
  marketEvents: MarketEventSnap[]
  /** most recent match events, newest last (liquidations, claims won, etc.) */
  log: string[]
}

// ----- client -> server -----

export type GameCommand =
  | { kind: 'designate'; asteroidId: string }
  | { kind: 'undesignate'; asteroidId: string }
  | { kind: 'buyShip' }
  | { kind: 'buyMiner' }
  | { kind: 'buyMinerSlot' }
  | { kind: 'buyDock' }
  | { kind: 'buyHangar' }
  | { kind: 'buyPressurization' }
  | { kind: 'sell'; resource: ResourceType }
  | { kind: 'upgradeShip'; shipId: string }
  | { kind: 'toggleAutoDesignate' }

export type ClientMessage =
  | { type: 'join'; name: string; room: string }
  | { type: 'start' } // host only: lobby -> running
  | { type: 'pause' } // host only: toggle the match pause (freezes the sim + clock)
  | { type: 'quit' } // forfeit + leave; the room is GC'd when it empties
  | { type: 'cmd'; cmd: GameCommand }
  | { type: 'chat'; text: string } // a line of room chat (lobby or match)
  | { type: 'ping' }

// ----- server -> client -----

export type ServerMessage =
  | { type: 'welcome'; corpId: string; room: string; isHost: boolean; you: string }
  | { type: 'lobby'; room: string; players: LobbyPlayer[]; isHost: boolean }
  | { type: 'snapshot'; world: WorldSnapshot }
  | { type: 'chat'; from: string; color: number; text: string }
  | { type: 'error'; message: string }
  | { type: 'pong' }

export interface LobbyPlayer {
  corpId: string
  name: string
  color: number
  online: boolean
}
