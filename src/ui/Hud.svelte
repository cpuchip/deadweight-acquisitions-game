<script lang="ts">
  import { baseState } from '../state/baseStore'
  import { fleetSummary } from '../state/fleetStore'
  import { commandQueue } from '../state/commandStore'
  import { autoMinerSummary, activeBeacons, attachNotifications, minerAvailability } from '../state/autoMinerStore'
  import { activeMarketEvents } from '../state/marketEventStore'
  import { oreSilo } from '../state/oreSiloStore'
  import { invariantLog } from '../state/invariantStore'
  import { get } from 'svelte/store'

  let saveLabel = 'Save'
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  function totalStored(storage: Record<string, number>): number {
    return Object.values(storage).reduce((sum, n) => sum + n, 0)
  }

  function storageEntries(storage: Record<string, number>): [string, number][] {
    return Object.entries(storage).filter(([, qty]) => qty > 0)
  }

  function manualSave(): void {
    commandQueue.update(q => [...q, { type: 'manualSave' }])
    saveLabel = 'Saved'
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { saveLabel = 'Save' }, 1000)
  }

  function mainMenu(): void {
    // save first, then return to the title screen (CONTINUE will resume from here)
    commandQueue.update(q => [...q, { type: 'manualSave' }])
    setTimeout(() => { location.href = location.pathname }, 250)
  }

  $: siloFull = totalStored($baseState.storage) >= $baseState.storageCapacity
  $: oreFull = $oreSilo.quantity >= $oreSilo.capacity

  function copyInvariants(): void {
    const lines = get(invariantLog)
    const header = `DWA invariant report — ${new Date().toISOString()} — ${lines.length} entries`
    void navigator.clipboard?.writeText([header, ...lines].join('\n'))
  }
  function clearInvariants(): void {
    invariantLog.set([])
  }
</script>

