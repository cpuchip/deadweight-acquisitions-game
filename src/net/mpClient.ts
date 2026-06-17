// WebSocket client for multiplayer. A small singleton: the Lobby calls connect(),
// the scene/HUD read the stores it fills and send commands through it.

import type { ClientMessage, ServerMessage, GameCommand } from '../../shared/protocol'
import {
  mpConnection,
  mpError,
  mpRoom,
  mpYouCorpId,
  mpIsHost,
  mpLobbyPlayers,
  mpSnapshot,
} from '../state/mpStore'

let ws: WebSocket | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}

export function connect(name: string, room: string): void {
  disconnect()
  mpConnection.set('connecting')
  mpError.set(null)
  try {
    ws = new WebSocket(wsUrl())
  } catch {
    mpConnection.set('error')
    mpError.set('Could not open a connection.')
    return
  }
  ws.onopen = () => {
    send({ type: 'join', name, room })
    heartbeat = setInterval(() => send({ type: 'ping' }), 20000)
  }
  ws.onmessage = (e) => {
    let msg: ServerMessage
    try {
      msg = JSON.parse(e.data)
    } catch {
      return
    }
    handle(msg)
  }
  ws.onerror = () => {
    mpConnection.set('error')
    mpError.set('Connection error.')
  }
  ws.onclose = () => {
    mpConnection.set('closed')
    if (heartbeat) {
      clearInterval(heartbeat)
      heartbeat = null
    }
  }
}

export function disconnect(): void {
  if (heartbeat) {
    clearInterval(heartbeat)
    heartbeat = null
  }
  if (ws) {
    ws.onclose = null
    try {
      ws.close()
    } catch {
      /* ignore */
    }
    ws = null
  }
}

function send(msg: ClientMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

export function startMatch(): void {
  send({ type: 'start' })
}

export function pauseMatch(): void {
  send({ type: 'pause' })
}

export function quitMatch(): void {
  send({ type: 'quit' })
  // let the quit message flush, then drop back to the menu
  setTimeout(() => {
    disconnect()
    location.href = location.pathname
  }, 150)
}

export function sendCommand(cmd: GameCommand): void {
  send({ type: 'cmd', cmd })
}

function handle(msg: ServerMessage): void {
  switch (msg.type) {
    case 'welcome':
      mpYouCorpId.set(msg.corpId)
      mpRoom.set(msg.room)
      mpIsHost.set(msg.isHost)
      mpConnection.set('connected')
      break
    case 'lobby':
      mpLobbyPlayers.set(msg.players)
      mpIsHost.set(msg.isHost)
      break
    case 'snapshot':
      mpSnapshot.set(msg.world)
      break
    case 'error':
      mpError.set(msg.message)
      break
    case 'pong':
      break
  }
}
