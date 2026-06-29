## Version Context

- TypeScript: ^5 (strict mode)
- Phaser: ^3 (arcade physics)
- Svelte: ^5
- Vite: ^8 (build + dev server, polling mode)
- Vitest: ^3 (unit tests, node environment)
- nanoid: ID generation for all game entities

---

## Architectural Boundaries

```
Forbidden: /src/ui/ Svelte components holding references to Phaser objects — all data routes through Svelte writable stores
Forbidden: /src/scenes/dispatchLogic.ts importing from Phaser — pure functions with structural interfaces only
Forbidden: /src/services/GameSaveService.ts importing from Phaser — operates on plain SaveState objects only
Required:  all persistence routes through GameSaveService → localStorage (key: 'dwa-save')
Required:  all UI→game commands route through commandQueue writable store; drained each frame by SpaceScene.drainCommandQueue()
Required:  all entity→UI data routes through Svelte writable stores via each entity's pushToStore() method
Required:  save schema migrations use a fallthrough switch in GameSaveService.migrate() — every version must fall through to the next
```

---

## Component Index

- **Entry Point** `/src/main.ts`
  - Inputs: browser DOM, `#hud` element
  - Outputs: Phaser.Game instance (canvas), three mounted Svelte components (Hud, EntityPanel, BasePanel)
  - Creates Phaser.Game with scenes [BootScene, MainMenuScene, SpaceScene] and RESIZE scale mode; mounts Svelte UI overlay onto `#hud`

- **BootScene** `/src/scenes/BootScene.ts`
  - Inputs: preloads the generated asset-harness atlases — `dwa_ships`
    (frames `hauler`, `miner`), `dwa_station` (frames `hub`, `tank`, `habitat`,
    `solar`, `dock`), `dwa_asteroids` (frames `iron`, `ice`, `silicates`,
    `rare-metals`, `unknown`), and `dwa_planet` (frame `planet`). All Apache/MIT
    (Z-Image clean stack).
  - Outputs: transitions to MainMenuScene

- **MainMenuScene** `/src/scenes/MainMenuScene.ts`
  - Inputs: `GameSaveService.hasSave()` (determines whether CONTINUE button appears)
  - Outputs: `GameSaveService.clear()` on NEW GAME; transitions to SpaceScene

- **SpaceScene** `/src/scenes/SpaceScene.ts` (~2580 lines — primary game orchestrator)
  - Inputs: commandQueue store (UI commands), keyboard/mouse/pointer events
  - Outputs: all Svelte writable stores; `GameSaveService.save()` every 10s and on `beforeunload`
  - Owns: entity lifecycle (spawn, update, destroy), camera, minimap, starfield, autoDispatch loop, save/load coordination
  - Key responsibilities: `create()` → load or generate world; `update(time, delta)` → per-frame state machine ticks; `autoDispatch()` → runs every `AUTO_DISPATCH_INTERVAL` (4s) via accumulator; `drainCommandQueue()` → translates UI commands to entity mutations; `buildSaveState()` / `loadFromSave()` → serialization boundary

- **dispatchLogic** `/src/scenes/dispatchLogic.ts`
  - Inputs: `SlottedShip[]`, `LocatedAsteroid[]`, `Set<string>` (occupied asteroid IDs)
  - Outputs: nearest eligible ship or asteroid (pure return values, no side effects)
  - Exports: `shipHasFreeMediumSlot(ship)`, `selectDispatchTarget(ships, target)`, `selectHaulerForDesignation(ships, hasStoredMiner, isMinerEmpty?)`, `selectDeployTarget(asteroids, ship, occupiedIds)` (the last is retained/tested but no longer called by the scene since deployment became designation-driven)
  - No Phaser dependency — uses structural interfaces `SlottedShip` and `LocatedAsteroid`; tested independently via Vitest

- **simLogic** `/src/scenes/simLogic.ts`
  - Pure, Phaser-free simulation *decisions* extracted from SpaceScene (single
    source of truth, unit-tested in `simLogic.test.ts`)
  - Exports: `designationsToRevert` (fulfilled→queued when an asteroid has no
    miner), `chooseDock` (free owned dock else public overflow), `shouldRelease
    WaitingHauler`, `planNetCollection` (collect up to free slots, orphan the rest)
  - Takes plain data / predicate closures; the scene applies the returned decisions

