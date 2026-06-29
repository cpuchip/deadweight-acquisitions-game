import Phaser from 'phaser'
import { nanoid } from 'nanoid'
import { selectedAutoMiner } from '../state/autoMinerStore'
import type { ResourceType } from '../world/worldConfig'
import type { Composition } from '../world/composition'
import type { Asteroid } from './Asteroid'
import { CargoNet } from './CargoNet'

export type AutoMinerState =
  | 'in-transit'
  | 'deploying'
  | 'attaching'
  | 'mining'
  | 'ejecting-net'
  | 'net-starved'
  | 'standby-beaconing'
  | 'stuck'
  | 'drifting'
  | 'dark'
  | 'station-stored'
  | 'station-repair'

export const MINER_RATE = 5               // resource units per second
export const NET_CAPACITY = 50            // resource units per net
export const MINER_INITIAL_NETS = 3       // spare nets transferred on deploy (+ 1 active = 4 total)
export const MINER_DEPLOY_DURATION_MS = 2000
export const MINER_DEPLOY_PROXIMITY = 80  // world units; Hauler arrival threshold
export const RESUPPLY_DURATION_MS = 1500
export const BEACON_INTERVAL_MS = 3000
export const ATTACH_FAILURE_PROB = 0.25
export const ATTACH_MAX_RETRIES = 3
export const ATTACH_DRIFT_DURATION_MS = 800
export const ATTACH_RETRY_DELAY_MS = 1800
// After a miner exhausts its attach retries at an asteroid, that asteroid is
// considered undeployable for this window so the deploy loop does not immediately
// re-target it (avoids redeploy thrash). It becomes retryable once the window passes.
export const ATTACH_COOLDOWN_MS = 30000
export const AUTOMINER_PURCHASE_COST = 300
export const STATION_MINER_SLOT_CAP = 6
export const MINER_TEXTURE_KEY = 'autominer'

export const CONDITION_GRACE_THRESHOLD = 0.7
export const CONDITION_CAP_THRESHOLD = 0.3
export const CONDITION_DEGRADE_PER_FAIL = 0.1
export const CONDITION_MAX_PENALTY = 0.5
export const CATASTROPHIC_FAIL_PROB = 0.2
export const MINER_REPAIR_DURATION_MS = 5000

export const MINER_BATTERY_MAX = 200
export const MINER_BATTERY_DRAIN_MINING = 2
export const MINER_BATTERY_DRAIN_BEACONING = 0.05
// Battery fraction at which a mining miner starts beaconing for recovery while
// still working, and the lower fraction at which it stops mining to preserve
// reserve battery for the beacon.
export const LOW_BATTERY_BEACON_FRAC = 0.2
export const LOW_BATTERY_STOP_FRAC = 0.1

// Why a miner is advertising for recovery, so the fleet/HUD can distinguish a
// "come collect, asteroid done" beacon from a "rescue me, battery dying" one.
export type BeaconReason = 'depleted' | 'low-battery' | 'stuck' | null

export function conditionPenaltyFraction(condition: number): number {
  if (condition >= CONDITION_GRACE_THRESHOLD) return 0
  if (condition < CONDITION_CAP_THRESHOLD) return 1
  return (CONDITION_GRACE_THRESHOLD - condition) / (CONDITION_GRACE_THRESHOLD - CONDITION_CAP_THRESHOLD)
}

export function generateAutoMinerTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(MINER_TEXTURE_KEY)) return
  const w = 14
  const h = 14
  const cx = w / 2
  const cy = h / 2
  const r = 5
  const gfx = scene.make.graphics({ x: 0, y: 0 })
  // Diamond body
  gfx.fillStyle(0x3a5570, 1)
  gfx.fillPoints(
    [
      { x: cx, y: cy - r },
      { x: cx + r, y: cy },
      { x: cx, y: cy + r },
      { x: cx - r, y: cy },
    ],
    true,
  )
  // Bright center
  gfx.fillStyle(0x88ccee, 0.9)
  gfx.fillRect(cx - 2, cy - 2, 4, 4)
  // Outline
  gfx.lineStyle(1, 0xaaddee, 0.9)
  gfx.strokePoints(
    [
      { x: cx, y: cy - r },
      { x: cx + r, y: cy },
      { x: cx, y: cy + r },
      { x: cx - r, y: cy },
    ],
    true,
  )
  gfx.generateTexture(MINER_TEXTURE_KEY, w, h)
  gfx.destroy()
}

export class AutoMiner extends Phaser.GameObjects.Image {
  readonly id: string
  state: AutoMinerState
  condition: number
  asteroidId: string | null
  spareNetCount: number
  activeNetFill: number
  activeResourceType: ResourceType | null = null // dominant of the in-progress active net
  activeComposition: Composition | null = null   // ore composition of the in-progress active net
  tetheredNetIds: string[]
  readonly technologyLevel: number
  isSelected: boolean
  freeOrbitalRadius: number | null = null
  freeOrbitalAngle: number | null = null
  battery: number
  beaconReason: BeaconReason = null
  private beaconTimer: Phaser.Time.TimerEvent | null = null

  constructor(scene: Phaser.Scene, id?: string) {
    super(scene, 0, 0, MINER_TEXTURE_KEY)
    this.id = id ?? nanoid()
    this.state = 'in-transit'
    this.condition = 1.0
    this.asteroidId = null
    this.spareNetCount = 0
    this.activeNetFill = 0
    this.tetheredNetIds = []
    this.technologyLevel = 1
    this.battery = MINER_BATTERY_MAX
    this.isSelected = false

    scene.add.existing(this)
    this.setOrigin(0.5, 0.5)
    this.setInteractive()
    this.setVisible(false)
  }

