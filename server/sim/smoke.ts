// Headless smoke test for the multiplayer sim. Runs three corps with crude AI
// through several quota periods and asserts the faithful economy + elimination.
// Run: npm run smoke   (exits non-zero on failure)

import { World } from './world'
import { RESOURCE_SELL_PRICES, type ResourceType } from '../../src/world/worldConfig'
import { SIM_HZ, MINER_COST, SHIP_COST, HAULER_FUEL_MAX, STARTING_MINER_SLOTS, MINER_SLOT_COST } from '../../shared/mpConfig'

const dt = 1 / SIM_HZ
let failures = 0
function assert(cond: boolean, msg: string): void {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) failures++
}

const world = new World(12345)

const AGGRESSIVE = 'A'
const MODERATE = 'B'
const PASSIVE = 'C'
world.addCorp(AGGRESSIVE, 'Aggressive', 0x55ccff)
world.addCorp(MODERATE, 'Moderate', 0xff7755)
world.addCorp(PASSIVE, 'Passive', 0x88dd66)

assert(world.phase === 'lobby', 'starts in lobby')
// money gate: a fresh corp has no miners, so a claim cannot dispatch yet
{
  const c = world.snapshot().corps[0]
  assert(c.minerCount === 1 && c.ships.length === 1, 'corp starts with 1 hauler + 1 pre-loaded miner (faithful to SP)')
}
world.start()
assert(world.phase === 'running', 'start() -> running')

const targets: Record<string, number> = { [AGGRESSIVE]: 4, [MODERATE]: 2, [PASSIVE]: 0 }
const buys: Record<string, boolean> = { [AGGRESSIVE]: true, [MODERATE]: true, [PASSIVE]: false }

function bestUnclaimed(): string | null {
  const snap = world.snapshot()
  let best: { id: string; value: number } | null = null
  for (const a of snap.asteroids) {
    if (a.claimedBy) continue
    const value = (RESOURCE_SELL_PRICES[a.resourceType] ?? 1) * a.currentQuantity
    if (!best || value > best.value) best = { id: a.id, value }
  }
  return best?.id ?? null
}

function ai(): void {
  const snap = world.snapshot()
  for (const corp of snap.corps) {
    if (!corp.alive) continue
    const target = targets[corp.id] ?? 0
    if (buys[corp.id]) {
      // sell everything to build credits
      for (const [res, qty] of Object.entries(corp.storage) as [ResourceType, number][]) {
        if ((qty ?? 0) > 0) world.applyCommand(corp.id, { kind: 'sell', resource: res })
      }
      // each active asteroid wants a miner to deploy + a hauler to shuttle
      if (corp.minerCount < target) {
        if (corp.minerCount >= corp.minerSlots && corp.credits >= MINER_SLOT_COST) {
          world.applyCommand(corp.id, { kind: 'buyMinerSlot' }) // out of slots — buy one first
        } else if (corp.credits >= MINER_COST) {
          world.applyCommand(corp.id, { kind: 'buyMiner' })
        }
      } else if (corp.ships.length < target && corp.credits >= SHIP_COST) {
        world.applyCommand(corp.id, { kind: 'buyShip' })
      }
    }
    const myClaims = snap.asteroids.filter((a) => a.claimedBy === corp.id).length
    if (myClaims < target) {
      const id = bestUnclaimed()
      if (id) world.applyCommand(corp.id, { kind: 'designate', asteroidId: id })
    }
  }
}

let liquidations = 0
let firstLiquidatedId: string | null = null
let prevAlive = new Set(world.snapshot().corps.filter((c) => c.alive).map((c) => c.id))
let lastPeriod = world.period
let everMined = false

