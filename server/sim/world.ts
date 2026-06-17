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
import { generateWorld, generateCompanyAsteroid, type AsteroidData } from '../../src/world/worldGenerator'
import {
  RESOURCE_SELL_PRICES,
  COMPANY_ARRIVAL_BASE_INTERVAL,
  COMPANY_ARRIVAL_MIN_INTERVAL,
  COMPANY_ASTEROID_MAX_COUNT,
  ORBITAL_K,
  type ResourceType,
} from '../../src/world/worldConfig'
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
  STARTING_MINER_SLOTS,
  STATION_MINER_SLOT_CAP,
  MINER_SLOT_COST,
  MAX_OWNED_DOCKS,
  DOCK_COST,
  DOCK_REFUEL_DISCOUNT,
  MAX_OWNED_HANGARS,
  HANGAR_COST,
  HANGAR_REPAIR_DISCOUNT,
  PRESSURIZATION_COST,
  PRESSURIZED_REPAIR_FACTOR,
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
  MINER_SLOTS,
  HAULER_FUEL_MAX,
  HAULER_FUEL_DRAIN_PER_SEC,
  HAULER_BATTERY_MAX,
  HAULER_BATTERY_CHARGE_RATE,
  REFUEL_FEE_PER_UNIT,
  CONDITION_GRACE_THRESHOLD,
  CONDITION_CAP_THRESHOLD,
  CONDITION_MAX_PENALTY,
  CONDITION_WEAR_PER_SEC,
  MINER_BATTERY_MAX,
  MINER_BATTERY_DRAIN_MINING,
  REPAIR_FEE_PER_POINT,
} from '../../shared/mpConfig'

/** Mining-rate penalty fraction from condition (mirrors Dave's conditionPenaltyFraction):
 * 0 above grace, ramps to 1 at the cap threshold. */
function conditionPenalty(condition: number): number {
  if (condition >= CONDITION_GRACE_THRESHOLD) return 0
  if (condition < CONDITION_CAP_THRESHOLD) return 1
  return (CONDITION_GRACE_THRESHOLD - condition) / (CONDITION_GRACE_THRESHOLD - CONDITION_CAP_THRESHOLD)
}
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
  /** an orphaned net cluster this hauler is recovering */
  targetOrphanId: string | null
  /** miners loaded in the bay, awaiting deployment (0..MINER_SLOTS) */
  minersAboard: number
  /** the rocks this hauler will deploy its bay miners at, in order (milk run) */
  deployQueue: string[]
  fuel: number
  battery: number
  timer: number
}

interface SimOrphanNet {
  id: string
  x: number
  y: number
  resourceType: ResourceType
  amount: number
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
  condition: number
  battery: number
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
  orphanNets: SimOrphanNet[]
  /** cumulative credits spent on station services (refuel + repair) */
  serviceSpend: number
  minerSlots: number
  ownedDocks: number
  ownedHangars: number
  pressurized: boolean
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
  /** total company asteroids that have arrived since the match began (a stat) */
  companyArrivalsCount = 0

  private asteroids = new Map<string, SimAsteroid>()
  private corps = new Map<string, SimCorp>()
  private log: string[] = []
  private naturalTotal = 0 // initial ore in the natural (non-company) field
  private companyArrivalAccumulator = 0
  private arrivalCounter = 0