- **Asteroid** `/src/entities/Asteroid.ts`
  - Renders the generated `dwa_asteroids` atlas frame for its `resourceType`
    (WI 585); falls back to the procedural `asteroid-<type>` circle. A
    `ASTEROID_TEXTURE_SIZE/max(w,h)` art factor folded into `baseScale` keeps the
    prior on-screen size, so depletion scaling and the fixed-radius company ring are
    unchanged.
  - **Scan-gating (WI 586):** a *large* (high-yield) asteroid is **unknown** until
    scanned — `isUnknown()` = `sizeCategory === 'large' && !scanned`. While unknown
    it renders the `unknown` atlas frame and the EntityPanel hides type/quantity/
    composition ("scan to assess"); `reveal()` (called from `completeScan`) sets
    `scanned` and flips to the resource frame. Small/medium asteroids are always
    known (their composition stays scan-gated as before). No save-schema change —
    `scanned` already persists. Manual mining of an unknown is allowed; auto-designate
    (company arrivals only) is unaffected.
  - Inputs: `AsteroidData` (from worldGenerator), per-frame orbital angle update from SpaceScene
  - Outputs: `selectedAsteroid` store (when selected); emits `'asteroid-selected'` event; `currentQuantity` consumed by AutoMiner
  - Maintains Keplerian orbit: `angle += ORBITAL_K / radius^1.5 * dt`
  - **Composition (Phase 5):** carries a `composition` (`world/composition.ts`, pure/tested: dominant resource 0.6–0.85 + weight-distributed traces, normalized) and a `scanned` flag. `resourceType` is retained as the **dominant** (= max-fraction), so texture/mining/net behaviour is unchanged; composition is latent until the ore pipeline (WI 541) consumes it and the scanner (WI 542) reveals it. Company asteroids skew high-value via `COMPANY_RESOURCE_WEIGHTS`.
  - **Scanner (Phase 5, WI 542):** the mining designation queue is reused via `kind: 'mine' | 'scan'`. A reusable scanner probe is a `{kind:'scanner'}` small-slot payload bought into station storage (`base.scannerCount`) — small so it does not compete with miners for medium slots. `dispatchScans` (pure selection `dispatchLogic.selectScanHauler`, claim-reconcile for diverted haulers) sends a scanner-hauler (`Ship.isScanJob`) to a scan-designated asteroid; arrival branches to the `'scanning'` ship state; after `SCAN_DURATION_MS` the scene reveals + persists the asteroid's composition. Info-only — never gates mining; probe stays on the hauler (no detach/recovery).

- **Ship** `/src/entities/Ship.ts` — `Phaser.Physics.Arcade.Sprite`
  - Inputs: per-frame `update(dt)` call from SpaceScene, state mutations from SpaceScene methods
  - Outputs: `selectedShip` store via `pushToStore()`; emits `'begin-unloading'`, `'unload-complete'` events
  - State machine: `idle` → `traveling-to-asteroid` → `deploying-miner` → `waiting-at-asteroid` → `collecting-nets` → `traveling-to-base` → `unloading` → `idle`; also `responding-to-beacon` → `loading-miner`; `resupplying-miner`
  - Key fields: `attachmentPoints: AttachmentPoint[]` (1 small net-store + 1 small empty + 2 medium empty by default), `collectSlotProgress`, fuel/power tanks (`thrusterFuel`, `rcsFuel`, `battery`, `chargeToggle`), dock/hangar slot indices, and unload state (`unloadTimer` cargo bay; `attachUnloadTimer` + `attachUnloadActive` for the per-item timed attachment-unload phase). `drawSlotIndicators()` renders per-slot markers (empty / reserved / miner / net / net-store) below the hull each frame. `updateThrusters(dt)` drives two procedural particle emitters (texture `fx-particle`): a continuous exhaust plume off the hull rear while `inTransit()`, and intermittent RCS flank puffs while `inManeuver()` — both keyed to the states that consume `thrusterFuel`/`rcsFuel`.
  - Constants: `SHIP_SPEED=180`, `UNLOAD_DURATION=3s`, `ATTACHMENT_UNLOAD_DURATION=1.5s` (per item), `HAULER_ATTACH_MANEUVER_MS=1500`, fuel/RCS/battery rates, `CARGO_CAPACITY_TIERS=[200,350,550,800]`

