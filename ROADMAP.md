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

## Next features — Plan B (ratified 2026-06-17, MP-native depth; build after the UI polish)

After the SP audit (parity is a close faithful *adaptation*; the un-ported items are SP
manual-micro we deliberately auto-manage), Michael picked the MP-native depth path:

- **Contested salvage** — orphaned nets are currently owner-only. Make them grabbable by
  ANY corp, so you can raid a rival's drifting nets when they over-extend. Real PvP
  tension; small build (relax the owner check in dispatch + render orphans neutrally + a
  contest/steal log line). The OrphanNetSnap already exists.
- **Catastrophic failure as stakes** — let a chronically un-serviced miner actually FAIL
  (lost), so over-claiming (more rocks than your haulers can service) has a real cost.
  Needs failure to be *reachable* despite auto-service — e.g., a miner whose hauler can't
  keep up (far/contested rock) wears past the cap and risks failure. Punishes greed,
  rewards a balanced fleet. Tune so normal play rarely triggers it.

NOT doing (SP manual-micro that fights the auto-dispatched MP): RCS fuel, nets-as-objects
+ manual collection, manual miner servicing states (dark/station-repair/resupply), ship→
miner charge toggle, granular spare-nets bookkeeping.

## Ratified 2026-06-17

- **Target = FULL PARITY (v3 → v6, + v7 polish).** Michael wants Dave's whole game,
  faithfully, with multiplayer. Build phase by phase; verify + deploy each.
- **Designation default = Dave's select→designate.** Click selects; press "Designate
  for Mining" to dispatch. Auto-claim becomes an opt-in **"quick-claim" toggle**
  (default off).
- Honest tension acknowledged + accepted: the deep sim (v5–v6) adds real
  micromanagement to the race. Full parity is the call anyway.

## Goal (set 2026-06-17): reach v7 — full parity.

Michael: "I want it all — set a goal to get to v7." Autonomous build (Ammon): drive
the phases to completion, surface only when his input is genuinely needed. Auto-deploy
on push is fixed (GitHub App granted access to the repo).

## Progress

