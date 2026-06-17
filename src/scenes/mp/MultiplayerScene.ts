import Phaser from 'phaser'
import { get } from 'svelte/store'
import { RESOURCE_COLORS } from '../../world/worldConfig'
import {
  mpSnapshot,
  mpYouCorpId,
  mpSelectedAsteroid,
  mpSelectedShip,
  mpSelectedMiner,
  mpBasePanelOpen,
  mpQuickClaim,
  mpCameraTarget,
} from '../../state/mpStore'
import { sendCommand } from '../../net/mpClient'
import { PLANET_RADIUS } from '../../../shared/mpConfig'
import type { WorldSnapshot, AsteroidSnap, ShipSnap, MinerSnap, CorpSnap } from '../../../shared/protocol'

const SIZE_RADIUS: Record<string, number> = { small: 7, medium: 11, large: 17 }
const CLICK_TOLERANCE = 6 // screen px movement under which a pointerup counts as a click
const BASE_OUTER_R = 32 // matches Dave's base texture outer ring
const BASE_INNER_R = 20

export class MultiplayerScene extends Phaser.Scene {
  private gfx!: Phaser.GameObjects.Graphics
  private snap: WorldSnapshot | null = null
  private unsub: Array<() => void> = []
  private centered = false
  private framedOnDeath = false
  private baseLabels = new Map<string, Phaser.GameObjects.Text>()

  // pan/zoom drag bookkeeping
  private dragging = false
  private dragStart = { x: 0, y: 0 }
  private camStart = { x: 0, y: 0 }
  private moved = 0
  private dragButton = 0 // which mouse button started the drag (0 = left)