- **AutoMiner** `/src/entities/AutoMiner.ts` — `Phaser.GameObjects.Image`
  - Inputs: `updateMining(dt, asteroid)` call from SpaceScene when state is `'mining'`
  - Outputs: `selectedAutoMiner` store; emits `'net-ejected'` (CargoNet instance), `'beacon-emitted'` ({id, x, y})
  - State machine: `in-transit` → `deploying` → `attaching` → `mining` → `ejecting-net` → `mining` | `net-starved`; also `standby-beaconing` (asteroid depleted, or battery ≤10% — a mining miner starts beaconing at ≤20% while still working, then stops mining at ≤10%), `drifting` (attach retry), `stuck` (retries exhausted with no free slot to recover into; with a free slot the miner is recovered to `in-transit` instead and its asteroid enters an attach cooldown — see `ATTACH_COOLDOWN_MS`), `dark` (battery exhausted — beacon silent, recoverable by manual dispatch). `beaconReason` (`depleted` | `low-battery` | `stuck`) records why the miner is advertising.
  - Constants: `MINER_RATE=5` units/s, `NET_CAPACITY=50` units, `MINER_INITIAL_NETS=3`, `ATTACH_FAILURE_PROB=0.25`, `ATTACH_MAX_RETRIES=3`, `BEACON_INTERVAL_MS=3000`
  - Free-orbit fields: `freeOrbitalRadius`, `freeOrbitalAngle` — used when asteroid depletes and miner drifts unattached

- **CargoNet** `/src/entities/CargoNet.ts` — `Phaser.GameObjects.Image`
  - Inputs: created by `AutoMiner.ejectNet()` or restored from save
  - **Phase 5:** carries **ore** — a `composition` (the source asteroid's, from the miner's `activeComposition`) + `quantity`; `resourceType` is the dominant, kept for display/colour. On unload, ore is deposited into the Base **raw-ore silo** (`acceptOre`), not separated resources into the resource silo.
  - States: `full-tethered` (at a miner, or orphaned in free-orbit — both visible), `in-transit` (carried on a hauler slot), `unloading` (at base)
  - Free-orbit fields (`freeOrbitalRadius`/`freeOrbitalAngle`) + `designatedForCollection`: when a miner is recovered without all its nets, the leftover nets are orphaned to free-orbit and stay recoverable via the player "designate for collection" action (never destroyed)
  - Constants: `NET_LEAKAGE_FRACTION=0.05` (quantity loss on collection), `NET_COLLECT_DURATION_MS=1500`

