import { describe, it, expect } from 'vitest'
import {
  designationsToRevert,
  chooseDock,
  shouldReleaseWaitingHauler,
  planNetCollection,
} from './simLogic'

// ── designationsToRevert ───────────────────────────────────────────────────

describe('designationsToRevert', () => {
  const exists = (ids: string[]) => (id: string) => ids.includes(id)
  const mined = (ids: string[]) => (id: string) => ids.includes(id)

  it('reverts a fulfilled designation whose asteroid exists but has no miner', () => {
    const desigs = [{ id: 'd1', asteroidId: 'a1', status: 'fulfilled' }]
    expect(designationsToRevert(desigs, exists(['a1']), mined([]))).toEqual(['d1'])
  })

  it('keeps a fulfilled designation whose asteroid still has a miner', () => {
    const desigs = [{ id: 'd1', asteroidId: 'a1', status: 'fulfilled' }]
    expect(designationsToRevert(desigs, exists(['a1']), mined(['a1']))).toEqual([])
  })

  it('ignores fulfilled designations whose asteroid is gone (retired elsewhere)', () => {
    const desigs = [{ id: 'd1', asteroidId: 'a1', status: 'fulfilled' }]
    expect(designationsToRevert(desigs, exists([]), mined([]))).toEqual([])
  })

  it('ignores queued/claimed designations', () => {
    const desigs = [
      { id: 'd1', asteroidId: 'a1', status: 'queued' },
      { id: 'd2', asteroidId: 'a2', status: 'claimed' },
    ]
    expect(designationsToRevert(desigs, exists(['a1', 'a2']), mined([]))).toEqual([])
  })
})

// ── chooseDock ─────────────────────────────────────────────────────────────

describe('chooseDock', () => {
  it('uses a free owned dock (no fee) when available', () => {
    expect(chooseDock(2, [false, false], 5)).toEqual({ index: 0, isPublic: false })
    expect(chooseDock(2, [true, false], 5)).toEqual({ index: 1, isPublic: false })
  })

  it('falls back to a public dock when all owned docks are occupied', () => {
    expect(chooseDock(2, [true, true], 5)).toEqual({ index: 2, isPublic: true })
  })

  it('uses a public dock when there are no owned docks', () => {
    expect(chooseDock(0, [], 5)).toEqual({ index: 0, isPublic: true })
  })

  it('clamps the public index to the fallback max', () => {
    expect(chooseDock(6, [true, true, true, true, true, true], 5)).toEqual({ index: 5, isPublic: true })
  })
})

// ── shouldReleaseWaitingHauler ─────────────────────────────────────────────

describe('shouldReleaseWaitingHauler', () => {
  it('releases when the asteroid is gone', () => {
    expect(shouldReleaseWaitingHauler(false, true, true)).toBe(true)
  })
  it('releases when nothing is actionable', () => {
    expect(shouldReleaseWaitingHauler(true, false, false)).toBe(true)
  })
  it('keeps waiting with an actionable miner', () => {
    expect(shouldReleaseWaitingHauler(true, true, false)).toBe(false)
  })
  it('keeps waiting with collectable nets', () => {
    expect(shouldReleaseWaitingHauler(true, false, true)).toBe(false)
  })
})

// ── planNetCollection ──────────────────────────────────────────────────────

describe('planNetCollection', () => {
  it('collects all nets when slots suffice', () => {
    expect(planNetCollection(['n1', 'n2'], 3)).toEqual({ collect: ['n1', 'n2'], orphan: [] })
  })
  it('collects up to free slots and orphans the rest', () => {
    expect(planNetCollection(['n1', 'n2', 'n3'], 1)).toEqual({ collect: ['n1'], orphan: ['n2', 'n3'] })
  })
  it('orphans everything when there are no free slots', () => {
    expect(planNetCollection(['n1', 'n2'], 0)).toEqual({ collect: [], orphan: ['n1', 'n2'] })
  })
  it('handles no nets', () => {
    expect(planNetCollection([], 2)).toEqual({ collect: [], orphan: [] })
  })
})
