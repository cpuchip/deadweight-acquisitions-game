<script lang="ts">
  import { baseState, basePanelOpen, stationUsage } from '../state/baseStore'
  import { resourceMarket } from '../state/marketStore'
  import { infrastructure, type LeverKey } from '../state/infrastructureStore'
  import { priceHistory } from '../state/metricsStore'
  import { oreSilo } from '../state/oreSiloStore'
  import Sparkline from './Sparkline.svelte'
  import { commandQueue } from '../state/commandStore'
  import { selectedShip } from '../state/shipStore'
  import { type ResourceType } from '../world/worldConfig'
  import { SHIP_COMMISSION_COST, SILO_CAPACITY_INCREMENT, ORE_SILO_INCREMENT } from '../entities/Base'
  import { AUTOMINER_PURCHASE_COST, STATION_MINER_SLOT_CAP } from '../entities/AutoMiner'
  import {
    MAX_UPGRADE_LEVEL,
    CARGO_CAPACITY_TIERS,
    CARGO_UPGRADE_COSTS,
  } from '../entities/Ship'
  import { SERVICE_SLOT_COUNT } from '../world/serviceSlots'
  import { HANGAR_BAY_COUNT } from '../world/hangarBays'
  import { getPrice } from '../world/pricingSeam'

  const DOCK_COST    = getPrice('owned-dock-purchase')
  const HANGAR_COST  = getPrice('owned-hangar-purchase')
  const PRESS_COST   = getPrice('pressurization-upgrade')
  const SLOT_COST    = getPrice('station-miner-slot')
  const SILO_COST    = getPrice('silo-capacity-upgrade')
  const ORE_SILO_COST = getPrice('ore-silo-capacity-upgrade')

  const FEE_PUBLIC_DOCK = getPrice('dock-cargo-drop')
  const FEE_HANGAR      = getPrice('hangar-service')
  const FEE_FUEL        = getPrice('fuel-refuel')
  const FEE_RCS         = getPrice('rcs-refuel')
  const FEE_REPAIR_PT   = getPrice('repair-per-condition-point')
  const FEE_ELECTRICITY = getPrice('electricity-per-battery-unit')

  const RESOURCE_LABELS: Record<string, string> = {
    iron: 'Iron',
    ice: 'Ice',
    silicates: 'Silicates',
    'rare-metals': 'Rare Metals',
  }

  const RESOURCE_ORDER: ResourceType[] = ['iron', 'ice', 'silicates', 'rare-metals']

  function totalStored(storage: Partial<Record<string, number>>): number {
    return Object.values(storage).reduce((sum, n) => sum + (n ?? 0), 0)
  }

  function close(): void {
    basePanelOpen.set(false)
  }

  function sellResource(type: ResourceType): void {
    commandQueue.update(q => [...q, { type: 'sellResource', resourceType: type }])
  }

  function commissionShip(): void {
    commandQueue.update(q => [...q, { type: 'commissionShip' }])
  }

  function upgradeShip(stat: 'cargo'): void {
    if (!$selectedShip) return
    commandQueue.update(q => [...q, { type: 'upgradeShip', shipId: $selectedShip!.id, stat }])
  }

  function purchaseMiner(): void {
    commandQueue.update(q => [...q, { type: 'purchaseMiner' }])
  }

  const SCANNER_COST = getPrice('scanner-purchase')
  function purchaseScanner(): void {
    commandQueue.update(q => [...q, { type: 'purchaseScanner' }])
  }

  $: hasMinerStorage = $baseState.stationMinerCount < $baseState.stationMinerSlotCount
  $: canBuyMiner = $baseState.credits >= AUTOMINER_PURCHASE_COST && hasMinerStorage

  function purchaseOwnedDock(): void {
    commandQueue.update(q => [...q, { type: 'purchaseOwnedDock' }])
  }

  function purchaseHangar(): void {
    commandQueue.update(q => [...q, { type: 'purchaseHangar' }])
  }

  function purchaseMinerSlot(): void {
    commandQueue.update(q => [...q, { type: 'purchaseMinerSlot' }])
  }

  function purchasePressurization(): void {
    commandQueue.update(q => [...q, { type: 'purchasePressurization' }])
  }

  function toggleAutoDesignate(): void {
    commandQueue.update(q => [...q, { type: 'toggleAutoDesignate' }])
  }

  function purchaseSiloCapacity(): void {
    commandQueue.update(q => [...q, { type: 'purchaseSiloCapacity' }])
  }

  const RESOURCE_LEVER: Partial<Record<ResourceType, LeverKey>> = {
    silicates: 'solar', ice: 'propellant', iron: 'foundry',
  }
  const LEVER_ORDER: LeverKey[] = ['solar', 'propellant', 'foundry']
  const LEVER_LABELS: Record<LeverKey, string> = {
    solar: 'Solar → Power', propellant: 'Propellant → Fuel/RCS', foundry: 'Foundry → Repair',
  }

  function investInfrastructure(lever: LeverKey): void {
    commandQueue.update(q => [...q, { type: 'investInfrastructure', lever }])
  }

  $: siloFull = totalStored($baseState.storage) >= $baseState.storageCapacity
  $: canExpandSilo = $baseState.credits >= SILO_COST

  function purchaseOreSiloCapacity(): void {
    commandQueue.update(q => [...q, { type: 'purchaseOreSiloCapacity' }])
  }
  $: oreFull = $oreSilo.quantity >= $oreSilo.capacity
  $: canExpandOre = $baseState.credits >= ORE_SILO_COST
