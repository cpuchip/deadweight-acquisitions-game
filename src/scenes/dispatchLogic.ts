import type { AttachmentPoint } from '../state/attachmentTypes'

export interface SlottedShip {
  readonly id: string
  readonly shipState: string
  readonly x: number
  readonly y: number
  readonly attachmentPoints: AttachmentPoint[]
}

export interface LocatedAsteroid {
  readonly id: string
  readonly x: number
  readonly y: number
}

function distSq(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) ** 2 + (ay - by) ** 2
}

export function shipHasFreeMediumSlot(ship: SlottedShip): boolean {
  return ship.attachmentPoints.some(ap => ap.size === 'medium' && ap.payload === null)
}

export function shipHasFreeSmallSlot(ship: SlottedShip): boolean {
  return ship.attachmentPoints.some(ap => ap.size === 'small' && ap.payload === null)
}

/** Returns the nearest idle ship that has at least one free medium slot, or null. */
export function selectDispatchTarget<S extends SlottedShip>(
  ships: S[],
  target: { x: number; y: number },
): S | null {
  return ships
    .filter(s => s.shipState === 'idle' && shipHasFreeMediumSlot(s))
    .reduce<S | null>((best, s) => {
      if (!best) return s
      return distSq(s.x, s.y, target.x, target.y) < distSq(best.x, best.y, target.x, target.y)
        ? s
        : best
    }, null)
}

function minerSlotOf(ship: SlottedShip): AttachmentPoint | undefined {
  return ship.attachmentPoints.find(ap => ap.size === 'medium' && ap.payload?.kind === 'auto-miner')
}

/**
 * Selects an idle hauler to fulfil a mining designation.
 * Preference 1: idle ship carrying an in-transit auto-miner on a medium slot.
 *   When `isMinerEmpty` is supplied, an empty carried miner is preferred over a
 *   loaded one (a miner still holding nets is a poorer redeploy candidate).
 * Preference 2 (only when hasStoredMiner): any idle ship with a free medium slot.
 * Returns null if no suitable ship exists.
 */
export function selectHaulerForDesignation<S extends SlottedShip>(
  ships: S[],
  hasStoredMiner: boolean,
  isMinerEmpty?: (minerId: string) => boolean,
): S | null {
  const idle = ships.filter(s => s.shipState === 'idle')

  const withMiner = idle.filter(s => minerSlotOf(s) !== undefined)
  if (withMiner.length > 0) {
    if (isMinerEmpty) {
      const empty = withMiner.find(s => {
        const payload = minerSlotOf(s)!.payload
        return payload?.kind === 'auto-miner' && isMinerEmpty(payload.minerId)
      })
      if (empty) return empty
    }
    return withMiner[0]
  }

  if (!hasStoredMiner) return null

  const withFreeSlot = idle.find(s =>
    s.attachmentPoints.some(ap => ap.size === 'medium' && ap.payload === null),
  )
  return withFreeSlot ?? null
}

export function shipCarriesScanner(ship: SlottedShip): boolean {
  return ship.attachmentPoints.some(ap => ap.payload?.kind === 'scanner')
}

/**
 * Selects an idle hauler to fulfil a scan designation, nearest to `target`.
 * Preference 1: an idle ship already carrying a scanner probe (reusable).
 * Preference 2 (only when scannerCount > 0): nearest idle ship with a free medium
 *   slot — it draws a scanner from station storage. Returns null if none qualify.
 */
export function selectScanHauler<S extends SlottedShip>(
  ships: S[],
  scannerCount: number,
  target: { x: number; y: number },
): { ship: S; drawFromStorage: boolean } | null {
  const idle = ships.filter(s => s.shipState === 'idle')
  const nearest = (cands: S[]): S | null =>
    cands.reduce<S | null>(
      (best, s) =>
        !best || distSq(s.x, s.y, target.x, target.y) < distSq(best.x, best.y, target.x, target.y) ? s : best,
      null,
    )

  const carrier = nearest(idle.filter(shipCarriesScanner))
  if (carrier) return { ship: carrier, drawFromStorage: false }

  if (scannerCount > 0) {
    const free = nearest(idle.filter(shipHasFreeSmallSlot)) // probes use a small slot
    if (free) return { ship: free, drawFromStorage: true }
  }
  return null
}

/** Returns the nearest asteroid not in occupiedAsteroidIds, or null. */
export function selectDeployTarget<A extends LocatedAsteroid>(
  asteroids: A[],
  ship: { x: number; y: number },
  occupiedAsteroidIds: Set<string>,
): A | null {
  return asteroids
    .filter(a => !occupiedAsteroidIds.has(a.id))
    .reduce<A | null>((best, a) => {
      if (!best) return a
      return distSq(ship.x, ship.y, a.x, a.y) < distSq(ship.x, ship.y, best.x, best.y) ? a : best
    }, null)
}