const TOTAL_SECONDS = 320
const ticks = TOTAL_SECONDS * SIM_HZ
let secAccum = 0
for (let i = 0; i < ticks; i++) {
  world.tick(dt)
  secAccum += dt
  if (secAccum >= 1) {
    secAccum = 0
    ai()
    const snap = world.snapshot()
    if (snap.corps.some((c) => c.miners.length > 0)) everMined = true
    const aliveNow = new Set(snap.corps.filter((c) => c.alive).map((c) => c.id))
    for (const id of prevAlive) {
      if (!aliveNow.has(id)) {
        liquidations++
        if (!firstLiquidatedId) firstLiquidatedId = id
      }
    }
    prevAlive = aliveNow
  }
  if (world.period !== lastPeriod) {
    lastPeriod = world.period
    const snap = world.snapshot()
    const board = snap.corps
      .map((c) => `${c.name}${c.alive ? '' : '†'}=${c.tonnage}t(${c.minerCount}m)`)
      .join('  ')
    console.log(`  [period ${world.period}, quota ${world.quota}t] ${board}`)
  }
  if (world.phase === 'ended') break
}

const final = world.snapshot()
console.log('\nfinal:', JSON.stringify(final.corps.map((c) => ({ n: c.name, t: c.tonnage, m: c.minerCount, alive: c.alive })), null, 0))
console.log('winner:', final.winnerCorpId, 'phase:', final.phase)

assert(everMined, 'miners deployed at asteroids (the deep loop ran)')
assert(final.corps.find((c) => c.id === AGGRESSIVE)!.tonnage > 0, 'aggressive corp shuttled ore to base (tonnage)')
assert(final.corps.find((c) => c.id === AGGRESSIVE)!.minerCount > 1, 'aggressive corp bought miners beyond the starter (money gate)')
assert(final.corps.find((c) => c.id === PASSIVE)!.tonnage === 0, 'passive corp (never claimed) delivered nothing — its starter miner stayed in the bay')
assert(liquidations >= 1, 'at least one corp was liquidated at a quota deadline')
assert(firstLiquidatedId === PASSIVE, 'the passive (no-miner) corp was liquidated first')
assert(
  final.winnerCorpId === null || final.winnerCorpId === AGGRESSIVE,
  'if a winner emerged, it was the aggressive corp',
)
console.log('  company arrivals during the match:', world.companyArrivalsCount)
assert(world.companyArrivalsCount >= 1, 'company asteroids arrived as the field depleted (Dave-faithful replenishment)')
assert(final.asteroids.some((a) => a.isCompany), 'company asteroids are flagged in the snapshot')

// ---- v4: named ships, cargo upgrades, auto-designate ----
{
  const w = new World(2024)
  w.addCorp('Z', 'Fleet', 0x55ccff)
  const c0 = w.snapshot().corps[0]
  assert(/^Hauler-\d{2}$/.test(c0.ships[0].name), 'ships are named Hauler-NN')

  w.start()
  w.applyCommand('Z', { kind: 'buyMiner' })
  w.applyCommand('Z', { kind: 'toggleAutoDesignate' })
  assert(w.snapshot().corps[0].autoDesignate === true, 'auto-designate toggles on')
  for (let i = 0; i < 60; i++) w.tick(dt)
  assert(
    w.snapshot().asteroids.some((a) => a.claimedBy === 'Z'),
    'auto-designate auto-claims an asteroid for an idle miner-hauler',
  )

  // v5 deep loop: hauler carries a miner out -> deploys it -> miner ejects nets ->
  // hauler shuttles them to base -> tonnage delivered
  let deployed = false
  for (let i = 0; i < 80 * SIM_HZ; i++) {
    w.tick(dt)
    if (w.snapshot().corps[0].miners.length > 0) deployed = true
    if (w.snapshot().corps[0].tonnage > 0) break
  }
  assert(deployed, 'a miner was deployed at the claimed asteroid')
  assert(w.snapshot().corps[0].tonnage > 0, 'deep loop delivered ore (deploy -> net -> shuttle -> base)')
}

