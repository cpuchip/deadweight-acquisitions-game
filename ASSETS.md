# Asset Attribution & Licensing

This project's **source code** is released into the public domain (see
[`UNLICENSE`](UNLICENSE)).

The bundled **sprite art** is generated and carries a different, permissive
license — documented here.

## Generated sprite atlases

The in-game sprites in [`public/assets/`](public/assets/) are **AI-generated**,
not hand-drawn, via the "asset-harness" clean-license pipeline:

| Atlas | Contents |
|-------|----------|
| `dwa_ships` | player hauler, mining vessel |
| `dwa_station` | station modules (hub, tank, habitat, solar, dock) |
| `dwa_asteroids` | per-resource asteroids (iron, ice, silicates, rare-metals) + an `unknown` variant |
| `dwa_planet` | gas-giant planet |

### Generation chain and licenses

| Component | Role | License |
|-----------|------|---------|
| [Z-Image Turbo](https://huggingface.co/Tongyi-MAI) (Alibaba Tongyi) | image generation engine | Apache 2.0 |
| Z-Image Fun ControlNet Union 2.1 | structure / angle control | Apache 2.0 |
| [BiRefNet](https://github.com/ZhengPeng7/BiRefNet) (HR-matting) | background removal | MIT |

No LoRAs or finetunes are used. (ComfyUI orchestrates the pipeline; as the GPL
*tool* that runs the models it does not impose its license on the generated
output.)

**Effective license of the generated assets: Apache License 2.0** — the most
restrictive link in the chain. The full text is bundled at
[`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt).

### Notes

- The assets are commercially redistributable under Apache 2.0 (with attribution
  preserved, i.e. this file).
- Separately, AI-generated images may not be copyrightable in some jurisdictions;
  this attribution is provided as the clean, conservative posture regardless.

## Summary

- **Code** → Unlicense (public domain), `UNLICENSE`.
- **Generated assets** (`public/assets/*.png`/`*.json`) → Apache 2.0, attributed
  above, license text in `licenses/Apache-2.0.txt`.
