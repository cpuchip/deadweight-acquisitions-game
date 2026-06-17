// Deadweight Acquisitions — multiplayer server.
// One Node process: serves the built Vite client (dist/) over HTTP and hosts the
// authoritative game on a same-origin WebSocket at /ws.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'
import { RoomRegistry } from './rooms'
import { SIM_HZ, SNAPSHOT_HZ } from '../shared/mpConfig'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '..', 'dist')
const PORT = Number(process.env.PORT) || 8080

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

// the build stamp written by vite (dist/version.txt); read once at startup
let BUILD_SHA = 'dev'
try {
  BUILD_SHA = fs.readFileSync(path.join(DIST, 'version.txt'), 'utf8').trim() || 'dev'
} catch {
  /* no build stamp (e.g. dev server before a build) — stays 'dev' */
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  if (urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }
  if (urlPath === '/version') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end(BUILD_SHA)
    return
  }

  let rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
  let filePath = path.resolve(DIST, rel)

  // traversal guard — stay inside dist/
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403)
    res.end('forbidden')
    return
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA-ish fallback: unknown path -> index.html
      filePath = path.join(DIST, 'index.html')
    }
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(404)
        res.end('not found')
        return
      }
      const ext = path.extname(filePath).toLowerCase()
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' })
      res.end(data)
    })
  })
}

const server = http.createServer(serveStatic)
const wss = new WebSocketServer({ server, path: '/ws' })
const registry = new RoomRegistry()

// --- persistence: resume in-progress matches across a server restart ---
const STATE_FILE = path.join(process.env.STATE_DIR || process.cwd(), 'rooms-state.json')
try {
  if (fs.existsSync(STATE_FILE)) {
    const resumed = registry.loadFrom(fs.readFileSync(STATE_FILE, 'utf8'))
    if (resumed > 0) console.log(`[deadweight] resumed ${resumed} in-progress match(es) from ${STATE_FILE}`)
  }
} catch (e) {
  console.warn('[deadweight] could not load persisted state:', e)
}
function persist(): void {
  try {
    fs.writeFileSync(STATE_FILE, registry.snapshot())
  } catch {
    /* best-effort */
  }
}
const EMPTY_TTL_MS = Number(process.env.EMPTY_TTL_MS) || 30 * 60_000 // drop abandoned matches after 30m
setInterval(() => {
  registry.sweep(Date.now(), EMPTY_TTL_MS)
  persist()
}, Number(process.env.PERSIST_MS) || 30_000)
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    persist()
    process.exit(0)
  })
}

wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (data) => registry.route(ws, data.toString()))
  ws.on('close', () => registry.close(ws))
  ws.on('error', () => registry.close(ws))
})

// --- simulation + broadcast loop ---
const SIM_DT = 1 / SIM_HZ
const SNAPSHOT_EVERY = Math.max(1, Math.round(SIM_HZ / SNAPSHOT_HZ))
let frame = 0

setInterval(() => {
  for (const room of registry.all()) room.world.tick(SIM_DT)
  frame += 1
  if (frame % SNAPSHOT_EVERY === 0) {
    for (const room of registry.all()) room.broadcastSnapshot()
  }
}, 1000 / SIM_HZ)

server.listen(PORT, () => {
  console.log(`[deadweight] serving ${DIST}`)
  console.log(`[deadweight] http + ws listening on :${PORT}  (ws path /ws)`)
})