// ---- v5b: net-starved beacon + recall ----
{
  // Seed chosen so the field's farthest LARGE rock sits well beyond the single-hauler
  // keep-up radius (~1700u): seed 42 → farthest large rock ≈ 2886u. The starve scenario
  // depends on procedural layout, so if a world-gen change (e.g. Dave's composition draws)
  // shifts the field, re-pick a seed with a far large rock — the precondition assert below
  // guards the floor so a too-close field fails at setup, not mysteriously at the starve.
  const w = new World(42)
  w.addCorp('S', 'Starver', 0x55ccff)
  w.start()
  w.applyCommand('S', { kind: 'buyMiner' })
  // designate the farthest LARGE rock: the single hauler's round trip can't keep the
  // miner's net buffer drained, so it must net-starve (and beacon) at least once
  const snap0 = w.snapshot()
  const base = snap0.corps[0]
  let far: { id: string; d: number } | null = null
  for (const a of snap0.asteroids) {
    if (a.sizeCategory !== 'large') continue
    const d = Math.hypot(a.x - base.baseX, a.y - base.baseY)
    if (!far || d > far.d) far = { id: a.id, d }
  }
  assert(!!far && far.d > 1700, 'found a far-enough large asteroid to starve a miner against (>1700u)')
  w.applyCommand('S', { kind: 'designate', asteroidId: far!.id })

  let everStarved = false
  for (let i = 0; i < 200 * SIM_HZ; i++) {
    w.tick(dt)
    if (w.snapshot().corps[0].miners.some((m) => m.state === 'net-starved')) {
      everStarved = true
      break
    }
  }
  assert(everStarved, 'a miner whose hauler cannot keep up goes net-starved (beacon trips)')
  assert(w.snapshot().log.some((l) => l.includes('full of nets')), 'net-starved miner pushes a beacon alert to the log')

  // recall = the miner panel's RECALL button (undesignate the rock): the deployed
  // miner returns to inventory and the claim is freed; the bought miner is kept
  const before = w.snapshot().corps[0]
  const ownedBefore = before.minerCount
  w.applyCommand('S', { kind: 'undesignate', asteroidId: far!.id })
  const after = w.snapshot().corps[0]
  assert(after.miners.every((m) => m.asteroidId !== far!.id), 'recall removes the deployed miner from the rock')
  assert(!w.snapshot().asteroids.find((a) => a.id === far!.id)?.claimedBy, 'recall frees the claim')
  assert(after.minerCount === ownedBefore, 'recall keeps the owned miner (returns it to inventory)')
}

// ---- v5b-2: orphaned-net recovery ----
{
  const w = new World(4242)
  w.addCorp('O', 'Orphan', 0x55ccff)
  w.start()
  w.applyCommand('O', { kind: 'buyMiner' })
  // a far rock: the miner accumulates nets while the single hauler is away, so we can
  // recall it mid-buffer and watch the nets drift as salvage (all within period 1)
  const s0 = w.snapshot()
  const b = s0.corps[0]
  let far: { id: string; d: number } | null = null
  for (const a of s0.asteroids) {
    if (a.sizeCategory !== 'large') continue
    const d = Math.hypot(a.x - b.baseX, a.y - b.baseY)
    if (!far || d > far.d) far = { id: a.id, d }
  }
  w.applyCommand('O', { kind: 'designate', asteroidId: far!.id })

  // wait until the deployed miner has buffered >= 2 nets (so a recall leaves real ore)
  let buffered = false
  for (let i = 0; i < 80 * SIM_HZ; i++) {
    w.tick(dt)
    const m = w.snapshot().corps[0].miners[0]
    if (m && m.netsReady >= 2) {
      buffered = true
      break
    }
  }
  assert(buffered, 'a far miner buffers nets while its hauler is away')

  // recall mid-buffer -> the nets are NOT lost, they become orphaned salvage
  w.applyCommand('O', { kind: 'undesignate', asteroidId: far!.id })
  assert(w.snapshot().corps[0].orphanNets.length >= 1, 'recalling a miner mid-buffer leaves orphaned nets (not lost)')

  // a freed hauler auto-recovers the drifting nets (designate-for-collection)
  let recovered = false
  for (let i = 0; i < 70 * SIM_HZ; i++) {
    w.tick(dt)
    const c = w.snapshot().corps[0]
    if (c.orphanNets.length === 0) {
      recovered = true
      break
    }
  }
  assert(recovered, 'a hauler auto-recovers the orphaned nets')
  assert(w.snapshot().corps[0].alive, 'corp survived the orphan-recovery window (stayed in period 1)')
}

