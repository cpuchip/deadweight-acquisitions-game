import Phaser from 'phaser'
import { mount } from 'svelte'
import { BootScene } from './scenes/BootScene'
import { MainMenuScene } from './scenes/MainMenuScene'
import { SpaceScene } from './scenes/SpaceScene'
import { MultiplayerScene } from './scenes/mp/MultiplayerScene'
import Hud from './ui/Hud.svelte'
import EntityPanel from './ui/EntityPanel.svelte'
import BasePanel from './ui/BasePanel.svelte'
import Lobby from './ui/mp/Lobby.svelte'
import MpHud from './ui/mp/MpHud.svelte'
import MpBasePanel from './ui/mp/MpBasePanel.svelte'
import MpMinimap from './ui/mp/MpMinimap.svelte'
import MpChat from './ui/mp/MpChat.svelte'
import { get } from 'svelte/store'
import { mpMode, spaceActive } from './state/mpStore'

new Phaser.Game({
  type: Phaser.AUTO,
  backgroundColor: '#05050f',
  physics: {
    default: 'arcade',
    arcade: { debug: false },
  },
  scene: [BootScene, MainMenuScene, SpaceScene, MultiplayerScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
})

// Single-player UI overlay (Dave's game).
const hudTarget = document.getElementById('hud')
if (hudTarget) {
  mount(Hud, { target: hudTarget })
  mount(EntityPanel, { target: hudTarget })
  mount(BasePanel, { target: hudTarget })
}

// Multiplayer UI overlay — its own container so SP and MP never overlap.
const mpTarget = document.createElement('div')
mpTarget.id = 'mp'
mpTarget.style.cssText =
  'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:20;display:none;'
document.body.appendChild(mpTarget)
mount(Lobby, { target: mpTarget })
mount(MpHud, { target: mpTarget })
mount(MpBasePanel, { target: mpTarget })
mount(MpMinimap, { target: mpTarget })
mount(MpChat, { target: mpTarget })

// Always-visible build stamp (which commit this page is) — subtle, bottom-right.
const buildBadge = document.createElement('div')
buildBadge.textContent = `build ${__BUILD_SHA__}`
buildBadge.style.cssText =
  'position:fixed;bottom:3px;right:7px;z-index:50;font:9px monospace;color:#3a5a6a;opacity:0.6;pointer-events:none;'
document.body.appendChild(buildBadge)

// Toggle which overlay is live by mode. The Phaser scene swap handles the canvas.
// The SP HUD shows only while the SpaceScene is actually running (not on the title).
function syncOverlays(): void {
  const mp = get(mpMode) === 'mp'
  mpTarget.style.display = mp ? 'block' : 'none'
  if (hudTarget) hudTarget.style.display = !mp && get(spaceActive) ? 'block' : 'none'
}
mpMode.subscribe(syncOverlays)
spaceActive.subscribe(syncOverlays)
