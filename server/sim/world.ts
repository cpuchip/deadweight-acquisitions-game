// The multiplayer simulation — server-authoritative, plain data, no Phaser.
//
// v5 deep mining loop (faithful to Dave's single-player): a hauler carries a
// purchased AutoMiner out to a claimed asteroid and DEPLOYS it; the deployed miner
// mines the rock and ejects nets (buffered, with net-starved backpressure); the
// hauler SHUTTLES those nets back to base storage. Ore is sold manually at the base
// menu. Tonnage = ore DELIVERED to base (the quota / elimination metric). The shared
// field, contested claims, and last-corp-standing layer are MP-only.
//
// Reuses Dave's Phaser-free modules: generateWorld() and RESOURCE_SELL_PRICES.

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
  CARGO_CAPACITY_TIERS,
  CARGO_UPGRADE_COSTS,
  MAX_CARGO_LEVEL,
  STORAGE_CAPACITY,
  MAX_SHIPS_PER_CORP,
  SHIP_SPEED,
  MINE_RATE,
  UNLOAD_SECONDS,
  ARRIVAL_RADIUS,
  BASE_ORBIT_RADIUS,
  WORLD_RADIUS,
  MAX_CORPS_PER_ROOM,
  NET_CAPACITY,
  MINER_NET_BUFFER,
  NET_LEAKAGE,
  MINER_DEPLOY_SECONDS,
  NET_COLLECT_SECONDS,
} from '../../shared/mpConfig'
import type {
  GameCommand,
  WorldSnapshot,
  ShipPhase,
  MinerState,
  MatchPhase,
} from '../../shared/protocol'

const MINER_ORE_CAP = MINER_NET_BUFFER * NET_CAPACITY // ore a miner holds before net-starved

interface SimShip {
  id: string
  name: string
  x: number
  y: number
  angle: number
  phase: ShipPhase
  cargo: number
  cargoLevel: number
  cargoResource: ResourceType | null
  /** the asteroid this hauler services */
  targetAsteroidId: string | null
  /** carrying a miner out to deploy */
  carryingMiner: boolean
  timer: number
}

interface SimMiner {
  id: string
  asteroidId: string
  x: number
  y: number
  resourceType: ResourceType
  /** ore mined + ejected as nets, awaiting collection (0..MINER_ORE_CAP) */
  oreReady: number
  state: MinerState
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
  /** total AutoMiners owned (deployed + idle inventory) */
  minersOwned: number
  deployedMiners: SimMiner[]
  claims: string[]
  shipCounter: number
  autoDesignate: boolean
  alive: boolean
  online: boolean
}

type SimAsteroid = AsteroidData & { claimedBy: string | null }

