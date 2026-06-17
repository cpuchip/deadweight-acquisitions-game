// The multiplayer simulation — server-authoritative, plain data, no Phaser.
//
// Reuses Dave's Phaser-free modules: generateWorld() for the shared field and
// RESOURCE_SELL_PRICES for the market. The ship/mining loop is reimplemented as
// plain data because the originals are Phaser entities and there is now one corp's
// worth of them per player, racing in one field.

import { nanoid } from 'nanoid'
import { generateWorld, type AsteroidData } from '../../src/world/worldGenerator'
import { RESOURCE_SELL_PRICES, type ResourceType } from '../../src/world/worldConfig'
import {
  QUOTA_PERIOD_SECONDS,
  QUOTA_BASE,
  QUOTA_GROWTH,
  STARTING_CREDITS,
  STARTING_SHIPS,
  SHIP_COST,
  SHIP_CARGO_CAPACITY,
  MAX_SHIPS_PER_CORP,
  SHIP_SPEED,
  MINE_RATE,
  UNLOAD_SECONDS,
  ARRIVAL_RADIUS,
  BASE_RING_RADIUS,
  WORLD_RADIUS,
  MAX_CORPS_PER_ROOM,
} from '../../shared/mpConfig'
import type {
  GameCommand,
  WorldSnapshot,
  ShipPhase,
  MatchPhase,
} from '../../shared/protocol'

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
}

interface SimCorp {
  id: string
  name: string
  color: number
  baseX: number
  baseY: number
  credits: number
  tonnage: number
  periodTonnage: number
  ships: SimShip[]
  /** asteroidIds this corp has claimed, in claim order (drives dispatch) */
  claims: string[]
  alive: boolean
  online: boolean
}

type SimAsteroid = AsteroidData & { claimedBy: string | null }

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  return Math.sqrt(dx * dx + dy * dy)
}

export class World {
  readonly seed: number
  t = 0
  phase: MatchPhase = 'lobby'
  period = 0
  quota = 0
  periodEndsAt = 0
  winnerCorpId: string | null = null

  private asteroids = new Map<string, SimAsteroid>()
  private corps = new Map<string, SimCorp>()
  private log: string[] = []
  private nextColorIndex = 0

  constructor(seed: number) {
    this.seed = seed
    for (const a of generateWorld(seed)) {
      this.asteroids.set(a.id, { ...a, claimedBy: null })
    }
  }

  // ---- membership ----

  addCorp(id: string, name: string, color: number): SimCorp {
    const index = this.corps.size
    const angle = (index / MAX_CORPS_PER_ROOM) * Math.PI * 2
    const baseX = Math.cos(angle) * BASE_RING_RADIUS
    const baseY = Math.sin(angle) * BASE_RING_RADIUS
    const corp: SimCorp = {
      id,
      name,
      color,
      baseX,
      baseY,
      credits: STARTING_CREDITS,
      tonnage: 0,
      periodTonnage: 0,
      ships: [],
      claims: [],
      alive: true,
      online: true,
    }
    for (let i = 0; i < STARTING_SHIPS; i++) corp.ships.push(this.makeShip(corp))
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

  private makeShip(corp: SimCorp): SimShip {
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
    this.periodEndsAt = QUOTA_PERIOD_SECONDS
    this.pushLog(`Match started — ${this.corps.size} corp(s). First quota: ${QUOTA_BASE} t.`)
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
    corp.ships.push(this.makeShip(corp))
    this.pushLog(`${corp.name} commissioned a hauler.`)
  }

  // ---- simulation ----

  tick(dt: number): void {
    if (this.phase !== 'running') return
    this.t += dt

    for (const corp of this.corps.values()) {
      if (!corp.alive) continue
      this.dispatch(corp)
      for (const ship of corp.ships) this.updateShip(corp, ship, dt)
      // drop dead claims (depleted/lost rocks)
      corp.claims = corp.claims.filter((id) => {
        const a = this.asteroids.get(id)
        return a && a.currentQuantity > 0 && a.claimedBy === corp.id
      })
    }

    if (this.t >= this.periodEndsAt) this.deadline()
  }

  /** Assign idle ships to claimed-but-uncovered asteroids (the autodispatch). */
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
      const ship = corp.ships.find((s) => s.phase === 'idle')
      if (!ship) break // no free ships — buy more
      ship.targetAsteroidId = claimId
      ship.phase = 'to-asteroid'
      covered.add(claimId)
    }
  }

  private updateShip(corp: SimCorp, ship: SimShip, dt: number): void {
    switch (ship.phase) {
      case 'idle':
        return

      case 'to-asteroid': {
        const a = ship.targetAsteroidId ? this.asteroids.get(ship.targetAsteroidId) : undefined
        if (!a || a.currentQuantity <= 0 || a.claimedBy !== corp.id) {
          // target lost — head home if loaded, else go idle at the field
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
        const room = ship.cargo === 0 ? SHIP_CARGO_CAPACITY : SHIP_CARGO_CAPACITY - ship.cargo
        const want = MINE_RATE * dt
        const got = Math.min(want, room, a.currentQuantity)
        if (got > 0) {
          a.currentQuantity -= got
          ship.cargo += got
          ship.cargoResource = a.resourceType
        }
        const full = ship.cargo >= SHIP_CARGO_CAPACITY - 0.001
        if (a.currentQuantity <= 0) {
          // mined out — release the claim for everyone
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
          // arrived — sell over a short dwell
          if (ship.unloadTimer <= 0) ship.unloadTimer = UNLOAD_SECONDS
          ship.unloadTimer -= dt
          if (ship.unloadTimer <= 0) {
            this.sell(corp, ship)
            ship.phase = 'idle'
          }
        }
        return
      }
    }
  }

  private sell(corp: SimCorp, ship: SimShip): void {
    if (ship.cargo > 0 && ship.cargoResource) {
      const price = RESOURCE_SELL_PRICES[ship.cargoResource] ?? 1
      corp.credits += ship.cargo * price
      corp.tonnage += ship.cargo
      corp.periodTonnage += ship.cargo
    }
    ship.cargo = 0
    ship.cargoResource = null
    ship.unloadTimer = 0
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

    // floor: everyone below the rising quota is cut
    for (const c of alive) if (c.periodTonnage < this.quota) toCut.add(c)

    // race: when 2+ remain, the single lowest is always cut
    if (alive.length >= 2) toCut.add(byTons[byTons.length - 1])

    // never wipe the whole field at once — the leader survives a universal miss
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

    // next period — quota rises, survivors reset
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
      if (a.currentQuantity <= 0) continue // depleted rocks vanish
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
      })),
    }))
    return {
      t: this.t,
      phase: this.phase,
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
