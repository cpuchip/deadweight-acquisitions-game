import { writable } from 'svelte/store'

export interface LeverView {
  capacity: number
  demand: number
  /** Effective price after the capacity-vs-demand factor. */
  price: number
  /** Static base price the factor is applied to. */
  base: number
}

export type LeverKey = 'solar' | 'propellant' | 'foundry'

/** Per-lever capacity / fleet-demand / effective price, mirrored from the scene for the UI. */
export const infrastructure = writable<Record<LeverKey, LeverView>>({
  solar:      { capacity: 0, demand: 0, price: 0, base: 0 },
  propellant: { capacity: 0, demand: 0, price: 0, base: 0 },
  foundry:    { capacity: 0, demand: 0, price: 0, base: 0 },
})