<div class="hud">
  <div class="hud-label">Deadweight Acquisitions</div>
  <div class="hud-row" class:silo-full={siloFull}>
    <span class="hud-key">Storage</span>
    <span class="hud-val">{Math.floor(totalStored($baseState.storage))} / {$baseState.storageCapacity}</span>
  </div>
  {#if siloFull}
    <div class="hud-row silo-warning">⚠ Storage full — processing paused; sell to resume</div>
  {/if}
  <div class="hud-row" class:silo-full={oreFull}>
    <span class="hud-key">Raw ore</span>
    <span class="hud-val">{Math.floor($oreSilo.quantity)} / {$oreSilo.capacity}</span>
  </div>
  {#if oreFull}
    <div class="hud-row silo-warning">⚠ Ore silo full — mining halted</div>
  {/if}
  {#each storageEntries($baseState.storage) as [type, qty]}
    <div class="hud-row hud-indent">
      <span class="hud-key resource-{type}">{type}</span>
      <span class="hud-val">{Math.floor(qty)}</span>
    </div>
  {/each}
  <div class="hud-row">
    <span class="hud-key">Credits</span>
    <span class="hud-val credits">{$baseState.credits}</span>
  </div>
  {#each $activeMarketEvents as ev}
    <div class="hud-row market-event" class:up={ev.multiplier > 1}>
      <span class="event-msg">{ev.multiplier > 1 ? '▲' : '▼'} {ev.resourceType} {ev.type} ×{ev.multiplier.toFixed(1)}</span>
    </div>
  {/each}
  <div class="hud-row hud-section">
    <span class="hud-key">Fleet</span>
  </div>
  <div class="hud-row hud-indent">
    <span class="hud-key">Idle</span>
    <span class="hud-val">{$fleetSummary.idle}</span>
  </div>
  <div class="hud-row hud-indent">
    <span class="hud-key">Active</span>
    <span class="hud-val">{$fleetSummary.active}</span>
  </div>
  <div class="hud-row hud-indent">
    <span class="hud-key">Returning</span>
    <span class="hud-val">{$fleetSummary.returning}</span>
  </div>
  {#if $fleetSummary.coasting > 0}
    <div class="hud-row hud-indent">
      <span class="hud-key miner-stuck">Coasting</span>
      <span class="hud-val miner-stuck">{$fleetSummary.coasting}</span>
    </div>
  {/if}
  {#if $autoMinerSummary.mining > 0 || $autoMinerSummary.netStarved > 0 || $autoMinerSummary.beaconing > 0 || $autoMinerSummary.dark > 0}
    <div class="hud-row hud-section">
      <span class="hud-key">Miners</span>
    </div>
    {#if $autoMinerSummary.mining > 0}
      <div class="hud-row hud-indent">
        <span class="hud-key miner-mining">Mining</span>
        <span class="hud-val">{$autoMinerSummary.mining}</span>
      </div>
    {/if}
    {#if $autoMinerSummary.netStarved > 0}
      <div class="hud-row hud-indent">
        <span class="hud-key miner-starved">Net-starved</span>
        <span class="hud-val">{$autoMinerSummary.netStarved}</span>
      </div>
    {/if}
    {#if $autoMinerSummary.beaconing > 0}
      <div class="hud-row hud-indent">
        <span class="hud-key miner-beaconing">Beaconing</span>
        <span class="hud-val">{$autoMinerSummary.beaconing}</span>
      </div>
    {/if}
    {#if $autoMinerSummary.dark > 0}
      <div class="hud-row hud-indent">
        <span class="hud-key miner-dark">Dark</span>
        <span class="hud-val">{$autoMinerSummary.dark}</span>
      </div>
    {/if}
    {#if $autoMinerSummary.stuck > 0}
      <div class="hud-row hud-indent">
        <span class="hud-key miner-stuck">Stuck</span>
        <span class="hud-val">{$autoMinerSummary.stuck}</span>
      </div>
    {/if}
  {/if}
  {#if $minerAvailability.shortage}
    <div class="hud-row hud-section miner-shortage">
      <span class="shortage-msg">⚠ Miners: {$minerAvailability.available} avail / {$minerAvailability.demanded} needed</span>
    </div>
  {/if}
  {#each $attachNotifications as notif (notif.id)}
    <div class="hud-row hud-section attach-notif" class:attach-exhausted={notif.exhausted}>
      <span class="notif-msg">{notif.message}</span>
    </div>
  {/each}
  {#each $activeBeacons as beacon (beacon.id)}
    <div class="hud-row hud-section beacon-alert">
      <span class="hud-key miner-beaconing">Beacon</span>
      <button class="dispatch-btn" on:click={() => commandQueue.update(q => [...q, { type: 'respondToBeacon', minerId: beacon.id }])}>Dispatch</button>
    </div>
  {/each}
  {#if $invariantLog.length > 0}
    <div class="hud-row hud-section invariant-copy">
      <span class="hud-key miner-stuck">⚠ Invariants ({$invariantLog.length})</span>
      <button class="dispatch-btn" on:click={copyInvariants}>Copy</button>
      <button class="dispatch-btn" on:click={clearInvariants}>Clear</button>
    </div>
  {/if}
  <div class="hud-row hud-section">
    <button class="save-btn" on:click={manualSave}>{saveLabel}</button>
    <button class="save-btn" on:click={mainMenu}>Main Menu</button>
  </div>
</div>

<style>
  .hud {
    position: absolute;
    top: 12px;
    left: 12px;
    font-family: monospace;
    font-size: 11px;
    pointer-events: none;
  }

  .hud-label {
    color: #6a8a6a;
    letter-spacing: 0.05em;
    margin-bottom: 6px;
  }

  .hud-row {
    display: flex;
    gap: 8px;
    margin-bottom: 2px;
  }

  .hud-section {
    margin-top: 6px;
  }

  .hud-indent {
    padding-left: 8px;
  }

  .hud-key {
    color: #4a6a7a;
    min-width: 52px;
  }

  .hud-val {
    color: #aaccee;
  }

  .credits {
    color: #ffdd88;
  }

  .resource-iron         { color: #c07840; }
  .resource-ice          { color: #99ddff; }
  .resource-silicates    { color: #c8b870; }
  .resource-rare-metals  { color: #cc99ff; }

  .save-btn {
    pointer-events: auto;
    background: rgba(20, 40, 60, 0.7);
    border: 1px solid #2a4a6a;
    border-radius: 3px;
    color: #6a9aaa;
    font-family: monospace;
    font-size: 10px;
    cursor: pointer;
    padding: 2px 8px;
  }

  .save-btn:hover {
    color: #aaccee;
    border-color: #4a7aaa;
  }

  .miner-mining   { color: #88ccee; }
  .miner-starved  { color: #cc8844; }
  .miner-beaconing { color: #ffaa44; }
  .miner-dark     { color: #556677; }
  .miner-stuck    { color: #cc4444; }

  .beacon-alert {
    align-items: center;
    gap: 6px;
  }

  .dispatch-btn {
    pointer-events: auto;
    background: rgba(40, 30, 10, 0.8);
    border: 1px solid #aa7722;
    border-radius: 3px;
    color: #ffaa44;
    font-family: monospace;
    font-size: 10px;
    cursor: pointer;
    padding: 1px 6px;
  }

  .dispatch-btn:hover {
    color: #ffcc88;
    border-color: #ffaa44;
  }

  .market-event {
    border-left: 2px solid #cc8844;
    padding-left: 4px;
  }

  .event-msg {
    color: #ffaa44;
    font-size: 10px;
  }

  .market-event.up .event-msg {
    color: #66cc88;
  }

  .silo-full .hud-val {
    color: #ff6655;
  }

  .silo-warning {
    color: #ff6655;
    font-size: 10px;
    border-left: 2px solid #ff6655;
    padding-left: 4px;
  }

  .miner-shortage {
    border-left: 2px solid #ffaa44;
    padding-left: 4px;
  }

  .shortage-msg {
    color: #ffaa44;
    font-size: 10px;
  }

  .attach-notif {
    border-left: 2px solid #cc8844;
    padding-left: 4px;
  }

  .attach-exhausted {
    border-left-color: #cc4444;
  }

  .notif-msg {
    color: #cc8844;
    font-size: 10px;
  }

  .attach-exhausted .notif-msg {
    color: #ee6666;
  }
</style>