- **Base** `/src/entities/Base.ts` — `Phaser.GameObjects.Container`
  - **Modular station render (WI 580):** the base is a container composed from the
    `dwa_station` atlas — a central `hub` child plus four radiating module sprites
    (`solar` N, `tank` W, `habitat` E, `dock` S). Each radiating module is
    **ownership-driven**: shown iff its backing field is `> 0` (`solarCapacity`,
    `propellantCapacity`, `ownedHangarCount`, `ownedDockCount`), re-evaluated by
    `syncModules()` on every `pushToStore()`. Visibility derives from
    already-persisted fields — **no save-schema change**. A container-local circular
    hit-area covers the whole assembly so any module click selects the base; orbit
    moves the container and children inherit the transform. Falls back to the
    procedural `BASE_TEXTURE_KEY` circle child if the atlas is absent.
  - Inputs: `acceptCargo()`, `sellResource()`, `commissionShip()`, `storeAutoMiner()`, station purchases (owned docks/hangars/miner slots, pressurization) from SpaceScene
  - Outputs: `baseState` store via `pushToStore()` (storage, credits, fleet size, station miner count/slots, owned dock/hangar counts, pressurization, autoDesignate)
  - **Orbits the planet**: `orbitalRadius`/`orbitalAngle` + `advanceOrbit(dt)`
    (Keplerian, `BASE_ORBIT_K`) advanced each frame; `orbitalAngle` persisted. The
    scene's `updateBaseAttachments()` moves the label, slot/hangar markers, docked/
    serviced ships, and station-keeping idle ships with it.
  - Station: **docks are effectively infinite** — a returning hauler always docks at
    a free owned dock (no fee) else a public dock (fee, unlimited, stacked); a ship
    carries `dockIsPublic` and `chargeDockFee(isPublic)` charges accordingly. Owned
    docks (occupancy-tracked) and hangar bays (finite, slow: upgrade/repair/storage)
    plus a station autominer inventory (`stationMinerIds`, cap
    `STATION_MINER_SLOT_CAP`). Autominers are **bought into station storage**
    (refused when full).
  - Resource silo: `storage` (per-resource) bounded by mutable `storageCapacity`,
    raised by `purchaseSiloCapacity()` (+`SILO_CAPACITY_INCREMENT`). The silo
    **soft-caps**: `acceptCargo()` always accepts an in-flight unload (may push
    transiently over capacity); `isSiloFull()` instead halts new acquisition
    (auto-designate) upstream. Selling stays explicit per-resource (`sellResource`).
  - Dynamic sell pricing: `markets` (per-resource `ResourceMarket` from
    `world/market.ts`, a pure/tested module) — selling depresses that resource's
    price (raises `pressure`), which decays back toward baseline over time
    (`recoverMarkets(dt)` each frame). `sellResource` realizes at the live price;
    `pushMarketToStore()` mirrors current/baseline to the `resourceMarket` store.
    Baseline = `RESOURCE_SELL_PRICES`. Sell pricing is a **stateful** resolver
    (distinct from the static `getPrice` fee seam).
  - Cost levers: per-lever capacity (`solarCapacity`/`propellantCapacity`/`foundryCapacity`)
    raised by `investInfrastructure(lever)` (spends silicates/ice/iron from the
    silo via `world/infrastructure.ts`). Effective consumable price =
    `effectivePrice(staticBase, capacity, demand)` = base × max(FLOOR, demand/(demand+capacity)).
    Demand is owned-fleet count (autominers → electricity & repair; haulers →
    fuel/RCS), computed in `SpaceScene` (which owns the fleet collections); the
    scene rewrites the three sinks (recharge, dock-refuel, repair) to charge the
    effective price and pushes the `infrastructure` store. Idle-safe: demand is a
    count, prices only paid on activity.
  - Market events: seeded, persisted exogenous shocks (`world/marketEvents.ts`,
    pure/tested) that shift a resource's sell baseline for a window (spike/glut/
    drought). The scene schedules them from a persisted `eventSeed` counter +
    `nextEventAt` (deterministic, reload-resumes), expires by window, and overlays
    multipliers via `Base.applyEventMultipliers` (baseline = `RESOURCE_SELL_PRICES`
    × event multiplier), composing with the WI 526 pressure. `activeMarketEvents`
    store drives the HUD readout. Events shift price only — never a charge.
  - Raw-ore silo & processing (Phase 5): `oreQuantity` + aggregate `oreComposition`
    bounded by `oreSiloCapacity` (`acceptOre` blends, `drainOre` removes,
    `isOreSiloFull` gates mining back-pressure). The scene's `processOre()` drains
    ore at `PROCESSING_RATE`, separates it into resources by composition
    (`world/processing.ts`, pure/tested — conserves mass) into the resource silo,
    and charges a flat `processing-fee` (1cr/unit, WI 568 — electricity term dropped
    as a balance tweak); it pauses when the
    resource silo is full (back-pressure chain: resource full → processing pauses →
    ore silo fills → mining halts). `oreSilo` store drives the UI. Idle-safe: cost
    only while consuming ore.
  - Constants: `BASE_STORAGE_CAPACITY`, `SILO_CAPACITY_INCREMENT`, `ORE_SILO_CAPACITY`,
    `ORE_SILO_INCREMENT`, `STARTING_CREDITS`,
    `SHIP_COMMISSION_COST`, `BASE_ORBIT_K` (and station purchase costs)

- **Planet** `/src/entities/Planet.ts`
  - Visual-only; at world origin; no game logic. Renders the generated `dwa_planet`
    sprite (WI 584) sized to `PLANET_RADIUS` and slowly z-rotating (looping tween;
    off-centre storm makes the spin read); procedural-texture fallback. Rotation is
    cosmetic — the slowdown uses the separate `PROXIMITY_PLANET_RADIUS`.

- **GameSaveService** `/src/services/GameSaveService.ts`
  - Inputs: `SaveState` plain objects; localStorage
  - Outputs: `SaveState | null` from `load()`; persists to localStorage on `save()`
  - Schema version: 28 (current); `migrate()` uses a fallthrough switch from v1→v28; each case upgrades one concern and falls through
  - Key migrations: v4 removed direct-mining fields + added attachment points; v6 split tetheredNets into a top-level cargoNets array; v11 cleared legacy `cargoContents`; v12+ added the Phase 3 fields (designations, station equipment, fuel/power, condition); v22 persists base `storageCapacity`; v23 persists per-resource `marketPressure`; v24 persists per-lever infrastructure capacities; v25 persists top-level `marketEvents`; v26 adds asteroid `composition` + `scanned`; v27 is the ore-pipeline cutover (net `composition` pure-from-resourceType, miner `activeComposition`, base raw-ore silo); v28 is scanner support (designation `kind='mine'`, base `scannerCount`, ship `isScanJob`). Additive optional fields introduced later are loaded with `?? default` and do not require a schema bump.

