import { writable } from 'svelte/store'

export interface MiningDesignation {
  id: string
  asteroidId: string
  // 'mine' = deploy a miner here; 'scan' = send a scanner-hauler to reveal composition.
  kind: 'mine' | 'scan'
  // 'fulfilled' = a miner is deployed and mining this asteroid; the entry persists
  // (bound to the asteroid) until the asteroid depletes, marking it "being mined"
  // and preventing re-designation.
  status: 'queued' | 'claimed' | 'fulfilled'
  claimedByShipId: string | null
}

export const designationQueue = writable<MiningDesignation[]>([])
