import Phaser from 'phaser'
import { get } from 'svelte/store'
import { RESOURCE_COLORS, SIZE_CONFIGS, ASTEROID_TEXTURE_SIZE } from '../../world/worldConfig'
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
import { PLANET_RADIUS, NET_RING_RADIUS } from '../../../shared/mpConfig'
import type { WorldSnapshot, AsteroidSnap, ShipSnap, MinerSnap, CorpSnap, ShipPhase } from '../../../shared/protocol'

const SIZE_RADIUS: Record<string, number> = { small: 7, medium: 11, large: 17 }

// --- Dave's generated atlases (loaded in BootScene, so cached before this scene runs) ---
const SHIP_ATLAS = 'dwa_ships' //   frames: hauler, miner
const STATION_ATLAS = 'dwa_station' // frames: hub, tank, habitat, solar, dock
const ASTEROID_ATLAS = 'dwa_asteroids' // frames: iron, ice, silicates, rare-metals, unknown
const PLANET_ATLAS = 'dwa_planet' // frame: planet
const FLAME_TEX = 'fx-flame'

// Ship atlas art faces "up"; in-game heading 0 = east, so render at heading + 90°.
const SHIP_ART_ANGLE_OFFSET = 90
const SHIP_DISPLAY_LENGTH = 36 // px along the travel axis (matches SP)
const MINER_DISPLAY = 18
// Plume geometry (faithful to Ship.ts): a slim additive billboard out the nozzle.
const EXHAUST_OFFSET = 24
const PLUME_WIDTH = 15
const PLUME_LENGTH = 72
// Phases where the hull is under main thrust (plume on).
const TRANSIT_PHASES: ReadonlySet<ShipPhase> = new Set<ShipPhase>(['to-asteroid', 'to-orphan', 'to-base'])

// Modular station (faithful to Base.ts): hub + four radiating modules at 44px/160px cells.
const MODULE_DISPLAY = 44
const MODULE_SCALE = MODULE_DISPLAY / 160
const CELL = MODULE_DISPLAY
const STATION_MODULES = [
  { frame: 'solar', dx: 0, dy: -CELL, angle: 0 },
  { frame: 'dock', dx: 0, dy: CELL, angle: 0 },
  { frame: 'tank', dx: -CELL, dy: 0, angle: 90 },
  { frame: 'habitat', dx: CELL, dy: 0, angle: -90 },
] as const

const BASE_OUTER_R = 32 // identity ring radius + click target (matches SP base footprint)
const DOCK_COUNT = 6
const DOCK_RADIUS = 46 // where idle haulers park (a ring just outside the hub)

export class MultiplayerScene extends Phaser.Scene {
  private bgGfx!: Phaser.GameObjects.Graphics // starfield + planet glow (behind sprites)
  private fxGfx!: Phaser.GameObjects.Graphics // rings, nets, beacons, bars (over sprites)
  private snap: WorldSnapshot | null = null
  private unsub: Array<() => void> = []
  private centered = false
  private framedOnDeath = false
  private baseLabels = new Map<string, Phaser.GameObjects.Text>()

  // sprite pools keyed by entity id (created on first sight, culled when gone)
  private planet: Phaser.GameObjects.Image | null = null
  private astSprites = new Map<string, Phaser.GameObjects.Image>()
  private shipSprites = new Map<string, Phaser.GameObjects.Image>()
  private plumeSprites = new Map<string, Phaser.GameObjects.Image>()
  private minerSprites = new Map<string, Phaser.GameObjects.Image>()
  private stations = new Map<string, Phaser.GameObjects.Container>()

  // depth bands so z-order is explicit regardless of creation order
  private static readonly D_BG = -100
  private static readonly D_PLANET = -90
  private static readonly D_ASTEROID = -10
  private static readonly D_STATION = 0
  private static readonly D_MINER = 8
  private static readonly D_PLUME = 9
  private static readonly D_SHIP = 10
  private static readonly D_FX = 50
  private static readonly D_LABEL = 60

  // smoothing: ease each moving object's displayed position toward the latest snapshot,
  // so 20Hz snapshots render as continuous motion (SP runs its sim at 60fps locally).
  private disp = new Map<string, { x: number; y: number }>()
  private seen = new Set<string>()
  private stars: { x: number; y: number; a: number; r: number }[] = []