- **gameState** `/src/state/gameState.ts`
  - Type definitions only: `SaveState`, `ShipSnapshot`, `AutoMinerSnapshot`, `CargoNetSnapshot`, `AsteroidSnapshot`, `BaseSnapshot`
  - Not a Svelte store — holds the initial/default plain object for save state construction

- **attachmentTypes** `/src/state/attachmentTypes.ts`
  - Types: `AttachmentPoint`, `AttachmentPointSize`, `NetStorePayload`, `AutoMinerPayload`, `CargoNetPayload`, `ReservedPayload` (a slot committed to an incoming miner/net before pickup — non-null so free-slot checks treat it as occupied; `kind` never matches a real payload), `AttachmentPayload`
  - `makeDefaultLoadout()`: returns `[small/net-store, small/empty, medium/empty, medium/empty]`
  - `NET_STORE_MAX_NETS=12`

- **shipStore** `/src/state/shipStore.ts`
  - Writable stores: `selectedShip: SelectedShipData | null`, `selectedAsteroid: SelectedAsteroidData | null`
  - `SelectedShipData` includes `collectSlotProgress: Record<number, number>` (keyed by attachment point array index)
  - Exports `ShipState` union type used by Ship entity and SpaceScene

- **autoMinerStore** `/src/state/autoMinerStore.ts`
  - Writable stores: `selectedAutoMiner`, `activeBeacons: BeaconData[]`, `autoMinerSummary: AutoMinerSummary`, `attachNotifications: AttachNotification[]`, `minerAvailability: MinerAvailability` (outstanding designations vs. available miners — drives the shortage indicator)

- **cargoNetStore** `/src/state/cargoNetStore.ts`
  - Writable store: `selectedCargoNet: SelectedCargoNetData | null` (includes `orphaned` + `designatedForCollection`)

- **designationStore** `/src/state/designationStore.ts`
  - Writable store: `designationQueue: MiningDesignation[]`
  - `MiningDesignation.status`: `queued | claimed | fulfilled` (fulfilled = a miner is deployed/mining; the entry persists until the asteroid depletes, marking it "being mined" and blocking re-designation)

- **baseStore** `/src/state/baseStore.ts`
  - Writable stores: `baseState: BaseState`, `basePanelOpen: boolean`, `stationUsage: StationUsage` (miner storage used/total; dock & hangar in-use/total/public — drives the Station Usage panel)
  - Economy stores (Phase 4): `resourceMarket` (per-resource current/baseline sell price), `infrastructure` (per-lever capacity/demand/effective-vs-base price), `activeMarketEvents` (HUD event list), `priceHistory` (per-resource bounded `{t,current,baseline}` series for the sparklines — **ephemeral, not persisted**)
  - Industry stores (Phase 5): `oreSilo` (raw-ore quantity/capacity/composition + processing status)

- **commandStore** `/src/state/commandStore.ts`
  - Writable store: `commandQueue: GameCommand[]`
  - `GameCommand` union: `sellResource`, `commissionShip`, `manualSave`, `upgradeShip`, `resupplyMiner`, `respondToBeacon`, `purchaseMiner`, `collectNets`, `purchaseMinerSlot`, `purchaseOwnedDock`, `purchaseHangar`, `purchasePressurization`, `designateAsteroid`, `undesignateAsteroid`, `collectNet`, `repairMiner`, `toggleAutoDesignate`, `toggleMinerCharge`

- **fleetStore** `/src/state/fleetStore.ts`
  - Writable store: `fleetSummary: { idle, active, returning }`

- **worldConfig** `/src/world/worldConfig.ts`
  - Constants: orbit radii, company arrival intervals, asteroid size configs, resource weights and sell prices
  - Types: `ResourceType` (`'iron' | 'ice' | 'silicates' | 'rare-metals'`), `SizeCategory` (`'small' | 'medium' | 'large'`)

- **worldGenerator** `/src/world/worldGenerator.ts`
  - Inputs: numeric seed
  - Outputs: `AsteroidData[]` (moon debris field + company asteroids)
  - `generateWorld(seed)`: moon debris cluster at `MOON_ORBIT_RADIUS=2200` + 4–8 company asteroids
  - `generateCompanyAsteroid(seed)`: single company asteroid for dynamic arrival events

- **rng** `/src/world/rng.ts`
  - Seeded RNG utilities: `createRng(seed)`, `rngInt()`, `rngFloat()`, `rngWeighted()`
  - Tested independently: `/src/world/rng.test.ts`

