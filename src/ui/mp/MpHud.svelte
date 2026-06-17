<script lang="ts">
  import { mpSnapshot, mpYouCorpId, mpConnection, mpSelectedAsteroid, mpSelectedShip, mpSelectedMiner, mpBasePanelOpen, mpIsHost, mpQuickClaim } from '../../state/mpStore'
  import { sendCommand, pauseMatch, quitMatch } from '../../net/mpClient'
  import { MAX_CARGO_LEVEL, CARGO_UPGRADE_COSTS, CARGO_CAPACITY_TIERS } from '../../../shared/mpConfig'
  import type { CorpSnap, AsteroidSnap, ShipSnap, MinerSnap, WorldSnapshot } from '../../../shared/protocol'

  function hex(c: number): string {
    return '#' + (c >>> 0).toString(16).padStart(6, '0')
  }
  function clock(sec: number): string {
    const s = Math.max(0, Math.floor(sec))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  $: world = $mpSnapshot
  $: show = $mpConnection === 'connected' && world && world.phase !== 'lobby'
  $: me = world ? world.corps.find((c) => c.id === $mpYouCorpId) ?? null : null
  $: board = world ? [...world.corps].sort((a, b) => b.periodTonnage - a.periodTonnage) : []
  $: countdown = world ? world.periodEndsAt - world.t : 0
  $: shipCount = me ? me.ships.length : 0
  $: stored = me ? Math.floor(Object.values(me.storage).reduce((s, n) => s + (n ?? 0), 0)) : 0
  $: selected = selectAsteroid(world?.asteroids, $mpSelectedAsteroid)
  $: selShip = findShip(world, $mpSelectedShip)
  $: selMiner = findMiner(world, $mpSelectedMiner)
  $: starved = me ? me.miners.filter((m) => m.state === 'net-starved').length : 0

  const SHIP_STATE: Record<string, string> = {
    idle: 'idle',
    'to-asteroid': 'en route',
    deploying: 'deploying miner',
    collecting: 'collecting nets',
    'to-base': 'hauling to base',
    unloading: 'unloading',
  }
  const MINER_STATE: Record<string, string> = {
    mining: 'mining',
    'net-starved': 'full — needs a hauler',
    depleted: 'rock depleted',
  }
  function findShip(w: WorldSnapshot | null, id: string | null): { ship: ShipSnap; corp: CorpSnap } | null {
    if (!w || !id) return null
    for (const c of w.corps) {
      const ship = c.ships.find((s) => s.id === id)
      if (ship) return { ship, corp: c }
    }
    return null
  }
  function findMiner(w: WorldSnapshot | null, id: string | null): { miner: MinerSnap; corp: CorpSnap } | null {
    if (!w || !id) return null
    for (const c of w.corps) {
      const miner = c.miners.find((m) => m.id === id)
      if (miner) return { miner, corp: c }
    }
    return null
  }
  function minerAsteroid(id: string): AsteroidSnap | null {
    if (!world) return null
    return world.asteroids.find((a) => a.id === id) ?? null
  }
  function recall(asteroidId: string): void {
    sendCommand({ kind: 'undesignate', asteroidId })
    mpSelectedMiner.set(null)
  }
  $: winner = world && world.winnerCorpId ? world.corps.find((c) => c.id === world.winnerCorpId) ?? null : null

  function selectAsteroid(list: AsteroidSnap[] | undefined, id: string | null): AsteroidSnap | null {
    if (!list || !id) return null
    return list.find((a) => a.id === id) ?? null
  }
  function corpName(id: string | null): string {
    if (!world || !id) return ''
    return world.corps.find((c) => c.id === id)?.name ?? ''
  }
  function quotaPct(c: CorpSnap): number {
    if (!world || world.quota <= 0) return 0
    return Math.min(100, (c.periodTonnage / world.quota) * 100)
  }

  function openBase(): void {
    mpBasePanelOpen.set(true)
  }
  function pause(): void {
    pauseMatch()
  }
  function quit(): void {
    quitMatch()
  }
  function toggleQuickClaim(): void {
    mpQuickClaim.update((v) => !v)
  }
  function upgrade(shipId: string): void {
    sendCommand({ kind: 'upgradeShip', shipId })
  }
  function claim(a: AsteroidSnap): void {
    if (a.claimedBy === $mpYouCorpId) sendCommand({ kind: 'undesignate', asteroidId: a.id })
    else if (!a.claimedBy) sendCommand({ kind: 'designate', asteroidId: a.id })
  }
  function again(): void {
    location.reload()
  }
</script>

{#if show && world}
  <!-- top bar -->
  <div class="hud-top">
    <div class="cell">
      <span class="k">PERIOD</span><span class="v">{world.period}</span>
    </div>
    <div class="cell">
      <span class="k">QUOTA</span><span class="v">{world.quota} t</span>
    </div>
    <div class="cell wide">
      <span class="k">DEADLINE</span>
      <span class="v" class:urgent={countdown < 15 && !world.paused} class:paused={world.paused}>
        {world.paused ? '❚❚ PAUSED' : clock(countdown)}
      </span>
    </div>
    {#if me}
      <div class="cell">
        <span class="k">CREDITS</span><span class="v credits">{me.credits}</span>
      </div>
      <div class="cell">
        <span class="k">YOUR HOLD</span>
        <span class="v" style="color:{hex(me.color)}">{me.periodTonnage} / {world.quota} t</span>
      </div>
    {/if}
    <div class="controls">
      {#if $mpIsHost && world.phase === 'running'}
        <button class="ctl" on:click={pause}>{world.paused ? '▶ Resume' : '❚❚ Pause'}</button>
      {/if}
      <button class="ctl quit" on:click={quit}>✕ Quit</button>
    </div>
  </div>

  <!-- scoreboard -->
  <div class="board">
    <div class="board-title">STANDINGS</div>
    {#each board as c (c.id)}
      <div class="row" class:dead={!c.alive} class:you={c.id === $mpYouCorpId}>
        <span class="dot" style="background:{hex(c.color)}"></span>
        <span class="nm">{c.name}{c.id === $mpYouCorpId ? ' (you)' : ''}</span>
        <span class="bar"><span class="fill" style="width:{quotaPct(c)}%;background:{hex(c.color)}"></span></span>
        <span class="tons">{c.periodTonnage}t</span>
        {#if !c.alive}<span class="skull">💀</span>{:else if !c.online}<span class="off">⏻</span>{/if}
      </div>
    {/each}
  </div>

  <!-- actions -->
  {#if me && me.alive}
    <div class="actions">
      <button class="act" on:click={openBase}>◉ BASE — buy miners · sell ore</button>
      <button class="act quick" class:on={$mpQuickClaim} on:click={toggleQuickClaim} title="When on, clicking an asteroid claims it immediately (otherwise: select, then Designate)">
        ⚡ quick-claim: {$mpQuickClaim ? 'on' : 'off'}
      </button>
      <div class="fleet">
        {shipCount} hauler{shipCount === 1 ? '' : 's'} · {me.minerCount} miner{me.minerCount === 1 ? '' : 's'} ({me.miners.length} deployed) · ore {stored}/{me.storageCapacity}{#if starved}<span class="warn"> · ⚠ {starved} full</span>{/if}
      </div>
    </div>
  {/if}

  <!-- selected asteroid -->
  {#if selected}
    <div class="sel">
      <div class="sel-title resource-{selected.resourceType}">{selected.resourceType.toUpperCase()}</div>
      <div class="sel-row"><span>remaining</span><span>{selected.currentQuantity} / {selected.maxQuantity} t</span></div>
      <div class="sel-row"><span>size</span><span>{selected.sizeCategory}</span></div>
      {#if selected.claimedBy === $mpYouCorpId}
        <button class="sel-btn release" on:click={() => claim(selected)}>RELEASE CLAIM</button>
      {:else if !selected.claimedBy}
        <button class="sel-btn" on:click={() => claim(selected)} disabled={!me || !me.alive}>DESIGNATE FOR MINING</button>
      {:else}
        <div class="contested">contested — held by {corpName(selected.claimedBy)}</div>
      {/if}
      {#if me && me.minerCount === 0 && selected.claimedBy !== $mpYouCorpId}
        <div class="need-miner">No AutoMiner yet — buy one at your base ◉ to mine.</div>
      {/if}
    </div>
  {/if}

  <!-- selected ship -->
  {#if selShip}
    <div class="sel ship">
      <div class="sel-title" style="color:{hex(selShip.corp.color)}">
        {selShip.ship.name} · {selShip.corp.name}{selShip.corp.id === $mpYouCorpId ? ' (you)' : ''}
      </div>
      <div class="sel-row"><span>state</span><span>{SHIP_STATE[selShip.ship.phase] ?? selShip.ship.phase}</span></div>
      <div class="sel-row"><span>cargo</span><span>{selShip.ship.cargo} / {selShip.ship.cargoCapacity}{selShip.ship.cargoResource ? ' · ' + selShip.ship.cargoResource : ''}</span></div>
      {#if selShip.ship.carryingMiner}
        <div class="sel-row"><span>bay</span><span>carrying a miner</span></div>
      {/if}
      {#if selShip.corp.id === $mpYouCorpId}
        {#if selShip.ship.cargoLevel < MAX_CARGO_LEVEL}
          <button
            class="sel-btn"
            disabled={!me || me.credits < CARGO_UPGRADE_COSTS[selShip.ship.cargoLevel]}
            on:click={() => upgrade(selShip.ship.id)}
          >
            UPGRADE CARGO → {CARGO_CAPACITY_TIERS[selShip.ship.cargoLevel + 1]}t · {CARGO_UPGRADE_COSTS[selShip.ship.cargoLevel]}cr
          </button>
        {:else}
          <div class="sel-row"><span>cargo hold</span><span>MAX</span></div>
        {/if}
      {/if}
    </div>
  {/if}

  <!-- selected miner -->
  {#if selMiner}
    {@const a = minerAsteroid(selMiner.miner.asteroidId)}
    <div class="sel miner">
      <div class="sel-title resource-{selMiner.miner.resourceType}">
        AUTOMINER · {selMiner.miner.resourceType.toUpperCase()}
      </div>
      <div class="sel-row"><span>corp</span><span style="color:{hex(selMiner.corp.color)}">{selMiner.corp.name}{selMiner.corp.id === $mpYouCorpId ? ' (you)' : ''}</span></div>
      <div class="sel-row">
        <span>state</span>
        <span class:hot={selMiner.miner.state === 'net-starved'}>{MINER_STATE[selMiner.miner.state] ?? selMiner.miner.state}</span>
      </div>
      <div class="sel-row"><span>nets ready</span><span>{selMiner.miner.netsReady}</span></div>
      {#if a}
        <div class="sel-row"><span>rock</span><span>{a.currentQuantity} / {a.maxQuantity} t</span></div>
      {/if}
      {#if selMiner.corp.id === $mpYouCorpId}
        <button class="sel-btn release" on:click={() => recall(selMiner.miner.asteroidId)}>RECALL MINER</button>
      {/if}
    </div>
  {/if}

  <!-- event log -->
  <div class="log">
    {#each world.log.slice(-5) as line}
      <div class="log-line">{line}</div>
    {/each}
  </div>

  <!-- eliminated banner (still spectating) -->
  {#if me && !me.alive && world.phase === 'running'}
    <div class="banner-elim">LIQUIDATED — you're spectating the rest of the match</div>
  {/if}

  <!-- end screen -->
  {#if world.phase === 'ended'}
    <div class="end-overlay">
      <div class="end-card">
        {#if winner}
          <div class="end-title" style="color:{hex(winner.color)}">{winner.name}</div>
          <div class="end-sub">LAST CORP STANDING</div>
          {#if winner.id === $mpYouCorpId}
            <div class="end-you win">You won. The tonnage was yours.</div>
          {:else}
            <div class="end-you">You were deadweight. {winner.name} outlasted the field.</div>
          {/if}
        {:else}
          <div class="end-title">ALL LIQUIDATED</div>
          <div class="end-sub">NO SURVIVORS</div>
        {/if}
        <div class="end-stat">Survived {world.period} period(s) · final quota {world.quota}t</div>
        <button class="mp-again" on:click={again}>PLAY AGAIN</button>
      </div>
    </div>
  {/if}
{/if}

<style>
  .hud-top {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    gap: 1px;
    background: #0a1018;
    border-bottom: 1px solid #1c2c38;
    font-family: monospace;
    pointer-events: none;
  }
  .cell {
    padding: 6px 14px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .cell.wide {
    min-width: 90px;
  }
  .k {
    font-size: 9px;
    color: #5a7a8a;
    letter-spacing: 1px;
  }
  .v {
    font-size: 15px;
    color: #cfe6f2;
  }
  .v.credits {
    color: #ffd766;
  }
  .v.paused {
    color: #ffcc44;
  }
  .controls {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    pointer-events: auto;
  }
  .ctl {
    background: rgba(40, 60, 90, 0.7);
    border: 1px solid #2a4a6a;
    border-radius: 5px;
    color: #cfe6f2;
    font-family: monospace;
    font-size: 11px;
    padding: 5px 10px;
    cursor: pointer;
  }
  .ctl:hover {
    background: rgba(60, 90, 130, 0.8);
  }
  .ctl.quit {
    border-color: #6a3a3a;
    color: #ffaa99;
  }
  .ctl.quit:hover {
    background: rgba(90, 40, 40, 0.7);
  }
  .v.urgent {
    color: #ff5544;
    animation: blink 1s steps(2) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.4;
    }
  }
  .board {
    position: absolute;
    top: 214px;
    right: 10px;
    width: 250px;
    background: rgba(10, 16, 24, 0.85);
    border: 1px solid #1c2c38;
    border-radius: 8px;
    padding: 8px 10px;
    font-family: monospace;
    pointer-events: none;
  }
  .board-title {
    font-size: 9px;
    color: #5a7a8a;
    letter-spacing: 2px;
    margin-bottom: 6px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
    font-size: 12px;
    color: #cfe6f2;
  }
  .row.dead {
    opacity: 0.4;
  }
  .row.you .nm {
    color: #fff;
    font-weight: bold;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex: none;
  }
  .nm {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar {
    width: 46px;
    height: 5px;
    background: #16242e;
    border-radius: 3px;
    overflow: hidden;
    flex: none;
  }
  .fill {
    display: block;
    height: 100%;
  }
  .tons {
    width: 42px;
    text-align: right;
    color: #9abacc;
    font-size: 11px;
  }
  .skull,
  .off {
    font-size: 10px;
  }
  .actions {
    position: absolute;
    top: 46px;
    left: 12px;
    font-family: monospace;
    pointer-events: auto;
  }
  .act {
    background: #1b4a66;
    color: #d8f0ff;
    border: 1px solid #3a7a9a;
    border-radius: 6px;
    padding: 9px 14px;
    font-family: monospace;
    font-size: 12px;
    cursor: pointer;
  }
  .act:hover {
    background: #235b7d;
  }
  .act.quick {
    margin-top: 6px;
    display: block;
    background: rgba(20, 34, 48, 0.85);
    border-color: #2a4a5a;
    color: #7a9aaa;
    font-size: 11px;
    padding: 6px 12px;
  }
  .act.quick.on {
    background: #2f4a22;
    border-color: #6a9a4a;
    color: #cceeaa;
  }
  .act:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .fleet {
    margin-top: 5px;
    font-size: 10px;
    color: #6a8a9a;
  }
  .fleet .warn {
    color: #ffaa44;
  }
  .sel-row .hot {
    color: #ffaa44;
  }
  .sel {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    width: 240px;
    background: rgba(10, 16, 24, 0.9);
    border: 1px solid #1c2c38;
    border-radius: 8px;
    padding: 10px 12px;
    font-family: monospace;
    pointer-events: auto;
  }
  .sel-title {
    font-size: 12px;
    letter-spacing: 1px;
    margin-bottom: 6px;
  }
  .sel-row {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: #9abacc;
    padding: 1px 0;
  }
  .sel-btn {
    width: 100%;
    margin-top: 8px;
    background: #1b4a66;
    color: #d8f0ff;
    border: 1px solid #3a7a9a;
    border-radius: 6px;
    padding: 8px;
    font-family: monospace;
    font-size: 12px;
    cursor: pointer;
  }
  .sel-btn.release {
    background: #5a2a2a;
    border-color: #8a4a4a;
  }
  .sel-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .contested {
    margin-top: 8px;
    font-size: 11px;
    color: #ff9966;
    text-align: center;
  }
  .need-miner {
    margin-top: 8px;
    font-size: 10px;
    color: #ffcc66;
    text-align: center;
  }
  .log {
    position: absolute;
    bottom: 12px;
    right: 12px;
    width: 280px;
    font-family: monospace;
    font-size: 10px;
    color: #6a8a9a;
    text-align: right;
    pointer-events: none;
  }
  .log-line {
    padding: 1px 0;
  }
  .banner-elim {
    position: absolute;
    top: 64px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(90, 20, 20, 0.85);
    color: #ffbbaa;
    border: 1px solid #8a4a4a;
    border-radius: 6px;
    padding: 6px 16px;
    font-family: monospace;
    font-size: 12px;
    pointer-events: none;
  }
  .end-overlay {
    position: absolute;
    inset: 0;
    background: rgba(2, 4, 12, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
  }
  .end-card {
    text-align: center;
    font-family: monospace;
    color: #cfe6f2;
    padding: 30px 40px;
    background: #0b1320;
    border: 1px solid #244;
    border-radius: 12px;
  }
  .end-title {
    font-size: 26px;
    letter-spacing: 2px;
  }
  .end-sub {
    font-size: 11px;
    color: #5a7a8a;
    letter-spacing: 3px;
    margin-top: 4px;
  }
  .end-you {
    margin-top: 18px;
    font-size: 14px;
    color: #9abacc;
  }
  .end-you.win {
    color: #88ffaa;
  }
  .end-stat {
    margin-top: 10px;
    font-size: 11px;
    color: #5a7a8a;
  }
  .mp-again {
    margin-top: 22px;
    background: #1b4a66;
    color: #d8f0ff;
    border: 1px solid #3a7a9a;
    border-radius: 6px;
    padding: 10px 24px;
    font-family: monospace;
    font-size: 13px;
    cursor: pointer;
  }
  .resource-iron {
    color: #b06030;
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