  /** eased display position for an entity id, snapping on a big jump (deploy/respawn) */
  private smooth(id: string, tx: number, ty: number): { x: number; y: number } {
    this.seen.add(id)
    let p = this.disp.get(id)
    if (!p) {
      p = { x: tx, y: ty }
      this.disp.set(id, p)
    } else if (Math.abs(tx - p.x) + Math.abs(ty - p.y) > 500) {
      p.x = tx
      p.y = ty
    } else {
      p.x += (tx - p.x) * 0.35
      p.y += (ty - p.y) * 0.35
    }
    return p
  }

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
    this.bgGfx = this.add.graphics().setDepth(MultiplayerScene.D_BG)
    this.fxGfx = this.add.graphics().setDepth(MultiplayerScene.D_FX)
    this.cameras.main.setZoom(0.32)
    this.cameras.main.centerOn(0, 0)

    // a world-space starfield for depth + motion reference (faithful to SP)
    this.stars = []
    for (let i = 0; i < 520; i++) {
      this.stars.push({
        x: (Math.random() * 2 - 1) * 4200,
        y: (Math.random() * 2 - 1) * 4200,
        a: 0.15 + Math.random() * 0.55,
        r: 2 + Math.random() * 3,
      })
    }

    // central planet sprite (Dave's gas-giant), slow z-spin so the storm reads
    if (this.textures.exists(PLANET_ATLAS)) {
      this.planet = this.add
        .image(0, 0, PLANET_ATLAS, 'planet')
        .setDepth(MultiplayerScene.D_PLANET)
        .setDisplaySize(PLANET_RADIUS * 2, PLANET_RADIUS * 2)
      this.tweens.add({ targets: this.planet, angle: 360, duration: 120000, repeat: -1 })
    }

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
      if (this.dragButton === 0) return // LEFT button never pans — it's select-only
      const dx = p.x - this.dragStart.x
      const dy = p.y - this.dragStart.y
      this.moved = Math.max(this.moved, Math.abs(dx) + Math.abs(dy))
      const zoom = this.cameras.main.zoom
      this.cameras.main.setScroll(this.camStart.x - dx / zoom, this.camStart.y - dy / zoom)
    })
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      this.dragging = false
      // LEFT = select (never drags, so a wiggle while clicking still selects);
      // right/middle are pan-only
      if (this.dragButton === 0) this.handleClick(p)
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
    this.planet?.destroy()
    this.planet = null
    for (const m of [this.astSprites, this.shipSprites, this.plumeSprites, this.minerSprites]) {
      for (const s of m.values()) s.destroy()
      m.clear()
    }
    for (const c of this.stations.values()) c.destroy()
    this.stations.clear()
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

  /** where an entity is actually drawn (eased/parked), so a click matches what you see */
  private shownPos(id: string, rawX: number, rawY: number): { x: number; y: number } {
    return this.disp.get(id) ?? { x: rawX, y: rawY }
  }

  private nearestShip(wx: number, wy: number): ShipSnap | null {
    if (!this.snap) return null
    let best: { s: ShipSnap; d: number } | null = null
    for (const c of this.snap.corps) {
      if (!c.alive) continue
      for (const s of c.ships) {
        const p = this.shownPos(s.id, s.x, s.y)
        const d = Math.hypot(p.x - wx, p.y - wy)
        if (d <= 32 && (!best || d < best.d)) best = { s, d }
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
        const p = this.shownPos(m.id, m.x, m.y)
        const d = Math.hypot(p.x - wx, p.y - wy)
        if (d <= 26 && (!best || d < best.d)) best = { m, d }
      }
    }
    return best?.m ?? null
  }

  private nearestAsteroid(wx: number, wy: number): AsteroidSnap | null {
    if (!this.snap) return null
    let best: { a: AsteroidSnap; d: number } | null = null
    for (const a of this.snap.asteroids) {
      const r = (SIZE_RADIUS[a.sizeCategory] ?? 8) * 2 + 20 // doubled hitbox — easier to grab
      const p = this.shownPos(a.id, a.x, a.y)
      const d = Math.hypot(p.x - wx, p.y - wy)
      if (d <= r && (!best || d < best.d)) best = { a, d }
    }
    return best?.a ?? null
  }

  // ---- sprite pool helpers (get-or-create, keyed by id) ----

  private ensureAst(a: AsteroidSnap): Phaser.GameObjects.Image | null {
    if (!this.textures.exists(ASTEROID_ATLAS)) return null
    // unscanned (large) rocks read as the generic 'unknown' frame until a ship scouts
    // near them; otherwise the per-resource frame (iron/ice/silicates/rare-metals)
    const tex = this.textures.get(ASTEROID_ATLAS)
    const frame = !a.scanned || !tex.has(a.resourceType) ? 'unknown' : a.resourceType
    let s = this.astSprites.get(a.id)
    if (!s) {
      s = this.add.image(a.x, a.y, ASTEROID_ATLAS, frame).setDepth(MultiplayerScene.D_ASTEROID)
      this.astSprites.set(a.id, s)
    } else if (s.frame.name !== frame) {
      s.setFrame(frame) // a rock just revealed — swap unknown -> its resource
    }
    return s
  }

  private ensureShip(s: ShipSnap): Phaser.GameObjects.Image | null {
    if (!this.textures.exists(SHIP_ATLAS)) return null
    let img = this.shipSprites.get(s.id)
    if (!img) {
      img = this.add.image(s.x, s.y, SHIP_ATLAS, 'hauler').setDepth(MultiplayerScene.D_SHIP)
      img.setScale(SHIP_DISPLAY_LENGTH / Math.max(img.height, 1)) // art faces up; scale to length
      this.shipSprites.set(s.id, img)
    }
    return img
  }

  private ensurePlume(id: string): Phaser.GameObjects.Image | null {
    if (!this.textures.exists(FLAME_TEX)) return null
    let p = this.plumeSprites.get(id)
    if (!p) {
      p = this.add
        .image(0, 0, FLAME_TEX)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setOrigin(0.5, 0.15) // hot end attaches at the nozzle
        .setDepth(MultiplayerScene.D_PLUME)
        .setVisible(false)
      this.plumeSprites.set(id, p)
    }
    return p
  }

  private ensureMiner(m: MinerSnap, color: number): Phaser.GameObjects.Image | null {
    if (!this.textures.exists(SHIP_ATLAS)) return null
    let img = this.minerSprites.get(m.id)
    if (!img) {
      img = this.add
        .image(m.x, m.y, SHIP_ATLAS, 'miner')
        .setDepth(MultiplayerScene.D_MINER)
        .setDisplaySize(MINER_DISPLAY, MINER_DISPLAY)
      this.minerSprites.set(m.id, img)
    }
    img.setTint(color)
    return img
  }

  /** a per-corp modular station (hub + radiating modules), hub tinted to the corp color */
  private ensureStation(c: CorpSnap): Phaser.GameObjects.Container | null {
    if (!this.textures.exists(STATION_ATLAS)) return null
    let cont = this.stations.get(c.id)
    if (!cont) {
      const parts: Phaser.GameObjects.GameObject[] = []
      const hub = this.add.image(0, 0, STATION_ATLAS, 'hub').setScale(MODULE_SCALE).setTint(c.color)
      parts.push(hub)
      for (const m of STATION_MODULES) {
        const mod = this.add.image(m.dx, m.dy, STATION_ATLAS, m.frame).setScale(MODULE_SCALE).setAngle(m.angle)
        parts.push(mod)
      }
      cont = this.add.container(c.baseX, c.baseY, parts).setDepth(MultiplayerScene.D_STATION)
      this.stations.set(c.id, cont)
    }
    return cont
  }

  /** destroy pooled sprites whose id wasn't present this frame */
  private cull<T extends Phaser.GameObjects.GameObject>(pool: Map<string, T>, live: Set<string>): void {
    for (const k of pool.keys()) {
      if (!live.has(k)) {
        pool.get(k)!.destroy()
        pool.delete(k)
      }
    }
  }

  update(): void {
    const bg = this.bgGfx
    const g = this.fxGfx
    bg.clear()
    g.clear()
    this.seen.clear()
    if (!this.snap) return

    // starfield (drawn first, behind everything)
    for (const s of this.stars) {
      bg.fillStyle(0xffffff, s.a)
      bg.fillCircle(s.x, s.y, s.r)
    }

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

    // soft atmosphere halo behind the planet sprite (sprite handles the body)
    const PR = PLANET_RADIUS
    for (let i = 5; i >= 1; i--) {
      bg.fillStyle(0x2a5a8a, 0.05 * i)
      bg.fillCircle(0, 0, PR + i * 7)
    }

    // ---- asteroids (sprite per resource; eased position; scaled by size + depletion) ----
    const liveAst = new Set<string>()
    const astPos = new Map<string, { x: number; y: number }>()
    for (const a of this.snap.asteroids) {
      liveAst.add(a.id)
      const p = this.smooth(a.id, a.x, a.y)
      astPos.set(a.id, p)
      const ratio = a.maxQuantity > 0 ? a.currentQuantity / a.maxQuantity : 1
      const d = ASTEROID_TEXTURE_SIZE * SIZE_CONFIGS[a.sizeCategory].scale * Math.max(0.25, ratio)
      const sprite = this.ensureAst(a)
      if (sprite) {
        sprite.setPosition(p.x, p.y).setDisplaySize(d, d)
      } else {
        // fallback: procedural circle if the atlas is somehow absent
        bg.fillStyle(RESOURCE_COLORS[a.resourceType] ?? 0x888888, 1)
        bg.fillCircle(p.x, p.y, d / 2)
      }
      const rr = d / 2
      // company asteroids (the richer arrivals) wear a soft gold halo
      if (a.isCompany) {
        g.lineStyle(1.5, 0xffd766, 0.55)
        g.strokeCircle(p.x, p.y, rr + 5)
      }
      if (a.claimedBy) {
        g.lineStyle(2, colorOf.get(a.claimedBy) ?? 0xffffff, 0.9)
        g.strokeCircle(p.x, p.y, rr + 4)
      }
      if (a.id === selected) {
        g.lineStyle(2, 0xffffff, 1)
        g.strokeCircle(p.x, p.y, rr + 8)
      }
    }
    this.cull(this.astSprites, liveAst)

    // ---- deployed miners (sprite at asteroid) + beacons + tethered nets ----
    const liveMiner = new Set<string>()
    const selectedMiner = get(mpSelectedMiner)
    const pulse = 0.5 + 0.5 * Math.sin(this.time.now / 220) // 0..1 beacon throb
    for (const c of this.snap.corps) {
      if (!c.alive) continue
      for (const m of c.miners) {
        liveMiner.add(m.id)
        const p = this.smooth(m.id, m.x, m.y)
        const img = this.ensureMiner(m, c.color)
        if (img) img.setPosition(p.x, p.y)
        else {
          g.fillStyle(c.color, 1)
          g.fillRect(p.x - 4, p.y - 4, 8, 8)
        }
        // beacon: a net-starved (full) or depleted miner throbs a ring for recovery
        if (m.state === 'net-starved' || m.state === 'depleted') {
          const beacon = m.state === 'net-starved' ? 0xffaa44 : 0x888888
          g.lineStyle(2, beacon, 0.25 + 0.55 * pulse)
          g.strokeCircle(p.x, p.y, 12 + pulse * 6)
        }
        // selection ring
        if (m.id === selectedMiner) {
          g.lineStyle(2, 0xffffff, 1)
          g.strokeCircle(p.x, p.y, 14)
        }
        // tethered nets ring the ASTEROID (faithful to SP), not the miner above it
        const ap = astPos.get(m.asteroidId) ?? p
        g.fillStyle(0xffcc44, 0.95)
        const n = Math.min(m.netsReady, 4)
        for (let i = 0; i < n; i++) {
          const ang = (i / 4) * Math.PI * 2 - Math.PI / 2
          g.fillCircle(ap.x + Math.cos(ang) * NET_RING_RADIUS, ap.y + Math.sin(ang) * NET_RING_RADIUS, 2.6)
        }
      }
    }
    this.cull(this.minerSprites, liveMiner)

    // orphaned nets drifting in the field (from recalled/lost miners) — salvage
    for (const c of this.snap.corps) {
      if (!c.alive || !c.orphanNets) continue
      for (const o of c.orphanNets) {
        const p = this.smooth(o.id, o.x, o.y)
        g.lineStyle(1, 0xffcc44, 0.35 + 0.35 * pulse)
        g.strokeCircle(p.x, p.y, 8 + pulse * 3)
        g.fillStyle(0xffcc44, 0.85)
        for (let i = 0; i < 4; i++) {
          const ang = (i / 4) * Math.PI * 2 + this.time.now / 900
          g.fillCircle(p.x + Math.cos(ang) * 5, p.y + Math.sin(ang) * 5, 1.8)
        }
      }
    }

    // ---- bases: Dave's modular station per corp, following its Keplerian orbit ----
    const me = get(mpYouCorpId)
    for (const c of this.snap.corps) {
      const dim = c.alive ? 1 : 0.3
      const mine = c.id === me
      const station = this.ensureStation(c)
      if (station) {
        station.setPosition(c.baseX, c.baseY).setAlpha(dim)
      } else {
        // fallback disc
        g.fillStyle(c.color, dim)
        g.fillCircle(c.baseX, c.baseY, 20)
      }
      // a thin corp-colored identity ring + a brighter ring for your own station
      g.lineStyle(mine ? 3 : 2, mine ? 0xffffff : c.color, 0.8 * dim)
      g.strokeCircle(c.baseX, c.baseY, BASE_OUTER_R)
      this.updateBaseLabel(c, mine)
    }

    // ---- ships: hauler sprite (tinted per corp) + thruster plume ----
    const liveShip = new Set<string>()
    const livePlume = new Set<string>()
    for (const c of this.snap.corps) {
      if (!c.alive) continue
      let parkIdx = 0
      for (const s of c.ships) {
        liveShip.add(s.id)
        let tx = s.x
        let ty = s.y
        // park idle haulers at the docks (first unoccupied, like SP) so they read
        // clearly — otherwise they sit dead-centre on the base disc and vanish into it
        if (s.phase === 'idle') {
          const ang = -Math.PI / 2 + ((parkIdx % DOCK_COUNT) / DOCK_COUNT) * Math.PI * 2
          tx = c.baseX + Math.cos(ang) * DOCK_RADIUS
          ty = c.baseY + Math.sin(ang) * DOCK_RADIUS
          parkIdx += 1
        }
        const p = this.smooth(s.id, tx, ty)
        const angDeg = Phaser.Math.RadToDeg(s.angle)
        const img = this.ensureShip(s)
        if (img) img.setPosition(p.x, p.y).setAngle(angDeg + SHIP_ART_ANGLE_OFFSET).setTint(c.color)
        else this.drawShipFallback(p.x, p.y, s.angle, c.color)

        // thruster plume while in transit (faithful to Ship.ts)
        const plume = this.ensurePlume(s.id)
        if (plume) {
          livePlume.add(s.id)
          if (TRANSIT_PHASES.has(s.phase)) {
            const rad = s.angle
            const rx = p.x - Math.cos(rad) * EXHAUST_OFFSET
            const ry = p.y - Math.sin(rad) * EXHAUST_OFFSET
            const flick = 0.8 + Math.random() * 0.35
            plume
              .setPosition(rx, ry)
              .setAngle(angDeg + 90)
              .setDisplaySize(PLUME_WIDTH, PLUME_LENGTH * flick)
              .setAlpha(0.8 + Math.random() * 0.2)
              .setVisible(true)
          } else {
            plume.setVisible(false)
          }
        }

        this.drawAttachments(p.x, p.y, s)
        if (s.progress > 0) this.drawProgress(p.x, p.y, s.progress)
      }
    }
    this.cull(this.shipSprites, liveShip)
    this.cull(this.plumeSprites, livePlume)

    // drop eased positions for entities that no longer exist (mined out / recovered)
    if (this.disp.size > this.seen.size) {
      for (const k of this.disp.keys()) if (!this.seen.has(k)) this.disp.delete(k)
    }
  }

  private updateBaseLabel(c: CorpSnap, mine: boolean): void {
    let label = this.baseLabels.get(c.id)
    if (!label) {
      label = this.add
        .text(0, 0, c.name, { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff' })
        .setOrigin(0.5, 0.5)
        .setDepth(MultiplayerScene.D_LABEL)
      this.baseLabels.set(c.id, label)
    }
    label.setText(mine ? `${c.name} (you)` : c.name)
    label.setColor('#' + (c.color >>> 0).toString(16).padStart(6, '0'))
    label.setPosition(c.baseX, c.baseY + BASE_OUTER_R + 16)
    // keep a constant on-screen size regardless of camera zoom
    label.setScale(1 / this.cameras.main.zoom)
    label.setAlpha(c.alive ? 1 : 0.3)
  }

  /** the ship's 4 attachment points below the hull (faithful to SP): 2 small (net-store
   * fill + a spare) + 2 medium miner bays — laid out in the ship's own frame so they
   * rotate with the hull, each a fill slot. */
  private drawAttachments(x: number, y: number, s: ShipSnap): void {
    const ca = Math.cos(s.angle)
    const sa = Math.sin(s.angle)
    const fwd = { x: ca, y: sa } // along the hull's length
    const side = { x: -sa, y: ca } // the hull's "down" (perpendicular)
    const slotH = 8 // half-extent across the row (the fill axis)
    const sideDist = 17 // how far below the hull the row hangs (clears the bigger sprite)
    const cx = x + side.x * sideDist
    const cy = y + side.y * sideDist
    const netFrac = s.cargoCapacity > 0 ? Math.min(1, s.cargo / s.cargoCapacity) : 0
    const slots = [
      { hw: 4, frac: netFrac, fill: 0xffcc44 }, // S: net-store
      { hw: 4, frac: 0, fill: 0xffffff }, // S: spare
      { hw: 6, frac: s.minersAboard >= 1 ? 1 : 0, fill: 0xffffff }, // M: miner bay
      { hw: 6, frac: s.minersAboard >= 2 ? 1 : 0, fill: 0xffffff }, // M: miner bay
    ]
    const gap = 5
    const totalW = slots.reduce((n, sl) => n + sl.hw * 2, 0) + gap * (slots.length - 1)
    let off = -totalW / 2
    for (const sl of slots) {
      const c = off + sl.hw
      const scx = cx + fwd.x * c
      const scy = cy + fwd.y * c
      this.drawRotatedSlot(scx, scy, fwd, side, sl.hw, slotH, sl.frac, sl.fill)
      off += sl.hw * 2 + gap
    }
  }

  /** a slot quad in the ship's frame; fills from the outer (down) edge inward by `frac` */
  private drawRotatedSlot(
    cx: number,
    cy: number,
    fwd: { x: number; y: number },
    side: { x: number; y: number },
    hw: number,
    hh: number,
    frac: number,
    fill: number,
  ): void {
    const g = this.fxGfx
    const pt = (l: number, h: number) => new Phaser.Math.Vector2(cx + fwd.x * l + side.x * h, cy + fwd.y * l + side.y * h)
    g.lineStyle(1, 0x4a6a7a, 0.85)
    g.strokePoints([pt(-hw, -hh), pt(hw, -hh), pt(hw, hh), pt(-hw, hh)], true, true)
    if (frac > 0) {
      const topH = hh - 2 * hh * frac // fill from the outer (+hh) edge up
      g.fillStyle(fill, 0.9)
      g.fillPoints([pt(-hw, hh), pt(hw, hh), pt(hw, topH), pt(-hw, topH)], true)
    }
  }

  /** a small progress ring around a hauler mid-transfer (deploy / collect / unload) */
  private drawProgress(x: number, y: number, frac: number): void {
    const g = this.fxGfx
    g.lineStyle(2.5, 0x88ddff, 0.9)
    g.beginPath()
    g.arc(x, y, 26, -Math.PI / 2, -Math.PI / 2 + Math.min(1, frac) * Math.PI * 2, false)
    g.strokePath()
  }

  /** procedural triangle fallback if the ship atlas is somehow unavailable */
  private drawShipFallback(x: number, y: number, angle: number, color: number): void {
    const g = this.fxGfx
    const len = 28
    const wid = 17
    const ca = Math.cos(angle)
    const sa = Math.sin(angle)
    const nx = x + ca * len
    const ny = y + sa * len
    const px = -sa
    const py = ca
    const bx = x - ca * (len * 0.5)
    const by = y - sa * (len * 0.5)
    g.fillStyle(color, 1)
    g.fillTriangle(nx, ny, bx + px * wid, by + py * wid, bx - px * wid, by - py * wid)
    g.lineStyle(1.5, 0xffffff, 0.9)
    g.strokeTriangle(nx, ny, bx + px * wid, by + py * wid, bx - px * wid, by - py * wid)
  }
}
