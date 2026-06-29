// Pure bounded-series helper for the metrics layer: append a sample and keep at
// most the newest `max` items. No Phaser, unit-tested.

export function pushBounded<T>(arr: readonly T[], item: T, max: number): T[] {
  const next = [...arr, item]
  return next.length > max ? next.slice(next.length - max) : next
}
