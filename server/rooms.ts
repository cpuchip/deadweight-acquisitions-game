// Room registry + per-connection routing for the multiplayer server.

import { WebSocket } from 'ws'
import { nanoid } from 'nanoid'
import { World } from './sim/world'
import { CORP_COLORS, MAX_CORPS_PER_ROOM } from '../shared/mpConfig'
import type { ClientMessage, ServerMessage, LobbyPlayer } from '../shared/protocol'

interface Member {
  ws: WebSocket
  corpId: string
  name: string
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

export class Room {
  readonly code: string
  readonly world: World
  private members = new Map<WebSocket, Member>()
  /** corp ids in join order; index 0 is the host */
  private order: string[] = []
  /** ms timestamp the room last went empty (null while occupied) — for the abandon sweep */
  private emptyAt: number | null = null

  /** how long this room has had no connected members (0 if occupied) */
  emptyForMs(now: number): number {
    return this.emptyAt === null ? 0 : now - this.emptyAt
  }

  constructor(code: string, world?: World) {
    this.code = code
    this.world = world ?? new World((Math.random() * 0x7fffffff) | 0)
  }

  /** snapshot this room's persistent state (the world + host order; not the sockets) */
  serialize(): Record<string, unknown> {
    return { code: this.code, order: this.order, world: this.world.serialize() }
  }

  static restore(s: { code: string; order?: string[]; world: unknown }): Room {
    const room = new Room(s.code, World.restore(s.world))
    room.order = s.order ?? []
    return room
  }

  get empty(): boolean {
    return this.members.size === 0
  }

  private hostCorpId(): string | null {
    return this.order[0] ?? null
  }

  handle(ws: WebSocket, raw: string): void {
    let msg: ClientMessage
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    switch (msg.type) {
      case 'join':
        this.join(ws, msg.name)
        break
      case 'start':
        this.startMatch(ws)
        break
      case 'pause':
        this.pauseMatch(ws)
        break
      case 'quit':
        this.quitMatch(ws)
        break
      case 'cmd': {
        const m = this.members.get(ws)
        if (m) this.world.applyCommand(m.corpId, msg.cmd)
        break
      }
      case 'chat': {
        const m = this.members.get(ws)
        if (m) this.chat(m, msg.text)
        break
      }
      case 'ping':
        send(ws, { type: 'pong' })
        break
    }
  }

  private chat(m: Member, rawText: string): void {
    const text = (rawText || '').replace(/\s+/g, ' ').trim().slice(0, 160)
    if (!text) return
    const me = this.lobbyPlayers().find((p) => p.corpId === m.corpId)
    const out: ServerMessage = { type: 'chat', from: m.name, color: me?.color ?? 0xffffff, text }
    const payload = JSON.stringify(out)
    for (const mem of this.members.values()) {
      if (mem.ws.readyState === WebSocket.OPEN) mem.ws.send(payload)
    }
  }

  private join(ws: WebSocket, rawName: string): void {
    const name = (rawName || '').trim().slice(0, 18) || 'Corp'

    // reattach to an offline corp of the same name (refresh / reconnect)
    const reattachId = this.findReattachable(name)
    if (reattachId) {
      this.world.setOnline(reattachId, true)
      this.bind(ws, reattachId, name)
      send(ws, {
        type: 'welcome',
        corpId: reattachId,
        room: this.code,
        isHost: this.hostCorpId() === reattachId,
        you: name,
      })
      this.broadcastLobby()
      return
    }

    if (this.world.phase !== 'lobby') {
      send(ws, { type: 'error', message: 'That match has already started. Try another room code.' })
      return
    }
    if (this.world.corpCount() >= MAX_CORPS_PER_ROOM) {
      send(ws, { type: 'error', message: 'This room is full.' })
      return
    }
    if (this.nameOnline(name)) {
      send(ws, { type: 'error', message: `"${name}" is already in this room. Pick another name.` })
      return
    }

    const corpId = nanoid(10)
    const color = CORP_COLORS[this.world.corpCount() % CORP_COLORS.length]
    this.world.addCorp(corpId, name, color)
    this.order.push(corpId)
    this.bind(ws, corpId, name)
    send(ws, {
      type: 'welcome',
      corpId,
      room: this.code,
      isHost: this.hostCorpId() === corpId,
      you: name,
    })
    this.broadcastLobby()
  }

  private startMatch(ws: WebSocket): void {
    const m = this.members.get(ws)
    if (!m) return
    if (this.hostCorpId() !== m.corpId) {
      send(ws, { type: 'error', message: 'Only the host can start the match.' })
      return
    }
    this.world.start()
    this.broadcastLobby() // clients flip to the match view on phase change
  }

