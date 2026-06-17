// Multiplayer simulation tuning. Kept separate from the single-player worldConfig
// so the MP balance can move without touching Dave's game.

// --- match cadence ---
export const SIM_HZ = 20 // server simulation ticks per second
export const SNAPSHOT_HZ = 10 // world snapshots broadcast per second

// --- quota / elimination ---
export const QUOTA_PERIOD_SECONDS = 90 // length of each quota period
export const QUOTA_BASE = 120 // tons required in period 1 (the absolute floor)
export const QUOTA_GROWTH = 1.35 // floor multiplies by this each period
/**
 * At each deadline the lowest-periodTonnage alive corp is always cut (the race),
 * AND any alive corp below `quota` is cut (the floor — gives solo play stakes and
 * trims laggards). Last corp standing wins.
 */

// --- starting corp ---
export const STARTING_CREDITS = 750 // mirrors Base.STARTING_CREDITS
export const STARTING_SHIPS = 2
export const SHIP_COST = 500 // mirrors Base.SHIP_COMMISSION_COST
export const SHIP_CARGO_CAPACITY = 200 // mirrors CARGO_CAPACITY_TIERS[0]
export const MAX_SHIPS_PER_CORP = 8

// --- ship behaviour (folded hauler+miner) ---
export const SHIP_SPEED = 180 // world units / sec (mirrors Ship.SHIP_SPEED)
export const MINE_RATE = 12 // tons / sec extracted while mining (faster than SP's 5 — MP has no net micro)
export const UNLOAD_SECONDS = 1.5 // dwell at base while selling cargo
export const ARRIVAL_RADIUS = 24 // world units, "close enough" to a point

// --- field layout ---
export const BASE_RING_RADIUS = 240 // corps' bases sit on a ring this far from origin
export const WORLD_RADIUS = 3000 // soft bound used for camera + minimap framing

// --- room limits ---
export const MAX_CORPS_PER_ROOM = 6
export const DEFAULT_ROOM = 'lobby'

// Hull/base palette assigned to corps in join order.
export const CORP_COLORS = [
  0x55ccff, // cyan
  0xff7755, // orange
  0x88dd66, // green
  0xcc88ff, // violet
  0xffcc44, // amber
  0xff5599, // pink
] as const
