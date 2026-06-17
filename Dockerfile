# Production image for Deadweight Acquisitions (multiplayer).
# One container: builds the Vite client and runs the Node server that serves the
# built client AND the same-origin game WebSocket at /ws.
#
# (Dave's Dockerfile.dev is the single-player dev toolbox; this is the deployable
#  multiplayer server.)

FROM node:lts-alpine
WORKDIR /app

# Install against the lockfile first so this layer caches across source changes.
# --legacy-peer-deps: matches the repo's .npmrc (a transitive peer range is stale).
COPY package.json package-lock.json .npmrc ./
RUN npm ci --legacy-peer-deps

# Build the client (vite build -> dist/), served by the server at runtime.
# git is installed so the build can stamp the commit hash (VITE_GIT_SHA); .git is
# copied in (un-ignored) for that, then removed to keep the image lean.
RUN apk add --no-cache git
COPY . .
RUN git config --global --add safe.directory /app \
 && export VITE_GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo dev)" \
 && echo "[build] VITE_GIT_SHA=$VITE_GIT_SHA" \
 && npm run build \
 && rm -rf .git

ENV PORT=8080
EXPOSE 8080

# Lightweight container healthcheck against the server's /healthz.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/healthz || exit 1

# tsx runs the TypeScript server directly (it reuses Dave's Phaser-free modules).
CMD ["npm", "run", "serve"]
