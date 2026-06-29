import { nanoid } from 'nanoid'

export type AttachmentPointSize = 'small' | 'medium'

export interface NetStorePayload {
  readonly kind: 'net-store'
  maxNets: number
  currentNets: number
}

export interface AutoMinerPayload {
  readonly kind: 'auto-miner'
  readonly minerId: string
}

export interface CargoNetPayload {
  readonly kind: 'cargo-net'
  readonly netId: string
}

// A reusable scanner probe occupying a medium slot (Phase 5). Fungible — no id.
export interface ScannerPayload {
  readonly kind: 'scanner'
}

// A slot committed to a payload the hauler does not yet physically hold (a miner
// it is travelling to recover, or a net mid-collection). Non-null so free-slot
// checks (`payload === null`) treat it as occupied; its `kind` never matches a
// real payload kind, so carried-payload checks skip it. Resolved to the real
// payload on pickup, or released (→ null) on cancel/load.
export interface ReservedPayload {
  readonly kind: 'reserved'
  readonly forKind: 'auto-miner' | 'cargo-net'
  readonly targetId: string
}

export type AttachmentPayload = NetStorePayload | AutoMinerPayload | CargoNetPayload | ReservedPayload | ScannerPayload

export interface AttachmentPoint {
  readonly id: string
  readonly size: AttachmentPointSize
  payload: AttachmentPayload | null
}

export const NET_STORE_MAX_NETS = 12

export function makeDefaultLoadout(): AttachmentPoint[] {
  return [
    { id: nanoid(), size: 'small', payload: { kind: 'net-store', maxNets: NET_STORE_MAX_NETS, currentNets: NET_STORE_MAX_NETS } },
    { id: nanoid(), size: 'small', payload: null },
    { id: nanoid(), size: 'medium', payload: null },
    { id: nanoid(), size: 'medium', payload: null },
  ]
}
