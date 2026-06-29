<script lang="ts">
  import { selectedShip, selectedAsteroid } from '../state/shipStore'
  import { selectedAutoMiner } from '../state/autoMinerStore'
  import { selectedCargoNet } from '../state/cargoNetStore'
  import { commandQueue } from '../state/commandStore'
  import { NET_CAPACITY, CONDITION_CAP_THRESHOLD, CONDITION_GRACE_THRESHOLD, MINER_BATTERY_MAX } from '../entities/AutoMiner'
  import { HAULER_FUEL_MAX, HAULER_RCS_MAX, HAULER_BATTERY_MAX } from '../entities/Ship'
  import { designationQueue } from '../state/designationStore'

  function cargoTotal(contents: Record<string, number>): number {
    return Object.values(contents).reduce((sum, n) => sum + n, 0)
  }

  function cargoEntries(contents: Record<string, number>): [string, number][] {
    return Object.entries(contents).filter(([, qty]) => qty > 0)
  }

  function conditionClass(condition: number): string {
    if (condition < CONDITION_CAP_THRESHOLD) return 'cond-critical'
    if (condition < CONDITION_GRACE_THRESHOLD) return 'cond-degraded'
    return 'cond-ok'
  }

  function slotLabel(size: string): string {
    return size === 'small' ? 'S' : 'M'
  }

  function payloadLabel(payload: { kind: string; currentNets?: number; maxNets?: number; minerId?: string; forKind?: string } | null): string {
    if (payload === null) return 'empty'
    if (payload.kind === 'net-store') return `net-store [${payload.currentNets}/${payload.maxNets}]`
    if (payload.kind === 'auto-miner') return `auto-miner`
    if (payload.kind === 'reserved') return `reserved (${payload.forKind ?? '…'})`
    return payload.kind
  }
</script>

