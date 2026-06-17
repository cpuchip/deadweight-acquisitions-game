// Headless smoke test for the multiplayer sim. Runs three corps with crude AI
// through several quota periods and asserts the core loop + elimination work.
// Run: npm run smoke   (exits non-zero on failure)

import { World } from './world'
import { RESOURCE_SELL_PRICES } from '../../src/world/worldConfig'
import { SIM_HZ } from '../../shared/mpConfig'

const dt = 1 / SIM_HZ
let failures = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`  ✗ ${msg}`)
    failures++
  } else {
    console.log(`  ✓ ${msg}`)
  }
}

const world = new World(12345)

// three corps with different appetites
const AGGRESSIVE = 'A'
const MODERATE = 'B'
const PASSIVE = 'C'
world.addCorp(AGGRESSIVE, 'Aggressive', 0x55ccff)
world.addCorp(MODERATE, 'Moderate', 0xff7755)
world.addCorp(PASSIVE, 'Passive', 0x88dd66)

assert(world.phase === 'lobby', 'starts in lobby')
world.start()
assert(world.phase === 'running', 'start() -> running')

const claimTargets: Record<string, number> = {
  [AGGRESSIVE]: 5,
  [MODERATE]: 2,
  [PASSIVE]: 0, // never claims — should be liquidated first
}
const buys: Record<string, boolean> = {
  [AGGRESSIVE]: true,
  [MODERATE]: true,
  [PASSIVE]: false,
}

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
    const target = claimTargets[corp.id] ?? 0
    const myClaims = snap.asteroids.filter((a) => a.claimedBy === corp.id).length
    if (myClaims < target) {
      const id = bestUnclaimed()
      if (id) world.applyCommand(corp.id, { kind: 'designate', asteroidId: id })
    }
    if (buys[corp.id] && corp.credits >= 600) {
      world.applyCommand(corp.id, { kind: 'buyShip' })
    }
  }
}

let liquidations = 0
let firstLiquidatedId: string | null = null
let prevAlive = new Set(world.snapshot().corps.filter((c) => c.alive).map((c) => c.id))
let lastPeriod = world.period

const TOTAL_SECONDS = 300
const ticks = TOTAL_SECONDS * SIM_HZ
let secAccum = 0
for (let i = 0; i < ticks; i++) {
  world.tick(dt)
  secAccum += dt
  if (secAccum >= 1) {
    secAccum = 0
    ai()
    const snap = world.snapshot()
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
      .map((c) => `${c.name}${c.alive ? '' : '†'}=${c.tonnage}t/${c.periodTonnage}p`)
      .join('  ')
    console.log(`  [period ${world.period}, quota ${world.quota}t] ${board}`)
  }
  if (world.phase === 'ended') break
}

const final = world.snapshot()
console.log('\nfinal:', JSON.stringify(final.corps.map((c) => ({ n: c.name, t: c.tonnage, alive: c.alive })), null, 0))
console.log('winner:', final.winnerCorpId, 'phase:', final.phase)

assert(final.corps.some((c) => c.tonnage > 0), 'the mine->sell loop accrued tonnage')
assert(final.corps.find((c) => c.id === AGGRESSIVE)!.tonnage > 0, 'aggressive corp earned tonnage')
assert(liquidations >= 1, 'at least one corp was liquidated at a quota deadline')
assert(firstLiquidatedId === PASSIVE, 'the passive (no-mining) corp was liquidated first')
assert(
  final.winnerCorpId === null || final.winnerCorpId === AGGRESSIVE,
  'if a winner emerged, it was the aggressive corp (not passive/null-only)',
)

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nall sim smoke assertions passed ✓')
