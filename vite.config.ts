/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Build stamp: the git short hash of the deployed commit, so the running page can
// declare exactly which build it is. The Dockerfile sets VITE_GIT_SHA (it has git);
// local builds fall back to reading git directly, then to 'dev'.
function buildSha(): string {
  const env = process.env.VITE_GIT_SHA
  if (env && env.trim()) return env.trim()
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
}
const BUILD_SHA = buildSha()

export default defineConfig({
  // Dave's relative base — lets the build be hosted under a subpath; harmless at root.
  base: './',
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
  },
  plugins: [
    svelte(),
    {
      // also drop the hash as a plain file so the server can serve /version
      name: 'write-version-txt',
      apply: 'build',
      closeBundle() {
        try {
          writeFileSync(resolve(process.cwd(), 'dist/version.txt'), BUILD_SHA)
        } catch {
          /* dist may not exist yet on a failed build — ignore */
        }
      },
    },
  ],
  server: {
    host: '0.0.0.0',
    watch: {
      usePolling: true,
    },
    // dev only: forward the multiplayer WebSocket to the tsx server (npm run dev:server)
    proxy: {
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
  test: {
    environment: 'node',
  },
})
