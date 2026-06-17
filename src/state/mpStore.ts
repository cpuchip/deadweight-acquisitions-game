// Multiplayer client stores. Kept separate from the single-player stores so the
// MP overlay and the SpaceScene game never read each other's state.

import { writable } from 'svelte/store'
import type { WorldSnapshot, LobbyPlayer } from '../../shared/protocol'

export type MpMode = 'off' | 'mp'
export type MpConnection = 'idle' | 'connecting' | 'connected' | 'error' | 'closed'

/** 'mp' while the multiplayer overlay + scene are active; 'off' for Dave's game. */
export const mpMode = writable<MpMode>('off')

export const mpConnection = writable<MpConnection>('idle')
export const mpError = writable<string | null>(null)
export const mpRoom = writable<string>('')
export const mpYouCorpId = writable<string | null>(null)
export const mpYouName = writable<string>('')
export const mpIsHost = writable<boolean>(false)
export const mpLobbyPlayers = writable<LobbyPlayer[]>([])
export const mpSnapshot = writable<WorldSnapshot | null>(null)
/** asteroid the player has selected on the map (for the claim/release panel) */
export const mpSelectedAsteroid = writable<string | null>(null)
/** ship the player has selected on the map (for the ship detail panel) */
export const mpSelectedShip = writable<string | null>(null)
/** deployed miner the player has selected on the map (for the miner detail panel) */
export const mpSelectedMiner = writable<string | null>(null)
/** the base/station menu (market, shipyard, equipment) — opens on clicking your base */
export const mpBasePanelOpen = writable<boolean>(false)
/** quick-claim: when on, left-click also designates (Dave's default is select-only) */
export const mpQuickClaim = writable<boolean>(false)
