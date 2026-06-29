export type PriceKey =
  | 'fuel-refuel'
  | 'rcs-refuel'
  | 'dock-cargo-drop'
  | 'hangar-service'
  | 'repair-per-condition-point'
  | 'electricity-per-battery-unit'
  | 'station-miner-slot'
  | 'owned-dock-purchase'
  | 'owned-hangar-purchase'
  | 'pressurization-upgrade'
  | 'silo-capacity-upgrade'
  | 'ore-silo-capacity-upgrade'
  | 'processing-fee'
  | 'scanner-purchase'

const PRICES: Record<PriceKey, number> = {
  'fuel-refuel':                  20,  // credits for a full thruster-fuel tank (per-unit at point of refuel)
  'rcs-refuel':                   10,  // credits for a full RCS tank (per-unit at point of refuel)
  'dock-cargo-drop':              10,
  'hangar-service':               50,
  'repair-per-condition-point':    5,
  'electricity-per-battery-unit':  2,
  'station-miner-slot':          200,
  'owned-dock-purchase':         100,
  'owned-hangar-purchase':       300,
  'pressurization-upgrade':      500,
  'silo-capacity-upgrade':       300,
  'ore-silo-capacity-upgrade':   300,
  'processing-fee':                1,  // per ore unit processed (public service)
  'scanner-purchase':            150,  // a reusable scanner probe into station storage
}

export function getPrice(key: PriceKey): number {
  return PRICES[key]
}
