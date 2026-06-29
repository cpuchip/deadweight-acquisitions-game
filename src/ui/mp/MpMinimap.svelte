<script lang="ts">
  import { onMount } from 'svelte'
  import { mpSnapshot, mpConnection, mpCameraTarget } from '../../state/mpStore'
  import { RESOURCE_COLORS } from '../../world/worldConfig'
  import { PLANET_RADIUS } from '../../../shared/mpConfig'
  import type { WorldSnapshot } from '../../../shared/protocol'

  const W = 178
  const H = 158
  const EXTENT = 3100 // world half-span the minimap covers
  const SCALE = Math.min(W, H) / (2 * EXTENT)

  let canvas: HTMLCanvasElement
  let ctx: CanvasRenderingContext2D | null = null

  function hex(c: number): string {
    return '#' + (c >>> 0).toString(16).padStart(6, '0')
  }

  // click the minimap to fly the main camera to that world point (faithful to SP)
  function navigate(e: MouseEvent): void {
    const worldX = (e.offsetX - W / 2) / SCALE
    const worldY = (e.offsetY - H / 2) / SCALE
    mpCameraTarget.set({ x: worldX, y: worldY })
  }

  onMount(() => {
    ctx = canvas.getContext('2d')
    const unsub = mpSnapshot.subscribe(draw)
    return unsub
  })

  function draw(w: WorldSnapshot | null): void {
    if (!ctx) return
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = 'rgba(10, 16, 24, 0.82)'
    ctx.fillRect(0, 0, W, H)
    if (!w) return

    const cx = W / 2
    const cy = H / 2
    const scale = SCALE
    const toX = (x: number) => Math.max(1, Math.min(W - 1, cx + x * scale))
    const toY = (y: number) => Math.max(1, Math.min(H - 1, cy + y * scale))

    // planet
    ctx.fillStyle = '#2a4a64'
    ctx.beginPath()
    ctx.arc(cx, cy, Math.max(2, PLANET_RADIUS * scale), 0, Math.PI * 2)
    ctx.fill()

    // asteroids (company arrivals stand out gold + a touch larger)
    for (const a of w.asteroids) {
      if (a.isCompany) {
        ctx.fillStyle = '#ffd766'
        ctx.fillRect(toX(a.x) - 1, toY(a.y) - 1, 2.5, 2.5)
      } else if (!a.scanned) {
        ctx.fillStyle = '#566472' // unscanned high-yield rock — a muted mystery blip
        ctx.fillRect(toX(a.x) - 0.5, toY(a.y) - 0.5, 1.5, 1.5)
      } else {
        ctx.fillStyle = hex(RESOURCE_COLORS[a.resourceType] ?? 0x888888)
        ctx.fillRect(toX(a.x) - 0.5, toY(a.y) - 0.5, 1.5, 1.5)
      }
    }

    // bases (squares) + ships (dots)
    for (const c of w.corps) {
      ctx.globalAlpha = c.alive ? 1 : 0.3
      ctx.fillStyle = hex(c.color)
      ctx.fillRect(toX(c.baseX) - 2.5, toY(c.baseY) - 2.5, 5, 5)
      if (c.alive) {
        for (const s of c.ships) ctx.fillRect(toX(s.x) - 1, toY(s.y) - 1, 2, 2)
      }
      ctx.globalAlpha = 1
    }

    // net-starved miners beacon amber — spot a stuck miner field-wide
    ctx.fillStyle = '#ffaa44'
    for (const c of w.corps) {
      if (!c.alive) continue
      for (const m of c.miners) {
        if (m.state !== 'net-starved') continue
        ctx.fillRect(toX(m.x) - 1.5, toY(m.y) - 1.5, 3, 3)
      }
    }
  }

  $: show = $mpConnection === 'connected' && !!$mpSnapshot && $mpSnapshot.phase !== 'lobby'
</script>

<div class="mm" style:display={show ? 'block' : 'none'}>
  <canvas bind:this={canvas} width={W} height={H} on:click={navigate} title="click to fly the view here"></canvas>
</div>

<style>
  .mm {
    position: absolute;
    top: 46px;
    right: 10px;
    border: 1px solid #2a4a5a;
    border-radius: 4px;
    overflow: hidden;
    line-height: 0;
    pointer-events: auto;
  }
  canvas {
    display: block;
    cursor: pointer;
  }
</style>
