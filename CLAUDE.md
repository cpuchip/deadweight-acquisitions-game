# CLAUDE.md — Deadweight Acquisitions

Client-side SPA space-mining/logistics game. **Phaser 3** (canvas + arcade physics)
for the simulation, **Svelte 5** for the HUD/panel overlay, **TypeScript** (strict),
built with **Vite 8**, tested with **Vitest**. No backend; state persists to
`localStorage`.

## Build & test — Docker + Make only

This repo builds in a container (`Dockerfile.dev` + `Makefile`). **Do not run `npm`
directly** — it won't match the toolchain. Use the make targets:

```
make install   # install deps in the container
make dev       # dev server → http://localhost:5173
make compile   # tsc --noEmit (type-check)
make test      # vitest run
make build     # production build → dist/
```

`make compile`, `make test`, and `make build` are the gates for any change; `build`
is the real gate for runtime wiring (Svelte/Phaser glue a type-check won't catch).

## Architecture — read before editing

`ARCHITECTURE.md` is the authoritative code-level map (component index, data flow,
save schema, Phase 3 station systems + Phase 4 economy + Phase 5 industry). Read
its **Architectural Boundaries** section first;
the load-bearing invariants:

- Svelte UI never holds Phaser object references — all entity→UI data flows through
  Svelte writable stores via each entity's `pushToStore()`.
- All UI→game actions flow through the `commandQueue` store, drained each frame by
  `SpaceScene.drainCommandQueue()`.
- Persistence routes only through `GameSaveService` → `localStorage['dwa-save']`.
  Save-schema migrations are a **fallthrough** switch in `migrate()` (every version
  falls through to the next); bump the version when a migration is needed.
- `dispatchLogic.ts` and `simLogic.ts` are pure (no Phaser import) and unit-tested —
  keep simulation *decisions* there, not inline in `SpaceScene`.
- `SpaceScene.ts` is the large central orchestrator (entity lifecycle, camera,
  minimap, `autoDispatch`, save/load).

## Design constraint

The game must be **safe to idle**: a fleet that has finished its work and converged
on the base must trend to zero ongoing cost. Fuel/power/wear are tied to *activity*
(transit, maneuvering, attaching, mining), never to mere existence. Don't add costs
that drain while parked.

## Conventions

- **Versioning:** one work item = one patch bump (`package.json` `version`).
  SideQuests are exempt unless the work item asks for a bump.
- IDs for game entities use `nanoid`.
- Vite `base` is `'./'` (relative) so the build can be hosted under a subpath.

## Where the docs live (tickets repo, not this repo)

- Project + design (incl. the future-phase roadmap):
  `/home/dave/Documents/tickets/docs/projects/deadweight-acquisitions/`
- Work items (one folder each, `workitem.md` + procedure artifacts):
  `/home/dave/Documents/tickets/docs/pending/`
- The development workflow procedures themselves: `/home/dave/Documents/workflow/`
