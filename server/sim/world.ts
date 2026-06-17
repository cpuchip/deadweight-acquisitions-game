// The multiplayer simulation — server-authoritative, plain data, no Phaser.
//
// Faithful to Dave's single-player economy: a hauler can only mine if it carries a
// purchased AutoMiner; cargo is hauled to base STORAGE (capped) and SOLD manually
// at the market for credits; you reinvest in haulers (500) and miners (300).
// Tonnage = tons DELIVERED to base (the quota / elimination metric). The shared
// asteroid field, contested claims, and last-corp-standing layer are MP-only.
//
// Reuses Dave's Phaser-free modules: generateWorld() for the field and
// RESOURCE_SELL_PRICES for the market.

import { nanoid } from 'nanoid'
import { generateWorld, type AsteroidData } from '../../src/world/worldGenerator'
import { RESOURCE_SELL_PRICES, type ResourceType } from '../../src/world/worldConfig'
import {
  FIRST_PERIOD_SECONDS,
  QUOTA_PERIOD_SECONDS,
  QUOTA_BASE,
  QUOTA_GROWTH,
  STARTING_CREDITS,
  STARTING_SHIPS,
  STARTING_MINERS,
  SHIP_COST,
  MINER_COST,
  SHIP_CARGO_CAPACITY,
  STORAGE_CAPACITY,
  MAX_SHIPS_PER_CORP,
  SHIP_SPEED,
  MINE_RATE,
  UNLOAD_SECONDS,
  ARRIVAL_RADIUS,
  BASE_ORBIT_RADIUS,
  WORLD_RADIUS,
  MAX_CORPS_PER_ROOM,
} from '../../shared/mpConfig'
import type { GameCommand, WorldSnapshot, ShipPhase, MatchPhase } from '../../shared/protocol'

interface SimShip {
  id: string
  x: number
  y: number
  angle: number
  phase: ShipPhase
  cargo: number
  cargoResource: ResourceType | null
  targetAsteroidId: string | null
  unloadTimer: number
  /** a hauler can only mine if it carries a purchased AutoMiner */
  hasMiner: boolean
}

interface SimCorp {
  id: string
  name: string
  color: number
  baseX: number
  baseY: number
  credits: number
  storage: Partial<Record<ResourceType, number>>
  tonnage: number
  periodTonnage: number
  ships: SimShip[]
  /** asteroidIds this corp has claimed, in claim order (drives dispatch) */
  claims: string[]
  alive: boolean
  online: boolean
}

type SimAsteroid = AsteroidData & { claimedBy: string | null }

export class World {
  readonly seed: number
  t = 0
  phase: MatchPhase = 'lobby'
  paused = false
  period = 0
  quota = 0
  periodEndsAt = 0
  winnerCorpId: string | null = null

  private asteroids = new Map<string, SimAsteroid>()
  private corps = new Map<string, SimCorp>()
  private log: string[] = []

  constructor(seed: number) {
    this.seed = seed
    for (const a of generateWorld(seed)) {
      this.asteroids.set(a.id, { ...a, claimedBy: null })
    }
  }

  // ---- membership ----

  addCorp(id: string, name: string, color: number): SimCorp {
    const index = this.corps.size
    // bases sit in "GEO orbit" around the planet (SP base is south at y=650)
    const angle = Math.PI / 2 + (index / MAX_CORPS_PER_ROOM) * Math.PI * 2
    const baseX = Math.cos(angle) * BASE_ORBIT_RADIUS
    const baseY = Math.sin(angle) * BASE_ORBIT_RADIUS
    const corp: SimCorp = {
      id,
      name,
      color,
      baseX,
      baseY,
      credits: STARTING_CREDITS,
      storage: {},
      tonnage: 0,
      periodTonnage: 0,
      ships: [],
      claims: [],
      alive: true,
      online: true,
    }
    for (let i = 0; i < STARTING_SHIPS; i++) corp.ships.push(this.makeShip(corp, i < STARTING_MINERS))
    this.corps.set(id, corp)
    this.pushLog(`${name} signed on.`)
    return corp
  }

  setOnline(corpId: string, online: boolean): void {
    const c = this.corps.get(corpId)
    if (c) c.online = online
  }

  hasCorp(corpId: string): boolean {
    return this.corps.has(corpId)
  }

