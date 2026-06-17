// End-to-end network test: spins two corps through a real WebSocket against a
// running server (npm run serve), starts the match, claims an asteroid, and
// asserts the full mine->haul->sell loop closes over the wire.
// Usage: start the server, then: npx tsx server/wstest.ts

import WebSocket from 'ws'
import type { ClientMessage, ServerMessage, WorldSnapshot } from '../shared/protocol'

const URL = process.env.WS_URL || 'ws://localhost:8080/ws'
const ROOM = 'ittest-' + Math.floor(Math.random() * 1000)

let failures = 0
function assert(cond: boolean, msg: string): void {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) failures++
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Client {
  ws: WebSocket
  corpId: string | null
  isHost: boolean
  snap: WorldSnapshot | null
  chat: { from: string; text: string }[]
}

function open(name: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL)
    const c: Client = { ws, corpId: null, isHost: false, snap: null, chat: [] }
    const t = setTimeout(() => reject(new Error('open timeout')), 5000)
    ws.on('open', () => send(ws, { type: 'join', name, room: ROOM }))
    ws.on('message', (data) => {
      const msg: ServerMessage = JSON.parse(data.toString())
      if (msg.type === 'welcome') {
        c.corpId = msg.corpId
        c.isHost = msg.isHost
        clearTimeout(t)
        resolve(c)
      } else if (msg.type === 'snapshot') {
        c.snap = msg.world
      } else if (msg.type === 'chat') {
        c.chat.push({ from: msg.from, text: msg.text })
      }
    })
    ws.on('error', reject)
  })
}
function send(ws: WebSocket, msg: ClientMessage): void {
  ws.send(JSON.stringify(msg))
}

