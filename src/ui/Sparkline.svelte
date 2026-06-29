<script lang="ts">
  import type { PriceSample } from '../state/metricsStore'

  export let samples: PriceSample[] = []
  export let width = 110
  export let height = 26

  $: vals = samples.flatMap(s => [s.current, s.baseline])
  $: min = vals.length ? Math.min(...vals) : 0
  $: max = vals.length ? Math.max(...vals) : 1
  $: range = max - min || 1

  function px(i: number, n: number): number {
    return n <= 1 ? width : (i / (n - 1)) * width
  }
  function py(v: number): number {
    // 2px padding top/bottom so lines aren't clipped
    return (height - 2) - ((v - min) / range) * (height - 4) + 1
  }

  $: currentPts = samples.map((s, i) => `${px(i, samples.length).toFixed(1)},${py(s.current).toFixed(1)}`).join(' ')
  $: baselinePts = samples.map((s, i) => `${px(i, samples.length).toFixed(1)},${py(s.baseline).toFixed(1)}`).join(' ')
</script>

<svg class="spark" {width} {height} viewBox="0 0 {width} {height}" preserveAspectRatio="none">
  {#if samples.length > 0}
    <polyline class="baseline" points={baselinePts} />
    <polyline class="current" points={currentPts} />
  {/if}
</svg>

<style>
  .spark {
    display: block;
    background: rgba(20, 30, 45, 0.5);
    border: 1px solid #2a3a4a;
    border-radius: 2px;
  }
  .baseline {
    fill: none;
    stroke: #7a8a99;
    stroke-width: 1;
    stroke-dasharray: 2 2;
  }
  .current {
    fill: none;
    stroke: #66bbff;
    stroke-width: 1.5;
  }
</style>