// ---- v7: Keplerian orbiting ----
{
  const w = new World(99)
  w.addCorp('K', 'Kepler', 0x55ccff)
  w.start()
  const before = w.snapshot().asteroids[0]
  const id = before.id
  const bx = before.x
  const by = before.y
  for (let i = 0; i < 30 * SIM_HZ; i++) w.tick(dt)
  const after = w.snapshot().asteroids.find((a) => a.id === id)!
  const moved = Math.hypot(after.x - bx, after.y - by)
  assert(moved > 1, 'asteroids orbit the planet over time (Keplerian drift)')
  const rBefore = Math.hypot(bx, by)
  const rAfter = Math.hypot(after.x, after.y)
  assert(Math.abs(rBefore - rAfter) < 1, 'orbital radius is preserved — the drift is angular')
}

// ---- v6: hauler fuel + refuel fee (auto-managed station service) ----
{
  const w = new World(555)
  w.addCorp('F', 'Fuel', 0x55ccff)
  w.start()
  w.applyCommand('F', { kind: 'buyMiner' })
  const s0 = w.snapshot()
  const fbase = s0.corps[0]
  let far: { id: string; d: number } | null = null
  for (const a of s0.asteroids) {
    if (a.sizeCategory !== 'large') continue
    const d = Math.hypot(a.x - fbase.baseX, a.y - fbase.baseY)
    if (!far || d > far.d) far = { id: a.id, d }
  }
  w.applyCommand('F', { kind: 'designate', asteroidId: far!.id })
  const startCredits = w.snapshot().corps[0].credits
  let minFuel = HAULER_FUEL_MAX
  let delivered = false
  for (let i = 0; i < 130 * SIM_HZ; i++) {
    w.tick(dt)
    const s = w.snapshot().corps[0]
    minFuel = Math.min(minFuel, s.ships[0].fuel)
    if (s.tonnage > 0) {
      delivered = true
      break
    }
  }
  assert(minFuel < HAULER_FUEL_MAX, 'a hauler burns fuel while traveling')
  assert(delivered, 'the fuelled hauler completed the deploy→deliver loop (no stranding)')
  assert(w.snapshot().corps[0].credits < startCredits, 'returning to base charged a refuel fee (station service credit sink)')
  assert(w.snapshot().corps[0].serviceSpend > 0, 'station-service spend is tracked (refuel/repair fees accumulate)')
}

// ---- v6: miner condition wear + hauler repair ----
{
  const w = new World(888)
  w.addCorp('C', 'Cond', 0x55ccff)
  w.start()
  w.applyCommand('C', { kind: 'buyMiner' })
  // far rock: the long hauler round trip spaces out services, so the miner wears below
  // grace between visits and the servicing hauler must repair it
  const cs = w.snapshot()
  const cbase = cs.corps[0]
  let far: { id: string; d: number } | null = null
  for (const a of cs.asteroids) {
    if (a.sizeCategory !== 'large') continue
    const d = Math.hypot(a.x - cbase.baseX, a.y - cbase.baseY)
    if (!far || d > far.d) far = { id: a.id, d }
  }
  w.applyCommand('C', { kind: 'designate', asteroidId: far!.id })
  let minCond = 1
  let sawRepair = false
  let prevCond = 1
  let prevId: string | null = null
  for (let i = 0; i < 150 * SIM_HZ; i++) {
    w.tick(dt)
    const m = w.snapshot().corps[0].miners[0]
    if (m) {
      minCond = Math.min(minCond, m.condition)
      if (m.id === prevId && m.condition > prevCond + 0.05) sawRepair = true // a repair jump
      prevId = m.id
      prevCond = m.condition
    }
  }
  assert(minCond < 0.9, 'a deployed miner wears down (condition drops with use)')
  assert(sawRepair, 'a servicing hauler repairs a worn miner (condition jumps back up)')
}

