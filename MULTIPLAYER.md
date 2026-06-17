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

## v1 scope (the deployed slice) vs. phase-2

**In v1 (this build):** shared seeded asteroid field · N corps each with a base,
credits, a fleet of mining-haulers · the mine→haul→sell→grow loop run automatically
per claimed asteroid · **contested asteroid claims** (first corp to claim mines it;
rare-metals pay 5× iron, so the rich rocks are the fight) · asteroid depletion ·
buy-ship economy · **rising quota + elimination, last corp standing** · lobby with
room codes + names (no accounts) · live scoreboard + quota timer · spectate after
elimination.

**Simplified out of v1 (documented, phase-2 candidates):** the hauler/miner
separation (folded — a ship mines directly), fuel/RCS/battery, condition/repair,
station services, attach-failure rolls, net leakage, beacons, orphaned-net
recovery, Keplerian orbiting (asteroids static in MP). The original single-player
game keeps all of these.

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

## Build progress

- [ ] shared/protocol.ts + shared/mpConfig.ts
- [ ] server/sim/world.ts  (the heart)
- [ ] server/rooms.ts + server/index.ts
- [ ] sim smoke test (node, headless)
- [ ] client: mpStore + Lobby + MultiplayerScene + MpHud + menu wiring
- [ ] package.json deps/scripts (ws, tsx, @types/ws)
- [ ] Dockerfile + docker-compose.yml
- [ ] local two-tab playtest
- [ ] Dokploy deploy → deadweight.cpuchip.net
- [ ] push fork

## Run

```bash
# local (built, prod-like)
docker compose up --build      # http://localhost:8080  (open two tabs = two corps)

# local dev (client HMR + server reload, two terminals)
npm run dev          # vite client on :5173, proxies /ws to the server
npm run dev:server   # tsx watch server on :8080
```