{#if $selectedCargoNet}
  <div class="panel">
    <div class="name cargonet-name">CARGO NET</div>
    <div class="row">
      <span class="label">State</span>
      <span class="value state-cn-{$selectedCargoNet.state}">{$selectedCargoNet.orphaned ? 'untethered' : $selectedCargoNet.state}</span>
    </div>
    <div class="row">
      <span class="label">Resource</span>
      <span class="value resource-{$selectedCargoNet.resourceType}">{$selectedCargoNet.resourceType}</span>
    </div>
    <div class="row">
      <span class="label">Quantity</span>
      <span class="value">{$selectedCargoNet.quantity}</span>
    </div>
    {#if $selectedCargoNet.orphaned}
      {#if $selectedCargoNet.designatedForCollection}
        <div class="row">
          <span class="label">Status</span>
          <span class="value desig-claimed">collection requested</span>
        </div>
      {:else}
        <button
          class="action-btn"
          on:click={() => commandQueue.update(q => [...q, { type: 'collectNet', netId: $selectedCargoNet!.id }])}
        >Designate for Collection</button>
      {/if}
    {/if}
  </div>
{:else if $selectedAutoMiner}
  <div class="panel">
    <div class="name autominer-name">AUTOMINER</div>
    <div class="row">
      <span class="label">State</span>
      <span class="value state-am-{$selectedAutoMiner.state}">{$selectedAutoMiner.state}</span>
    </div>
    <div class="row">
      <span class="label">Net fill</span>
      <span class="value">{Math.floor($selectedAutoMiner.activeNetFill)} / {NET_CAPACITY}</span>
    </div>
    <div class="row">
      <span class="label">Spare nets</span>
      <span class="value">{$selectedAutoMiner.spareNetCount}</span>
    </div>
    <div class="row">
      <span class="label">Tethered</span>
      <span class="value">{$selectedAutoMiner.tetheredNetCount}</span>
    </div>
    <div class="row">
      <span class="label">Condition</span>
      <span class="value {conditionClass($selectedAutoMiner.condition)}">{Math.round($selectedAutoMiner.condition * 100)}%</span>
    </div>
    {#if $selectedAutoMiner.condition < CONDITION_CAP_THRESHOLD}
      <div class="cond-warning">⚠ Catastrophic failure risk</div>
    {/if}
    <div class="row meter-row">
      <span class="label">Battery</span>
      <span class="value">{Math.floor($selectedAutoMiner.battery)}/{MINER_BATTERY_MAX}</span>
    </div>
    <div class="meter-track">
      <div class="meter-fill meter-battery" style="width: {$selectedAutoMiner.battery / MINER_BATTERY_MAX * 100}%"></div>
    </div>
    {#if $selectedAutoMiner.state === 'net-starved'}
      <button
        class="action-btn"
        on:click={() => commandQueue.update(q => [...q, { type: 'resupplyMiner', minerId: $selectedAutoMiner!.id }])}
      >Resupply</button>
    {/if}
    {#if $selectedAutoMiner.state === 'station-stored'}
      <button
        class="action-btn"
        on:click={() => commandQueue.update(q => [...q, { type: 'repairMiner', minerId: $selectedAutoMiner!.id }])}
      >Repair</button>
    {:else if $selectedAutoMiner.state === 'station-repair'}
      <div class="row">
        <span class="label">Service</span>
        <span class="value state-am-station-repair">Repairing…</span>
      </div>
    {:else if $selectedAutoMiner.state === 'dark'}
      <div class="row">
        <span class="label">Battery exhausted</span>
        <button
          class="action-btn"
          on:click={() => commandQueue.update(q => [...q, { type: 'respondToBeacon', minerId: $selectedAutoMiner!.id }])}
        >Recover</button>
      </div>
    {/if}
  </div>
{:else if $selectedShip}
  <div class="panel">
    <div class="name">{$selectedShip.name}</div>
    <div class="row">
      <span class="label">State</span>
      <span class="value state-{$selectedShip.state}">{$selectedShip.state}</span>
    </div>
    {#if $selectedShip.state === 'unloading'}
      {#if $selectedShip.attachUnloadProgress < 1}
        <div class="unload-bar-track">
          <div class="attach-bar-fill" style="width: {$selectedShip.attachUnloadProgress * 100}%"></div>
        </div>
      {/if}
      {#if $selectedShip.unloadProgress < 1}
        <div class="unload-bar-track">
          <div class="unload-bar-fill" style="width: {$selectedShip.unloadProgress * 100}%"></div>
        </div>
      {/if}
    {/if}
    <div class="row">
      <span class="label">Cargo</span>
      <span class="value">{Math.floor(cargoTotal($selectedShip.cargoContents))} / {$selectedShip.cargoCapacity}</span>
    </div>
    {#each cargoEntries($selectedShip.cargoContents) as [type, qty]}
      <div class="row cargo-row">
        <span class="label resource-{type}">{type}</span>
        <span class="value">{Math.floor(qty)}</span>
      </div>
    {/each}
    <div class="section-label">ATTACHMENT POINTS</div>
    {#each $selectedShip.attachmentPoints as ap, i}
      <div class="row ap-row">
        <span class="ap-slot">{i + 1} [{slotLabel(ap.size)}]</span>
        <span class="ap-payload payload-{ap.payload?.kind ?? 'empty'}">{payloadLabel(ap.payload as { kind: string; currentNets?: number; maxNets?: number; forKind?: string } | null)}</span>
      </div>
      {#if $selectedShip.state === 'collecting-nets' && $selectedShip.collectSlotProgress[i] !== undefined}
        <div class="collect-bar-track">
          <div class="collect-bar-fill" style="width: {$selectedShip.collectSlotProgress[i] * 100}%"></div>
        </div>
      {/if}
    {/each}
    <div class="section-label">FUEL / POWER</div>
    <div class="row meter-row">
      <span class="label">Thruster</span>
      <span class="value">{Math.floor($selectedShip.thrusterFuel)}/{HAULER_FUEL_MAX}</span>
    </div>
    <div class="meter-track">
      <div class="meter-fill meter-fuel" style="width: {$selectedShip.thrusterFuel / HAULER_FUEL_MAX * 100}%"></div>
    </div>
    <div class="row meter-row">
      <span class="label">RCS</span>
      <span class="value">{Math.floor($selectedShip.rcsFuel)}/{HAULER_RCS_MAX}</span>
    </div>
    <div class="meter-track">
      <div class="meter-fill meter-rcs" style="width: {$selectedShip.rcsFuel / HAULER_RCS_MAX * 100}%"></div>
    </div>
    <div class="row meter-row">
      <span class="label">Battery</span>
      <span class="value">{Math.floor($selectedShip.battery)}/{HAULER_BATTERY_MAX}</span>
    </div>
    <div class="meter-track">
      <div class="meter-fill meter-battery" style="width: {$selectedShip.battery / HAULER_BATTERY_MAX * 100}%"></div>
    </div>
    {#if $selectedShip.state === 'waiting-at-asteroid'}
      <div class="row">
        <span class="label">Miner Charge</span>
        <button
          class="toggle-btn {$selectedShip.chargeToggle ? 'active' : ''}"
          on:click={() => commandQueue.update(q => [...q, { type: 'toggleMinerCharge', shipId: $selectedShip!.id }])}
        >{$selectedShip.chargeToggle ? 'ON' : 'OFF'}</button>
      </div>
    {/if}
  </div>
{:else if $selectedAsteroid}
  {@const mineDesig = $designationQueue.find(d => d.asteroidId === $selectedAsteroid!.id && d.kind === 'mine') ?? null}
  {@const scanDesig = $designationQueue.find(d => d.asteroidId === $selectedAsteroid!.id && d.kind === 'scan') ?? null}
  {@const compOrder = ['iron', 'ice', 'silicates', 'rare-metals'] as const}
  {@const unknown = $selectedAsteroid.sizeCategory === 'large' && !$selectedAsteroid.scanned}
  <div class="panel">
    <div class="name asteroid-name">{unknown ? 'Unknown' : $selectedAsteroid.resourceType}</div>
    <div class="row">
      <span class="label">Size</span>
      <span class="value">{$selectedAsteroid.sizeCategory}</span>
    </div>
    <div class="row">
      <span class="label">Quantity</span>
      <span class="value">{#if unknown}—{:else}{Math.floor($selectedAsteroid.currentQuantity)} / {$selectedAsteroid.maxQuantity}{/if}</span>
    </div>

    {#if unknown}
      <div class="row">
        <span class="label">Contents</span>
        <span class="value">unknown — scan to assess</span>
      </div>
    {:else if $selectedAsteroid.scanned}
      {#each compOrder as r}
        {#if $selectedAsteroid.composition[r] > 0}
          <div class="row">
            <span class="label resource-{r}">{r}</span>
            <span class="value">{Math.round($selectedAsteroid.composition[r] * 100)}%</span>
          </div>
        {/if}
      {/each}
    {:else}
      <div class="row">
        <span class="label">Composition</span>
        <span class="value">dominant {$selectedAsteroid.resourceType} — scan to reveal</span>
      </div>
    {/if}

    {#if mineDesig === null}
      <button
        class="action-btn"
        on:click={() => commandQueue.update(q => [...q, { type: 'designateAsteroid', asteroidId: $selectedAsteroid!.id }])}
      >Designate for Mining</button>
    {:else if mineDesig.status === 'fulfilled'}
      <div class="row">
        <span class="label">Mining</span>
        <span class="value desig-fulfilled">being mined</span>
      </div>
    {:else}
      <div class="row">
        <span class="label">Mining</span>
        <span class="value desig-{mineDesig.status}">{mineDesig.status}</span>
      </div>
      <button
        class="action-btn action-btn-cancel"
        on:click={() => commandQueue.update(q => [...q, { type: 'undesignateAsteroid', asteroidId: $selectedAsteroid!.id }])}
      >Un-designate</button>
    {/if}

    {#if $selectedAsteroid.scanned}
      <div class="row">
        <span class="label">Scan</span>
        <span class="value desig-fulfilled">scanned ✓</span>
      </div>
    {:else if scanDesig === null}
      <button
        class="action-btn"
        on:click={() => commandQueue.update(q => [...q, { type: 'designateScan', asteroidId: $selectedAsteroid!.id }])}
      >Designate for Scanning</button>
    {:else}
      <div class="row">
        <span class="label">Scan</span>
        <span class="value desig-{scanDesig.status}">{scanDesig.status}</span>
      </div>
      <button
        class="action-btn action-btn-cancel"
        on:click={() => commandQueue.update(q => [...q, { type: 'undesignateScan', asteroidId: $selectedAsteroid!.id }])}
      >Cancel Scan</button>
    {/if}
  </div>
{/if}

<style>
  .panel {
    position: absolute;
    bottom: 24px;
    right: 24px;
    background: rgba(5, 10, 20, 0.85);
    border: 1px solid #2a4a6a;
    border-radius: 4px;
    padding: 12px 16px;
    min-width: 220px;
    font-family: monospace;
    font-size: 12px;
    color: #aaccee;
    pointer-events: auto;
  }

  .name {
    font-size: 13px;
    color: #88ddff;
    margin-bottom: 8px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .asteroid-name {
    color: #cc9966;
  }

  .row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .cargo-row {
    padding-left: 8px;
  }

  .label {
    color: #6a8a9a;
  }

  .value {
    color: #cce0f0;
  }

  .unload-bar-track {
    height: 5px;
    background: rgba(30, 50, 80, 0.8);
    border-radius: 2px;
    margin-bottom: 6px;
    overflow: hidden;
  }

  .unload-bar-fill {
    height: 100%;
    background: #88ccff;
    border-radius: 2px;
    transition: width 0.05s linear;
  }

  .attach-bar-fill {
    height: 100%;
    background: #ffaa44;
    border-radius: 2px;
    transition: width 0.05s linear;
  }

  .collect-bar-track {
    height: 4px;
    background: rgba(30, 50, 80, 0.8);
    border-radius: 2px;
    margin: -2px 0 4px 4px;
    overflow: hidden;
  }

  .collect-bar-fill {
    height: 100%;
    background: #ffcc44;
    border-radius: 2px;
    transition: width 0.05s linear;
  }

  .section-label {
    font-size: 9px;
    color: #3a6a8a;
    letter-spacing: 0.08em;
    margin-top: 8px;
    margin-bottom: 4px;
    border-top: 1px solid #1a3a5a;
    padding-top: 6px;
  }

  .ap-row {
    padding-left: 4px;
    margin-bottom: 3px;
  }

  .ap-slot {
    color: #6a8a9a;
    min-width: 40px;
  }

  .ap-payload {
    color: #7a9aaa;
    font-size: 11px;
  }

  .autominer-name {
    color: #88ccdd;
  }

  .cargonet-name {
    color: #ffcc44;
  }

  .state-cn-full-tethered { color: #88ffaa; }
  .state-cn-in-transit    { color: #ffdd88; }
  .state-cn-unloading     { color: #44aaff; }

  .payload-net-store   { color: #88ddaa; }
  .payload-auto-miner  { color: #88ccdd; }
  .payload-cargo-net   { color: #ffcc44; }
  .payload-reserved    { color: #7790a8; font-style: italic; }

  .action-btn {
    display: block;
    margin-top: 8px;
    width: 100%;
    background: rgba(40, 80, 120, 0.8);
    border: 1px solid #4a8aaa;
    border-radius: 3px;
    color: #88ddff;
    font-family: monospace;
    font-size: 11px;
    padding: 4px 8px;
    cursor: pointer;
    pointer-events: auto;
  }

  .action-btn:hover {
    background: rgba(60, 110, 160, 0.9);
    border-color: #6aaccf;
  }

  .toggle-btn {
    background: rgba(40, 80, 120, 0.8);
    border: 1px solid #4a8aaa;
    border-radius: 3px;
    color: #88ddff;
    font-family: monospace;
    font-size: 11px;
    padding: 2px 8px;
    cursor: pointer;
    pointer-events: auto;
  }

  .toggle-btn.active {
    background: rgba(60, 130, 80, 0.8);
    border-color: #4aaa66;
    color: #88ffaa;
  }

  .toggle-btn:hover {
    background: rgba(60, 110, 160, 0.9);
    border-color: #6aaccf;
  }

  .meter-track {
    height: 3px;
    background: #1a2a3a;
    margin: 1px 0 4px;
    border-radius: 1px;
  }

  .meter-fill {
    height: 100%;
    border-radius: 1px;
  }

  .meter-fuel     { background: #cc8844; }
  .meter-rcs      { background: #4488cc; }
  .meter-battery  { background: #cccc44; }

  .meter-row {
    margin-bottom: 0;
  }

  .state-idle                      { color: #88ffaa; }
  .state-moving                    { color: #ffdd88; }
  .state-traveling-to-base         { color: #ff9944; }
  .state-unloading                 { color: #44aaff; }
  .state-traveling-to-asteroid     { color: #ffdd88; }
  .state-deploying-miner           { color: #ffbb44; }
  .state-waiting-at-asteroid       { color: #88ffaa; }
  .state-collecting-nets           { color: #88ddff; }
  .state-resupplying-miner         { color: #88ffaa; }

  .state-am-in-transit             { color: #6a8a9a; }
  .state-am-deploying              { color: #ffdd88; }
  .state-am-attaching              { color: #ffbb44; }
  .state-am-mining                 { color: #88ffaa; }
  .state-am-ejecting-net           { color: #88ddff; }
  .state-am-net-starved            { color: #ff6644; }
  .state-am-standby-beaconing      { color: #ffaa44; }
  .state-am-stuck                  { color: #cc4444; }
  .state-am-station-repair         { color: #88ccdd; }

  .cond-ok       { color: #cce0f0; }
  .cond-degraded { color: #ffaa44; }
  .cond-critical { color: #ff6644; }

  .cond-warning {
    font-size: 10px;
    color: #ff6644;
    margin-top: 4px;
    margin-bottom: 2px;
  }

  .desig-queued  { color: #88ffaa; }
  .desig-claimed { color: #ffdd88; }
  .desig-fulfilled { color: #66ccff; }

  .action-btn-cancel {
    background: rgba(60, 20, 20, 0.8);
    border-color: #885544;
    color: #ffaa88;
  }

  .action-btn-cancel:hover {
    background: rgba(90, 30, 30, 0.9);
    border-color: #aa7766;
  }

  .resource-iron         { color: #c07840; }
  .resource-ice          { color: #99ddff; }
  .resource-silicates    { color: #c8b870; }
  .resource-rare-metals  { color: #cc99ff; }
</style>
