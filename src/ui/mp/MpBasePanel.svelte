<script lang="ts">
  import { mpSnapshot, mpYouCorpId, mpConnection, mpBasePanelOpen, mpSelectedShip } from '../../state/mpStore'
  import { sendCommand } from '../../net/mpClient'
  import {
    SHIP_COST, MINER_COST, MAX_SHIPS_PER_CORP, REFUEL_FEE_PER_UNIT, REPAIR_FEE_PER_POINT,
    STATION_MINER_SLOT_CAP, MINER_SLOT_COST, MAX_OWNED_DOCKS, DOCK_COST, MAX_OWNED_HANGARS,
    HANGAR_COST, PRESSURIZATION_COST, MAX_CARGO_LEVEL, CARGO_CAPACITY_TIERS, CARGO_UPGRADE_COSTS,
  } from '../../../shared/mpConfig'
  import { RESOURCE_SELL_PRICES, type ResourceType } from '../../world/worldConfig'

  const RESOURCE_LABELS: Record<ResourceType, string> = {
    iron: 'Iron',
    ice: 'Ice',
    silicates: 'Silicates',
    'rare-metals': 'Rare Metals',
  }
  const RESOURCE_ORDER: ResourceType[] = ['iron', 'ice', 'silicates', 'rare-metals']

  $: world = $mpSnapshot
  $: me = world ? world.corps.find((c) => c.id === $mpYouCorpId) ?? null : null
  $: show = $mpConnection === 'connected' && $mpBasePanelOpen && me && me.alive
  $: stored = me ? Object.values(me.storage).reduce((s, n) => s + (n ?? 0), 0) : 0
  $: deployed = me ? me.miners.length : 0
  $: selShip = me ? me.ships.find((s) => s.id === $mpSelectedShip) ?? null : null
  $: events = world?.marketEvents ?? []
  function eventFor(type: ResourceType) {
    return events.find((e) => e.resourceType === type) ?? null
  }

  function close(): void {
    mpBasePanelOpen.set(false)
  }
  function sell(resource: ResourceType): void {
    sendCommand({ kind: 'sell', resource })
  }
  function buyShip(): void {
    sendCommand({ kind: 'buyShip' })
  }
  function buyMiner(): void {
    sendCommand({ kind: 'buyMiner' })
  }
  function buyMinerSlot(): void {
    sendCommand({ kind: 'buyMinerSlot' })
  }
  function buyDock(): void {
    sendCommand({ kind: 'buyDock' })
  }
  function buyHangar(): void {
    sendCommand({ kind: 'buyHangar' })
  }
  function buyPress(): void {
    sendCommand({ kind: 'buyPressurization' })
  }
  function upgradeCargo(id: string): void {
    sendCommand({ kind: 'upgradeShip', shipId: id })
  }
  function toggleAuto(): void {
    sendCommand({ kind: 'toggleAutoDesignate' })
  }
</script>