- **movement** `/src/world/movement.ts` (pure/tested, WI 581)
  - `flybyScale(speedMultiplier, minSpeed, maxScale)`: hauler display-scale for the
    fly-by "looming" effect — 1.0× at cruise → `maxScale` (1.5×) at full slowdown.
  - `asteroidProximityRadius(baseRadius, size)`: per-asteroid slowdown radius scaled
    by `SIZE_CONFIGS[size].scale` (small 60 / medium 120 / large 192; planet 600).
  - Consumed by `SpaceScene.computeSpeedMultiplier` (size-scaled asteroid radius) and
    the per-frame ship loop (`Ship.setFlybyScale` multiplies the spawn scale).

- **Hud** `/src/ui/Hud.svelte`
  - Reads: `baseState`, `fleetSummary`, `autoMinerSummary`, `activeBeacons`, `attachNotifications`
  - Writes: `commandQueue` (manualSave)
  - Displays: resource storage, credits, fleet counts (idle/active/returning), miner counts (mining/net-starved/beaconing/dark), beacon list, attach notifications

- **EntityPanel** `/src/ui/EntityPanel.svelte`
  - Reads: `selectedShip`, `selectedAsteroid`, `selectedAutoMiner`, `selectedCargoNet`, `designationQueue`
  - Writes: `commandQueue` (resupplyMiner, respondToBeacon, collectNets, upgradeShip, designate/un-designate asteroid, collectNet, repairMiner, toggleMinerCharge)
  - Displays: ship detail (state, cargo, attachment slots, fuel/RCS/battery meters), asteroid detail (+ designate / "being mined"), miner detail (condition/battery/RCS), net detail (+ "designate for collection" when orphaned)

- **BasePanel** `/src/ui/BasePanel.svelte`
  - Reads: `baseState`, `basePanelOpen`, `selectedShip`, `stationUsage`
  - Writes: `commandQueue` (sellResource, investInfrastructure, commissionShip, upgradeShip, purchaseMiner into Base storage, purchase owned dock/hangar/miner-slot/pressurization/silo-capacity)
  - Displays: market (live sell prices + Sell/Invest), PRICE HISTORY sparklines (`Sparkline.svelte`, hand-rolled SVG from `priceHistory`), INFRASTRUCTURE (cost-lever capacity/demand/price), ship commission, cargo upgrades, station purchases, and a Station Usage section (miner storage; dock/hangar in-use with public-fee notes)

---

## Dependency Chains

```
/src/main.ts
  → /src/scenes/BootScene.ts, MainMenuScene.ts, SpaceScene.ts
  → /src/ui/Hud.svelte, EntityPanel.svelte, BasePanel.svelte

/src/scenes/SpaceScene.ts
  → /src/entities/Asteroid.ts, Ship.ts, AutoMiner.ts, CargoNet.ts, Base.ts, Planet.ts
  → /src/scenes/dispatchLogic.ts
  → /src/services/GameSaveService.ts
  → /src/state/ (all stores)
  → /src/world/worldConfig.ts, worldGenerator.ts

/src/entities/Ship.ts
  → /src/entities/Base.ts (constructor ref for base position)
  → /src/state/shipStore.ts, attachmentTypes.ts
  → /src/world/worldConfig.ts (ResourceType)

/src/entities/AutoMiner.ts
  → /src/entities/CargoNet.ts (ejectNet creates instance)
  → /src/entities/Asteroid.ts (updateMining accepts Asteroid)
  → /src/state/autoMinerStore.ts

/src/entities/CargoNet.ts
  → /src/state/cargoNetStore.ts
  → /src/world/worldConfig.ts (ResourceType)

/src/entities/Base.ts
  → /src/state/baseStore.ts
  → /src/world/worldConfig.ts (ResourceType, RESOURCE_SELL_PRICES)
  → /src/entities/AutoMiner.ts (AUTOMINER_PURCHASE_COST)

/src/scenes/dispatchLogic.ts
  → /src/state/attachmentTypes.ts (AttachmentPoint interface only)

/src/services/GameSaveService.ts
  → /src/state/gameState.ts (SaveState type)
  → /src/state/attachmentTypes.ts (makeDefaultLoadout — used in v4→v5 migration)

/src/ui/*.svelte
  → /src/state/ (all stores)
  → /src/world/worldConfig.ts (ResourceType, RESOURCE_SELL_PRICES)
  → /src/entities/AutoMiner.ts, Ship.ts, Base.ts (exported constants only — no class refs)

/src/world/worldGenerator.ts
  → /src/world/worldConfig.ts
  → /src/world/rng.ts
```

