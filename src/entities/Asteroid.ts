import Phaser from 'phaser'
import { SIZE_CONFIGS, ASTEROID_TEXTURE_SIZE, ORBITAL_K, type ResourceType, type SizeCategory } from '../world/worldConfig'
import type { Composition } from '../world/composition'
import type { AsteroidData } from '../world/worldGenerator'
import { selectedAsteroid } from '../state/shipStore'
import { get } from 'svelte/store'

// Generated per-resource asteroid atlas (asset-harness). Frames are named by resource type
// ('iron'|'ice'|'silicates'|'rare-metals', plus 'unknown' for scan-gated large asteroids).
export const ASTEROID_ATLAS_KEY = 'dwa_asteroids'

// Large (high-yield) asteroids start unknown until scanned — they reveal the generic 'unknown'
// frame (and hide type/quantity/composition in the panel) until a scan completes (WI 586).
function isUnknownData(data: AsteroidData): boolean {
  return data.sizeCategory === 'large' && !data.scanned
}
function asteroidFrame(data: AsteroidData): string {
  return isUnknownData(data) ? 'unknown' : data.resourceType
}

const COMPANY_RING_RADIUS = ASTEROID_TEXTURE_SIZE * 1.2  // slightly larger than the largest visual
const COMPANY_RING_COLOR = 0x44ffdd
const COMPANY_RING_ALPHA = 0.85
const COMPANY_RING_WIDTH = 1.5
const DEPLETION_SCALE_MIN = 0.2

export class Asteroid extends Phaser.GameObjects.Image {
  readonly id: string
  readonly resourceType: ResourceType
  readonly composition: Composition
  scanned: boolean
  currentQuantity: number
  readonly maxQuantity: number
  readonly sizeCategory: SizeCategory
  readonly isCompany: boolean
  orbitalRadius: number
  orbitalAngle: number
  private readonly baseScale: number
  private companyRing: Phaser.GameObjects.Graphics | null = null

  constructor(scene: Phaser.Scene, data: AsteroidData) {
    super(
      scene, 0, 0,
      scene.textures.exists(ASTEROID_ATLAS_KEY) ? ASTEROID_ATLAS_KEY : `asteroid-${data.resourceType}`,
      scene.textures.exists(ASTEROID_ATLAS_KEY) ? asteroidFrame(data) : undefined,
    )
    this.id = data.id
    this.resourceType = data.resourceType
    this.composition = data.composition
    this.scanned = data.scanned
    this.currentQuantity = data.currentQuantity
    this.maxQuantity = data.maxQuantity
    this.sizeCategory = data.sizeCategory
    this.isCompany = data.isCompany
    this.orbitalRadius = data.orbitalRadius
    this.orbitalAngle = data.orbitalAngle
    // Fold a (32px → frame) art factor in so the generated sprite renders at the same
    // on-screen size as the old procedural 32px circle (factor = 1 for the fallback).
    const artFactor = ASTEROID_TEXTURE_SIZE / Math.max(this.width, this.height)
    this.baseScale = SIZE_CONFIGS[data.sizeCategory].scale * artFactor
    const depletionRatio = data.maxQuantity > 0 ? data.currentQuantity / data.maxQuantity : 1
    this.setScale(this.baseScale * Math.max(DEPLETION_SCALE_MIN, depletionRatio))
    this.x = Math.cos(this.orbitalAngle) * this.orbitalRadius
    this.y = Math.sin(this.orbitalAngle) * this.orbitalRadius
    scene.add.existing(this)
    this.setInteractive()

    if (this.isCompany) {
      this.companyRing = scene.add.graphics()
      this.companyRing.lineStyle(COMPANY_RING_WIDTH, COMPANY_RING_COLOR, COMPANY_RING_ALPHA)
      this.companyRing.strokeCircle(data.x, data.y, COMPANY_RING_RADIUS)

      scene.tweens.add({
        targets: this.companyRing,
        alpha: { from: COMPANY_RING_ALPHA, to: 0.1 },
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
    }
  }

  /** A large (high-yield) asteroid whose contents are hidden until scanned. */
  isUnknown(): boolean {
    return this.sizeCategory === 'large' && !this.scanned
  }

  /** Scan complete: mark known and reveal the resource sprite (no-op art in fallback mode). */
  reveal(): void {
    this.scanned = true
    if (this.scene.textures.exists(ASTEROID_ATLAS_KEY)) this.setFrame(this.resourceType)
    this.pushToStore()
  }

  updateOrbit(dt: number): void {
    this.orbitalAngle += (ORBITAL_K / Math.max(this.orbitalRadius, 1) ** 1.5) * dt
    this.x = Math.cos(this.orbitalAngle) * this.orbitalRadius
    this.y = Math.sin(this.orbitalAngle) * this.orbitalRadius
    if (this.companyRing) {
      this.companyRing.clear()
      this.companyRing.lineStyle(COMPANY_RING_WIDTH, COMPANY_RING_COLOR, COMPANY_RING_ALPHA)
      this.companyRing.strokeCircle(this.x, this.y, COMPANY_RING_RADIUS)
    }
  }

  pushToStore(): void {
    const ratio = this.maxQuantity > 0 ? this.currentQuantity / this.maxQuantity : 0
    this.setScale(this.baseScale * Math.max(DEPLETION_SCALE_MIN, ratio))

    const current = get(selectedAsteroid)
    if (current?.id !== this.id) return
    selectedAsteroid.set({
      id: this.id,
      resourceType: this.resourceType,
      composition: this.composition,
      scanned: this.scanned,
      currentQuantity: this.currentQuantity,
      maxQuantity: this.maxQuantity,
      sizeCategory: this.sizeCategory,
    })
  }

  selectSelf(): void {
    selectedAsteroid.set({
      id: this.id,
      resourceType: this.resourceType,
      composition: this.composition,
      scanned: this.scanned,
      currentQuantity: this.currentQuantity,
      maxQuantity: this.maxQuantity,
      sizeCategory: this.sizeCategory,
    })
  }

  destroy(fromScene?: boolean): void {
    if (get(selectedAsteroid)?.id === this.id) {
      selectedAsteroid.set(null)
    }
    if (this.companyRing) {
      this.companyRing.destroy()
      this.companyRing = null
    }
    super.destroy(fromScene)
  }
}
