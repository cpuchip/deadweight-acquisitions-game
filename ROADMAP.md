# Deadweight Multiplayer — Parity Roadmap (v3+)

Goal: keep the competitive multiplayer, and walk it toward **full parity with Dave's
single-player game**. Catalogued by playing his SP (localhost:5173) + reading his
`SpaceScene` / `BasePanel` / `EntityPanel`.

The architecture already supports all of this — every phase adds to the
server-authoritative sim (`server/sim/world.ts`) and the Phaser-renderer client
(`src/scenes/mp`, `src/ui/mp`). No re-architecture needed. Dave's single-player
stays untouched throughout.

## Where we are (v2 + this pass)

Faithful economy (1 hauler / 0 miners / 750cr; buy miners 300cr; manual selling;
storage cap), faithful base look + base menu (market/shipyard/equipment), the
competitive layer (contested claims, quota, last-corp-standing), lobby + deep links.
**This pass added:** right-click-drag no longer pops the browser menu (left-click
selects, right/middle pan); **Pause** (host) + **Quit** in the top bar (quit forfeits
and the room dies on the server when it empties).

## Parity gaps (what Dave's SP has that MP doesn't)

| Gap | Dave's SP | MP today |
|-----|-----------|----------|
| **Designation UX** | click an asteroid → **select** → "Designate for Mining" button | auto-claims on click |
| **Minimap** | top-right field overview | none |
| **Entity inspection** | rich `EntityPanel` (ship / miner / asteroid / net) | thin claim panel + scoreboard |
| **Planet** | large, textured, proximity slow-zone | small flat circle |
| **Base depth** | station services, fees, cargo upgrades, auto-designate, miner storage | market / shipyard / equipment only |
| **Fleet** | named ships, per-ship upgrades, 2 miner slots + net-store | fungible hauler count, 1 miner each |
| **Mining loop** | hauler deploys miner → miner ejects nets → hauler shuttles nets | hauler mines directly |
| **Fuel / power** | thruster fuel, RCS, battery (refuel/recharge, electricity fees) | none |
| **Condition** | miners degrade, catastrophic failure, hangar repair | none |
| **Beacons** | net-starved / dark miners beacon for recovery | none |
| **Orphaned nets** | free-orbit nets, designate-for-collection | none |
| **World dynamics** | Keplerian orbiting, company asteroid arrivals over time | static field |

## Phases

### v3 — "Feels like Dave's" (interaction parity, no deep sim) — ~1 session
The cheap wins that close most of the *perceived* gap.
- **Designation UX:** left-click selects → an `EntityPanel` with a **Designate for
  Mining** button (Dave's flow). Keep **auto-claim as a toggle** (you like it) —
  default per your call below.
- **Minimap** (top-right) — shared-field overview: all corps' bases + ships + asteroids.
- **EntityPanel** for MP — asteroid + ship detail (miner detail lands with v5).
- **Bigger textured planet** + the proximity slow-zone feel.

### v4 — Fuller base + fleet identity (economy depth) — ~1–2 sessions
- Full base panel: per-ship **cargo upgrades** (tiers), **auto-designate** toggle,
  station **miner storage**.
- **Named ships** with individual upgrade levels (not fungible counts).
- **Multiple miners per hauler** (attachment slots: net-store + 2 medium).

### v5 — The deep mining sim (the heart of Dave's logistics) — ~2–3 sessions
The big one. Changes the competitive feel toward more micromanagement.
- Hauler **deploys** a miner at the asteroid → miner mines + **ejects nets** → hauler
  **collects nets** and hauls to base.
- **Orphaned-net recovery** (free-orbit, designate-for-collection).
- **Beacons + recovery** (net-starved / dark miners).

### v6 — Resource management (fuel / power / condition) — ~2 sessions
- Hauler fuel / RCS / battery; miner battery / RCS; **refuel + recharge** at base
  (electricity fees).
- **Condition / repair** (degradation, catastrophic failure, hangar repair).
- **Station services** (docks = fast transfer, hangars = slow service; owned vs.
  public fees; pressurization).

### v7 — World dynamics + MP polish — ~1–2 sessions
- **Keplerian orbiting** asteroids; **company asteroid arrivals** over time.
- **Room persistence** (server snapshot → disk; reconnect-resume).
- Lobby chat; spectator + camera-framing polish.
- Fix the **auto-deploy webhook** (currently deploys are manual `compose.deploy`).

## Ratified 2026-06-17

- **Target = FULL PARITY (v3 → v6, + v7 polish).** Michael wants Dave's whole game,
  faithfully, with multiplayer. Build phase by phase; verify + deploy each.
- **Designation default = Dave's select→designate.** Click selects; press "Designate
  for Mining" to dispatch. Auto-claim becomes an opt-in **"quick-claim" toggle**
  (default off).
- Honest tension acknowledged + accepted: the deep sim (v5–v6) adds real
  micromanagement to the race. Full parity is the call anyway.

## Progress

- **v3 started 2026-06-17:** designation UX flipped to Dave's default (click selects;
  panel button designates) + quick-claim toggle. Next in v3: minimap, EntityPanel
  build-out, bigger textured planet.
