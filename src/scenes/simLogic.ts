// Pure, Phaser-free simulation decision logic extracted from SpaceScene so the
// bug-prone dispatch/recovery/deploy choices can be unit-tested in isolation.
// The scene supplies plain data / predicates and applies the returned decisions.

export interface DesignationLike {
  readonly id: string
  readonly asteroidId: string
  readonly status: string
}

/**
 * Returns the ids of `fulfilled` designations that should revert to `queued`:
 * their asteroid still exists but no miner is attached to it (the miner was
 * recovered, went dark, or was destroyed). Depleted asteroids are retired
 * elsewhere, so they are excluded via `asteroidExists`.
 */
export function designationsToRevert(
  designations: readonly DesignationLike[],
  asteroidExists: (asteroidId: string) => boolean,
  asteroidHasMiner: (asteroidId: string) => boolean,
): string[] {
  return designations
    .filter(d => d.status === 'fulfilled' && asteroidExists(d.asteroidId) && !asteroidHasMiner(d.asteroidId))
    .map(d => d.id)
}

export interface DockChoice {
  /** Dock-ring index to position the ship at (public docks stack on one index). */
  readonly index: number
  /** True when no free owned dock was available — a public (fee) dock is used. */
  readonly isPublic: boolean
}

/**
 * Chooses a dock for a returning hauler: the first free owned dock (no fee) if
 * one exists, otherwise a public dock (fee). Public docks are unlimited and stack
 * on a single ring position. `slotOccupied[i]` is the occupancy of owned dock i;
 * `publicFallbackMax` clamps the public visual index.
 */
export function chooseDock(
  ownedDockCount: number,
  slotOccupied: readonly boolean[],
  publicFallbackMax: number,
): DockChoice {
  for (let i = 0; i < ownedDockCount; i++) {
    if (!slotOccupied[i]) return { index: i, isPublic: false }
  }
  return { index: Math.min(ownedDockCount, publicFallbackMax), isPublic: true }
}

/**
 * Whether a hauler parked in `waiting-at-asteroid` should be released to base:
 * its asteroid is gone, or has no actionable miner and no collectable nets.
 */
export function shouldReleaseWaitingHauler(
  asteroidExists: boolean,
  hasActionableMiner: boolean,
  hasCollectableNets: boolean,
): boolean {
  return !asteroidExists || (!hasActionableMiner && !hasCollectableNets)
}

/**
 * Splits a miner's full-tethered nets into those a recovering hauler can collect
 * (up to its free medium slots) and the rest, which are orphaned to free-orbit
 * (recoverable) — never lost.
 */
export function planNetCollection(
  fullNetIds: readonly string[],
  freeSlotCount: number,
): { collect: string[]; orphan: string[] } {
  const n = Math.max(0, Math.min(fullNetIds.length, freeSlotCount))
  return { collect: fullNetIds.slice(0, n), orphan: fullNetIds.slice(n) }
}