  constructor(seed: number) {
    this.seed = seed
    for (const a of generateWorld(seed)) {
      this.asteroids.set(a.id, { ...a, claimedBy: null })
      if (!a.isCompany) this.naturalTotal += a.currentQuantity
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
      orphanNets: [],
      serviceSpend: 0,
      minerSlots: STARTING_MINER_SLOTS,
      ownedDocks: 0,
      ownedHangars: 0,
      pressurized: false,
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
      targetOrphanId: null,
      minersAboard: 0,
      deployQueue: [],
      fuel: HAULER_FUEL_MAX,
      battery: HAULER_BATTERY_MAX,
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
      case 'buyMinerSlot':
        this.buyMinerSlot(corp)
        break
      case 'buyDock':
        this.buyDock(corp)
        break
      case 'buyHangar':
        this.buyHangar(corp)
        break
      case 'buyPressurization':
        this.buyPressurization(corp)
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
    // recall a deployed miner + free its hauler; any nets it had buffered are NOT
    // lost — they drift as orphaned salvage for a hauler to recover later
    for (const m of corp.deployedMiners) {
      if (m.asteroidId === asteroidId && m.oreReady > 0.5) this.spawnOrphan(corp, m)
    }
    corp.deployedMiners = corp.deployedMiners.filter((m) => m.asteroidId !== asteroidId)
    for (const s of corp.ships) {
      s.deployQueue = s.deployQueue.filter((id) => id !== asteroidId)
      if (s.targetAsteroidId === asteroidId) {
        if (s.minersAboard > 0 && s.deployQueue.length > 0) {
          s.targetAsteroidId = s.deployQueue[0] // re-route the rest of the deploy run
          s.phase = 'to-asteroid'
        } else {
          s.minersAboard = 0
          s.deployQueue = []
          s.targetAsteroidId = null
          s.phase = s.cargo > 0 ? 'to-base' : 'idle'
        }
      }
    }
  }

  private spawnOrphan(corp: SimCorp, m: SimMiner): void {
    corp.orphanNets.push({
      id: nanoid(8),
      x: m.x,
      y: m.y,
      resourceType: m.resourceType,
      amount: m.oreReady,
    })
    this.pushLog(`${corp.name} recalled a miner — its nets are adrift for recovery.`)
  }

  private buyShip(corp: SimCorp): void {
    if (corp.ships.length >= MAX_SHIPS_PER_CORP) return
    if (corp.credits < SHIP_COST) return
    corp.credits -= SHIP_COST
    corp.ships.push(this.makeShip(corp))
    this.pushLog(`${corp.name} commissioned a hauler.`)
  }

  private buyMiner(corp: SimCorp): void {
    if (corp.minersOwned >= corp.minerSlots) return // need a free station miner slot
    if (corp.credits < MINER_COST) return
    corp.credits -= MINER_COST
    corp.minersOwned += 1
    this.pushLog(`${corp.name} bought an AutoMiner.`)
  }

  private buyMinerSlot(corp: SimCorp): void {
    if (corp.minerSlots >= STATION_MINER_SLOT_CAP) return
    if (corp.credits < MINER_SLOT_COST) return
    corp.credits -= MINER_SLOT_COST
    corp.minerSlots += 1
    this.pushLog(`${corp.name} added a station miner slot (${corp.minerSlots}/${STATION_MINER_SLOT_CAP}).`)
  }

  private buyDock(corp: SimCorp): void {
    if (corp.ownedDocks >= MAX_OWNED_DOCKS) return
    if (corp.credits < DOCK_COST) return
    corp.credits -= DOCK_COST
    corp.ownedDocks += 1
    this.pushLog(`${corp.name} bought an owned dock — cheaper refuel.`)
  }

  private buyHangar(corp: SimCorp): void {
    if (corp.ownedHangars >= MAX_OWNED_HANGARS) return
    if (corp.credits < HANGAR_COST) return
    corp.credits -= HANGAR_COST
    corp.ownedHangars += 1
    this.pushLog(`${corp.name} bought a hangar — cheaper repairs.`)
  }

  private buyPressurization(corp: SimCorp): void {
    if (corp.pressurized || corp.ownedHangars < 1) return
    if (corp.credits < PRESSURIZATION_COST) return
    corp.credits -= PRESSURIZATION_COST
    corp.pressurized = true
    this.pushLog(`${corp.name} pressurized a hangar bay — faster, cheaper service.`)
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

  private sellResource(corp: SimCorp, resource: ResourceType): void {
    const qty = corp.storage[resource] ?? 0
    if (qty <= 0) return
    corp.storage[resource] = 0
    corp.credits += qty * (RESOURCE_SELL_PRICES[resource] ?? 1)
  }

  // ---- simulation ----

  tick(dt: number): void {
    if (this.phase !== 'running' || this.paused) return
    this.t += dt

    this.orbitAsteroids(dt)

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

    this.companyArrivals(dt)

    if (this.t >= this.periodEndsAt) this.deadline()
  }

  /** Keplerian orbiting: every asteroid drifts along its orbit around the planet,
   * angular rate ω = ORBITAL_K / r^1.5 (inner rocks faster). Faithful to Dave's SP. */
  private orbitAsteroids(dt: number): void {
    const TWO_PI = Math.PI * 2
    for (const a of this.asteroids.values()) {
      if (a.orbitalRadius <= 0) continue
      const omega = ORBITAL_K / Math.pow(a.orbitalRadius, 1.5)
      a.orbitalAngle = (a.orbitalAngle + omega * dt) % TWO_PI
      a.x = Math.cos(a.orbitalAngle) * a.orbitalRadius
      a.y = Math.sin(a.orbitalAngle) * a.orbitalRadius
    }
  }

  /** Company asteroids arrive over time — faster as the natural field is exhausted,
   * keeping the field replenished (faithful to Dave's company-arrival pacing). */
  private companyArrivals(dt: number): void {
    this.companyArrivalAccumulator += dt
    let naturalRemaining = 0
    let companyActive = 0
    for (const a of this.asteroids.values()) {
      if (a.isCompany) {
        if (a.currentQuantity > 0) companyActive++
      } else {
        naturalRemaining += Math.max(0, a.currentQuantity)
      }
    }
    const fraction = this.naturalTotal > 0 ? Math.min(1, naturalRemaining / this.naturalTotal) : 0
    const interval =
      COMPANY_ARRIVAL_MIN_INTERVAL + (COMPANY_ARRIVAL_BASE_INTERVAL - COMPANY_ARRIVAL_MIN_INTERVAL) * fraction
    if (this.companyArrivalAccumulator < interval) return
    this.companyArrivalAccumulator = 0
    if (companyActive >= COMPANY_ASTEROID_MAX_COUNT) return
    const a = generateCompanyAsteroid(this.seed * 100000 + ++this.arrivalCounter)
    this.asteroids.set(a.id, { ...a, claimedBy: null })
    this.companyArrivalsCount += 1
    this.pushLog(`📦 A company asteroid arrived — fresh ${a.resourceType}.`)
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

  private idleHauler(corp: SimCorp): SimShip | undefined {
    return corp.ships.find(
      (s) => s.phase === 'idle' && !s.targetAsteroidId && !s.targetOrphanId && s.minersAboard === 0,
    )
  }

  /** Claimed rocks that want a miner — no miner yet, still has ore, and not already
   * queued in some hauler's bay. Returned nearest-to-base first (the milk-run order). */
  private rocksNeedingMiner(corp: SimCorp): string[] {
    const queued = new Set<string>()
    for (const s of corp.ships) for (const id of s.deployQueue) queued.add(id)
    const out: { id: string; d: number }[] = []
    for (const aid of corp.claims) {
      const a = this.asteroids.get(aid)
      if (!a || a.claimedBy !== corp.id || a.currentQuantity <= 0) continue
      if (queued.has(aid)) continue
      if (corp.deployedMiners.some((m) => m.asteroidId === aid)) continue
      out.push({ id: aid, d: Math.hypot(a.x - corp.baseX, a.y - corp.baseY) })
    }
    out.sort((x, y) => x.d - y.d)
    return out.map((o) => o.id)
  }

  /** Assign idle haulers — to shuttle deployed miners, to milk-run-deploy new ones, and
   * to recover orphaned nets. */
  private dispatch(corp: SimCorp): void {
    // (1) shuttle: a claimed rock with a deployed miner + no servicing hauler gets one
    for (const aid of corp.claims) {
      const a = this.asteroids.get(aid)
      if (!a || a.claimedBy !== corp.id) continue
      if (!corp.deployedMiners.some((m) => m.asteroidId === aid)) continue
      const serviced = corp.ships.some((s) => s.targetAsteroidId === aid && s.phase !== 'idle')
      if (serviced) continue
      const ship = this.idleHauler(corp)
      if (!ship) break
      ship.targetAsteroidId = aid
      ship.phase = 'to-asteroid'
    }

    // (2) deploy (milk run): load an idle hauler with up to MINER_SLOTS miners and send it
    // to deploy them across the nearest rocks that want one
    let reserved = corp.ships.reduce((n, s) => n + s.minersAboard, 0)
    let available = corp.minersOwned - corp.deployedMiners.length - reserved
    while (available > 0) {
      const ship = this.idleHauler(corp)
      if (!ship) break
      const need = this.rocksNeedingMiner(corp)
      if (need.length === 0) break
      const load = Math.min(MINER_SLOTS, available, need.length)
      ship.deployQueue = need.slice(0, load)
      ship.minersAboard = load
      available -= load
      ship.targetAsteroidId = ship.deployQueue[0]
      ship.phase = 'to-asteroid'
    }

    // (3) any still-idle haulers recover drifting orphaned nets (run automatically)
    for (const orphan of corp.orphanNets) {
      if (corp.ships.some((s) => s.targetOrphanId === orphan.id)) continue
      const ship = this.idleHauler(corp)
      if (!ship) break
      ship.targetOrphanId = orphan.id
      ship.phase = 'to-orphan'
    }
  }

  /** A deploy-run target became invalid (depleted / unclaimed / already has a miner):
   * drop it and any other now-invalid heads, then go to the next, or finish the run. */
  private advanceDeployRun(corp: SimCorp, ship: SimShip): void {
    do {
      ship.deployQueue.shift()
    } while (ship.deployQueue.length > 0 && !this.canDeployAt(corp, ship.deployQueue[0]))
    if (ship.deployQueue.length > 0) {
      ship.targetAsteroidId = ship.deployQueue[0]
      ship.phase = 'to-asteroid'
    } else {
      ship.minersAboard = 0 // undeployed miners return to inventory
      ship.targetAsteroidId = null
      ship.phase = ship.cargo > 0 ? 'to-base' : 'idle'
    }
  }

  private canDeployAt(corp: SimCorp, asteroidId: string): boolean {
    const a = this.asteroids.get(asteroidId)
    return !!a && a.claimedBy === corp.id && a.currentQuantity > 0 && !this.minerAt(corp, asteroidId)
  }

  private minerAt(corp: SimCorp, asteroidId: string): SimMiner | undefined {
    return corp.deployedMiners.find((m) => m.asteroidId === asteroidId)
  }

  private updateMiner(corp: SimCorp, m: SimMiner, dt: number): void {
    const prev = m.state
    const a = this.asteroids.get(m.asteroidId)
    // a deployed miner is attached to its rock — it rides the orbit with it
    if (a) {
      m.x = a.x
      m.y = a.y
    }
    if (!a || a.currentQuantity <= 0) {
      m.state = 'depleted'
    } else {
      // a deployed miner wears down while on station (mining or waiting); a servicing
      // hauler repairs it. condition cuts the effective mining rate below grace.
      m.condition = Math.max(0, m.condition - CONDITION_WEAR_PER_SEC * dt)
      if (m.oreReady >= MINER_ORE_CAP) {
        m.state = 'net-starved'
      } else if (m.battery <= 0) {
        m.state = 'net-starved' // out of power — awaits a hauler recharge
      } else {
        m.battery = Math.max(0, m.battery - MINER_BATTERY_DRAIN_MINING * dt)
        const rate = MINE_RATE * (1 - CONDITION_MAX_PENALTY * conditionPenalty(m.condition))
        const amount = Math.min(rate * dt, a.currentQuantity, MINER_ORE_CAP - m.oreReady)
        if (amount > 0) {
          a.currentQuantity -= amount
          m.oreReady += amount
        }
        m.state = m.oreReady >= MINER_ORE_CAP ? 'net-starved' : 'mining'
      }
    }
    // beacon: announce once when a miner first fills up (its nets need a hauler)
    if (m.state === 'net-starved' && prev !== 'net-starved') {
      this.pushLog(`⚠ ${corp.name}'s miner is full of nets — send a hauler.`)
    }
  }

  private updateShip(corp: SimCorp, ship: SimShip, dt: number): void {
    // battery tops up while not thrusting (faithful to Dave; haulers self-power)
    if (ship.phase !== 'to-asteroid' && ship.phase !== 'to-orphan' && ship.phase !== 'to-base') {
      ship.battery = Math.min(HAULER_BATTERY_MAX, ship.battery + HAULER_BATTERY_CHARGE_RATE * dt)
    }
    switch (ship.phase) {
      case 'idle':
        return

      case 'to-asteroid': {
        const a = ship.targetAsteroidId ? this.asteroids.get(ship.targetAsteroidId) : undefined
        if (ship.minersAboard > 0) {
          // deploy run: skip to the next queued rock if this one can't take a miner
          if (!ship.targetAsteroidId || !this.canDeployAt(corp, ship.targetAsteroidId)) {
            this.advanceDeployRun(corp, ship)
            return
          }
          if (this.moveToward(ship, a!.x, a!.y, dt)) {
            ship.phase = 'deploying'
            ship.timer = MINER_DEPLOY_SECONDS
          }
          return
        }
        // shuttle run: head to the rock to collect its miner's nets
        if (!a || a.claimedBy !== corp.id) {
          ship.targetAsteroidId = null
          ship.phase = ship.cargo > 0 ? 'to-base' : 'idle'
          return
        }
        if (this.moveToward(ship, a.x, a.y, dt)) {
          ship.phase = 'collecting'
          ship.timer = NET_COLLECT_SECONDS
        }
        return
      }

      case 'deploying': {
        const a = ship.targetAsteroidId ? this.asteroids.get(ship.targetAsteroidId) : undefined
        if (a) {
          ship.x = a.x // dock at the rock so the hauler rides its orbit
          ship.y = a.y
        }
        ship.timer -= dt
        if (ship.timer > 0) return
        if (a && !this.minerAt(corp, a.id)) {
          corp.deployedMiners.push({
            id: nanoid(8),
            asteroidId: a.id,
            x: a.x,
            y: a.y,
            resourceType: a.resourceType,
            oreReady: 0,
            state: 'mining',
            condition: 1,
            battery: MINER_BATTERY_MAX,
          })
          ship.minersAboard = Math.max(0, ship.minersAboard - 1)
        }
        // drop this rock from the run; skip any now-invalid next rocks
        do {
          ship.deployQueue.shift()
        } while (ship.deployQueue.length > 0 && !this.canDeployAt(corp, ship.deployQueue[0]))
        if (ship.minersAboard > 0 && ship.deployQueue.length > 0) {
          ship.targetAsteroidId = ship.deployQueue[0] // milk run: go deploy the next miner
          ship.phase = 'to-asteroid'
        } else {
          ship.minersAboard = 0 // any leftover returns to inventory
          ship.deployQueue = []
          ship.phase = 'collecting' // shuttle the rock we just deployed at
          ship.timer = NET_COLLECT_SECONDS
        }
        return
      }

      case 'collecting': {
        const ast = ship.targetAsteroidId ? this.asteroids.get(ship.targetAsteroidId) : undefined
        if (ast) {
          ship.x = ast.x // stay docked at the rock as it drifts
          ship.y = ast.y
        }
        ship.timer -= dt
        if (ship.timer > 0) return
        const miner = ship.targetAsteroidId ? this.minerAt(corp, ship.targetAsteroidId) : undefined
        if (!miner) {
          ship.targetAsteroidId = null
          ship.phase = ship.cargo > 0 ? 'to-base' : 'idle'
          return
        }
        this.serviceMiner(corp, miner) // dock service: recharge + repair the miner
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

      case 'to-orphan': {
        const orphan = ship.targetOrphanId
          ? corp.orphanNets.find((o) => o.id === ship.targetOrphanId)
          : undefined
        if (!orphan) {
          ship.targetOrphanId = null
          ship.phase = ship.cargo > 0 ? 'to-base' : 'idle'
          return
        }
        if (this.moveToward(ship, orphan.x, orphan.y, dt)) {
          const cap = shipCapacity(ship)
          const take = Math.min(orphan.amount, cap - ship.cargo)
          if (take > 0) {
            orphan.amount -= take
            ship.cargo += take * (1 - NET_LEAKAGE)
            ship.cargoResource = orphan.resourceType
          }
          if (orphan.amount <= 0.5) {
            corp.orphanNets = corp.orphanNets.filter((o) => o.id !== orphan.id)
          }
          ship.targetOrphanId = null
          ship.phase = ship.cargo > 0 ? 'to-base' : 'idle'
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
        this.refuel(corp, ship) // dock service: top off fuel (for a fee) + recharge
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

  /** field service when a hauler docks at a deployed miner: recharge its battery (free —
   * the hauler brings power) and, if it has worn below grace, repair it for a credit fee. */
  private serviceMiner(corp: SimCorp, m: SimMiner): void {
    m.battery = MINER_BATTERY_MAX
    if (m.condition < CONDITION_GRACE_THRESHOLD) {
      let fee = (1 - m.condition) * REPAIR_FEE_PER_POINT * Math.max(0, 1 - corp.ownedHangars * HANGAR_REPAIR_DISCOUNT)
      if (corp.pressurized) fee *= PRESSURIZED_REPAIR_FACTOR
      corp.credits = Math.max(0, corp.credits - fee)
      corp.serviceSpend += fee
      m.condition = 1
    }
  }

  /** dock service at base: refuel the hauler (credit fee scales with what it burned)
   * and recharge its battery. Faithful station service; never strands the hauler. */
  private refuel(corp: SimCorp, ship: SimShip): void {
    const need = HAULER_FUEL_MAX - ship.fuel
    if (need > 0.5) {
      const fee = need * REFUEL_FEE_PER_UNIT * Math.max(0, 1 - corp.ownedDocks * DOCK_REFUEL_DISCOUNT)
      corp.credits = Math.max(0, corp.credits - fee)
      corp.serviceSpend += fee
      ship.fuel = HAULER_FUEL_MAX
    }
    ship.battery = HAULER_BATTERY_MAX
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
    // thrusting burns fuel (refilled for a fee at base every return — never strands;
    // the more it travels, the bigger the refuel bill, so far rocks cost more to service)
    ship.fuel = Math.max(0, ship.fuel - HAULER_FUEL_DRAIN_PER_SEC * dt)
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
    corp.orphanNets = []
    for (const s of corp.ships) {
      s.phase = 'idle'
      s.targetAsteroidId = null
      s.targetOrphanId = null
      s.minersAboard = 0
      s.deployQueue = []
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
        isCompany: a.isCompany,
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
        condition: m.condition,
        battery: Math.round(m.battery),
      })),
      orphanNets: c.orphanNets.map((o) => ({
        id: o.id,
        x: o.x,
        y: o.y,
        resourceType: o.resourceType,
        amount: Math.round(o.amount),
      })),
      autoDesignate: c.autoDesignate,
      serviceSpend: Math.round(c.serviceSpend),
      minerSlots: c.minerSlots,
      ownedDocks: c.ownedDocks,
      ownedHangars: c.ownedHangars,
      pressurized: c.pressurized,
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
        carryingMiner: s.minersAboard > 0,
        minersAboard: s.minersAboard,
        fuel: Math.round(s.fuel),
        battery: Math.round(s.battery),
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

  // ---- persistence (raw state dump so no field can be missed) ----

  serialize(): Record<string, unknown> {
    return {
      seed: this.seed,
      t: this.t,
      phase: this.phase,
      paused: this.paused,
      period: this.period,
      quota: this.quota,
      periodEndsAt: this.periodEndsAt,
      winnerCorpId: this.winnerCorpId,
      companyArrivalsCount: this.companyArrivalsCount,
      companyArrivalAccumulator: this.companyArrivalAccumulator,
      arrivalCounter: this.arrivalCounter,
      naturalTotal: this.naturalTotal,
      asteroids: [...this.asteroids.values()],
      corps: [...this.corps.values()],
      log: this.log,
    }
  }

  static restore(s: any): World {
    const w = new World(s.seed)
    w.t = s.t
    w.phase = s.phase
    w.paused = s.paused
    w.period = s.period
    w.quota = s.quota
    w.periodEndsAt = s.periodEndsAt
    w.winnerCorpId = s.winnerCorpId
    w.companyArrivalsCount = s.companyArrivalsCount ?? 0
    w.companyArrivalAccumulator = s.companyArrivalAccumulator ?? 0
    w.arrivalCounter = s.arrivalCounter ?? 0
    w.naturalTotal = s.naturalTotal ?? 0
    w.asteroids = new Map((s.asteroids as SimAsteroid[]).map((a) => [a.id, a]))
    w.corps = new Map((s.corps as SimCorp[]).map((c) => [c.id, c]))
    w.log = s.log ?? []
    return w
  }
}

function roundStorage(s: Partial<Record<ResourceType, number>>): Partial<Record<ResourceType, number>> {
  const out: Partial<Record<ResourceType, number>> = {}
  for (const [k, v] of Object.entries(s) as [ResourceType, number][]) {
    if (v > 0) out[k] = Math.round(v)
  }
  return out
}
