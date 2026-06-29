import { SIZE_CONFIGS, type SizeCategory } from './worldConfig'

// Pure movement-feel helpers (no Phaser). The scene owns the proximity-slowdown
// model and feeds these; keeping the mappings here makes them unit-testable.

/**
 * Display-scale factor for the fly-by "looming" effect: 1.0 at cruise
 * (speedMultiplier = 1) rising to `maxScale` at full slowdown
 * (speedMultiplier = minSpeed). `speedMultiplier` is clamped to [minSpeed, 1].
 */
export function flybyScale(speedMultiplier: number, minSpeed: number, maxScale: number): number {
  const clamped = Math.max(minSpeed, Math.min(1, speedMultiplier))
  const t = (1 - clamped) / (1 - minSpeed) // 0 at cruise → 1 at full slowdown
  return 1 + (maxScale - 1) * t
}

/**
 * Per-asteroid slowdown proximity radius, scaled by the asteroid's size category
 * so larger asteroids slow a passing ship over a wider radius (small < large).
 */
export function asteroidProximityRadius(baseRadius: number, size: SizeCategory): number {
  return baseRadius * SIZE_CONFIGS[size].scale
}
