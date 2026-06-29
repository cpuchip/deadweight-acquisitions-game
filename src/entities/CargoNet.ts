import Phaser from 'phaser'
import { nanoid } from 'nanoid'
import { selectedCargoNet } from '../state/cargoNetStore'
import type { ResourceType } from '../world/worldConfig'
import { type Composition, dominantResource } from '../world/composition'

export type CargoNetState = 'full-tethered' | 'in-transit' | 'unloading'

export const CARGO_NET_TEXTURE_KEY = 'cargo-net'
export const NET_LEAKAGE_FRACTION = 0.05
export const NET_COLLECT_DURATION_MS = 1500
export const TETHER_LINE_COLOR = 0x556677
export const TETHER_LINE_ALPHA = 0.5

export function generateCargoNetTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(CARGO_NET_TEXTURE_KEY)) return
  const w = 8
  const h = 8
  const gfx = scene.make.graphics({ x: 0, y: 0 })
  gfx.fillStyle(0x996633, 1)
  gfx.fillRect(0, 0, w, h)
  gfx.lineStyle(1, 0xffcc44, 0.9)
  gfx.strokeRect(0, 0, w, h)
  gfx.fillStyle(0xffcc44, 0.3)
  gfx.fillRect(2, 2, 4, 4)
  gfx.generateTexture(CARGO_NET_TEXTURE_KEY, w, h)
  gfx.destroy()
}

export class CargoNet extends Phaser.GameObjects.Image {
  readonly id: string
  state: CargoNetState
  // The ore's makeup. `resourceType` is the dominant, kept for display/colour.
  readonly composition: Composition
  readonly resourceType: ResourceType
  quantity: number
  asteroidId: string | null
  isSelected: boolean
  // Set when the net is orphaned (its miner was recovered without it): the net
  // free-orbits the planet like a stranded miner and is recoverable via player
  // "designate for collection". null while tethered to a miner.
  freeOrbitalRadius: number | null = null
  freeOrbitalAngle: number | null = null
  designatedForCollection: boolean = false

  constructor(
    scene: Phaser.Scene,
    composition: Composition,
    quantity: number,
    asteroidId: string | null = null,
    id?: string,
  ) {
    super(scene, 0, 0, CARGO_NET_TEXTURE_KEY)
    this.id = id ?? nanoid()
    this.state = 'full-tethered'
    this.composition = composition
    this.resourceType = dominantResource(composition)
    this.quantity = quantity
    this.asteroidId = asteroidId
    this.isSelected = false

    scene.add.existing(this)
    this.setOrigin(0.5, 0.5)
    this.setInteractive()
    this.setVisible(true)
  }

  select(): void {
    this.isSelected = true
    this.pushToStore()
  }

  deselect(): void {
    this.isSelected = false
    selectedCargoNet.set(null)
  }

  pushToStore(): void {
    if (!this.isSelected) return
    selectedCargoNet.set({
      id: this.id,
      state: this.state,
      resourceType: this.resourceType,
      quantity: Math.floor(this.quantity),
      orphaned: this.freeOrbitalRadius !== null,
      designatedForCollection: this.designatedForCollection,
    })
  }

  destroy(fromScene?: boolean): void {
    if (this.isSelected) selectedCargoNet.set(null)
    super.destroy(fromScene)
  }
}
