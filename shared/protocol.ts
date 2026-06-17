// Wire protocol shared by the multiplayer client and server.
// Plain data only — no Phaser, no DOM. Imported by both the Vite client bundle
// and the tsx Node server.

import type { ResourceType, SizeCategory } from '../src/world/worldConfig'

export type { ResourceType, SizeCategory }

export type MatchPhase = 'lobby' | 'running' | 'ended'

/** A ship's coarse, render-friendly state. */
export type ShipPhase = 'idle' | 'to-asteroid' | 'mining' | 'to-base'

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
}

export interface ShipSnap {
  id: string
  x: number
  y: number
  /** facing in radians, for rendering the hull */
  angle: number
  phase: ShipPhase
  cargo: number
  cargoCapacity: number
  cargoResource: ResourceType | null
  targetAsteroidId: string | null
}

export interface CorpSnap {
  id: string
  name: string
  /** 0xRRGGBB hull/base tint, assigned on join */
  color: number
  baseX: number
  baseY: number
  credits: number
  /** cumulative tons sold across the whole match */
  tonnage: number
  /** tons sold in the current quota period (the elimination metric) */
  periodTonnage: number
  ships: ShipSnap[]
  alive: boolean
  online: boolean
}

export interface WorldSnapshot {
  /** server sim time in seconds */
  t: number
  phase: MatchPhase
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
  /** most recent match events, newest last (liquidations, claims won, etc.) */
  log: string[]
}

// ----- client -> server -----

export type GameCommand =
  | { kind: 'designate'; asteroidId: string }
  | { kind: 'undesignate'; asteroidId: string }
  | { kind: 'buyShip' }

export type ClientMessage =
  | { type: 'join'; name: string; room: string }
  | { type: 'start' } // host only: lobby -> running
  | { type: 'cmd'; cmd: GameCommand }
  | { type: 'ping' }

// ----- server -> client -----

export type ServerMessage =
  | { type: 'welcome'; corpId: string; room: string; isHost: boolean; you: string }
  | { type: 'lobby'; room: string; players: LobbyPlayer[]; isHost: boolean }
  | { type: 'snapshot'; world: WorldSnapshot }
  | { type: 'error'; message: string }
  | { type: 'pong' }

export interface LobbyPlayer {
  corpId: string
  name: string
  color: number
  online: boolean
}