// ---- v6: multiple miners per hauler (the 2-miner bay milk run) ----
{
  const w = new World(1212)
  w.addCorp('M', 'MilkRun', 0x55ccff)
  w.start()
  w.applyCommand('M', { kind: 'buyMiner' })
  w.applyCommand('M', { kind: 'buyMiner' }) // two miners, still ONE hauler
  const ms = w.snapshot()
  const mbase = ms.corps[0]
  const near = ms.asteroids
    .map((a) => ({ id: a.id, d: Math.hypot(a.x - mbase.baseX, a.y - mbase.baseY) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, 2)
  w.applyCommand('M', { kind: 'designate', asteroidId: near[0].id })
  w.applyCommand('M', { kind: 'designate', asteroidId: near[1].id })
  let maxDeployed = 0
  for (let i = 0; i < 90 * SIM_HZ; i++) {
    w.tick(dt)
    maxDeployed = Math.max(maxDeployed, w.snapshot().corps[0].miners.length)
    if (maxDeployed >= 2) break
  }
  assert(w.snapshot().corps[0].ships.length === 1, 'milk-run test uses a single hauler')
  assert(maxDeployed >= 2, 'one hauler deploys two miners in a single trip (2-miner bay milk run)')
}

// ---- v7: persistence (serialize → restore round-trip) ----
{
  const w = new World(31337)
  w.addCorp('P', 'Persist', 0x55ccff)
  w.start()
  w.applyCommand('P', { kind: 'buyMiner' })
  for (let i = 0; i < 40 * SIM_HZ; i++) w.tick(dt) // build up some live state
  const before = w.snapshot()
  const json = JSON.stringify(w.serialize()) // exercise the real serialize → JSON → restore path
  const restored = World.restore(JSON.parse(json))
  const after = restored.snapshot()
  assert(after.phase === before.phase && after.period === before.period, 'restore preserves match phase + period')
  assert(Math.abs(after.t - before.t) < 0.001, 'restore preserves the sim clock')
  assert(after.asteroids.length === before.asteroids.length, 'restore preserves the asteroid field')
  assert(after.corps[0].credits === before.corps[0].credits, 'restore preserves corp credits')
  assert(after.corps[0].ships[0].fuel === before.corps[0].ships[0].fuel, 'restore preserves ship fuel')
  // the restored world keeps simulating from where it left off
  restored.tick(dt)
  assert(restored.snapshot().t > before.t, 'a restored match resumes ticking')
}

// ---- v6: station economy (miner-slot cap + buyable upgrades + cargo upgrade) ----
{
  const w = new World(4040)
  w.addCorp('A', 'Cap', 0x55ccff)
  w.addCorp('B', 'Slot', 0xff7755)
  w.addCorp('C', 'Dock', 0x88dd66)
  w.addCorp('D', 'Hangar', 0xcc88ff)
  w.addCorp('E', 'Upgrade', 0xffcc44)
  const find = (id: string) => w.snapshot().corps.find((c) => c.id === id)!
  assert(
    find('A').minerSlots === STARTING_MINER_SLOTS && find('A').minerCount === 1,
    'corp starts with the station miner slots + 1 pre-loaded miner',
  )
  // A: buying miners is capped at the station slots
  for (let i = 0; i < 6; i++) w.applyCommand('A', { kind: 'buyMiner' })
  assert(find('A').minerCount === STARTING_MINER_SLOTS, 'buyMiner is capped at the station miner slots')
  // B: a miner slot raises the cap
  w.applyCommand('B', { kind: 'buyMinerSlot' })
  assert(find('B').minerSlots === STARTING_MINER_SLOTS + 1, 'buying a miner slot raises the cap')
  // C: owned dock (cheaper refuel)
  w.applyCommand('C', { kind: 'buyDock' })
  assert(find('C').ownedDocks === 1, 'buying an owned dock')
  // D: hangar, and pressurization is gated on credits/hangar
  w.applyCommand('D', { kind: 'buyHangar' })
  w.applyCommand('D', { kind: 'buyPressurization' }) // not enough left after the hangar
  assert(find('D').ownedHangars === 1, 'buying a hangar')
  assert(!find('D').pressurized, 'pressurization is gated (needs a hangar + the credits)')
  // E: cargo upgrade (re-added — it lives in the base economy, like SP)
  const ship = find('E').ships[0]
  const capBefore = ship.cargoCapacity
  w.applyCommand('E', { kind: 'upgradeShip', shipId: ship.id })
  const after2 = find('E').ships[0]
  assert(after2.cargoLevel === 1 && after2.cargoCapacity > capBefore, 'cargo upgrade raises capacity')
}

// ---- Tier 3a: dynamic sell market + global market events (faithful to Dave's SP) ----
{
  const w = new World(7)
  w.addCorp('M', 'Marketeer', 0x44ff88)
  w.start()
  // markets start rested: live price == reference baseline, zero pressure
  {
    const c = w.snapshot().corps[0]
    assert(c.prices.iron.current === RESOURCE_SELL_PRICES.iron, 'market opens at the reference baseline')
    assert(c.prices.iron.pressure === 0, 'market opens with zero sell-pressure')
  }
  // designate the NEAREST rock so the single hauler keeps storage fed quickly
  w.applyCommand('M', { kind: 'buyMiner' })
  const s0 = w.snapshot()
  const base = s0.corps[0]
  let near: { id: string; d: number } | null = null
  for (const a of s0.asteroids) {
    const d = Math.hypot(a.x - base.baseX, a.y - base.baseY)
    if (!near || d < near.d) near = { id: a.id, d }
  }
  w.applyCommand('M', { kind: 'designate', asteroidId: near!.id })
  // run until ore is delivered to base storage (the deploy -> mine -> shuttle loop)
  let delivered = false
  for (let i = 0; i < 600 * SIM_HZ && !delivered; i++) {
    w.tick(dt)
    delivered = (Object.values(w.snapshot().corps[0].storage) as number[]).some((v) => (v ?? 0) > 0)
  }
  assert(delivered, 'mined ore reached base storage (a resource to sell)')

  // Tier 3b: a rock's ore separates by composition — the delivered ore yields the
  // dominant resource PLUS trace amounts of the others (faithful to Dave's Phase 5),
  // so storage holds more than one resource type after a single rock's delivery.
  const st0 = w.snapshot().corps[0].storage
  {
    const kinds = (Object.keys(st0) as ResourceType[]).filter((k) => (st0[k] ?? 0) > 0)
    assert(kinds.length >= 2, 'composition split: delivered ore yields the dominant + trace resources')
  }
  // sell the DOMINANT (largest) resource so the price move clears the wire rounding
  let res: ResourceType | null = null
  let maxQty = 0
  for (const [k, q] of Object.entries(st0) as [ResourceType, number][]) {
    if ((q ?? 0) > maxQty) {
      maxQty = q ?? 0
      res = k
    }
  }
  assert(!!res, 'a dominant resource is stocked to sell')

  const before = w.snapshot().corps[0]
  const priceBefore = before.prices[res!].current
  const credBefore = before.credits
  w.applyCommand('M', { kind: 'sell', resource: res! })
  const afterSell = w.snapshot().corps[0]
  assert(afterSell.credits > credBefore, 'selling adds credits')
  assert(afterSell.storage[res!] === undefined || (afterSell.storage[res!] ?? 0) === 0, 'selling empties that resource')
  assert(afterSell.prices[res!].current < priceBefore, 'a sell depresses the live price (sell-pressure rises)')
  assert(afterSell.prices[res!].pressure > 0, 'sell-pressure is recorded on the market')

  // recovery: hold off selling and the price climbs back toward baseline over time
  const depressed = afterSell.prices[res!].current
  for (let i = 0; i < 60 * SIM_HZ; i++) w.tick(dt)
  assert(w.snapshot().corps[0].prices[res!].current > depressed, 'price recovers toward baseline when a corp holds off')
}
{
  // a market event eventually fires (EVENT_INTERVAL_MIN = 45s) and reaches the wire,
  // shifting the affected resource's baseline away from its reference price
  const w = new World(99)
  w.addCorp('E', 'Eventful', 0x8844ff)
  w.start()
  let ev: { resourceType: ResourceType; multiplier: number } | null = null
  for (let i = 0; i < 180 * SIM_HZ && !ev; i++) {
    w.tick(dt)
    const evs = w.snapshot().marketEvents
    if (evs.length > 0) ev = evs[0]
  }
  assert(!!ev, 'a global market event fires and reaches the snapshot')
  if (ev) {
    const baseline = w.snapshot().corps[0].prices[ev.resourceType].baseline
    const ref = RESOURCE_SELL_PRICES[ev.resourceType]
    assert(Math.abs(baseline - ref * ev.multiplier) < 0.2, 'the event multiplier is folded into the resource baseline')
  }
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nall sim smoke assertions passed ✓')