  corpCount(): number {
    return this.corps.size
  }

  private makeShip(corp: SimCorp, hasMiner: boolean): SimShip {
    return {
      id: nanoid(8),
      x: corp.baseX,
      y: corp.baseY,
      angle: 0,
      phase: 'idle',
      cargo: 0,
      cargoResource: null,
      targetAsteroidId: null,
      unloadTimer: 0,
      hasMiner,
    }
  }

  // ---- match control ----

  start(): void {
    if (this.phase !== 'lobby') return
    if (this.corps.size < 1) return
    this.phase = 'running'
    this.t = 0
    this.period = 1
    this.quota = QUOTA_BASE
    this.periodEndsAt = FIRST_PERIOD_SECONDS // generous setup window for period 1
    this.pushLog(`Match started — ${this.corps.size} corp(s). Setup period: hit ${QUOTA_BASE} t.`)
  }

  private end(winner: SimCorp | null): void {
    this.phase = 'ended'
    this.winnerCorpId = winner?.id ?? null
    if (winner) this.pushLog(`🏆 ${winner.name} is the last corp standing. Winner!`)
    else this.pushLog(`All corps liquidated. No survivors.`)
  }

  // ---- commands ----

  applyCommand(corpId: string, cmd: GameCommand): void {
    const corp = this.corps.get(corpId)
    if (!corp || !corp.alive) return
    switch (cmd.kind) {
      case 'designate':
        this.designate(corp, cmd.asteroidId)
        break
      case 'undesignate':
        this.undesignate(corp, cmd.asteroidId)
        break
      case 'buyShip':
        this.buyShip(corp)
        break
      case 'buyMiner':
        this.buyMiner(corp)
        break
      case 'sell':
        this.sellResource(corp, cmd.resource)
        break
    }
  }

  private designate(corp: SimCorp, asteroidId: string): void {
    const a = this.asteroids.get(asteroidId)
    if (!a || a.currentQuantity <= 0) return
    if (a.claimedBy && a.claimedBy !== corp.id) return // contested — someone owns it
    a.claimedBy = corp.id
    if (!corp.claims.includes(asteroidId)) corp.claims.push(asteroidId)
  }

  private undesignate(corp: SimCorp, asteroidId: string): void {
    corp.claims = corp.claims.filter((id) => id !== asteroidId)
    const a = this.asteroids.get(asteroidId)
    if (a && a.claimedBy === corp.id) a.claimedBy = null
  }

  private buyShip(corp: SimCorp): void {
    if (corp.ships.length >= MAX_SHIPS_PER_CORP) return
    if (corp.credits < SHIP_COST) return
    corp.credits -= SHIP_COST
    corp.ships.push(this.makeShip(corp, false))
    this.pushLog(`${corp.name} commissioned a hauler.`)
  }

  private buyMiner(corp: SimCorp): void {
    if (corp.credits < MINER_COST) return
    const ship = corp.ships.find((s) => !s.hasMiner)
    if (!ship) return // no free hauler slot — commission a hauler first
    corp.credits -= MINER_COST
    ship.hasMiner = true
    this.pushLog(`${corp.name} fitted an AutoMiner.`)
  }

  private sellResource(corp: SimCorp, resource: ResourceType): void {
    const qty = corp.storage[resource] ?? 0
    if (qty <= 0) return
    corp.storage[resource] = 0
    corp.credits += qty * (RESOURCE_SELL_PRICES[resource] ?? 1)
  }

  // ---- simulation ----

  setPaused(v: boolean): void {
    if (this.phase === 'running') this.paused = v
  }

  /** A corp leaves the match — forfeits (removed from the race), claims released. */
  forfeit(corpId: string): void {
    const c = this.corps.get(corpId)
    if (!c || !c.alive) return
    this.liquidate(c)
    this.pushLog(`${c.name} left the match.`)
  }

  tick(dt: number): void {
    if (this.phase !== 'running' || this.paused) return
    this.t += dt

    for (const corp of this.corps.values()) {
      if (!corp.alive) continue
      this.dispatch(corp)
      for (const ship of corp.ships) this.updateShip(corp, ship, dt)
      corp.claims = corp.claims.filter((id) => {
        const a = this.asteroids.get(id)
        return a && a.currentQuantity > 0 && a.claimedBy === corp.id
      })
    }

    if (this.t >= this.periodEndsAt) this.deadline()
  }