  updateMining(dt: number, asteroid: Asteroid): void {
    if (this.state !== 'mining') return

    this.battery = Math.max(0, this.battery - MINER_BATTERY_DRAIN_MINING * dt)
    if (this.battery <= 0) {
      this.stopBeacon()
      this.state = 'dark'
      this.pushToStore()
      return
    }

    const batteryFrac = this.battery / MINER_BATTERY_MAX
    // Very low: stop mining and beacon for recovery on the reserve battery.
    if (batteryFrac <= LOW_BATTERY_STOP_FRAC) {
      this.state = 'standby-beaconing'
      this.beaconReason = 'low-battery'
      this.startBeacon()
      this.pushToStore()
      return
    }
    // Low: start advertising for recovery but keep mining for now.
    if (batteryFrac <= LOW_BATTERY_BEACON_FRAC && this.beaconReason !== 'low-battery') {
      this.beaconReason = 'low-battery'
      this.startBeacon()
    }

    const effectiveRate = MINER_RATE * (1 - CONDITION_MAX_PENALTY * conditionPenaltyFraction(this.condition))
    const extracted = Math.min(effectiveRate * dt, asteroid.currentQuantity)
    asteroid.currentQuantity -= extracted
    this.activeNetFill += extracted
    this.activeResourceType = asteroid.resourceType
    this.activeComposition = asteroid.composition
    asteroid.pushToStore()

    if (asteroid.currentQuantity <= 0) {
      this.state = 'standby-beaconing'
      this.beaconReason = 'depleted'
      this.startBeacon()
      this.pushToStore()
      return
    }

    if (this.activeNetFill >= NET_CAPACITY) {
      this.ejectNet(asteroid.composition)
    }
  }

  private ejectNet(composition: Composition): void {
    this.state = 'ejecting-net'

    const net = new CargoNet(this.scene, composition, this.activeNetFill, this.asteroidId)
    net.setPosition(this.x + 10, this.y - 10)
    this.tetheredNetIds = [...this.tetheredNetIds, net.id]
    this.activeNetFill = 0

    this.emit('net-ejected', net)
    this.playEjectEffect()

    if (this.spareNetCount > 0) {
      this.spareNetCount--
      this.state = 'mining'
    } else {
      this.state = 'net-starved'
    }

    this.pushToStore()
  }

  /**
   * Ejects the partial (not-yet-full) active net for transport when the miner is
   * recovered, so its accumulated resources are not stranded. Creates a
   * full-tethered CargoNet the recovery flow then collects (or orphans, never
   * loses). No-op if there is no fill or the resource type is unknown.
   */
  ejectActiveNet(): void {
    if (this.activeNetFill <= 0 || this.activeComposition === null) return
    const net = new CargoNet(this.scene, this.activeComposition, this.activeNetFill, this.asteroidId)
    net.setPosition(this.x + 10, this.y - 10)
    this.tetheredNetIds = [...this.tetheredNetIds, net.id]
    this.activeNetFill = 0
    this.emit('net-ejected', net)
    this.pushToStore()
  }

  private playEjectEffect(): void {
    const dot = this.scene.add.circle(this.x, this.y, 3, 0xffcc44, 1)
    this.scene.tweens.add({
      targets: dot,
      x: this.x + 15,
      y: this.y - 15,
      alpha: 0,
      duration: 500,
      ease: 'Power1',
      onComplete: () => dot.destroy(),
    })
  }

  startBeacon(): void {
    if (this.beaconTimer) return
    this.beaconTimer = this.scene.time.addEvent({
      delay: BEACON_INTERVAL_MS,
      callback: this.emitPing,
      callbackScope: this,
      loop: true,
    })
    this.emitPing()
  }

  stopBeacon(): void {
    if (this.beaconTimer) {
      this.beaconTimer.remove()
      this.beaconTimer = null
    }
  }

  private emitPing(): void {
    const ring = this.scene.add.graphics()
    const ping = { radius: 0, alpha: 0.9 }
    this.scene.tweens.add({
      targets: ping,
      radius: 24,
      alpha: 0,
      duration: 800,
      ease: 'Power1',
      onUpdate: () => {
        ring.clear()
        ring.lineStyle(1.5, 0xffaa44, ping.alpha)
        ring.strokeCircle(this.x, this.y, ping.radius)
      },
      onComplete: () => ring.destroy(),
    })
    this.emit('beacon-emitted', { id: this.id, x: this.x, y: this.y })
  }

  select(): void {
    this.isSelected = true
    this.pushToStore()
  }

  deselect(): void {
    this.isSelected = false
    selectedAutoMiner.set(null)
  }

  pushToStore(): void {
    if (!this.isSelected) return
    selectedAutoMiner.set({
      id: this.id,
      state: this.state,
      condition: this.condition,
      asteroidId: this.asteroidId,
      activeNetFill: this.activeNetFill,
      spareNetCount: this.spareNetCount,
      tetheredNetCount: this.tetheredNetIds.length,
      battery: this.battery,
      beaconReason: this.beaconReason,
    })
  }

  destroy(fromScene?: boolean): void {
    this.stopBeacon()
    if (this.isSelected) selectedAutoMiner.set(null)
    super.destroy(fromScene)
  }
}
