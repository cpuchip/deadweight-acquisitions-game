import { writable } from 'svelte/store'

const MAX = 200

/** Recent F9 invariant-sweep violations (debug-only), deduped, for copy-to-clipboard reporting. */
export const invariantLog = writable<string[]>([])

/** Records a violation once (deduped by message; the sweep fires every tick). */
export function logInvariant(msg: string, clock: number): void {
  invariantLog.update(lines => {
    if (lines.some(line => line.endsWith(msg))) return lines // already logged this distinct violation
    const next = [...lines, `[t=${clock.toFixed(0)}] ${msg}`]
    return next.length > MAX ? next.slice(next.length - MAX) : next
  })
}