- **v3 COMPLETE 2026-06-17:**
  - designation UX = Dave's select→designate default + quick-claim toggle ✓
  - **minimap** (DOM canvas, top-right; planet/asteroids/bases/ships) ✓
  - **EntityPanel**: ship selection + detail (state/cargo/miner/owner) ✓ + asteroid panel
  - bigger **textured planet** (banding) ✓
  - (deferred to when entities split: miner/net detail panels — that's v5)
- **v4 COMPLETE 2026-06-17:**
  - **named ships** (Hauler-01, -02, …) ✓
  - **per-ship cargo upgrades** (tiers 200/350/550/800, costs 300/600/1000) via the
    ship detail panel ✓
  - **auto-designate** toggle (base panel AUTOMATION) — idle miner-haulers auto-claim
    the richest free asteroids ✓ (browser-proven: delivered 200t via auto-claim)
  - **Re-sequenced:** multiple-miners-per-hauler (attachment slots) MOVED to **v5** —
    it's meaningless until miners are separately deployable (the v5 deep-mining loop).
    Same destination, cleaner phase boundary.
- **v5a COMPLETE 2026-06-17 — the deep mining loop core:**
  - Miners are now a **pool** (bought, not mounted). A hauler **carries a miner out and
    DEPLOYS it** at the claimed asteroid; the deployed miner **mines + ejects nets**
    (buffered, with **net-starved** backpressure); the hauler **shuttles** the nets to
    base storage; tonnage = ore delivered. Miner **recovered** on depletion. ✓
  - Deployed miners + their tethered nets render at asteroids; haulers show a
    carrying-miner / nets-aboard marker. Ship states: en route / deploying / collecting
    / hauling / unloading. Base panel + ship panel updated to the pool model.
  - Verified: smoke + wstest (deploy + shuttle + tonnage) green local + **prod**; browser
    e2e (auto-mined 53t via deploy→net→shuttle).
- **v5b-1 COMPLETE 2026-06-17 — read the loop + recall:**
  - **Miner detail panel** — click a deployed miner (it takes click priority over the
    asteroid it sits on) → resource / owning corp / state / nets ready / host-rock
    remaining, plus a **RECALL MINER** button (your corp only; returns the bought miner
    to inventory + frees the claim). ✓
  - **Beacons** — a net-starved (full) or depleted miner throbs a pulsing ring in the
    scene, and net-starved miners blip amber on the minimap so you can spot a stuck one
    field-wide. ✓
  - **Net-starved alert** — the moment a miner first fills its net buffer it pushes a
    "⚠ your miner is full of nets — send a hauler" line to the event log, and the fleet
    readout shows "⚠ N full". ✓
  - Verified: smoke (net-starved beacon trips + log alert + recall removes miner/frees
    claim/keeps the owned miner) + typecheck + build + wstest green; browser e2e ran the
    full deploy→deliver loop (53t) with the new render code live and **0 console errors**.
- **v5b: clickable minimap (ease-of-life) COMPLETE 2026-06-17 (`e333810`).** Clicking the
  MP minimap flies the main camera to that world point (300ms Power2 pan), matching SP.
  mpCameraTarget store bridges the DOM minimap to the Phaser scene. Browser-confirmed.
- **v5b-2a: orphaned-net recovery COMPLETE 2026-06-17 (`daeb562`).** Recalling a miner
  with buffered nets leaves the nets adrift as salvage (OrphanNetSnap + 'to-orphan' ship
  phase); a freed hauler auto-recovers them. Faithful to Dave's free-orbit nets. smoke
  25/25 + wstest + prod.
- **v7: company asteroid arrivals COMPLETE 2026-06-17 (`d210066`).** Company asteroids
  arrive over time (interval scales BASE→MIN by remaining natural fraction; capped at
  COMPANY_ASTEROID_MAX_COUNT), using Dave's generateCompanyAsteroid. Gold halo in-scene +
  gold minimap dot; AsteroidSnap.isCompany. smoke 28/28 + wstest + prod.

- **v7: Keplerian orbiting COMPLETE 2026-06-17 (`9fb0977`).** The field drifts (ω =
  ORBITAL_K / r^1.5); deployed miners + docked haulers ride their rock. smoke 30/30 +
  wstest (over-the-wire orbit-drift assert) + prod.
- **v7: room chat COMPLETE 2026-06-17 (`03a839d`).** Lobby + match chat; collapsible
  bottom-left panel; server broadcasts trimmed/capped lines tagged with corp color.
  wstest 21/21 + prod.
- **build stamp COMPLETE 2026-06-17 (`1a76ba2`) — dev infra.** `__BUILD_SHA__` (git short
  hash) on the menu footer + a corner badge; `GET /version` returns it; `dist/version.txt`.
  Now deploy-verify = `curl /version` (definitive, esp. for server-only changes). Dockerfile
  installs git + un-ignores .git to read the commit, then removes it.

### Remaining to v7 — DECISION 2026-06-17 (AskUserQuestion): **FULL FAITHFUL PARITY — all of it**
Michael chose to implement every SP system faithfully (Dave's constants), **auto-managed**
so the auto-dispatch race stays ease-of-life (no micro). Tension acknowledged + overridden:
much of it is auto-managed/invisible in the auto-sim, but he wants the full parity. So the
systems exist + are VISIBLE (bars + credit-sink fees in the log), auto-serviced at base,
and tuned MP-safe (never strand). Phase breakdown (each its own tested commit):
- **(a) hauler fuel + battery DONE (`a495a2f`)** — fuel drains thrusting; auto-refuel at
  base for a distance-scaled credit fee (never strands); battery recharges parked; bars in
  the ship panel. smoke 33/33 + prod.
- **(b) miner condition + battery + repair DONE (`2e82f13`)** — miners wear on-station
  (condition→mining penalty below grace) + drain battery; the shuttling hauler auto-services
  (recharge free + repair-for-a-fee when worn). Far rocks rack up real wear/repair, close
  rocks stay serviced. Bars in the miner panel (worn=amber). smoke 35/35 + prod.
- **(c) station services** — surface the service economy: a base-panel STATION section
  listing the auto-services + fee rates + cumulative service spend. (Dock/hangar/public-fee/
  pressurization are SP single-station internals that don't map to MP's one-base-per-corp —
  the fee model IS the station service here.) (next)
- **(d) multiple miners per hauler DONE (`0a73848`)** — Dave's 2-miner bay; a hauler
  carries up to MINER_SLOTS miners and milk-run-deploys across a cluster (minersAboard +
  deployQueue, reservation-aware). smoke 39/39 (one hauler deploys two miners) + prod.
- **(e) room persistence DONE (`dc36ec4`)** — running matches snapshot → disk (Docker
  volume) + resume on boot; reconnect-by-name into the resumed sim. GC keeps running rooms
  on empty; a TTL sweep drops abandoned ones. smoke 45/45 + a local crash→reboot→resume
  e2e + prod.
- **(f) spectator + camera polish** — F frames the whole field, C/Home recenters on base,
  and you auto-frame the field when eliminated (spectator overview). Balance: the main
  smoke match resolves to a clean winner with the fee sinks small vs ore income — healthy.
  (in flight → then **v7 deployed**)