---

## Linear Data Flow

### Game boot and world initialization
```
1. main.ts: Phaser.Game constructed with scene list; Svelte components mounted on #hud
2. BootScene.create(): immediately starts MainMenuScene
3. MainMenuScene.create(): GameSaveService.hasSave() determines button layout
4. Player clicks CONTINUE or NEW GAME → SpaceScene starts
5. SpaceScene.create():
   a. Procedural textures generated as fallbacks (miner, net, base circle, asteroid circles, planet); when the preloaded atlases are present the hauler (`dwa_ships`), base station (`dwa_station`), asteroids (`dwa_asteroids`), and planet (`dwa_planet`) render from them instead
   b. GameSaveService.load() → if save exists: loadFromSave(save); else: spawnWorld() using worldGenerator.generateWorld(worldSeed)
   c. Camera configured; input handlers attached; beforeunload handler registered
```

### AutoMiner mining lifecycle (designation-driven)
```
1. Player (or auto-designate-arrivals) designates an asteroid → 'designateAsteroid'
   command → addDesignation() enqueues a MiningDesignation (status 'queued').
2. SpaceScene.autoDispatch() (every 4s) does, in order:
   a. Idle carriers at base: recharge their in-transit miners and store them in
      station storage (deployment never auto-targets arbitrary asteroids).
   b. Reconcile fulfilled designations: a 'fulfilled' designation whose asteroid
      has no attached miner reverts to 'queued' (re-dispatch).
   c. For each queued designation (skipping asteroids on attach cooldown):
      selectHaulerForDesignation() picks an idle hauler — preferring one already
      carrying an (empty) miner, else routing one to fetch a stored miner first;
      claimDesignation() marks it 'claimed'.
   d. Net-starved / full-net miners → dispatch a hauler to the asteroid.
   e. Designated orphaned nets → initiateCollectOrphanNet() sends a hauler.
3. Carrier arrives within MINER_DEPLOY_PROXIMITY → performDeploy(): tween miner to
   asteroid; fulfillDesignation() (→ 'fulfilled'); beginAttachAttempt()
   (ATTACH_FAILURE_PROB, up to ATTACH_MAX_RETRIES; condition raises fail chance,
   below threshold a catastrophic-loss roll). On success: state 'mining'. On
   exhaustion: hauler returns to base, the asteroid gets an ATTACH_COOLDOWN_MS.
4. AutoMiner.updateMining(dt, asteroid): extracts MINER_RATE; ejects a CargoNet at
   NET_CAPACITY (→ tethered); drains battery (≤20% begins beaconing while mining;
   ≤10% stops mining; 0 → 'dark'); depletion → 'standby-beaconing'.
5. Beacons fire 'beacon-emitted' every BEACON_INTERVAL_MS → activeBeacons store.
6. Collection: beginCollecting() reserves a slot per net and tweens each over
   NET_COLLECT_DURATION_MS, converting the reservation to the real cargo-net on
   completion (per-slot amber progress bars).
7. Recovery: a hauler dispatched to a beacon reserves a medium slot on dispatch
   (initiateRespondToBeacon); performRecovery() resolves the reservation to the
   real miner on arrival. A miner's nets that do not fit are orphaned to free-orbit
   (recoverable), never destroyed.
8. Return + unload at base: cargo bay drains over UNLOAD_DURATION; the per-item
   attachment-unload phase (processAttachmentUnloadTick) drains one net OR stores+
   recharges one in-transit miner per ATTACHMENT_UNLOAD_DURATION. Ship → 'idle'
   when both are done.
```

### UI command flow
```
1. User clicks action in EntityPanel or BasePanel → commandQueue.update(q => [...q, cmd])
2. SpaceScene.update() → drainCommandQueue(): commandQueue.update(q => []) → handleCommand(cmd) for each
3. handleCommand() dispatches to: addDesignation()/removeDesignation(),
   initiateCollectNets(), initiateResupplyMiner(), initiateRespondToBeacon(),
   collectNet (designate orphaned net), performPurchaseMiner(), commissionNewShip(),
   initiateShipUpgrade(), initiateRepair(), station purchases, toggles, etc.
```

### Save / load cycle
```
1. SpaceScene.update(): autoSaveAccumulator += dt; when >= 10s → GameSaveService.save(buildSaveState())
2. buildSaveState(): snapshots all entities to plain SaveState object (schemaVersion=28)
3. GameSaveService.save(): JSON.stringify(SaveState) → localStorage['dwa-save']
4. On load: GameSaveService.load() → JSON.parse → migrate() fallthrough switch upgrades schema → return SaveState
5. SpaceScene.loadFromSave(): re-creates all entity instances from snapshot data; restores timers and states
```

