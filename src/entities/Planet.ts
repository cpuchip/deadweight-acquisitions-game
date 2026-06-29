import Phaser from 'phaser'

export const PLANET_TEXTURE_KEY = 'planet'
export const PLANET_RADIUS = 280
// Generated planet sprite (asset-harness). Single frame 'planet'; pole-on gas giant with an
// off-centre storm so the slow spin reads.
export const PLANET_ATLAS_KEY = 'dwa_planet'
const PLANET_SPIN_MS = 120000  // one slow revolution (~2 min); we view a pole, so spin about z

export function generatePlanetTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(PLANET_TEXTURE_KEY)) return

  const size = PLANET_RADIUS * 2 + 8
  const cx = size / 2
  const cy = size / 2

  const gfx = scene.make.graphics({ x: 0, y: 0 })

  // Body — deep blue-grey gas giant
  gfx.fillStyle(0x1a2a44, 1)
  gfx.fillCircle(cx, cy, PLANET_RADIUS)

  // Subtle atmospheric banding
  gfx.fillStyle(0x1e3050, 0.5)
  gfx.fillEllipse(cx, cy - PLANET_RADIUS * 0.2, PLANET_RADIUS * 1.8, PLANET_RADIUS * 0.35)
  gfx.fillStyle(0x152236, 0.4)
  gfx.fillEllipse(cx, cy + PLANET_RADIUS * 0.25, PLANET_RADIUS * 1.6, PLANET_RADIUS * 0.28)

  // Rim highlight
  gfx.lineStyle(3, 0x3a6090, 0.6)
  gfx.strokeCircle(cx, cy, PLANET_RADIUS)

  gfx.generateTexture(PLANET_TEXTURE_KEY, size, size)
  gfx.destroy()
}

export class Planet extends Phaser.GameObjects.Image {
  constructor(scene: Phaser.Scene) {
    const useAtlas = scene.textures.exists(PLANET_ATLAS_KEY)
    super(scene, 0, 0, useAtlas ? PLANET_ATLAS_KEY : PLANET_TEXTURE_KEY, useAtlas ? 'planet' : undefined)
    scene.add.existing(this)
    this.setDepth(-10)
    if (useAtlas) this.setDisplaySize(PLANET_RADIUS * 2, PLANET_RADIUS * 2)
    // Slow z-rotation; the off-centre storm makes it read as a spinning pole-on planet.
    scene.tweens.add({ targets: this, angle: 360, duration: PLANET_SPIN_MS, repeat: -1 })
  }
}
