export type ResourceType = 'iron' | 'ice' | 'silicates' | 'rare-metals'
export type SizeCategory = 'small' | 'medium' | 'large'

export interface SizeConfig {
  chance: number
  scale: number
  quantityMin: number
  quantityMax: number
}

// --- World layout ---
export const MOON_ORBIT_RADIUS = 2200
export const MOON_DEBRIS_SPREAD_RADIUS = 350
export const MOON_DEBRIS_COUNT_MIN = 35
export const MOON_DEBRIS_COUNT_MAX = 55

export const COMPANY_COUNT_MIN = 4
export const COMPANY_COUNT_MAX = 8
export const COMPANY_DISTANCE_MIN = 800
export const COMPANY_DISTANCE_MAX = 2800
export const COMPANY_ARRIVAL_BASE_INTERVAL = 300  // seconds at full natural resources
export const COMPANY_ARRIVAL_MIN_INTERVAL = 60    // floor when natural resources exhausted
export const COMPANY_ASTEROID_MAX_COUNT = 12
export const ORBITAL_K = 500                      // Keplerian constant: ω = K / r^1.5
export const SHIP_PARK_RADIUS = 35                 // px: orbit radius around asteroid while parked
export const SHIP_PARK_ORBIT_RATE = 0.4            // rad/s: angular rate of ship orbit around asteroid
export const AUTO_DISPATCH_INTERVAL = 4            // seconds between auto-dispatch scans

// --- Resource weights ---
export const MOON_RESOURCE_WEIGHTS: Record<ResourceType, number> = {
  iron:          0.55,
  silicates:     0.30,
  ice:           0.10,
  'rare-metals': 0.05,
}

export const COMPANY_RESOURCE_WEIGHTS: Record<ResourceType, number> = {
  iron:          0.15,
  silicates:     0.15,
  ice:           0.35,
  'rare-metals': 0.35,
}

// --- Asteroid sizing ---
export const SIZE_CONFIGS: Record<SizeCategory, SizeConfig> = {
  small:  { chance: 0.50, scale: 0.5, quantityMin: 50,  quantityMax: 150  },
  medium: { chance: 0.35, scale: 1.0, quantityMin: 150, quantityMax: 400  },
  large:  { chance: 0.15, scale: 1.6, quantityMin: 400, quantityMax: 1000 },
}

export const SIZE_WEIGHTS: Record<SizeCategory, number> = {
  small:  SIZE_CONFIGS.small.chance,
  medium: SIZE_CONFIGS.medium.chance,
  large:  SIZE_CONFIGS.large.chance,
}

export const ASTEROID_TEXTURE_SIZE = 32

export const RESOURCE_COLORS: Record<ResourceType, number> = {
  iron:          0xb06030,
  ice:           0x99ddff,
  silicates:     0xc8b870,
  'rare-metals': 0xcc99ff,
}

export const RESOURCE_SELL_PRICES: Record<ResourceType, number> = {
  iron:          3,
  ice:           5,
  silicates:     4,
  'rare-metals': 14,
}
