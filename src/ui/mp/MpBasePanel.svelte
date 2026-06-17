<script lang="ts">
  import { mpSnapshot, mpYouCorpId, mpConnection, mpBasePanelOpen } from '../../state/mpStore'
  import { sendCommand } from '../../net/mpClient'
  import { SHIP_COST, MINER_COST, MAX_SHIPS_PER_CORP } from '../../../shared/mpConfig'
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
  $: freeSlots = me ? me.ships.length - me.minerCount : 0

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
    <div class="row"><span class="label">Fleet</span><span class="value">{me.ships.length} hauler{me.ships.length === 1 ? '' : 's'} · {me.minerCount} miner{me.minerCount === 1 ? '' : 's'}</span></div>

    <div class="sec">MARKET</div>
    {#each RESOURCE_ORDER as type}
      {@const qty = Math.floor(me.storage[type] ?? 0)}
      <div class="row mkt" class:off={qty <= 0}>
        <span class="label resource-{type}">{RESOURCE_LABELS[type]}</span>
        <span class="qty">{qty}</span>
        <span class="price">@{RESOURCE_SELL_PRICES[type]}cr</span>
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
    <div class="row buy" class:off={me.credits < MINER_COST || freeSlots <= 0}>
      <span class="label">AutoMiner</span>
      <span class="price">{MINER_COST}cr</span>
      <button class="btn" disabled={me.credits < MINER_COST || freeSlots <= 0} on:click={buyMiner}>
        {freeSlots <= 0 ? 'No free hauler' : 'Buy'}
      </button>
    </div>
    <div class="sec">AUTOMATION</div>
    <div class="row buy">
      <span class="label">Auto-designate</span>
      <span class="price">{me.autoDesignate ? 'ON' : 'OFF'}</span>
      <button class="btn" on:click={toggleAuto}>{me.autoDesignate ? 'Disable' : 'Enable'}</button>
    </div>

    <div class="hint">
      {#if me.minerCount === 0}
        Buy an AutoMiner, then claim an asteroid on the map — a miner-equipped hauler mines it.
      {:else if me.autoDesignate}
        Auto-designate is ON — idle miner-haulers claim the richest free asteroids for you.
      {:else}
        A hauler needs an AutoMiner to mine. Mined ore hauls here to storage — sell it for credits.
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
