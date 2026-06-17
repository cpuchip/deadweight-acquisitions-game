// Headless smoke test for the multiplayer sim. Runs three corps with crude AI
// through several quota periods and asserts the faithful economy + elimination.
// Run: npm run smoke   (exits non-zero on failure)

import { World } from './world'
import { RESOURCE_SELL_PRICES, type ResourceType } from '../../src/world/worldConfig'
import { SIM_HZ, MINER_COST, SHIP_COST } from '../../shared/mpConfig'

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
  assert(c.minerCount === 0 && c.ships.length === 1, 'corp starts with 1 hauler, 0 miners (faithful)')
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
      if (corp.minerCount < target && corp.credits >= MINER_COST) {
        world.applyCommand(corp.id, { kind: 'buyMiner' })
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
assert(final.corps.find((c) => c.id === AGGRESSIVE)!.minerCount > 0, 'aggressive corp bought miners (money gate)')
assert(final.corps.find((c) => c.id === PASSIVE)!.tonnage === 0, 'passive corp (no miners) delivered nothing — the money gate held')
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

  const ship = c0.ships[0]
  const capBefore = ship.cargoCapacity
  w.applyCommand('Z', { kind: 'upgradeShip', shipId: ship.id })
  const after = w.snapshot().corps[0].ships[0]
  assert(after.cargoLevel === 1 && after.cargoCapacity > capBefore, 'cargo upgrade raises capacity')

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
  const w = new World(777)
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
  assert(!!far, 'found a far large asteroid to starve a miner against')
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

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nall sim smoke assertions passed ✓')
