import type { SaveState } from '../state/gameState'
import { makeDefaultLoadout } from '../state/attachmentTypes'
import { HAULER_FUEL_MAX, HAULER_RCS_MAX, HAULER_BATTERY_MAX } from '../entities/Ship'
import { BASE_STORAGE_CAPACITY, ORE_SILO_CAPACITY } from '../entities/Base'
import { pureComposition } from '../world/composition'
import type { ResourceType } from '../world/worldConfig'
import { MINER_BATTERY_MAX } from '../entities/AutoMiner'

const SAVE_KEY = 'dwa-save'

function migrate(raw: SaveState): SaveState | null {
  // Each case falls through so saves upgrade through all intermediate versions.
  switch (raw.schemaVersion) {
    case 1:
      // v1 → v2: add isCompany: false to every asteroid
      raw = {
        ...raw,
        schemaVersion: 2,
        asteroids: raw.asteroids.map(a => ({
          ...a,
          isCompany: (a as { isCompany?: boolean }).isCompany ?? false,
        })),
      }
      // falls through
    case 2:
      // v2 → v3: add cargoUpgradeLevel and miningUpgradeLevel to every ship
      raw = {
        ...raw,
        schemaVersion: 3,
        ships: raw.ships.map(s => ({
          ...s,
          cargoUpgradeLevel: (s as { cargoUpgradeLevel?: number }).cargoUpgradeLevel ?? 0,
          miningUpgradeLevel: (s as { miningUpgradeLevel?: number }).miningUpgradeLevel ?? 0,
        })),
      }
      // falls through
    case 3:
      // v3 → v4: add orbitalRadius and orbitalAngle to every asteroid
      raw = {
        ...raw,
        schemaVersion: 4,
        asteroids: raw.asteroids.map(a => ({
          ...a,
          orbitalRadius: (a as { orbitalRadius?: number }).orbitalRadius ?? Math.sqrt(a.x * a.x + a.y * a.y),
          orbitalAngle: (a as { orbitalAngle?: number }).orbitalAngle ?? Math.atan2(a.y, a.x),
        })),
      }
      // falls through
    case 4: {
      // v4 → v5: remove mining fields; add attachment points; reset mining states to idle
      type V4Ship = {
        miningRate?: unknown
        miningUpgradeLevel?: unknown
        miningTargetId?: unknown
        autoCycle?: unknown
        shipState?: string
        target?: unknown
        [key: string]: unknown
      }
      raw = {
        ...raw,
        schemaVersion: 5,
        ships: (raw.ships as unknown as V4Ship[]).map(s => {
          const { miningRate: _mr, miningUpgradeLevel: _mul, miningTargetId: _mti, autoCycle: _ac, ...rest } = s
          const shipState = (s.shipState === 'traveling-to-target' || s.shipState === 'mining')
            ? 'idle'
            : (s.shipState as string)
          const target = (s.shipState === 'traveling-to-target' || s.shipState === 'mining')
            ? null
            : rest.target
          return {
            ...rest,
            shipState,
            target,
            attachmentPoints: makeDefaultLoadout(),
          }
        }),
      } as unknown as SaveState
      // falls through
    }
    case 5:
      // v5 → v6: add autoMiners array; add asteroidTargetId to ships
      raw = {
        ...raw,
        schemaVersion: 6,
        autoMiners: [],
        ships: (raw.ships as unknown as Array<Record<string, unknown>>).map(s => ({
          ...s,
          asteroidTargetId: null,
        })),
      } as unknown as SaveState
      // falls through
    case 6: {
      // v6 → v7: tetheredNets[] on miners becomes tetheredNetIds: string[]; add top-level cargoNets
      type V6TetheredNet = { id: string; resourceType: string; quantity: number }
      type V6Miner = { tetheredNets?: V6TetheredNet[]; asteroidId?: string | null; [key: string]: unknown }
      const cargoNets: Array<Record<string, unknown>> = []
      raw = {
        ...raw,
        schemaVersion: 7,
        cargoNets,
        autoMiners: (raw.autoMiners as unknown as V6Miner[]).map(m => {
          const tetheredNets = m.tetheredNets ?? []
          for (const tn of tetheredNets) {
            cargoNets.push({
              id: tn.id,
              state: 'full-tethered',
              resourceType: tn.resourceType,
              quantity: tn.quantity,
              asteroidId: m.asteroidId ?? null,
            })
          }
          const { tetheredNets: _tn, ...rest } = m
          return { ...rest, tetheredNetIds: tetheredNets.map(tn => tn.id) }
        }),
      } as unknown as SaveState
      // falls through
    }
    case 7:
      // v7 → v8: add freeOrbitalRadius / freeOrbitalAngle to autoMiners
      raw = {
        ...raw,
        schemaVersion: 8,
        autoMiners: (raw.autoMiners as unknown as Array<Record<string, unknown>>).map(m => ({
          ...m,
          freeOrbitalRadius: null,
          freeOrbitalAngle: null,
        })),
      } as unknown as SaveState
      // falls through
    case 8:
      // v8 → v9: add waitOrbitalAngle to ships
      raw = {
        ...raw,
        schemaVersion: 9,
        ships: (raw.ships as unknown as Array<Record<string, unknown>>).map(s => ({
          ...s,
          waitOrbitalAngle: null,
        })),
      } as unknown as SaveState
      // falls through
    case 9:
      // v9 → v10: add attachUnloadTimer to ships
      raw = {
        ...raw,
        schemaVersion: 10,
        ships: (raw.ships as unknown as Array<Record<string, unknown>>).map(s => ({
          ...s,
          attachUnloadTimer: 0,
        })),
      } as unknown as SaveState
      // falls through
    case 10:
      // v10 → v11: clear legacy cargoContents; pre-satisfy unloadTimer for ships saved mid-unload
      raw = {
        ...raw,
        schemaVersion: 11,
        ships: (raw.ships as unknown as Array<Record<string, unknown>>).map(s => ({
          ...s,
          cargoContents: {},
          unloadTimer: s['shipState'] === 'unloading' ? 3 : s['unloadTimer'],
        })),
      } as unknown as SaveState
      // falls through
    case 11:
      // v11 → v12: add dockSlotIndex to ships
      raw = {
        ...raw,
        schemaVersion: 12,
        ships: (raw.ships as unknown as Array<Record<string, unknown>>).map(s => ({
          ...s,
          dockSlotIndex: null,
        })),
      } as unknown as SaveState
      // falls through
    case 12:
      // v12 → v13: add ownedDockCount to base
      raw = {
        ...raw,
        schemaVersion: 13,
        base: {
          ...(raw.base as unknown as Record<string, unknown>),
          ownedDockCount: 0,
        },
      } as unknown as SaveState
      // falls through
    case 13:
      // v13 → v14: add hangarSlotIndex and hangarServiceTimer to ships; add ownedHangarCount and hangarPressurized to base
      raw = {
        ...raw,
        schemaVersion: 14,
        ships: (raw.ships as unknown as Array<Record<string, unknown>>).map(s => ({
          ...s,
          hangarSlotIndex: null,
          hangarServiceTimer: 0,
        })),
        base: {
          ...(raw.base as unknown as Record<string, unknown>),
          ownedHangarCount: 0,
          hangarPressurized: false,
        },
      } as unknown as SaveState
      // falls through
    case 14:
      // v14 → v15: add stationMinerSlotCount and stationMinerIds to base
      raw = {
        ...raw,
        schemaVersion: 15,
        base: {
          ...(raw.base as unknown as Record<string, unknown>),
          stationMinerSlotCount: 0,
          stationMinerIds: [],
        },
      } as unknown as SaveState
      // falls through
    case 15:
      // v15 → v16: add designations array
      raw = {
        ...raw,
        schemaVersion: 16,
        designations: [],
      } as unknown as SaveState
      // falls through
    case 16:
      // v16 → v17: add condition: 1 to every autominer
      raw = {
        ...raw,
        schemaVersion: 17,
        autoMiners: (raw.autoMiners as unknown as Array<Record<string, unknown>>).map(m => ({
          ...m,
          condition: (m as { condition?: number }).condition ?? 1,
        })),
      } as unknown as SaveState
      // falls through
    case 17:
      // v17 → v18: add autoDesignate flag to base
      raw = {
        ...raw,
        schemaVersion: 18,
        base: { ...(raw.base as unknown as Record<string, unknown>), autoDesignate: false },
      } as unknown as SaveState
      // falls through
    case 18:
      // v18 → v19: add thrusterFuel/rcsFuel/battery to every ship
      raw = {
        ...raw,
        schemaVersion: 19,
        ships: (raw.ships as unknown as Array<Record<string, unknown>>).map(s => ({
          ...s,
          thrusterFuel: (s as { thrusterFuel?: number }).thrusterFuel ?? HAULER_FUEL_MAX,
          rcsFuel: (s as { rcsFuel?: number }).rcsFuel ?? HAULER_RCS_MAX,
          battery: (s as { battery?: number }).battery ?? HAULER_BATTERY_MAX,
        })),
      } as unknown as SaveState
      // falls through
    case 19:
      // v19 → v20: add battery/rcsFuel to every autominer
      raw = {
        ...raw,
        schemaVersion: 20,
        autoMiners: (raw.autoMiners as unknown as Array<Record<string, unknown>>).map(m => ({
          ...m,
          battery: (m as { battery?: number }).battery ?? MINER_BATTERY_MAX,
          // Miner RCS was removed (WI 558); this historical migration keeps adding the
          // now-ignored field with its original default so the v19→v20 step is unchanged.
          rcsFuel: (m as { rcsFuel?: number }).rcsFuel ?? 50,
        })),
      } as unknown as SaveState
      // falls through
    case 20:
      // v20 → v21: add chargeToggle: false to every ship
      raw = {
        ...raw,
        schemaVersion: 21,
        ships: (raw.ships as unknown as Array<Record<string, unknown>>).map(s => ({
          ...s,
          chargeToggle: false,
        })),
      } as unknown as SaveState
      // falls through
    case 21:
      // v21 → v22: persist storageCapacity on base (was reconstructed from constant)
      raw = {
        ...raw,
        schemaVersion: 22,
        base: {
          ...(raw.base as unknown as Record<string, unknown>),
          storageCapacity: (raw.base as { storageCapacity?: number }).storageCapacity ?? BASE_STORAGE_CAPACITY,
        },
      } as unknown as SaveState
      // falls through
    case 22:
      // v22 → v23: add per-resource marketPressure on base (defaults to undepressed)
      raw = {
        ...raw,
        schemaVersion: 23,
        base: {
          ...(raw.base as unknown as Record<string, unknown>),
          marketPressure: (raw.base as { marketPressure?: unknown }).marketPressure ?? {},
        },
      } as unknown as SaveState
      // falls through
    case 23:
      // v23 → v24: add per-lever infrastructure capacities on base (default 0)
      raw = {
        ...raw,
        schemaVersion: 24,
        base: {
          ...(raw.base as unknown as Record<string, unknown>),
          solarCapacity: (raw.base as { solarCapacity?: number }).solarCapacity ?? 0,
          propellantCapacity: (raw.base as { propellantCapacity?: number }).propellantCapacity ?? 0,
          foundryCapacity: (raw.base as { foundryCapacity?: number }).foundryCapacity ?? 0,
        },
      } as unknown as SaveState
      // falls through
    case 24:
      // v24 → v25: add top-level marketEvents (legacy saves get a fresh schedule on load)
      raw = {
        ...raw,
        schemaVersion: 25,
        marketEvents: (raw as { marketEvents?: unknown }).marketEvents ?? { active: [], nextEventAt: 0, seed: 0 },
      } as unknown as SaveState
      // falls through
    case 25:
      // v25 → v26: add composition (pure-dominant from resourceType) + scanned to asteroids
      raw = {
        ...raw,
        schemaVersion: 26,
        asteroids: (raw.asteroids as unknown as Array<{ resourceType: ResourceType; composition?: unknown; scanned?: boolean }>).map(a => ({
          ...a,
          composition: a.composition ?? pureComposition(a.resourceType),
          scanned: a.scanned ?? false,
        })),
      } as unknown as SaveState
      // falls through
    case 26: {
      // v26 → v27: ore-pipeline cutover. Nets carry composition (pure from their
      // resourceType); miners gain activeComposition; the base gains the raw-ore silo.
      const emptyComp = { iron: 0, ice: 0, silicates: 0, 'rare-metals': 0 }
      raw = {
        ...raw,
        schemaVersion: 27,
        cargoNets: (raw.cargoNets as unknown as Array<{ resourceType: ResourceType; composition?: unknown }>).map(n => ({
          ...n,
          composition: n.composition ?? pureComposition(n.resourceType),
        })),
        autoMiners: (raw.autoMiners as unknown as Array<{ activeResourceType?: ResourceType | null; activeComposition?: unknown }>).map(m => ({
          ...m,
          activeComposition: m.activeComposition ?? (m.activeResourceType ? pureComposition(m.activeResourceType) : null),
        })),
        base: {
          ...(raw.base as unknown as Record<string, unknown>),
          oreQuantity: (raw.base as { oreQuantity?: number }).oreQuantity ?? 0,
          oreComposition: (raw.base as { oreComposition?: unknown }).oreComposition ?? emptyComp,
          oreSiloCapacity: (raw.base as { oreSiloCapacity?: number }).oreSiloCapacity ?? ORE_SILO_CAPACITY,
        },
      } as unknown as SaveState
      // falls through
    }
    case 27:
      // v27 → v28: scanner probe support. Tag designations kind='mine'; add base
      // scannerCount; add ship isScanJob. All default to the pre-scanner state.
      raw = {
        ...raw,
        schemaVersion: 28,
        designations: (raw.designations as unknown as Array<{ kind?: string }>).map(d => ({
          ...d,
          kind: d.kind ?? 'mine',
        })),
        ships: (raw.ships as unknown as Array<Record<string, unknown>>).map(s => ({
          ...s,
          isScanJob: (s as { isScanJob?: boolean }).isScanJob ?? false,
        })),
        base: {
          ...(raw.base as unknown as Record<string, unknown>),
          scannerCount: (raw.base as { scannerCount?: number }).scannerCount ?? 0,
        },
      } as unknown as SaveState
      // falls through
    case 28:
      return raw
    default:
      console.warn(`GameSaveService: unrecognized schema version ${raw.schemaVersion}, discarding save`)
      return null
  }
}

export const GameSaveService = {
  save(state: SaveState): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state))
    } catch {
      // localStorage unavailable or quota exceeded — silently no-op
    }
  },

  load(): SaveState | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (raw === null) return null
      const parsed = JSON.parse(raw) as SaveState
      return migrate(parsed)
    } catch {
      return null
    }
  },

  clear(): void {
    try {
      localStorage.removeItem(SAVE_KEY)
    } catch {
      // silently no-op
    }
  },

  hasSave(): boolean {
    try {
      return localStorage.getItem(SAVE_KEY) !== null
    } catch {
      return false
    }
  },
}
