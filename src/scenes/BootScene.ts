import Phaser from 'phaser'

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' })
  }

  preload(): void {
    // Generated ship atlas (asset-harness, Z-Image clean stack). Frames: 'hauler', 'miner'.
    this.load.atlas('dwa_ships', 'assets/dwa_ships.png', 'assets/dwa_ships.json')
    // Generated station module atlas (asset-harness). Frames: 'hub', 'tank', 'habitat', 'solar', 'dock'.
    this.load.atlas('dwa_station', 'assets/dwa_station.png', 'assets/dwa_station.json')
    // Generated asteroid atlas (asset-harness). Frames: 'iron','ice','silicates','rare-metals','unknown'.
    this.load.atlas('dwa_asteroids', 'assets/dwa_asteroids.png', 'assets/dwa_asteroids.json')
    // Generated planet sprite (asset-harness). Single frame 'planet'.
    this.load.atlas('dwa_planet', 'assets/dwa_planet.png', 'assets/dwa_planet.json')
    // Generated flame sprite (asset-harness vfx, additive on black) for the thruster plume.
    this.load.image('fx-flame', 'assets/fx_flame.png')
  }

  create(): void {
    this.scene.start('MainMenuScene')
  }
}
