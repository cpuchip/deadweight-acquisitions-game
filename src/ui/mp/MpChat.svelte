<script lang="ts">
  import { tick } from 'svelte'
  import { mpChat, mpConnection, mpYouName } from '../../state/mpStore'
  import { sendChat } from '../../net/mpClient'

  let draft = ''
  let list: HTMLDivElement
  let open = true

  function hex(c: number): string {
    return '#' + (c >>> 0).toString(16).padStart(6, '0')
  }

  async function submit(): Promise<void> {
    const t = draft.trim()
    if (!t) return
    sendChat(t)
    draft = ''
    await tick()
    if (list) list.scrollTop = list.scrollHeight
  }

  // auto-scroll to the newest line as messages arrive
  $: if ($mpChat && list) {
    tick().then(() => {
      if (list) list.scrollTop = list.scrollHeight
    })
  }

  $: show = $mpConnection === 'connected'
</script>

{#if show}
  <div class="chat" class:closed={!open}>
    <button class="bar" on:click={() => (open = !open)} title="toggle chat">
      <span>CHAT</span><span class="chev">{open ? '▾' : '▴'}</span>
    </button>
    {#if open}
      <div class="lines" bind:this={list}>
        {#each $mpChat as line (line.id)}
          <div class="line">
            <span class="who" style="color:{hex(line.color)}">{line.from}{line.from === $mpYouName ? ' (you)' : ''}:</span>
            <span class="txt">{line.text}</span>
          </div>
        {/each}
        {#if $mpChat.length === 0}
          <div class="empty">Say hi to the room…</div>
        {/if}
      </div>
      <form class="entry" on:submit|preventDefault={submit}>
        <input bind:value={draft} maxlength="160" placeholder="message…" autocomplete="off" />
        <button type="submit" disabled={!draft.trim()}>➤</button>
      </form>
    {/if}
  </div>
{/if}

<style>
  .chat {
    position: absolute;
    bottom: 12px;
    left: 12px;
    width: 264px;
    background: rgba(10, 16, 24, 0.86);
    border: 1px solid #1c2c38;
    border-radius: 8px;
    font-family: monospace;
    pointer-events: auto;
    overflow: hidden;
  }
  .bar {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(20, 34, 48, 0.9);
    border: none;
    border-bottom: 1px solid #1c2c38;
    color: #7a9aaa;
    font-family: monospace;
    font-size: 9px;
    letter-spacing: 2px;
    padding: 5px 10px;
    cursor: pointer;
  }
  .chat.closed .bar {
    border-bottom: none;
  }
  .chev {
    color: #5a7a8a;
  }
  .lines {
    max-height: 140px;
    overflow-y: auto;
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .line {
    font-size: 11px;
    line-height: 1.35;
    word-break: break-word;
  }
  .who {
    font-weight: bold;
    margin-right: 4px;
  }
  .txt {
    color: #cfe6f2;
  }
  .empty {
    font-size: 10px;
    color: #5a7a8a;
    font-style: italic;
  }
  .entry {
    display: flex;
    gap: 4px;
    padding: 6px;
    border-top: 1px solid #16242e;
  }
  .entry input {
    flex: 1;
    background: #0a1018;
    border: 1px solid #2a4a5a;
    border-radius: 5px;
    color: #cfe6f2;
    font-family: monospace;
    font-size: 11px;
    padding: 5px 7px;
    min-width: 0;
  }
  .entry input:focus {
    outline: none;
    border-color: #3a7a9a;
  }
  .entry button {
    background: #1b4a66;
    border: 1px solid #3a7a9a;
    border-radius: 5px;
    color: #d8f0ff;
    font-size: 11px;
    padding: 5px 9px;
    cursor: pointer;
  }
  .entry button:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
