import { describe, it, expect } from 'vitest'
import { pushBounded } from './history'

describe('pushBounded', () => {
  it('grows and preserves order below the cap', () => {
    let s: number[] = []
    s = pushBounded(s, 1, 3)
    s = pushBounded(s, 2, 3)
    expect(s).toEqual([1, 2])
  })

  it('drops the oldest and holds length at the cap', () => {
    let s: number[] = [1, 2, 3]
    s = pushBounded(s, 4, 3)
    expect(s).toEqual([2, 3, 4])
    expect(s.length).toBe(3)
  })

  it('always retains the newest sample', () => {
    let s: number[] = []
    for (let i = 0; i < 100; i++) s = pushBounded(s, i, 10)
    expect(s.length).toBe(10)
    expect(s[s.length - 1]).toBe(99)
    expect(s[0]).toBe(90)
  })

  it('does not mutate the input array', () => {
    const a = [1, 2]
    const b = pushBounded(a, 3, 5)
    expect(a).toEqual([1, 2])
    expect(b).toEqual([1, 2, 3])
  })
})
