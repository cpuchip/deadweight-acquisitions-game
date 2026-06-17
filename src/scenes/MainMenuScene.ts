import Phaser from 'phaser'
import { GameSaveService } from '../services/GameSaveService'
import { mpMode } from '../state/mpStore'

export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MainMenuScene' })
  }

  create(): void {
    // Deep link: /?mp=1 (optionally &room=code) jumps straight into multiplayer,
    // so a shared link lands friends in the lobby without touching the menu.
    if (new URLSearchParams(location.search).has('mp')) {
      mpMode.set('mp')
      this.scene.start('MultiplayerScene')
      return
    }

    const { width, height } = this.scale
    const cx = width / 2
    const cy = height / 2

    this.add
      .text(cx, cy - 80, 'DEADWEIGHT ACQUISITIONS', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#4a7a9a',
        letterSpacing: 3,
      })
      .setOrigin(0.5, 0.5)

    this.add
      .text(cx, cy - 48, 'CORP.', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#2a5a6a',
        letterSpacing: 2,
      })
      .setOrigin(0.5, 0.5)

    const hasSave = GameSaveService.hasSave()

    let y = cy + 10
    if (hasSave) {
      this.makeButton(cx, y, 'CONTINUE', () => {
        this.scene.start('SpaceScene')
      })
      y += 44
    }

    this.makeButton(cx, y, 'NEW GAME', () => {
      GameSaveService.clear()
      this.scene.start('SpaceScene')
    })
    y += 44

    this.makeButton(cx, y, 'MULTIPLAYER', () => {
      mpMode.set('mp')
      this.scene.start('MultiplayerScene')
    })

    this.add
      .text(cx, y + 40, 'competitive — last corp standing', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#3a5a6a',
      })
      .setOrigin(0.5, 0.5)

    // build stamp — which commit this page was built from
    this.add
      .text(cx, height - 14, `build ${__BUILD_SHA__}`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#2a4250',
      })
      .setOrigin(0.5, 0.5)
  }

  private makeButton(x: number, y: number, label: string, onClick: () => void): void {
    const btn = this.add
      .text(x, y, `[ ${label} ]`, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#6aaaca',
      })
      .setOrigin(0.5, 0.5)
      .setInteractive({ useHandCursor: true })

    btn.on('pointerover', () => btn.setColor('#aaddff'))
    btn.on('pointerout', () => btn.setColor('#6aaaca'))
    btn.on('pointerdown', onClick)
  }
}