  private pauseMatch(ws: WebSocket): void {
    const m = this.members.get(ws)
    if (!m) return
    if (this.hostCorpId() !== m.corpId) {
      send(ws, { type: 'error', message: 'Only the host can pause the match.' })
      return
    }
    this.world.setPaused(!this.world.paused)
  }

  private quitMatch(ws: WebSocket): void {
    const m = this.members.get(ws)
    if (!m) return
    this.world.forfeit(m.corpId) // remove the corp from the race
    this.order = this.order.filter((id) => id !== m.corpId) // pass the host on
    // the client reloads after quitting; the socket close removes the member and,
    // when the room empties, the registry GCs it (the match dies on the server)
  }

  private bind(ws: WebSocket, corpId: string, name: string): void {
    this.members.set(ws, { ws, corpId, name })
    this.emptyAt = null
  }

  handleClose(ws: WebSocket): void {
    const m = this.members.get(ws)
    if (!m) return
    this.members.delete(ws)
    this.world.setOnline(m.corpId, false)
    if (this.members.size === 0) this.emptyAt = Date.now()
    this.broadcastLobby()
  }

  /** an offline corp with this exact name can be reclaimed */
  private findReattachable(name: string): string | null {
    for (const p of this.lobbyPlayers()) {
      if (p.name === name && !p.online) return p.corpId
    }
    return null
  }

  private nameOnline(name: string): boolean {
    return this.lobbyPlayers().some((p) => p.name === name && p.online)
  }

  private lobbyPlayers(): LobbyPlayer[] {
    return this.world.snapshot().corps.map((c) => ({
      corpId: c.id,
      name: c.name,
      color: c.color,
      online: c.online,
    }))
  }

  private broadcastLobby(): void {
    const players = this.lobbyPlayers()
    for (const m of this.members.values()) {
      send(m.ws, {
        type: 'lobby',
        room: this.code,
        players,
        isHost: this.hostCorpId() === m.corpId,
      })
    }
  }

  /** push the latest world to everyone (called by the broadcast loop) */
  broadcastSnapshot(): void {
    if (this.members.size === 0) return
    const world = this.world.snapshot()
    const msg: ServerMessage = { type: 'snapshot', world }
    const payload = JSON.stringify(msg)
    for (const m of this.members.values()) {
      if (m.ws.readyState === WebSocket.OPEN) m.ws.send(payload)
    }
  }
}

export class RoomRegistry {
  private rooms = new Map<string, Room>()
  /** which room a given socket has joined */
  private socketRoom = new Map<WebSocket, Room>()

  route(ws: WebSocket, raw: string): void {
    let msg: ClientMessage
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.type === 'join') {
      const code = normalizeRoom(msg.room)
      const room = this.getOrCreate(code)
      this.socketRoom.set(ws, room)
      room.handle(ws, raw)
      return
    }
    const room = this.socketRoom.get(ws)
    if (room) room.handle(ws, raw)
  }

  close(ws: WebSocket): void {
    const room = this.socketRoom.get(ws)
    if (room) {
      room.handleClose(ws)
      this.socketRoom.delete(ws)
      // a running match is kept when it empties (players can reconnect / it persists);
      // a lobby or finished room is cleaned up immediately
      if (room.empty && room.world.phase !== 'running') this.rooms.delete(room.code)
    }
  }

  /** drop rooms that have been empty (abandoned) longer than ttlMs — keeps abandoned
   * in-progress matches from ticking forever after everyone disconnects */
  sweep(now: number, ttlMs: number): void {
    for (const room of [...this.rooms.values()]) {
      if (room.empty && room.emptyForMs(now) > ttlMs) this.rooms.delete(room.code)
    }
  }

  private getOrCreate(code: string): Room {
    let room = this.rooms.get(code)
    if (!room) {
      room = new Room(code)
      this.rooms.set(code, room)
    }
    return room
  }

  all(): Room[] {
    return [...this.rooms.values()]
  }

  /** serialize in-progress matches to one JSON string (for periodic / shutdown persistence) */
  snapshot(): string {
    const running = [...this.rooms.values()].filter((r) => r.world.phase === 'running')
    return JSON.stringify(running.map((r) => r.serialize()))
  }

  /** restore in-progress matches from a persisted snapshot on boot. Members reconnect
   * on their own (reattach-by-name), so restored rooms start empty and resume the sim. */
  loadFrom(json: string): number {
    let n = 0
    try {
      const arr = JSON.parse(json) as { code: string; order?: string[]; world: unknown }[]
      for (const ro of arr) {
        const room = Room.restore(ro)
        if (room.world.phase !== 'running') continue
        this.rooms.set(room.code, room)
        n += 1
      }
    } catch {
      /* corrupt snapshot — start fresh */
    }
    return n
  }
}

function normalizeRoom(code: string): string {
  const c = (code || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
  return c.slice(0, 24) || 'lobby'
}
