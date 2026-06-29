# Deadweight Acquisitions

A web-based space mining, resource gathering, and logistics game. You work as a contractor for Deadweight Acquisitions Corp — a company that measures its workers in tonnage.

Built with Phaser 3, Svelte 5, TypeScript, and Vite 8. Runs entirely in the browser; no backend required.

## Requirements

- Docker
- Make

## Development

```bash
make install   # install dependencies
make dev       # start dev server at http://localhost:5173
```

## Other Targets

```bash
make build     # production build → dist/
make compile   # TypeScript type-check (no emit)
make test      # run unit tests (Vitest)
make clean     # remove node_modules/ and dist/
```

## License

- **Code** is released into the public domain — see [`UNLICENSE`](UNLICENSE).
- **Bundled sprite art** (`public/assets/`) is AI-generated and licensed
  **Apache 2.0** — see [`ASSETS.md`](ASSETS.md) for attribution and the generation
  chain, with the license text in [`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt).