async function main(): Promise<void> {
  console.log(`connecting to ${URL} room ${ROOM}`)
  const alpha = await open('Alpha')
  const beta = await open('Beta')
  assert(!!alpha.corpId && !!beta.corpId, 'both corps got a welcome')
  assert(alpha.isHost && !beta.isHost, 'first joiner is host, second is not')

  // chat broadcasts to the whole room (lobby or match)
  send(alpha.ws, { type: 'chat', text: 'hello room' })
  await sleep(400)
  assert(beta.chat.some((c) => c.from === 'Alpha' && c.text === 'hello room'), 'chat broadcasts to other corps in the room')
  assert(alpha.chat.some((c) => c.text === 'hello room'), 'sender sees their own chat line')

  send(alpha.ws, { type: 'start' })
  await sleep(700)
  assert(alpha.snap?.phase === 'running', 'host start -> phase running (seen by client)')
  assert((alpha.snap?.corps.length ?? 0) === 2, 'snapshot shows both corps')

  // capture an asteroid's position to confirm Keplerian orbiting over the wire later
  const orbitProbe = alpha.snap!.asteroids[0]
    ? { id: alpha.snap!.asteroids[0].id, x: alpha.snap!.asteroids[0].x, y: alpha.snap!.asteroids[0].y }
    : null

  // Alpha claims the asteroid nearest its base, to keep the round trip short.
  const me = alpha.snap!.corps.find((c) => c.id === alpha.corpId)!
  assert(me.minerCount === 1 && me.ships.length === 1, 'Alpha starts with 1 hauler + 1 pre-loaded miner')
  let nearest: { id: string; d: number } | null = null
  for (const a of alpha.snap!.asteroids) {
    const d = Math.hypot(a.x - me.baseX, a.y - me.baseY)
    if (!nearest || d < nearest.d) nearest = { id: a.id, d }
  }
  assert(!!nearest, 'found an asteroid to claim')

  // claiming a rock deploys the pre-loaded starter miner — a hauler dispatches to carry it out
  send(alpha.ws, { type: 'cmd', cmd: { kind: 'designate', asteroidId: nearest!.id } })
  console.log(`  Alpha claimed ${nearest!.id} (~${Math.round(nearest!.d)} units away)`)
  let dispatched = false
  for (let i = 0; i < 20; i++) {
    await sleep(500)
    const a = alpha.snap?.corps.find((c) => c.id === alpha.corpId)
    if (a?.ships.some((s) => s.phase !== 'idle')) {
      dispatched = true
      break
    }
  }
  assert(dispatched, 'claiming a rock dispatches a hauler to deploy the starter miner')
  // buying another miner lets you work a second rock (the money side of the economy)
  send(alpha.ws, { type: 'cmd', cmd: { kind: 'buyMiner' } })

  // the deep loop (deploy -> net -> shuttle) should bank tonnage; give it room
  let earned = false
  let sawMiner = false
  for (let i = 0; i < 140; i++) {
    await sleep(500)
    const a = alpha.snap?.corps.find((c) => c.id === alpha.corpId)
    if ((a?.miners.length ?? 0) > 0) sawMiner = true
    if ((a?.tonnage ?? 0) > 0) {
      earned = true
      console.log(`  Alpha banked ${a!.tonnage}t, credits ${a!.credits}`)
      break
    }
  }
  assert(sawMiner, 'a miner was deployed at the asteroid')
  assert(earned, 'deep loop shuttled ore to base over the network')

  // Keplerian orbiting: by now (many seconds in) the probed asteroid has drifted
  if (orbitProbe) {
    const oa = alpha.snap?.asteroids.find((a) => a.id === orbitProbe.id)
    if (oa) {
      const d = Math.hypot(oa.x - orbitProbe.x, oa.y - orbitProbe.y)
      console.log(`  orbit drift of probe asteroid: ${d.toFixed(2)} units (from ${orbitProbe.x.toFixed(0)},${orbitProbe.y.toFixed(0)} to ${oa.x.toFixed(0)},${oa.y.toFixed(0)})`)
      assert(d > 0.5, 'asteroids orbit over the wire (Keplerian drift)')
    } else {
      console.log('  (orbit-probe asteroid was mined out — orbit check skipped)')
    }
  }

  // v4: ship naming + cargo upgrade over the network
  {
    const myShip = alpha.snap?.corps.find((c) => c.id === alpha.corpId)?.ships[0]
    assert(!!myShip && /^Hauler-\d{2}$/.test(myShip.name), 'ships are named (e.g. Hauler-01)')
    const capBefore = myShip!.cargoCapacity
    send(alpha.ws, { type: 'cmd', cmd: { kind: 'upgradeShip', shipId: myShip!.id } })
    await sleep(700)
    const after = alpha.snap?.corps.find((c) => c.id === alpha.corpId)?.ships[0]
    assert(!!after && after.cargoCapacity > capBefore, 'cargo upgrade raised capacity over the network')
  }

  // claim contest: Beta cannot claim Alpha's asteroid
  send(beta.ws, { type: 'cmd', cmd: { kind: 'designate', asteroidId: nearest!.id } })
  await sleep(600)
  const ast = alpha.snap?.asteroids.find((x) => x.id === nearest!.id)
  if (ast) assert(ast.claimedBy === alpha.corpId, 'contested asteroid stays with the first claimant')
  else console.log('  (asteroid already mined out — claim-contest check skipped)')

  // pause (host only) freezes the sim clock
  send(alpha.ws, { type: 'pause' })
  await sleep(700)
  assert(alpha.snap?.paused === true, 'host pause sets the paused flag')
  const tPause = alpha.snap!.t
  await sleep(2000)
  assert(Math.abs(alpha.snap!.t - tPause) < 0.3, 'paused freezes the sim clock')
  send(alpha.ws, { type: 'pause' }) // resume
  await sleep(700)
  assert(alpha.snap?.paused === false, 'host can resume')

  // quit forfeits the corp (removed from the race)
  send(beta.ws, { type: 'quit' })
  await sleep(700)
  const betaCorp = alpha.snap?.corps.find((c) => c.id === beta.corpId)
  assert(!!betaCorp && !betaCorp.alive, 'quitting forfeits the corp')

  alpha.ws.close()
  beta.ws.close()
}

main()
  .then(() => {
    if (failures > 0) {
      console.error(`\n${failures} assertion(s) failed`)
      process.exit(1)
    }
    console.log('\nall network integration assertions passed ✓')
    process.exit(0)
  })
  .catch((e) => {
    console.error('integration test error:', e)
    process.exit(1)
  })
