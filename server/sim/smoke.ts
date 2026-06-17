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
      const minered = corp.minerCount
      const slots = corp.ships.length - minered // haulers without a miner
      if (minered < target) {
        if (slots > 0 && corp.credits >= MINER_COST) world.applyCommand(corp.id, { kind: 'buyMiner' })
        else if (corp.ships.length < target && corp.credits >= SHIP_COST) world.applyCommand(corp.id, { kind: 'buyShip' })
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
    if (snap.corps.some((c) => c.ships.some((s) => s.phase === 'mining'))) everMined = true
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

assert(everMined, 'a miner-equipped hauler actually mined (economy works)')
assert(final.corps.find((c) => c.id === AGGRESSIVE)!.tonnage > 0, 'aggressive corp delivered tonnage')
assert(final.corps.find((c) => c.id === AGGRESSIVE)!.minerCount > 0, 'aggressive corp bought miners (money gate)')
assert(final.corps.find((c) => c.id === PASSIVE)!.tonnage === 0, 'passive corp (no miners) delivered nothing — the money gate held')
assert(liquidations >= 1, 'at least one corp was liquidated at a quota deadline')
assert(firstLiquidatedId === PASSIVE, 'the passive (no-miner) corp was liquidated first')
assert(
  final.winnerCorpId === null || final.winnerCorpId === AGGRESSIVE,
  'if a winner emerged, it was the aggressive corp',
)

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nall sim smoke assertions passed ✓')