function shipCapacity(s: SimShip): number {
  return CARGO_CAPACITY_TIERS[s.cargoLevel] ?? CARGO_CAPACITY_TIERS[0]
}

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
      minersOwned: STARTING_MINERS,
      deployedMiners: [],
      claims: [],
      shipCounter: 0,
      autoDesignate: false,
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
    corp.shipCounter += 1
    return {
      id: nanoid(8),
      name: `Hauler-${String(corp.shipCounter).padStart(2, '0')}`,
      x: corp.baseX,
      y: corp.baseY,
      angle: 0,
      phase: 'idle',
      cargo: 0,
      cargoLevel: 0,
      cargoResource: null,
      targetAsteroidId: null,
      carryingMiner: false,
      timer: 0,
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
    this.periodEndsAt = FIRST_PERIOD_SECONDS
    this.pushLog(`Match started — ${this.corps.size} corp(s). Setup period: hit ${QUOTA_BASE} t.`)
  }

  setPaused(v: boolean): void {
    if (this.phase === 'running') this.paused = v
  }

  forfeit(corpId: string): void {
    const c = this.corps.get(corpId)
    if (!c || !c.alive) return
    this.liquidate(c)
    this.pushLog(`${c.name} left the match.`)
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
      case 'upgradeShip':
        this.upgradeShip(corp, cmd.shipId)
        break
      case 'toggleAutoDesignate':
        corp.autoDesignate = !corp.autoDesignate
        break
    }
  }

  private designate(corp: SimCorp, asteroidId: string): void {
    const a = this.asteroids.get(asteroidId)
    if (!a || a.currentQuantity <= 0) return
    if (a.claimedBy && a.claimedBy !== corp.id) return
    a.claimedBy = corp.id
    if (!corp.claims.includes(asteroidId)) corp.claims.push(asteroidId)
  }

  private undesignate(corp: SimCorp, asteroidId: string): void {
    corp.claims = corp.claims.filter((id) => id !== asteroidId)
    const a = this.asteroids.get(asteroidId)
    if (a && a.claimedBy === corp.id) a.claimedBy = null
    // recall a deployed miner + free its hauler
    corp.deployedMiners = corp.deployedMiners.filter((m) => m.asteroidId !== asteroidId)
    for (const s of corp.ships) {
      if (s.targetAsteroidId === asteroidId) {
        s.targetAsteroidId = null
        s.carryingMiner = false
        s.phase = s.cargo > 0 ? 'to-base' : 'idle'
      }
    }
  }

  private buyShip(corp: SimCorp): void {
    if (corp.ships.length >= MAX_SHIPS_PER_CORP) return
    if (corp.credits < SHIP_COST) return
    corp.credits -= SHIP_COST
    corp.ships.push(this.makeShip(corp))
    this.pushLog(`${corp.name} commissioned a hauler.`)
  }

  private buyMiner(corp: SimCorp): void {
    if (corp.credits < MINER_COST) return
    corp.credits -= MINER_COST
    corp.minersOwned += 1
    this.pushLog(`${corp.name} bought an AutoMiner.`)
  }

  private sellResource(corp: SimCorp, resource: ResourceType): void {
    const qty = corp.storage[resource] ?? 0
    if (qty <= 0) return
    corp.storage[resource] = 0
    corp.credits += qty * (RESOURCE_SELL_PRICES[resource] ?? 1)
  }

  private upgradeShip(corp: SimCorp, shipId: string): void {
    const ship = corp.ships.find((s) => s.id === shipId)
    if (!ship || ship.cargoLevel >= MAX_CARGO_LEVEL) return
    const cost = CARGO_UPGRADE_COSTS[ship.cargoLevel]
    if (corp.credits < cost) return
    corp.credits -= cost
    ship.cargoLevel += 1
    this.pushLog(`${corp.name} upgraded ${ship.name}'s cargo hold to ${shipCapacity(ship)} t.`)
  }

  // ---- simulation ----

  tick(dt: number): void {
    if (this.phase !== 'running' || this.paused) return
    this.t += dt

    for (const corp of this.corps.values()) {
      if (!corp.alive) continue
      if (corp.autoDesignate) this.autoDesignate(corp)
      this.dispatch(corp)
      for (const m of corp.deployedMiners) this.updateMiner(corp, m, dt)
      for (const ship of corp.ships) this.updateShip(corp, ship, dt)
      // drop claims with no resource AND no deployed miner left
      corp.claims = corp.claims.filter((id) => {
        const a = this.asteroids.get(id)
        if (!a || a.claimedBy !== corp.id) return false
        return a.currentQuantity > 0 || corp.deployedMiners.some((m) => m.asteroidId === id)
      })
    }

    if (this.t >= this.periodEndsAt) this.deadline()
  }

  private autoDesignate(corp: SimCorp): void {
    if (corp.claims.length >= corp.minersOwned) return
    const id = this.bestUnclaimedAsteroid()
    if (id) this.designate(corp, id)
  }

  private bestUnclaimedAsteroid(): string | null {
    let best: { id: string; value: number } | null = null
    for (const a of this.asteroids.values()) {
      if (a.claimedBy || a.currentQuantity <= 0) continue
      const value = (RESOURCE_SELL_PRICES[a.resourceType] ?? 1) * a.currentQuantity
      if (!best || value > best.value) best = { id: a.id, value }
    }
    return best?.id ?? null
  }

  /** Assign idle haulers to claimed asteroids — to deploy a miner, then to shuttle. */
  private dispatch(corp: SimCorp): void {
    const reserved = corp.ships.filter((s) => s.carryingMiner).length
    let available = corp.minersOwned - corp.deployedMiners.length - reserved

    for (const aid of corp.claims) {
      const a = this.asteroids.get(aid)
      if (!a || a.claimedBy !== corp.id) continue
      const serviced = corp.ships.some((s) => s.targetAsteroidId === aid && s.phase !== 'idle')
      if (serviced) continue
      const hasMiner = corp.deployedMiners.some((m) => m.asteroidId === aid)
      const ship = corp.ships.find((s) => s.phase === 'idle' && !s.targetAsteroidId)
      if (!ship) break
      if (hasMiner) {
        // miner already there — send a hauler to shuttle its nets
        ship.targetAsteroidId = aid
        ship.carryingMiner = false
        ship.phase = 'to-asteroid'
      } else if (available > 0 && a.currentQuantity > 0) {
        // carry a fresh miner out to deploy
        ship.targetAsteroidId = aid
        ship.carryingMiner = true
        ship.phase = 'to-asteroid'
        available -= 1
      }
    }
  }

  private minerAt(corp: SimCorp, asteroidId: string): SimMiner | undefined {
    return corp.deployedMiners.find((m) => m.asteroidId === asteroidId)
  }

  private updateMiner(corp: SimCorp, m: SimMiner, dt: number): void {
    const prev = m.state
    const a = this.asteroids.get(m.asteroidId)
    if (!a || a.currentQuantity <= 0) {
      m.state = 'depleted'
    } else if (m.oreReady >= MINER_ORE_CAP) {
      m.state = 'net-starved'
    } else {
      const amount = Math.min(MINE_RATE * dt, a.currentQuantity, MINER_ORE_CAP - m.oreReady)
      if (amount > 0) {
        a.currentQuantity -= amount
        m.oreReady += amount
      }
      m.state = m.oreReady >= MINER_ORE_CAP ? 'net-starved' : 'mining'
    }
    // beacon: announce once when a miner first fills up (its nets need a hauler)
    if (m.state === 'net-starved' && prev !== 'net-starved') {
      this.pushLog(`⚠ ${corp.name}'s miner is full of nets — send a hauler.`)
    }
  }

  private updateShip(corp: SimCorp, ship: SimShip, dt: number): void {
    switch (ship.phase) {
      case 'idle':
        return

      case 'to-asteroid': {
        const a = ship.targetAsteroidId ? this.asteroids.get(ship.targetAsteroidId) : undefined
        const minerHere = ship.targetAsteroidId ? this.minerAt(corp, ship.targetAsteroidId) : undefined
        // target invalid: no asteroid, or (carrying a miner to) a depleted rock with no miner yet
        if (!a || a.claimedBy !== corp.id || (ship.carryingMiner && a.currentQuantity <= 0 && !minerHere)) {
          ship.carryingMiner = false
          ship.targetAsteroidId = null
          ship.phase = ship.cargo > 0 ? 'to-base' : 'idle'
          return
        }
        if (this.moveToward(ship, a.x, a.y, dt)) {
          if (ship.carryingMiner) {
            ship.phase = 'deploying'
            ship.timer = MINER_DEPLOY_SECONDS
          } else {
            ship.phase = 'collecting'
            ship.timer = NET_COLLECT_SECONDS
          }
        }
        return
      }

      case 'deploying': {
        ship.timer -= dt
        if (ship.timer > 0) return
        const a = ship.targetAsteroidId ? this.asteroids.get(ship.targetAsteroidId) : undefined
        if (a && !this.minerAt(corp, a.id)) {
          corp.deployedMiners.push({
            id: nanoid(8),
            asteroidId: a.id,
            x: a.x,
            y: a.y,
            resourceType: a.resourceType,
            oreReady: 0,
            state: 'mining',
          })
        }
        ship.carryingMiner = false
        ship.phase = 'collecting'
        ship.timer = NET_COLLECT_SECONDS
        return
      }

      case 'collecting': {
        ship.timer -= dt
        if (ship.timer > 0) return
        const miner = ship.targetAsteroidId ? this.minerAt(corp, ship.targetAsteroidId) : undefined
        if (!miner) {
          ship.targetAsteroidId = null
          ship.phase = ship.cargo > 0 ? 'to-base' : 'idle'
          return
        }
        // wait at the asteroid until at least one net is ready (or the miner is
        // net-starved / done) — the miner buffers nets during the hauler's round trip
        const ready =
          miner.oreReady >= NET_CAPACITY ||
          miner.state === 'net-starved' ||
          miner.state === 'depleted' ||
          ship.cargo > 0
        if (!ready) {
          ship.timer = NET_COLLECT_SECONDS
          return
        }
        const cap = shipCapacity(ship)
        const take = Math.min(miner.oreReady, cap - ship.cargo)
        if (take > 0) {
          miner.oreReady -= take
          ship.cargo += take * (1 - NET_LEAKAGE)
          ship.cargoResource = miner.resourceType
        }
        const minerDone = miner.state === 'depleted' && miner.oreReady <= 0.01
        if (minerDone) {
          // recover the miner; release the claim if the rock is spent
          corp.deployedMiners = corp.deployedMiners.filter((mm) => mm.id !== miner.id)
          corp.claims = corp.claims.filter((id) => id !== miner.asteroidId)
          const a = this.asteroids.get(miner.asteroidId)
          if (a && a.claimedBy === corp.id) a.claimedBy = null
          ship.targetAsteroidId = null
          ship.phase = ship.cargo > 0 ? 'to-base' : 'idle'
        } else if (ship.cargo > 0) {
          ship.phase = 'to-base' // haul this batch; the miner buffers more meanwhile
        } else {
          ship.timer = NET_COLLECT_SECONDS
        }
        return
      }

      case 'to-base': {
        if (this.moveToward(ship, corp.baseX, corp.baseY, dt)) {
          ship.phase = 'unloading'
          ship.timer = UNLOAD_SECONDS
        }
        return
      }

      case 'unloading': {
        ship.timer -= dt
        if (ship.timer > 0) return
        this.deliver(corp, ship)
        if (ship.cargo > 0.5) {
          ship.timer = UNLOAD_SECONDS // storage full — wait, retry (player must sell)
          return
        }
        // go back to the miner if it's still deployed, else idle
        const stillMining = ship.targetAsteroidId && this.minerAt(corp, ship.targetAsteroidId)
        if (stillMining) {
          ship.phase = 'to-asteroid'
        } else {
          ship.targetAsteroidId = null
          ship.phase = 'idle'
        }
        return
      }
    }
  }

  private totalStored(corp: SimCorp): number {
    let s = 0
    for (const v of Object.values(corp.storage)) s += v ?? 0
    return s
  }

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
    corp.deployedMiners = []
    for (const s of corp.ships) {
      s.phase = 'idle'
      s.targetAsteroidId = null
      s.carryingMiner = false
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
      minerCount: c.minersOwned,
      miners: c.deployedMiners.map((m) => ({
        id: m.id,
        x: m.x,
        y: m.y,
        asteroidId: m.asteroidId,
        resourceType: m.resourceType,
        netsReady: Math.floor(m.oreReady / NET_CAPACITY),
        state: m.state,
      })),
      autoDesignate: c.autoDesignate,
      tonnage: Math.round(c.tonnage),
      periodTonnage: Math.round(c.periodTonnage),
      alive: c.alive,
      online: c.online,
      ships: c.ships.map((s) => ({
        id: s.id,
        name: s.name,
        x: s.x,
        y: s.y,
        angle: s.angle,
        phase: s.phase,
        cargo: Math.round(s.cargo),
        cargoCapacity: shipCapacity(s),
        cargoLevel: s.cargoLevel,
        cargoResource: s.cargoResource,
        targetAsteroidId: s.targetAsteroidId,
        carryingMiner: s.carryingMiner,
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
