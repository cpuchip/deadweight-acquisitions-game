<script lang="ts">
  import {
    mpConnection,
    mpError,
    mpRoom,
    mpLobbyPlayers,
    mpIsHost,
    mpSnapshot,
    mpYouName,
  } from '../../state/mpStore'
  import { connect, startMatch } from '../../net/mpClient'

  let name = ''
  let room = roomFromUrl() || randomCode()

  function randomCode(): string {
    const a = ['ore', 'haul', 'rock', 'tug', 'drift', 'slag', 'comet', 'belt']
    const n = Math.floor(Math.random() * 90 + 10)
    return a[Math.floor(Math.random() * a.length)] + '-' + n
  }

  function roomFromUrl(): string {
    return new URLSearchParams(location.search).get('room') || ''
  }

  function join(): void {
    const n = name.trim()
    if (!n) {
      mpError.set('Enter a corp name.')
      return
    }
    mpYouName.set(n)
    connect(n, room.trim() || 'lobby')
  }

  function hex(c: number): string {
    return '#' + (c >>> 0).toString(16).padStart(6, '0')
  }

  function leave(): void {
    location.reload()
  }

  let copied = false
  function copyInvite(): void {
    const link = `${location.origin}/?mp=1&room=${encodeURIComponent($mpRoom)}`
    navigator.clipboard?.writeText(link).then(
      () => {
        copied = true
        setTimeout(() => (copied = false), 1400)
      },
      () => {},
    )
  }

  // Show the join form until connected; then the roster until the match runs.
  $: showJoin = $mpConnection !== 'connected'
  $: inLobby = $mpConnection === 'connected' && (!$mpSnapshot || $mpSnapshot.phase === 'lobby')
</script>

{#if showJoin}
  <div class="mp-overlay">
    <div class="mp-panel">
      <div class="mp-title">DEADWEIGHT ACQUISITIONS</div>
      <div class="mp-sub">COMPETITIVE — LAST CORP STANDING</div>

      <label class="mp-field">
        <span>Corp name</span>
        <input bind:value={name} maxlength="18" placeholder="e.g. Stuffleberry Hauling" on:keydown={(e) => e.key === 'Enter' && join()} />
      </label>
      <label class="mp-field">
        <span>Room code</span>
        <input bind:value={room} maxlength="24" placeholder="room code" on:keydown={(e) => e.key === 'Enter' && join()} />
      </label>

      <button class="mp-btn primary" on:click={join} disabled={$mpConnection === 'connecting'}>
        {$mpConnection === 'connecting' ? 'CONNECTING…' : 'JOIN'}
      </button>
      <button class="mp-btn ghost" on:click={leave}>BACK</button>

      {#if $mpError}<div class="mp-err">{$mpError}</div>{/if}
      <div class="mp-hint">Share the room code with friends to play together. Same code = same field.</div>
    </div>
  </div>
{:else if inLobby}
  <div class="mp-overlay">
    <div class="mp-panel">
      <div class="mp-title">ROOM · {$mpRoom}</div>
      <div class="mp-sub">{$mpLobbyPlayers.length} corp(s) signed on</div>

      <div class="mp-roster">
        {#each $mpLobbyPlayers as p (p.corpId)}
          <div class="mp-player">
            <span class="mp-dot" style="background:{hex(p.color)}"></span>
            <span class="mp-pname">{p.name}</span>
            <span class="mp-pstat">{p.online ? 'ready' : 'offline'}</span>
          </div>
        {/each}
      </div>

      {#if $mpIsHost}
        <button class="mp-btn primary" on:click={startMatch} disabled={$mpLobbyPlayers.length < 1}>
          START MATCH
        </button>
        <div class="mp-hint">You're the host. Start when everyone's in. (Solo works too — survival mode.)</div>
      {:else}
        <div class="mp-waiting">Waiting for the host to start…</div>
      {/if}

      <button class="mp-btn ghost" on:click={copyInvite}>{copied ? 'LINK COPIED ✓' : 'COPY INVITE LINK'}</button>

      {#if $mpError}<div class="mp-err">{$mpError}</div>{/if}
      <button class="mp-btn ghost" on:click={leave}>LEAVE</button>
    </div>
  </div>
{/if}

<style>
  .mp-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(2, 4, 12, 0.78);
    pointer-events: auto;
    font-family: monospace;
    color: #cfe6f2;
  }
  .mp-panel {
    width: 360px;
    max-width: 90vw;
    background: #0b1320;
    border: 1px solid #244;
    border-radius: 10px;
    padding: 22px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
  }
  .mp-title {
    font-size: 16px;
    letter-spacing: 2px;
    color: #6aaaca;
    margin-bottom: 2px;
  }
  .mp-sub {
    font-size: 10px;
    letter-spacing: 1px;
    color: #5a7a8a;
    margin-bottom: 18px;
  }
  .mp-field {
    display: block;
    margin-bottom: 12px;
  }
  .mp-field span {
    display: block;
    font-size: 10px;
    color: #7a9aaa;
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .mp-field input {
    width: 100%;
    background: #05080f;
    border: 1px solid #2a4a5a;
    color: #cfe6f2;
    padding: 9px 10px;
    font-family: monospace;
    font-size: 13px;
    border-radius: 6px;
    box-sizing: border-box;
  }
  .mp-field input:focus {
    outline: none;
    border-color: #4a8aaa;
  }
  .mp-btn {
    width: 100%;
    padding: 11px;
    margin-top: 8px;
    font-family: monospace;
    font-size: 13px;
    letter-spacing: 1px;
    border-radius: 6px;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .mp-btn.primary {
    background: #1b4a66;
    color: #d8f0ff;
    border-color: #3a7a9a;
  }
  .mp-btn.primary:hover {
    background: #235b7d;
  }
  .mp-btn.primary:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .mp-btn.ghost {
    background: transparent;
    color: #6a8a9a;
    border-color: #234;
  }
  .mp-btn.ghost:hover {
    color: #9abacc;
  }
  .mp-err {
    margin-top: 12px;
    color: #ff8866;
    font-size: 12px;
  }
  .mp-hint {
    margin-top: 12px;
    color: #5a7a8a;
    font-size: 10px;
    line-height: 1.5;
  }
  .mp-waiting {
    margin-top: 8px;
    color: #88bbdd;
    font-size: 12px;
    text-align: center;
    padding: 8px;
  }
  .mp-roster {
    margin: 6px 0 14px;
    max-height: 240px;
    overflow-y: auto;
  }
  .mp-player {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 4px;
    border-bottom: 1px solid #162430;
  }
  .mp-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex: none;
  }
  .mp-pname {
    flex: 1;
    font-size: 13px;
  }
  .mp-pstat {
    font-size: 10px;
    color: #5a7a8a;
    text-transform: uppercase;
  }
</style>
