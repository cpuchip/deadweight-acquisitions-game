// Pure, Phaser-free cost-lever model: station infrastructure capacity lowers an
// operating cost, with owned-fleet demand as the counter-pressure.
//
// A lever's effective price = base × max(FLOOR, demand / (demand + capacity)).
// - capacity 0 → factor demand/demand = 1 → price at base (no infrastructure).
// - capacity grows (fixed demand) → factor → 0 → price floored at FLOOR×base.
// - demand grows (fixed capacity) → factor → 1 → price climbs back toward base.
// So a reduction bought today erodes as the owned fleet grows unless capacity is
// fed to keep pace. Demand is a fleet-count (idle-safe), never a timed drain.
//
// Kept pure (no Phaser, no stores) so it is unit-tested directly under Vitest.

/** Effective prices never drop below this fraction of the base price. */
export const PRICE_FLOOR_FRACTION = 0.2

/** Capacity (in fleet-demand-equivalent units) gained per resource unit invested. */
export const CAPACITY_PER_RESOURCE_UNIT = 0.05

/**
 * Effective consumable price given the static base, the lever's built capacity,
 * and the current owned-fleet demand. Always in [FLOOR×base, base].
 */
export function effectivePrice(base: number, capacity: number, demand: number): number {
  const denom = demand + capacity
  if (denom <= 0) return base // nothing owned and nothing built — nominal price
  const factor = Math.max(PRICE_FLOOR_FRACTION, demand / denom)
  return base * factor
}

/** Capacity after investing `qty` resource units (linear accrual; price has diminishing returns). */
export function investCapacity(capacity: number, qty: number): number {
  if (qty <= 0) return capacity
  return capacity + qty * CAPACITY_PER_RESOURCE_UNIT
}
