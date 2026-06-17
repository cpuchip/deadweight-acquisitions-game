import Phaser from 'phaser'
import { get } from 'svelte/store'
import { RESOURCE_COLORS } from '../../world/worldConfig'
import {
  mpSnapshot,
  mpYouCorpId,
  mpSelectedAsteroid,
  mpBasePanelOpen,
} from '../../state/mpStore'
import { sendCommand } from '../../net/mpClient'
import { PLANET_RADIUS } from '../../../shared/mpConfig'
import type { WorldSnapshot, AsteroidSnap, CorpSnap } from '../../../shared/protocol'

const SIZE_RADIUS: Record<string, number> = { small: 7, medium: 11, large: 17 }
const CLICK_TOLERANCE = 6 // screen px movement under which a pointerup counts as a click
const BASE_OUTER_R = 32 // matches Dave's base texture outer ring
const BASE_INNER_R = 20

export class MultiplayerScene extends Phaser.Scene {
  private gfx!: Phaser.GameObjects.Graphics
  private snap: WorldSnapshot | null = null
  private unsub: Array<() => void> = []
  private centered = false
  private baseLabels = new Map<string, Phaser.GameObjects.Text>()

  // pan/zoom drag bookkeeping
  private dragging = false
  private dragStart = { x: 0, y: 0 }
  private camStart = { x: 0, y: 0 }
  private moved = 0

