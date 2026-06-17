// Multiplayer simulation tuning. Kept separate from the single-player worldConfig
// so the MP balance can move without touching Dave's game. Values mirror Dave's
// single-player economy (Base.ts / AutoMiner.ts) so multiplayer feels faithful.

// --- match cadence ---
export const SIM_HZ = 20 // server simulation ticks per second
export const SNAPSHOT_HZ = 10 // world snapshots broadcast per second

// --- quota / elimination ---
// Period 1 is a generous SETUP window — you start with 0 miners and must buy +
// deploy one before the axe falls. After that the periods tighten and the quota
// climbs. (Dave's single-player has no quota at all, so a humane first period
// keeps the relaxed feel while still building toward the competitive stakes.)
export const FIRST_PERIOD_SECONDS = 150 // period-1 deadline (setup grace)
export const QUOTA_PERIOD_SECONDS = 120 // length of each later quota period
export const QUOTA_BASE = 50 // tons DELIVERED required in period 1 (the absolute floor)
export const QUOTA_GROWTH = 1.3 // floor multiplies by this each period
/**
 * Tonnage = tons delivered to your base storage (production), not tons sold — so
 * the quota rewards mining while selling drives the economy. At each deadline the
 * lowest-periodTonnage alive corp is always cut (the race), AND any alive corp
 * below `quota` is cut (the floor). Last corp standing wins.
 */

// --- starting corp (mirrors Dave's SP: 1 hauler, 0 miners, 750 credits) ---
export const STARTING_CREDITS = 750 // Base.STARTING_CREDITS
export const STARTING_SHIPS = 1 // SP spawns a single Hauler-01
export const STARTING_MINERS = 0 // you must BUY miners before you can mine
export const SHIP_COST = 500 // Base.SHIP_COMMISSION_COST
export const MINER_COST = 300 // AutoMiner.AUTOMINER_PURCHASE_COST
export const STORAGE_CAPACITY = 2000 // Base.BASE_STORAGE_CAPACITY
export const MAX_SHIPS_PER_CORP = 8

// per-ship cargo upgrade tiers (mirror Ship.CARGO_CAPACITY_TIERS / CARGO_UPGRADE_COSTS)
export const CARGO_CAPACITY_TIERS = [200, 350, 550, 800] as const
export const CARGO_UPGRADE_COSTS = [300, 600, 1000] as const
export const MAX_CARGO_LEVEL = 3
export const SHIP_CARGO_CAPACITY = CARGO_CAPACITY_TIERS[0] // starting capacity (tier 0)

// --- ship behaviour ---
export const SHIP_SPEED = 180 // world units / sec (Ship.SHIP_SPEED)
export const MINE_RATE = 10 // tons / sec a DEPLOYED miner extracts at its asteroid
export const UNLOAD_SECONDS = 1.5 // dwell at base while moving cargo into storage

// --- v5 deep mining loop (hauler deploys a miner, which ejects nets the hauler shuttles) ---
export const NET_CAPACITY = 50 // ore per net (Dave's NET_CAPACITY) — a display unit here
export const MINER_NET_BUFFER = 4 // nets a deployed miner holds before it's net-starved (paused)
export const NET_LEAKAGE = 0.05 // fraction lost when the hauler collects ore (Dave's NET_LEAKAGE_FRACTION)
export const MINER_DEPLOY_SECONDS = 1.5 // dwell to deploy or recover a miner
export const NET_COLLECT_SECONDS = 0.8 // dwell to collect nets at the asteroid

export const ARRIVAL_RADIUS = 28 // world units, "close enough" to a point

// --- v6 hauler resources (mirror Dave's Ship.ts; auto-serviced at base, MP-safe) ---
// Fuel drains while thrusting and tops off (for a fee) at base on every return, so it
// never strands in the deploy→shuttle→base loop — it's a visible bar + a credit sink.
export const HAULER_FUEL_MAX = 300
export const HAULER_FUEL_DRAIN_PER_SEC = 3 // while moving
export const HAULER_BATTERY_MAX = 100
export const HAULER_BATTERY_CHARGE_RATE = 0.5 // recharges while not thrusting (parked/coasting)
export const REFUEL_FEE_PER_UNIT = 0.15 // station service fee, credits per fuel unit topped off

// --- field layout (faithful: planet at origin, bases in GEO orbit around it) ---
export const PLANET_RADIUS = 160 // visual planet radius (SP planet sits at 0,0)
export const BASE_ORBIT_RADIUS = 650 // bases sit this far from the planet (SP base is at y=650)
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