---

## Phase 3 Systems

- **Mining designation queue** (`designationStore`): clicking an asteroid enqueues
  a `MiningDesignation`. Lifecycle `queued → claimed → fulfilled`; a fulfilled
  entry persists (asteroid "being mined", re-designation blocked) until depletion
  retires it. autoDispatch reconciles a fulfilled designation back to queued if its
  asteroid loses its miner. Deployment is designation-only — no auto-deploy to
  arbitrary asteroids.
- **Attachment slot reservation model**: a slot a hauler is travelling to fill
  holds a `reserved` payload (not the real miner/net) until pickup, resolved via
  `resolveReservation`/`claimFreeMediumSlot`. Over-capacity recovery orphans
  leftover nets to free-orbit (player-designated collection), never destroying
  them.
- **Pricing seam** (`/src/world/pricingSeam.ts`): single `getPrice(key)` lookup for
  all consumable prices and service fees (fixed values in Phase 3; the integration
  point for Phase 4 dynamic pricing).
- **Condition / repair**: each autominer has a condition value; failed attaches
  degrade it along a bounded penalty curve (attach-fail + mining-rate, capped),
  and below a low threshold an attach may catastrophically destroy the miner.
  Repair is a timed hangar-bay service.
- **Station services**: **docks are effectively infinite** — free owned docks
  (occupancy-tracked) preferred, else unlimited public docks (per-use fee, stacked
  on one ring position); `dockIsPublic` drives the fee. Hangar bays (few, slow —
  upgrade, repair, miner storage) remain finite, public or owned. `stationUsage`
  surfaces owned-docks-used/total and public docks in use.
- **Base orbit**: the base orbits the planet; all base-relative geometry (slots,
  hangars, docked ships, idle station-keeping ships, free-orbit fallbacks,
  proximity, minimap) derives from the live base position each frame.
- **Fuel & power**: haulers hold thruster fuel (transit, trickle-charges battery),
  RCS gas (maneuvering, incl. the attach maneuver), and a small battery;
  autominers hold a large battery (mining/beaconing drain) and an RCS tank
  (attaching). Recharge is the priced electricity sink; parked fleet draws nothing
  (idle-cost guarantee).
- **Dev tooling** (F9, default on in development): a per-tick **invariant sweep**
  (`checkInvariants`, end of autoDispatch) logs structural violations at their
  origin, and a **debug overlay** (`updateDebugOverlay`) draws per-entity state
  labels. The bug-prone decisions are also unit-tested via `simLogic`. The sweep
  includes **economy invariants** (`world/economyInvariants.ts`, pure/tested:
  non-negative silo/capacity/pressure, positive baseline, current ≤ baseline,
  active-event window validity — over-cap silo is legal and excluded), and the
  overlay shows an economy readout (prices, lever capacities, active events) near
  the base. The sweep also includes **industry invariants** (`world/industryInvariants.ts`,
  pure/tested: non-negative ore, normalized ore/asteroid compositions, scan-queue
  references valid), and the overlay readout adds ore level / probes / scanned
  count. All Phase 4–5 economy/industry logic lives in pure, unit-tested `world/`
  modules (`market`, `infrastructure`, `marketEvents`, `history`, `economyInvariants`,
  `composition`, `processing`, `industryInvariants`). Invariant warnings are also
  recorded (deduped) in the `invariantLog` store, with HUD **Copy / Clear** buttons
  (debug-only) to copy a timestamped report to the clipboard.

---

## Known Gaps

- `Planet.ts` not traced — visual only; no inputs or outputs to document
- Minimap rendering (`drawMinimap()`) is fully internal to SpaceScene — no external interface
- Tests (`make test`, 50): `rng.test.ts` (seeded RNG), `dispatchLogic.test.ts`
  (dispatch pure functions), `simLogic.test.ts` (designation reconcile, dock
  choice, waiting-release, net collection split). Scene-bound behavior is verified
  manually + by the in-game invariant sweep.
- The base now orbits the planet (WI-458); `BASE_X/BASE_Y` is only the initial
  orbit point. A full end-to-end headless simulation test remains a future option
  (the pure `simLogic` decisions are the foundation).
- The `#5`/`#8` slot-overrun reports are believed closed by the reservation model (WI-467/468); no deterministic repro was captured