  constructor() {
    super({ key: 'MultiplayerScene' })
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#05050f')
    this.gfx = this.add.graphics()
    this.cameras.main.setZoom(0.32)
    this.cameras.main.centerOn(0, 0)

    this.unsub.push(mpSnapshot.subscribe((s) => (this.snap = s)))

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.dragging = true
      this.moved = 0
      this.dragStart = { x: p.x, y: p.y }
      this.camStart = { x: this.cameras.main.scrollX, y: this.cameras.main.scrollY }
    })
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.dragging) return
      const dx = p.x - this.dragStart.x
      const dy = p.y - this.dragStart.y
      this.moved = Math.max(this.moved, Math.abs(dx) + Math.abs(dy))
      const zoom = this.cameras.main.zoom
      this.cameras.main.setScroll(this.camStart.x - dx / zoom, this.camStart.y - dy / zoom)
    })
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      this.dragging = false
      if (this.moved <= CLICK_TOLERANCE) this.handleClick(p)
    })
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const next = Phaser.Math.Clamp(this.cameras.main.zoom * (dy > 0 ? 0.9 : 1.1), 0.12, 1.5)
      this.cameras.main.setZoom(next)
    })

    this.scale.on('resize', () => this.cameras.main.centerOn(this.cameras.main.midPoint.x, this.cameras.main.midPoint.y))
  }

  shutdown(): void {
    for (const u of this.unsub) u()
    this.unsub = []
    for (const l of this.baseLabels.values()) l.destroy()
    this.baseLabels.clear()
  }

  private myCorp() {
    const id = get(mpYouCorpId)
    return this.snap?.corps.find((c) => c.id === id) ?? null
  }

  private handleClick(p: Phaser.Input.Pointer): void {
    if (!this.snap) return
    const world = this.cameras.main.getWorldPoint(p.x, p.y)

    // clicking YOUR base opens the station menu
    const myBase = this.myCorp()
    if (myBase && Math.hypot(world.x - myBase.baseX, world.y - myBase.baseY) <= BASE_OUTER_R + 14) {
      mpBasePanelOpen.set(true)
      mpSelectedAsteroid.set(null)
      return
    }

    const a = this.nearestAsteroid(world.x, world.y)
    if (!a) {
      mpSelectedAsteroid.set(null)
      return
    }
    mpSelectedAsteroid.set(a.id)
    const me = get(mpYouCorpId)
    if (a.claimedBy === me) {
      sendCommand({ kind: 'undesignate', asteroidId: a.id })
    } else if (!a.claimedBy) {
      sendCommand({ kind: 'designate', asteroidId: a.id })
    }
    // contested (someone else owns it): selection only, no command
  }

  private nearestAsteroid(wx: number, wy: number): AsteroidSnap | null {
    if (!this.snap) return null
    let best: { a: AsteroidSnap; d: number } | null = null
    for (const a of this.snap.asteroids) {
      const r = (SIZE_RADIUS[a.sizeCategory] ?? 8) + 10
      const dx = a.x - wx
      const dy = a.y - wy
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d <= r && (!best || d < best.d)) best = { a, d }
    }
    return best?.a ?? null
  }

  update(): void {
    const g = this.gfx
    g.clear()
    if (!this.snap) return

    // recenter once on the player's base
    if (!this.centered) {
      const me = this.myCorp()
      if (me) {
        this.cameras.main.centerOn(me.baseX, me.baseY)
        this.centered = true
      }
    }

    const colorOf = new Map(this.snap.corps.map((c) => [c.id, c.color]))
    const selected = get(mpSelectedAsteroid)

    // central planet
    g.fillStyle(0x1c3247, 1)
    g.fillCircle(0, 0, PLANET_RADIUS)
    g.fillStyle(0x244058, 0.6)
    g.fillCircle(-PLANET_RADIUS * 0.25, -PLANET_RADIUS * 0.2, PLANET_RADIUS * 0.55)
    g.lineStyle(2, 0x3a6090, 1)
    g.strokeCircle(0, 0, PLANET_RADIUS)

    // asteroids
    for (const a of this.snap.asteroids) {
      const r = SIZE_RADIUS[a.sizeCategory] ?? 8
      g.fillStyle(RESOURCE_COLORS[a.resourceType] ?? 0x888888, 1)
      g.fillCircle(a.x, a.y, r)
      if (a.claimedBy) {
        g.lineStyle(2, colorOf.get(a.claimedBy) ?? 0xffffff, 0.9)
        g.strokeCircle(a.x, a.y, r + 3)
      }
      if (a.id === selected) {
        g.lineStyle(2, 0xffffff, 1)
        g.strokeCircle(a.x, a.y, r + 6)
      }
    }

    // bases — faithful station look (inner disc + outer ring), tinted per corp
    const me = get(mpYouCorpId)
    for (const c of this.snap.corps) {
      const dim = c.alive ? 1 : 0.25
      const mine = c.id === me
      g.fillStyle(c.color, dim)
      g.fillCircle(c.baseX, c.baseY, BASE_INNER_R)
      g.lineStyle(mine ? 3 : 2, mine ? 0xffffff : 0x88ccff, dim)
      g.strokeCircle(c.baseX, c.baseY, BASE_OUTER_R)
      this.updateBaseLabel(c, mine)
    }

    // ships
    for (const c of this.snap.corps) {
      if (!c.alive) continue
      for (const s of c.ships) {
        this.drawShip(s.x, s.y, s.angle, c.color)
        if (s.cargo > 0) {
          g.fillStyle(0xffffff, 0.9)
          g.fillCircle(s.x, s.y, 2.2)
        }
      }
    }
  }

  private updateBaseLabel(c: CorpSnap, mine: boolean): void {
    let label = this.baseLabels.get(c.id)
    if (!label) {
      label = this.add
        .text(0, 0, c.name, { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff' })
        .setOrigin(0.5, 0.5)
      this.baseLabels.set(c.id, label)
    }
    label.setText(mine ? `${c.name} (you)` : c.name)
    label.setColor('#' + (c.color >>> 0).toString(16).padStart(6, '0'))
    label.setPosition(c.baseX, c.baseY + BASE_OUTER_R + 14)
    // keep a constant on-screen size regardless of camera zoom
    label.setScale(1 / this.cameras.main.zoom)
    label.setAlpha(c.alive ? 1 : 0.3)
  }

  private drawShip(x: number, y: number, angle: number, color: number): void {
    const g = this.gfx
    const len = 9
    const wid = 6
    const ca = Math.cos(angle)
    const sa = Math.sin(angle)
    // nose
    const nx = x + ca * len
    const ny = y + sa * len
    // tail corners (perpendicular)
    const px = -sa
    const py = ca
    const bx = x - ca * (len * 0.5)
    const by = y - sa * (len * 0.5)
    g.fillStyle(color, 1)
    g.fillTriangle(nx, ny, bx + px * wid, by + py * wid, bx - px * wid, by - py * wid)
  }
}