  /** Assign idle MINER-EQUIPPED ships to claimed-but-uncovered asteroids. */
  private dispatch(corp: SimCorp): void {
    const covered = new Set<string>()
    for (const s of corp.ships) {
      if (s.targetAsteroidId && (s.phase === 'to-asteroid' || s.phase === 'mining')) {
        covered.add(s.targetAsteroidId)
      }
    }
    for (const claimId of corp.claims) {
      if (covered.has(claimId)) continue
      const a = this.asteroids.get(claimId)
      if (!a || a.currentQuantity <= 0 || a.claimedBy !== corp.id) continue
      // only a hauler with an AutoMiner can work the rock (the money gate)
      const ship = corp.ships.find((s) => s.phase === 'idle' && s.hasMiner && s.cargo <= 0)
      if (!ship) break
      ship.targetAsteroidId = claimId
      ship.phase = 'to-asteroid'
      covered.add(claimId)
    }
  }

  private totalStored(corp: SimCorp): number {
    let s = 0
    for (const v of Object.values(corp.storage)) s += v ?? 0
    return s
  }

  private updateShip(corp: SimCorp, ship: SimShip, dt: number): void {
    switch (ship.phase) {
      case 'idle':
        return

      case 'to-asteroid': {
        const a = ship.targetAsteroidId ? this.asteroids.get(ship.targetAsteroidId) : undefined
        if (!a || a.currentQuantity <= 0 || a.claimedBy !== corp.id) {
          ship.targetAsteroidId = null
          ship.phase = ship.cargo > 0 ? 'to-base' : 'idle'
          return
        }
        if (this.moveToward(ship, a.x, a.y, dt)) ship.phase = 'mining'
        return
      }

      case 'mining': {
        const a = ship.targetAsteroidId ? this.asteroids.get(ship.targetAsteroidId) : undefined
        if (!a || a.currentQuantity <= 0 || a.claimedBy !== corp.id) {
          ship.targetAsteroidId = null
          ship.phase = ship.cargo > 0 ? 'to-base' : 'idle'
          return
        }
        const room = SHIP_CARGO_CAPACITY - ship.cargo
        const got = Math.min(MINE_RATE * dt, room, a.currentQuantity)
        if (got > 0) {
          a.currentQuantity -= got
          ship.cargo += got
          ship.cargoResource = a.resourceType
        }
        const full = ship.cargo >= SHIP_CARGO_CAPACITY - 0.001
        if (a.currentQuantity <= 0) {
          a.claimedBy = null
          corp.claims = corp.claims.filter((id) => id !== a.id)
          ship.phase = 'to-base'
        } else if (full) {
          ship.phase = 'to-base'
        }
        return
      }

      case 'to-base': {
        if (this.moveToward(ship, corp.baseX, corp.baseY, dt)) {
          if (ship.unloadTimer <= 0) ship.unloadTimer = UNLOAD_SECONDS
          ship.unloadTimer -= dt
          if (ship.unloadTimer <= 0) {
            this.deliver(corp, ship)
            if (ship.cargo <= 0.5) {
              ship.unloadTimer = 0
              ship.phase = 'idle'
            } else {
              // storage full — wait at base and retry until the player sells
              ship.unloadTimer = UNLOAD_SECONDS
            }
          }
        }
        return
      }
    }
  }

  /** Move cargo into base storage (what fits). Counts toward tonnage. */
  private deliver(corp: SimCorp, ship: SimShip): void {
    if (ship.cargo <= 0 || !ship.cargoResource) {
      ship.cargo = 0
      ship.cargoResource = null
      return
    }
    const space = STORAGE_CAPACITY - this.totalStored(corp)
    const fit = Math.min(ship.cargo, Math.max(0, space))
    if (fit > 0) {
      const res = ship.cargoResource
      corp.storage[res] = (corp.storage[res] ?? 0) + fit
      corp.tonnage += fit
      corp.periodTonnage += fit
      ship.cargo -= fit
      if (ship.cargo <= 0.5) {
        ship.cargo = 0
        ship.cargoResource = null
      }
    }
  }