{#if show && me}
  <div class="panel">
    <div class="header">
      <span class="title">BASE · {me.name}</span>
      <button class="x" on:click={close}>✕</button>
    </div>
    <div class="row"><span class="label">Credits</span><span class="value credits">{me.credits}</span></div>
    <div class="row"><span class="label">Storage</span><span class="value">{Math.floor(stored)} / {me.storageCapacity}</span></div>
    <div class="row"><span class="label">Fleet</span><span class="value">{me.ships.length} hauler{me.ships.length === 1 ? '' : 's'} · {me.minerCount} miner{me.minerCount === 1 ? '' : 's'} ({deployed} deployed)</span></div>

    <div class="sec">MARKET <span class="sec-note">live price · dumping depresses it</span></div>
    {#each RESOURCE_ORDER as type}
      {@const qty = Math.floor(me.storage[type] ?? 0)}
      {@const p = me.prices[type]}
      {@const ev = eventFor(type)}
      <div class="row mkt" class:off={qty <= 0}>
        <span class="label resource-{type}">{RESOURCE_LABELS[type]}</span>
        <span class="qty">{qty}</span>
        <span class="price" class:lo={p.current < p.baseline - 0.05}>
          @{p.current}cr{#if ev}<span class="ev" class:up={ev.multiplier >= 1} title="{ev.type} ×{ev.multiplier}">{ev.multiplier >= 1 ? '▲' : '▼'}</span>{/if}
        </span>
        <button class="btn" disabled={qty <= 0} on:click={() => sell(type)}>Sell</button>
      </div>
    {/each}

    <div class="sec">SHIPYARD</div>
    <div class="row buy" class:off={me.credits < SHIP_COST || me.ships.length >= MAX_SHIPS_PER_CORP}>
      <span class="label">Hauler</span>
      <span class="price">{SHIP_COST}cr</span>
      <button class="btn" disabled={me.credits < SHIP_COST || me.ships.length >= MAX_SHIPS_PER_CORP} on:click={buyShip}>
        {me.ships.length >= MAX_SHIPS_PER_CORP ? 'Max' : 'Commission'}
      </button>
    </div>

    <div class="sec">EQUIPMENT</div>
    <div class="row buy" class:off={me.credits < MINER_COST || me.minerCount >= me.minerSlots}>
      <span class="label">AutoMiner</span>
      <span class="price">{me.minerCount}/{me.minerSlots} · {MINER_COST}cr</span>
      <button class="btn" disabled={me.credits < MINER_COST || me.minerCount >= me.minerSlots} on:click={buyMiner}>
        {me.minerCount >= me.minerSlots ? 'No slot' : 'Buy'}
      </button>
    </div>

    {#if selShip}
      <div class="sec">UPGRADES · {selShip.name}</div>
      {#if selShip.cargoLevel < MAX_CARGO_LEVEL}
        <div class="row buy" class:off={me.credits < CARGO_UPGRADE_COSTS[selShip.cargoLevel]}>
          <span class="label">Cargo hold</span>
          <span class="price">→{CARGO_CAPACITY_TIERS[selShip.cargoLevel + 1]}t · {CARGO_UPGRADE_COSTS[selShip.cargoLevel]}cr</span>
          <button class="btn" disabled={me.credits < CARGO_UPGRADE_COSTS[selShip.cargoLevel]} on:click={() => upgradeCargo(selShip.id)}>Buy</button>
        </div>
      {:else}
        <div class="row svc"><span class="label">Cargo hold</span><span class="value">MAX ({selShip.cargoCapacity}t)</span></div>
      {/if}
    {/if}

    <div class="sec">STATION</div>
    <div class="row buy" class:off={me.minerSlots >= STATION_MINER_SLOT_CAP || me.credits < MINER_SLOT_COST}>
      <span class="label">Miner slot</span>
      <span class="price">{me.minerSlots}/{STATION_MINER_SLOT_CAP} · {MINER_SLOT_COST}cr</span>
      <button class="btn" disabled={me.minerSlots >= STATION_MINER_SLOT_CAP || me.credits < MINER_SLOT_COST} on:click={buyMinerSlot}>{me.minerSlots >= STATION_MINER_SLOT_CAP ? 'Max' : 'Buy'}</button>
    </div>
    <div class="row buy" class:off={me.ownedDocks >= MAX_OWNED_DOCKS || me.credits < DOCK_COST}>
      <span class="label">Dock · cheaper refuel</span>
      <span class="price">{me.ownedDocks}/{MAX_OWNED_DOCKS} · {DOCK_COST}cr</span>
      <button class="btn" disabled={me.ownedDocks >= MAX_OWNED_DOCKS || me.credits < DOCK_COST} on:click={buyDock}>{me.ownedDocks >= MAX_OWNED_DOCKS ? 'Max' : 'Buy'}</button>
    </div>
    <div class="row buy" class:off={me.ownedHangars >= MAX_OWNED_HANGARS || me.credits < HANGAR_COST}>
      <span class="label">Hangar · cheaper repair</span>
      <span class="price">{me.ownedHangars}/{MAX_OWNED_HANGARS} · {HANGAR_COST}cr</span>
      <button class="btn" disabled={me.ownedHangars >= MAX_OWNED_HANGARS || me.credits < HANGAR_COST} on:click={buyHangar}>{me.ownedHangars >= MAX_OWNED_HANGARS ? 'Max' : 'Buy'}</button>
    </div>
    <div class="row buy" class:off={me.pressurized || me.ownedHangars < 1 || me.credits < PRESSURIZATION_COST}>
      <span class="label">Pressurize bay · ½ repair</span>
      {#if me.pressurized}
        <span class="price">DONE</span><button class="btn" disabled>✓</button>
      {:else}
        <span class="price">{PRESSURIZATION_COST}cr</span>
        <button class="btn" disabled={me.ownedHangars < 1 || me.credits < PRESSURIZATION_COST} on:click={buyPress}>Buy</button>
      {/if}
    </div>
    <div class="row svc"><span class="label">Service fees · refuel {REFUEL_FEE_PER_UNIT}/u · repair {REPAIR_FEE_PER_POINT}/pt</span></div>
    <div class="row svc"><span class="label">Spent on services</span><span class="value credits">{me.serviceSpend}cr</span></div>

    <div class="sec">AUTOMATION</div>
    <div class="row buy">
      <span class="label">Auto-designate</span>
      <span class="price">{me.autoDesignate ? 'ON' : 'OFF'}</span>
      <button class="btn" on:click={toggleAuto}>{me.autoDesignate ? 'Disable' : 'Enable'}</button>
    </div>

    <div class="hint">
      {#if me.minerCount === 0}
        Buy an AutoMiner, then claim an asteroid — a hauler carries the miner out and deploys it.
      {:else if me.autoDesignate}
        Auto-designate is ON — idle haulers carry miners to the richest free asteroids for you.
      {:else}
        Haulers carry miners to your claimed asteroids and shuttle the nets back here. Sell ore for credits.
      {/if}
    </div>
  </div>
{/if}

<style>
  .panel {
    position: absolute;
    bottom: 16px;
    left: 16px;
    width: 260px;
    max-height: calc(100vh - 88px);
    overflow-y: auto;
    background: rgba(5, 10, 20, 0.92);
    border: 1px solid #2a4a6a;
    border-radius: 6px;
    padding: 12px 14px;
    font-family: monospace;
    font-size: 12px;
    color: #aaccee;
    pointer-events: auto;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .title {
    font-size: 13px;
    color: #44aaff;
    letter-spacing: 0.05em;
  }
  .x {
    background: none;
    border: none;
    color: #6a8a9a;
    font-family: monospace;
    cursor: pointer;
  }
  .x:hover {
    color: #aaccee;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }
  .label {
    color: #6a8a9a;
    flex: 1;
  }
  .value {
    color: #cce0f0;
  }
  .credits {
    color: #ffdd88;
  }
  .sec {
    font-size: 10px;
    color: #3a6a8a;
    letter-spacing: 0.08em;
    margin-top: 10px;
    margin-bottom: 4px;
    border-top: 1px solid #1a3a5a;
    padding-top: 6px;
  }
  .mkt .qty {
    color: #cce0f0;
    min-width: 34px;
    text-align: right;
  }
  .price {
    color: #6a8a9a;
    font-size: 10px;
    min-width: 42px;
  }
  .price.lo {
    color: #d88a4a; /* depressed by your own recent dumping */
  }
  .ev {
    margin-left: 2px;
    font-size: 9px;
    color: #d88a4a; /* glut/drought pulling the baseline down */
  }
  .ev.up {
    color: #6ad88a; /* spike/drought pushing the baseline up */
  }
  .sec-note {
    color: #2f5570;
    letter-spacing: 0;
    text-transform: none;
    font-size: 9px;
  }
  .buy,
  .mkt {
    justify-content: space-between;
  }
  .btn {
    background: rgba(40, 80, 120, 0.6);
    border: 1px solid #2a5a8a;
    border-radius: 3px;
    color: #aaccee;
    font-family: monospace;
    font-size: 10px;
    cursor: pointer;
    padding: 2px 7px;
    white-space: nowrap;
  }
  .btn:hover:not(:disabled) {
    background: rgba(60, 100, 150, 0.7);
  }
  .btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .off .label,
  .off .qty,
  .off .price {
    opacity: 0.4;
  }
  .hint {
    margin-top: 10px;
    font-size: 10px;
    color: #5a7a8a;
    line-height: 1.5;
  }
  .resource-iron {
    color: #c07840;
  }
  .resource-ice {
    color: #99ddff;
  }
  .resource-silicates {
    color: #c8b870;
  }
  .resource-rare-metals {
    color: #cc99ff;
  }
</style>
