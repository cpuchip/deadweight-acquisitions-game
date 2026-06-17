# Deadweight Acquisitions — Multiplayer

> Added to cpuchip's fork. **Dave's original single-player game is untouched** —
> multiplayer is an additive mode reachable from the main menu. The fork stays a
> clean superset of `happydave/deadweight-acquisitions-game`.

## What this is

A **competitive, last-corp-standing** multiplayer mode. Several players each run
their own mining corporation in one shared asteroid field. Every quota period the
lowest-tonnage corp is liquidated. Make quota or you're deadweight. Last corp
standing wins.

## Architecture

**Server-authoritative.** A Node WebSocket server owns the canonical simulation;
clients send commands and render snapshots. This reuses the two seams the original
already had — a serializable command type and a full-world snapshot — and keeps
Phaser entirely client-side (rendering only), which sidesteps the headless-Phaser
problem.

```
  Browser (Phaser renderer)  --- WebSocket (/ws) --->  Node server
   - draws world from snapshots                          - owns the sim (server/sim)
   - sends GameCommands                                  - rooms, corps, quota/elimination
   - lobby + scoreboard + quota HUD                      - serves the built client (dist/)
```

- **Same-origin WS.** One Node service serves the built Vite client *and* the
  WebSocket on `/ws`. No CORS, no cross-service proxy. One container, one domain.
- **Reused from Dave (Phaser-free):** `src/world/worldConfig.ts`, `rng.ts`,
  `worldGenerator.ts` — the server generates the shared field with Dave's own code.
- **Reimplemented as plain data (multi-corp):** the ship/mining state machine,
  because the originals extend Phaser classes and there is one corp's worth of them.

## Scope — faithful economy (v2, 2026-06-17) vs. deferred micro

**Faithful to Dave's single-player economy** (rebuilt after first-play feedback):
- Start with **1 hauler, 0 miners, 750 credits** (mirrors SP's single Hauler-01).
- A hauler can only mine if it carries a **purchased AutoMiner (300cr)** — the money
  gate. Clicking an asteroid with no miner-equipped hauler registers the claim but
  dispatches nothing (no more free auto-mining).
- Mined ore hauls to **base storage (cap 2000)**, **not auto-sold**. You **sell
  manually** at the base menu's market for credits, then reinvest (haulers 500cr,
  miners 300cr).
- The **base** is a faithful station (Dave's look, per-corp tint, name label) in GEO
  orbit around the planet; clicking it opens the **base menu** (credits/storage,
  MARKET, SHIPYARD, EQUIPMENT) — the MP twin of Dave's `BasePanel`.
- **Tonnage = tons DELIVERED to base** (production), so the quota rewards mining
  while selling drives growth and frees storage.

**MP-only competitive layer:** shared seeded field · **contested asteroid claims**
(rare-metals pay 5× iron) · **rising quota + elimination, last corp standing**
(period 1 is a generous setup window) · lobby + room codes + deep links ·
scoreboard · spectate after elimination.

**Still deferred (the deeper SP micro):** the hauler/miner *deploy + net-shuttle*
dance (a miner-equipped hauler mines directly here), beacons, attach-failure/
condition/repair, fuel/RCS/battery, station dock/hangar services, per-ship cargo
upgrades, Keplerian orbiting. Single-player keeps all of these untouched; they're
the next faithfulness layer if wanted.

## Layout

```
server/
  index.ts        # http: serve dist/ + WebSocket /ws
  rooms.ts        # room registry, join, host election, command relay, broadcast loop
  sim/
    world.ts      # the multi-corp simulation (tick, applyCommand, quota/elimination)
shared/
  protocol.ts     # ClientMessage / ServerMessage / WorldSnapshot / GameCommand
  mpConfig.ts     # MP sim constants (quota period/curve, fleet start, prices ref)
src/                       # Dave's client + MP additions
  scenes/MainMenuScene.ts  # + MULTIPLAYER button
  scenes/mp/MultiplayerScene.ts
  ui/mp/Lobby.svelte, MpHud.svelte
  state/mpStore.ts
Dockerfile        # single-stage: npm ci -> vite build -> tsx server
docker-compose.yml
```

## Build progress — v1 SHIPPED 2026-06-17

- [x] shared/protocol.ts + shared/mpConfig.ts
- [x] server/sim/world.ts  (the heart)
- [x] server/rooms.ts + server/index.ts
- [x] sim smoke test (server/sim/smoke.ts) — 5/5 green
- [x] client: mpStore + Lobby + MultiplayerScene + MpHud + menu wiring
- [x] package.json deps/scripts (ws, tsx, @types/ws, nanoid)
- [x] Dockerfile + docker-compose.yml
- [x] networked integration test (server/wstest.ts) — green local + container + prod
- [x] in-browser verify (lobby, claim, render) via playwright-cli
- [x] Dokploy deploy → **https://deadweight.cpuchip.net** (live)
- [x] push fork (cpuchip/deadweight-acquisitions-game @ master)

**Deploy:** NOCIX Dokploy (server.ibeco.me), project `deadweight`
(`ilaeCtLXDQrQsP9mlK9rX`), compose `l4tkfFkX5GvAvNSlmqR3H`, auto-deploy on push to
master. `*.cpuchip.net` is wildcard DNS → the VPS, so the subdomain needed no DNS step.

## Known follow-ups / tuning

- **Balance:** first quota (120 t / 90 s) can be tight if you claim a distant rock;
  travel is ~6 s each way. Tune `QUOTA_*` / `MINE_RATE` / `BASE_RING_RADIUS` in
  `shared/mpConfig.ts`. It's a knob, not a bug.
- **Phase-2 (ratified shape, not built):** the folded hauler/miner separation,
  fuel/condition/station depth, Keplerian orbiting, reconnect-hardening, a real
  lobby chat, and the deeper economy. See the scope section above.
- Snapshots send the full (non-depleted) asteroid set each tick — fine for a few
  friends; delta-encode if a room ever gets large.

## Run

```bash
# local (built, prod-like)
docker compose up --build      # http://localhost:8080  (open two tabs = two corps)

# local dev (client HMR + server reload, two terminals)
npm run dev          # vite client on :5173, proxies /ws to the server
npm run dev:server   # tsx watch server on :8080
```