  /** Move a ship toward a point; returns true on arrival. Updates facing. */
  private moveToward(ship: SimShip, tx: number, ty: number, dt: number): boolean {
    const dx = tx - ship.x
    const dy = ty - ship.y
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d <= ARRIVAL_RADIUS) return true
    ship.angle = Math.atan2(dy, dx)
    const step = SHIP_SPEED * dt
    if (step >= d) {
      ship.x = tx
      ship.y = ty
      return true
    }
    ship.x += (dx / d) * step
    ship.y += (dy / d) * step
    return false
  }

  // ---- quota deadline / elimination ----

  private deadline(): void {
    const alive = [...this.corps.values()].filter((c) => c.alive)
    if (alive.length === 0) {
      this.end(null)
      return
    }
    const byTons = [...alive].sort((a, b) => b.periodTonnage - a.periodTonnage)
    const toCut = new Set<SimCorp>()

    for (const c of alive) if (c.periodTonnage < this.quota) toCut.add(c)
    if (alive.length >= 2) toCut.add(byTons[byTons.length - 1])
    if (toCut.size === alive.length && alive.length >= 2) toCut.delete(byTons[0])

    for (const c of toCut) this.liquidate(c)

    const aliveAfter = [...this.corps.values()].filter((c) => c.alive)
    if (alive.length >= 2 && aliveAfter.length === 1) {
      this.end(aliveAfter[0])
      return
    }
    if (aliveAfter.length === 0) {
      this.end(null)
      return
    }

    this.period += 1
    this.quota = Math.round(this.quota * QUOTA_GROWTH)
    for (const c of aliveAfter) c.periodTonnage = 0
    this.periodEndsAt += QUOTA_PERIOD_SECONDS
    this.pushLog(`Period ${this.period} — quota raised to ${this.quota} t.`)
  }

  private liquidate(corp: SimCorp): void {
    corp.alive = false
    for (const id of corp.claims) {
      const a = this.asteroids.get(id)
      if (a && a.claimedBy === corp.id) a.claimedBy = null
    }
    corp.claims = []
    for (const s of corp.ships) {
      s.phase = 'idle'
      s.targetAsteroidId = null
    }
    this.pushLog(`💀 ${corp.name} liquidated — ${corp.periodTonnage} t against a ${this.quota} t quota.`)
  }

  // ---- output ----

  private pushLog(msg: string): void {
    this.log.push(msg)
    if (this.log.length > 12) this.log.shift()
  }

  snapshot(): WorldSnapshot {
    const asteroids = []
    for (const a of this.asteroids.values()) {
      if (a.currentQuantity <= 0) continue
      asteroids.push({
        id: a.id,
        x: a.x,
        y: a.y,
        resourceType: a.resourceType,
        sizeCategory: a.sizeCategory,
        currentQuantity: Math.round(a.currentQuantity),
        maxQuantity: a.maxQuantity,
        claimedBy: a.claimedBy,
      })
    }
    const corps = [...this.corps.values()].map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      baseX: c.baseX,
      baseY: c.baseY,
      credits: Math.floor(c.credits),
      storage: roundStorage(c.storage),
      storageCapacity: STORAGE_CAPACITY,
      minerCount: c.ships.filter((s) => s.hasMiner).length,
      tonnage: Math.round(c.tonnage),
      periodTonnage: Math.round(c.periodTonnage),
      alive: c.alive,
      online: c.online,
      ships: c.ships.map((s) => ({
        id: s.id,
        x: s.x,
        y: s.y,
        angle: s.angle,
        phase: s.phase,
        cargo: Math.round(s.cargo),
        cargoCapacity: SHIP_CARGO_CAPACITY,
        cargoResource: s.cargoResource,
        targetAsteroidId: s.targetAsteroidId,
        hasMiner: s.hasMiner,
      })),
    }))
    return {
      t: this.t,
      phase: this.phase,
      paused: this.paused,
      seed: this.seed,
      worldRadius: WORLD_RADIUS,
      period: this.period,
      quota: this.quota,
      periodEndsAt: this.periodEndsAt,
      asteroids,
      corps,
      winnerCorpId: this.winnerCorpId,
      log: [...this.log],
    }
  }
}

function roundStorage(s: Partial<Record<ResourceType, number>>): Partial<Record<ResourceType, number>> {
  const out: Partial<Record<ResourceType, number>> = {}
  for (const [k, v] of Object.entries(s) as [ResourceType, number][]) {
    if (v > 0) out[k] = Math.round(v)
  }
  return out
}