</script>

{#if $basePanelOpen}
  <div class="panel">
    <!-- Header -->
    <div class="header">
      <span class="title">BASE</span>
      <button class="close-btn" on:click={close}>✕</button>
    </div>
    <div class="row">
      <span class="label">Credits</span>
      <span class="value credits">{Math.floor($baseState.credits)}</span>
    </div>
    <div class="row" class:silo-full={siloFull}>
      <span class="label">Storage</span>
      <span class="value">
        {Math.floor(totalStored($baseState.storage))} / {$baseState.storageCapacity}
        {#if siloFull}<span class="silo-full-tag">FULL</span>{/if}
      </span>
    </div>
    {#if siloFull}
      <div class="silo-warning">Storage full — processing paused. Sell or expand.</div>
    {/if}
    <div class="row shipyard-row" class:disabled={!canExpandSilo}>
      <span class="label">Expand Silo</span>
      <span class="price">+{SILO_CAPACITY_INCREMENT}t · {SILO_COST}cr</span>
      <button
        class="commission-btn"
        disabled={!canExpandSilo}
        on:click={purchaseSiloCapacity}
      >Buy</button>
    </div>

    <!-- Ore & processing -->
    <div class="section-title">ORE</div>
    <div class="row" class:silo-full={oreFull}>
      <span class="label">Raw ore</span>
      <span class="value">
        {Math.floor($oreSilo.quantity)} / {$oreSilo.capacity}
        {#if oreFull}<span class="silo-full-tag">FULL</span>{/if}
      </span>
    </div>
    <div class="row">
      <span class="label">Processing</span>
      <span class="value" class:depressed={$oreSilo.processing}>
        {$oreSilo.processing ? 'refining…' : ($oreSilo.quantity > 0 ? 'paused (silo full)' : 'idle')}
      </span>
    </div>
    {#if oreFull}
      <div class="silo-warning">Ore silo full — mining halted. Process/sell to drain.</div>
    {/if}
    <div class="row shipyard-row" class:disabled={!canExpandOre}>
      <span class="label">Expand Ore Silo</span>
      <span class="price">+{ORE_SILO_INCREMENT}t · {ORE_SILO_COST}cr</span>
      <button
        class="commission-btn"
        disabled={!canExpandOre}
        on:click={purchaseOreSiloCapacity}
      >Buy</button>
    </div>

    <!-- Market -->
    <div class="section-title">MARKET</div>
    {#each RESOURCE_ORDER as type}
      {@const qty = Math.floor($baseState.storage[type] ?? 0)}
      {@const mkt = $resourceMarket[type]}
      {@const depressed = mkt.current < mkt.baseline - 0.05}
      <div class="row market-row" class:disabled={qty <= 0}>
        <span class="label resource-{type}">{RESOURCE_LABELS[type]}</span>
        <span class="qty">{qty}</span>
        <span class="price" class:depressed>
          @ {mkt.current.toFixed(1)}cr{#if depressed}<span class="base-ref"> /{mkt.baseline}</span>{/if}
        </span>
        {#if RESOURCE_LEVER[type]}
          <button
            class="invest-btn"
            disabled={qty <= 0}
            title="Invest into {LEVER_LABELS[RESOURCE_LEVER[type]!]}"
            on:click={() => investInfrastructure(RESOURCE_LEVER[type]!)}
          >Invest</button>
        {/if}
        <button
          class="sell-btn"
          disabled={qty <= 0}
          on:click={() => sellResource(type)}
        >Sell</button>
      </div>
    {/each}

    <!-- Price history -->
    <div class="section-title">PRICE HISTORY</div>
    {#each RESOURCE_ORDER as type}
      <div class="row metric-row">
        <span class="label resource-{type}">{RESOURCE_LABELS[type]}</span>
        <Sparkline samples={$priceHistory[type]} />
      </div>
    {/each}

    <!-- Infrastructure (cost levers) -->
    <div class="section-title">INFRASTRUCTURE</div>
    {#each LEVER_ORDER as lever}
      {@const inf = $infrastructure[lever]}
      {@const reduced = inf.price < inf.base - 0.05}
      <div class="row infra-row">
        <span class="label">{LEVER_LABELS[lever]}</span>
        <span class="infra-stat">cap {inf.capacity.toFixed(0)} · dem {inf.demand}</span>
        <span class="price" class:depressed={reduced}>{inf.price.toFixed(1)}<span class="base-ref">/{inf.base}</span></span>
      </div>
    {/each}

    <!-- Shipyard -->
    <div class="section-title">SHIPYARD</div>
    <div class="row shipyard-row" class:disabled={$baseState.credits < SHIP_COMMISSION_COST}>
      <span class="label">Hauler</span>
      <span class="price">{SHIP_COMMISSION_COST}cr</span>
      <button
        class="commission-btn"
        disabled={$baseState.credits < SHIP_COMMISSION_COST}
        on:click={commissionShip}
      >Commission</button>
    </div>

    <!-- Equipment -->
    <div class="section-title">EQUIPMENT</div>
    <div class="row shipyard-row" class:disabled={!canBuyMiner}>
      <span class="label">AutoMiner</span>
      <span class="price">{AUTOMINER_PURCHASE_COST}cr</span>
      <button
        class="commission-btn"
        disabled={!canBuyMiner}
        on:click={purchaseMiner}
      >Buy</button>
    </div>
    {#if !hasMinerStorage}
      <div class="row"><span class="fee-note">No free miner storage — buy a Miner Slot below</span></div>
    {/if}
    <div class="row shipyard-row" class:disabled={$baseState.credits < SCANNER_COST}>
      <span class="label">Scanner Probe ({$baseState.scannerCount})</span>
      <span class="price">{SCANNER_COST}cr</span>
      <button
        class="commission-btn"
        disabled={$baseState.credits < SCANNER_COST}
        on:click={purchaseScanner}
      >Buy</button>
    </div>

    <!-- Station usage -->
    <div class="section-title">STATION USAGE</div>
    <div class="row">
      <span class="label">Miner storage</span>
      <span class="value">{$stationUsage.minersStored}/{$stationUsage.minerSlots} used</span>
    </div>
    <div class="row">
      <span class="label">Owned docks</span>
      <span class="value">
        {$stationUsage.ownedDocksInUse}/{$stationUsage.ownedDocksTotal} in use{#if $stationUsage.publicDocksInUse > 0} <span class="fee-note">+{$stationUsage.publicDocksInUse} public · fees</span>{/if}
      </span>
    </div>
    <div class="row">
      <span class="label">Hangars in use</span>
      <span class="value">
        {$stationUsage.hangarsInUse}/{$stationUsage.hangarsTotal}{#if $stationUsage.publicHangarsInUse > 0} <span class="fee-note">({$stationUsage.publicHangarsInUse} public · fees)</span>{/if}
      </span>
    </div>

    <!-- Station -->
    <div class="section-title">STATION</div>
    <div class="row shipyard-row" class:disabled={$baseState.ownedDockCount >= SERVICE_SLOT_COUNT || $baseState.credits < DOCK_COST}>
      <span class="label">Docks</span>
      <span class="upgrade-info">{$baseState.ownedDockCount}/{SERVICE_SLOT_COUNT}</span>
      <span class="price">{DOCK_COST}cr</span>
      <button
        class="commission-btn"
        disabled={$baseState.ownedDockCount >= SERVICE_SLOT_COUNT || $baseState.credits < DOCK_COST}
        on:click={purchaseOwnedDock}
      >Buy</button>
    </div>
    <div class="row shipyard-row" class:disabled={$baseState.ownedHangarCount >= HANGAR_BAY_COUNT || $baseState.credits < HANGAR_COST}>
      <span class="label">Hangars</span>
      <span class="upgrade-info">{$baseState.ownedHangarCount}/{HANGAR_BAY_COUNT}</span>
      <span class="price">{HANGAR_COST}cr</span>
      <button
        class="commission-btn"
        disabled={$baseState.ownedHangarCount >= HANGAR_BAY_COUNT || $baseState.credits < HANGAR_COST}
        on:click={purchaseHangar}
      >Buy</button>
    </div>
    <div class="row shipyard-row" class:disabled={$baseState.stationMinerSlotCount >= STATION_MINER_SLOT_CAP || $baseState.credits < SLOT_COST}>
      <span class="label">Miner Slots</span>
      <span class="upgrade-info">{$baseState.stationMinerSlotCount}/{STATION_MINER_SLOT_CAP}</span>
      <span class="price">{SLOT_COST}cr</span>
      <button
        class="commission-btn"
        disabled={$baseState.stationMinerSlotCount >= STATION_MINER_SLOT_CAP || $baseState.credits < SLOT_COST}
        on:click={purchaseMinerSlot}
      >Buy</button>
    </div>
    <div class="row shipyard-row" class:disabled={$baseState.hangarPressurized || $baseState.ownedHangarCount < 1 || $baseState.credits < PRESS_COST}>
      <span class="label">Pressurize Bay</span>
      {#if $baseState.hangarPressurized}
        <span class="max-label">DONE</span>
      {:else}
        <span class="price">{PRESS_COST}cr</span>
        <button
          class="commission-btn"
          disabled={$baseState.ownedHangarCount < 1 || $baseState.credits < PRESS_COST}
          on:click={purchasePressurization}
        >Buy</button>
      {/if}
    </div>

    <!-- Automation -->
    <div class="section-title">AUTOMATION</div>
    <div class="row shipyard-row">
      <span class="label">Auto-Designate</span>
      <span class="value">{$baseState.autoDesignate ? 'ON' : 'OFF'}</span>
      <button class="toggle-btn" on:click={toggleAutoDesignate}>
        {$baseState.autoDesignate ? 'Disable' : 'Enable'}
      </button>
    </div>

    <!-- Fees -->
    <div class="section-title">FEES</div>
    <div class="row fee-row">
      <span class="label">Public dock use</span>
      <span class="fee-value">{FEE_PUBLIC_DOCK}cr</span>
    </div>
    <div class="row fee-row">
      <span class="label">Hangar service</span>
      <span class="fee-value">{FEE_HANGAR}cr</span>
    </div>
    <div class="row fee-row">
      <span class="label">Fuel / full tank</span>
      <span class="fee-value">{FEE_FUEL}cr</span>
    </div>
    <div class="row fee-row">
      <span class="label">RCS / full tank</span>
      <span class="fee-value">{FEE_RCS}cr</span>
    </div>
    <div class="row fee-row">
      <span class="label">Repair</span>
      <span class="fee-value">{FEE_REPAIR_PT}cr/pt</span>
    </div>
    <div class="row fee-row">
      <span class="label">Electricity</span>
      <span class="fee-value">{FEE_ELECTRICITY}cr/unit</span>
    </div>

    <!-- Upgrades (visible only when a ship is selected) -->
    {#if $selectedShip}
      {@const cargoLvl = $selectedShip.cargoUpgradeLevel}
      <div class="section-title">UPGRADES — {$selectedShip.name}</div>
      <div class="row upgrade-row" class:disabled={cargoLvl >= MAX_UPGRADE_LEVEL || $baseState.credits < CARGO_UPGRADE_COSTS[cargoLvl]}>
        <span class="label">Cargo</span>
        <span class="upgrade-info">
          {CARGO_CAPACITY_TIERS[cargoLvl]}
          {#if cargoLvl < MAX_UPGRADE_LEVEL}→ {CARGO_CAPACITY_TIERS[cargoLvl + 1]}{/if}
        </span>
        {#if cargoLvl < MAX_UPGRADE_LEVEL}
          <span class="price">{CARGO_UPGRADE_COSTS[cargoLvl]}cr</span>
          <button
            class="upgrade-btn"
            disabled={$baseState.credits < CARGO_UPGRADE_COSTS[cargoLvl]}
            on:click={() => upgradeShip('cargo')}
          >Upgrade</button>
        {:else}
          <span class="max-label">MAX</span>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .panel {
    position: absolute;
    bottom: 24px;
    left: 24px;
    background: rgba(5, 10, 20, 0.90);
    border: 1px solid #2a4a6a;
    border-radius: 4px;
    padding: 12px 16px;
    width: 320px;            /* fixed so content changes don't resize the panel */
    box-sizing: border-box;
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

  .close-btn {
    background: none;
    border: none;
    color: #6a8a9a;
    font-family: monospace;
    font-size: 12px;
    cursor: pointer;
    padding: 0 2px;
  }

  .close-btn:hover {
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

  .fee-note {
    color: #ffaa66;
    font-size: 0.85em;
  }

  .silo-full .value {
    color: #ff6655;
  }

  .silo-full-tag {
    color: #ff6655;
    font-weight: bold;
    margin-left: 4px;
  }

  .silo-warning {
    color: #ff6655;
    font-size: 0.85em;
    border-left: 2px solid #ff6655;
    padding-left: 4px;
    margin: 2px 0;
  }

  .price.depressed {
    color: #ffaa66;
  }

  .base-ref {
    color: #7a8a99;
    font-size: 0.85em;
  }

  .credits {
    color: #ffdd88;
  }

  .section-title {
    font-size: 10px;
    color: #3a6a8a;
    letter-spacing: 0.08em;
    margin-top: 10px;
    margin-bottom: 4px;
    border-top: 1px solid #1a3a5a;
    padding-top: 6px;
  }

  .market-row .qty {
    color: #cce0f0;
    min-width: 36px;
    text-align: right;
  }

  .price {
    color: #6a8a9a;
    font-size: 10px;
    min-width: 40px;
  }

  .sell-btn,
  .commission-btn,
  .invest-btn {
    background: rgba(40, 80, 120, 0.6);
    border: 1px solid #2a5a8a;
    border-radius: 3px;
    color: #aaccee;
    font-family: monospace;
    font-size: 10px;
    cursor: pointer;
    padding: 2px 6px;
    white-space: nowrap;
  }

  .invest-btn {
    background: rgba(40, 90, 60, 0.6);
    border-color: #2a7a4a;
    color: #aaeec0;
    margin-right: 3px;
  }

  .infra-stat {
    color: #7a8a99;
    font-size: 0.85em;
    flex: 1;
    text-align: right;
    padding-right: 6px;
  }

  .metric-row {
    align-items: center;
    gap: 6px;
  }

  .metric-row .label {
    flex: 1;
  }

  .toggle-btn {
    background: rgba(40, 80, 120, 0.6);
    border: 1px solid #2a5a8a;
    border-radius: 3px;
    color: #aaccee;
    font-family: monospace;
    font-size: 10px;
    cursor: pointer;
    padding: 2px 6px;
    white-space: nowrap;
  }

  .toggle-btn:hover {
    background: rgba(60, 100, 150, 0.7);
  }

  .sell-btn:hover:not(:disabled),
  .commission-btn:hover:not(:disabled) {
    background: rgba(60, 100, 150, 0.7);
  }

  .invest-btn:hover:not(:disabled) {
    background: rgba(60, 120, 85, 0.7);
  }

  .sell-btn:disabled,
  .commission-btn:disabled,
  .invest-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .disabled .label,
  .disabled .qty,
  .disabled .price {
    opacity: 0.4;
  }

  .shipyard-row {
    justify-content: space-between;
  }

  .resource-iron         { color: #c07840; }
  .resource-ice          { color: #99ddff; }
  .resource-silicates    { color: #c8b870; }
  .resource-rare-metals  { color: #cc99ff; }

  .upgrade-row {
    justify-content: space-between;
  }

  .upgrade-info {
    color: #cce0f0;
    font-size: 10px;
    flex: 1;
  }

  .upgrade-btn {
    background: rgba(40, 80, 120, 0.6);
    border: 1px solid #2a5a8a;
    border-radius: 3px;
    color: #aaccee;
    font-family: monospace;
    font-size: 10px;
    cursor: pointer;
    padding: 2px 6px;
    white-space: nowrap;
  }

  .upgrade-btn:hover:not(:disabled) {
    background: rgba(60, 100, 150, 0.7);
  }

  .upgrade-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .max-label {
    color: #44aaff;
    font-size: 10px;
    padding: 2px 6px;
  }

  .fee-row {
    justify-content: space-between;
  }

  .fee-value {
    color: #6a8a9a;
    font-size: 10px;
  }
</style>
