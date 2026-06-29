import { describe, it, expect } from 'vitest'
import { selectScanHauler, type SlottedShip } from './dispatchLogic'
import type { AttachmentPoint } from '../state/attachmentTypes'

const smallSlot = (payload: AttachmentPoint['payload']): AttachmentPoint => ({ id: 's', size: 'small', payload })
const ship = (id: string, x: number, payload: AttachmentPoint['payload'], state = 'idle'): SlottedShip => ({
  id, shipState: state, x, y: 0, attachmentPoints: [smallSlot(payload)],
})
const target = { x: 0, y: 0 }

describe('selectScanHauler', () => {
  it('prefers an idle ship already carrying a scanner', () => {
    const ships = [ship('free', 1, null), ship('carrier', 5, { kind: 'scanner' })]
    const r = selectScanHauler(ships, 3, target)
    expect(r?.ship.id).toBe('carrier')
    expect(r?.drawFromStorage).toBe(false)
  })

  it('draws from storage onto a free-slot ship when no carrier and scanners available', () => {
    const r = selectScanHauler([ship('free', 2, null)], 1, target)
    expect(r?.ship.id).toBe('free')
    expect(r?.drawFromStorage).toBe(true)
  })

  it('returns null when no carrier and no scanners in storage', () => {
    expect(selectScanHauler([ship('free', 2, null)], 0, target)).toBeNull()
  })

  it('picks the nearest qualifying carrier', () => {
    const ships = [ship('far', 10, { kind: 'scanner' }), ship('near', 2, { kind: 'scanner' })]
    expect(selectScanHauler(ships, 0, target)?.ship.id).toBe('near')
  })

  it('ignores non-idle ships', () => {
    expect(selectScanHauler([ship('busy', 1, { kind: 'scanner' }, 'mining')], 0, target)).toBeNull()
  })
})