  constructor() {
    super({ key: 'MultiplayerScene' })
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#05050f')
    this.gfx = this.add.graphics()
    this.cameras.main.setZoom(0.32)
    this.cameras.main.centerOn(0, 0)

    this.unsub.push(mpSnapshot.subscribe((s) => (this.snap = s)))

    // clicking the minimap flies the main camera to that world point (faithful to SP)
    this.unsub.push(
      mpCameraTarget.subscribe((t) => {
        if (!t) return
        this.centered = true // user took control of the view
        this.cameras.main.pan(t.x, t.y, 300, 'Power2')
      }),
    )

    // right-click drags the map without popping the browser context menu
    this.input.mouse?.disableContextMenu()

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.dragging = true
      this.moved = 0
      this.dragButton = p.button
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
      // only a LEFT click selects/claims; right/middle are pan-only
      if (this.moved <= CLICK_TOLERANCE && this.dragButton === 0) this.handleClick(p)
    })
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const next = Phaser.Math.Clamp(this.cameras.main.zoom * (dy > 0 ? 0.9 : 1.1), 0.12, 1.5)
      this.cameras.main.setZoom(next)
    })

    // F frames the whole field, C / Home re-centres on your base
    this.input.keyboard?.on('keydown-F', () => this.frameField())
    this.input.keyboard?.on('keydown-C', () => this.frameBase())
    this.input.keyboard?.on('keydown-HOME', () => this.frameBase())

    this.scale.on('resize', () => this.cameras.main.centerOn(this.cameras.main.midPoint.x, this.cameras.main.midPoint.y))
  }

  /** zoom + centre to take in the whole field (spectator / overview) */
  private frameField(): void {
    this.centered = true
    const r = this.snap?.worldRadius ?? 3000
    const vp = Math.min(this.scale.width, this.scale.height)
    this.cameras.main.setZoom(Phaser.Math.Clamp(vp / (2.2 * r), 0.1, 1.5))
    this.cameras.main.pan(0, 0, 350, 'Power2')
  }

  /** snap back to a working zoom on your own base */
  private frameBase(): void {
    this.centered = true
    const me = this.myCorp()
    this.cameras.main.setZoom(0.5)
    if (me) this.cameras.main.pan(me.baseX, me.baseY, 350, 'Power2')
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
      mpSelectedShip.set(null)
      mpSelectedMiner.set(null)
      return
    }

    // a deployed miner sits on its asteroid — it takes priority so you can inspect it
    const miner = this.nearestMiner(world.x, world.y)
    if (miner) {
      mpSelectedMiner.set(miner.id)
      mpSelectedShip.set(null)
      mpSelectedAsteroid.set(null)
      return
    }

    // a ship takes priority over an asteroid behind it
    const ship = this.nearestShip(world.x, world.y)
    if (ship) {
      mpSelectedShip.set(ship.id)
      mpSelectedAsteroid.set(null)
      mpSelectedMiner.set(null)
      return
    }

    const a = this.nearestAsteroid(world.x, world.y)
    if (!a) {
      mpSelectedAsteroid.set(null)
      mpSelectedShip.set(null)
      mpSelectedMiner.set(null)
      return
    }
    mpSelectedAsteroid.set(a.id)
    mpSelectedShip.set(null)
    mpSelectedMiner.set(null)
    // Dave's default: click only SELECTS — the panel's "Designate for Mining" button
    // dispatches. The quick-claim toggle restores click-to-designate.
    if (get(mpQuickClaim)) {
      const me = get(mpYouCorpId)
      if (!a.claimedBy) sendCommand({ kind: 'designate', asteroidId: a.id })
      else if (a.claimedBy === me) sendCommand({ kind: 'undesignate', asteroidId: a.id })
    }
  }

  private nearestShip(wx: number, wy: number): ShipSnap | null {
    if (!this.snap) return null
    let best: { s: ShipSnap; d: number } | null = null
    for (const c of this.snap.corps) {
      if (!c.alive) continue
      for (const s of c.ships) {
        const d = Math.hypot(s.x - wx, s.y - wy)
        if (d <= 16 && (!best || d < best.d)) best = { s, d }
      }
    }
    return best?.s ?? null
  }

  private nearestMiner(wx: number, wy: number): MinerSnap | null {
    if (!this.snap) return null
    let best: { m: MinerSnap; d: number } | null = null
    for (const c of this.snap.corps) {
      if (!c.alive) continue
      for (const m of c.miners) {
        const d = Math.hypot(m.x - wx, m.y - wy)
        if (d <= 13 && (!best || d < best.d)) best = { m, d }
      }
    }
    return best?.m ?? null
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

    // once eliminated, pull back to frame the whole field (you're a spectator now)
    const myc = this.myCorp()
    if (myc && !myc.alive && !this.framedOnDeath) {
      this.framedOnDeath = true
      this.frameField()
    }

    const colorOf = new Map(this.snap.corps.map((c) => [c.id, c.color]))
    const selected = get(mpSelectedAsteroid)

    // central planet — textured bands (kept within the disc)
    const PR = PLANET_RADIUS
    g.fillStyle(0x172838, 1)
    g.fillCircle(0, 0, PR)
    g.fillStyle(0x1f3a52, 0.7)
    g.fillEllipse(0, -PR * 0.34, PR * 1.5, PR * 0.32)
    g.fillStyle(0x12283a, 0.75)
    g.fillEllipse(0, PR * 0.18, PR * 1.7, PR * 0.26)
    g.fillStyle(0x1a3346, 0.7)
    g.fillEllipse(0, PR * 0.55, PR * 1.2, PR * 0.22)
    g.fillStyle(0x2a4a64, 0.45)
    g.fillCircle(-PR * 0.3, -PR * 0.3, PR * 0.4) // terminator highlight
    g.lineStyle(2, 0x3a6090, 1)
    g.strokeCircle(0, 0, PR)

    // asteroids
    for (const a of this.snap.asteroids) {
      const r = SIZE_RADIUS[a.sizeCategory] ?? 8
      // company asteroids (the richer arrivals) wear a soft gold halo
      if (a.isCompany) {
        g.lineStyle(1.5, 0xffd766, 0.55)
        g.strokeCircle(a.x, a.y, r + 4)
      }
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

    // deployed miners (at asteroids) + their tethered nets
    const selectedMiner = get(mpSelectedMiner)
    const pulse = 0.5 + 0.5 * Math.sin(this.time.now / 220) // 0..1 beacon throb
    for (const c of this.snap.corps) {
      if (!c.alive) continue
      for (const m of c.miners) {
        // beacon: a net-starved (full) or depleted miner throbs a ring for recovery
        if (m.state === 'net-starved' || m.state === 'depleted') {
          const beacon = m.state === 'net-starved' ? 0xffaa44 : 0x888888
          g.lineStyle(2, beacon, 0.25 + 0.55 * pulse)
          g.strokeCircle(m.x, m.y, 9 + pulse * 6)
        }
        g.fillStyle(c.color, 1)
        g.fillRect(m.x - 4, m.y - 4, 8, 8)
        g.lineStyle(1.5, m.state === 'net-starved' ? 0xffaa44 : m.state === 'depleted' ? 0x888888 : 0xffffff, 0.9)
        g.strokeRect(m.x - 5, m.y - 5, 10, 10)
        // selection ring
        if (m.id === selectedMiner) {
          g.lineStyle(2, 0xffffff, 1)
          g.strokeCircle(m.x, m.y, 13)
        }
        // tethered nets ringing the miner
        g.fillStyle(0xffcc44, 0.95)
        const n = Math.min(m.netsReady, 4)
        for (let i = 0; i < n; i++) {
          const ang = (i / 4) * Math.PI * 2 - Math.PI / 2
          g.fillCircle(m.x + Math.cos(ang) * 11, m.y + Math.sin(ang) * 11, 2.2)
        }
      }
    }

    // orphaned nets drifting in the field (from recalled/lost miners) — salvage
    for (const c of this.snap.corps) {
      if (!c.alive || !c.orphanNets) continue
      for (const o of c.orphanNets) {
        g.lineStyle(1, 0xffcc44, 0.35 + 0.35 * pulse)
        g.strokeCircle(o.x, o.y, 8 + pulse * 3)
        g.fillStyle(0xffcc44, 0.85)
        for (let i = 0; i < 4; i++) {
          const ang = (i / 4) * Math.PI * 2 + this.time.now / 900
          g.fillCircle(o.x + Math.cos(ang) * 5, o.y + Math.sin(ang) * 5, 1.8)
        }
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
        if (s.carryingMiner) {
          g.fillStyle(0xffffff, 0.95)
          g.fillRect(s.x - 2, s.y - 2, 4, 4) // the miner it's carrying out
        } else if (s.cargo > 0) {
          g.fillStyle(0xffcc44, 0.95)
          g.fillCircle(s.x, s.y, 2.2) // ore nets aboard
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
