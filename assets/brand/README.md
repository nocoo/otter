# Otter brand assets

A small river treasure. One native 2048 × 2048 Azure gpt-image-2 request. The owner delegated intermediate acceptance for this named batch; the acceptance record does not claim that the owner reviewed the returned bytes.

## Use by surface

| Surface | Asset | Treatment |
| --- | --- | --- |
| README / large gallery | `assets/brand/icon-rounded.png` | Selected rounded presentation at 128 px in README |
| Sidebar, both states | `packages/web/public/logo-24.png` | Transparent 24 px foreground |
| Not-found view | `packages/web/public/logo-80.png` | Transparent foreground; intentional muted empty-state opacity retained |
| Browser favicon | `packages/web/public/favicon.png and favicon.ico` | Transparent 32 px PNG and decoded 16/32/48 ICO |
| Apple touch | `packages/web/public/apple-touch-icon.png` | Opaque square 180 px presentation |
| Social | `packages/web/public/opengraph-image.png` | Rounded presentation on a 1200 × 630 canvas |

Root `logo.png` is the canonical 2048 × 2048 transparent foreground. `assets/brand/icon.png` and `icon-rounded.png` preserve the independent square and rounded presentation. Small UI and browser marks use the foreground with its original proportions and alpha, without a background tile, glow, color filter or additional mask. Native app and touch icons follow their platform's separate masking contract.

## Rebuild and evidence

```sh
uv run --with pillow python scripts/resize-logos.py
```

Selected study `2026-09-07-01`, finishing `02`. The complete generated mark has 224.5 px clearance from the actual 23% rounded outline; no expressive feature or accessory is clipped.

The presentation uses **Riverbank sweeps**, with base `#648691`, light `#bdccc5`, shade `#355569` and motif `#243e50`. Geometry, fine grain and shallow shadows remain separate from the foreground; product UI colors remain independent. [source.json](source.json) records exact master checksums and the previous identity.

- [Individual before/after page](https://hexly.ai/logos/otter)
- [Complete artwork and finishing archive](https://github.com/nocoo/hexly.ai/tree/main/artwork/logo-family/otter/2026-09-07-01)
- [Local static review](https://index.dev.hexly.ai/artwork/logo-family/otter/2026-09-07-01/review.html)
- [Shared usage SOP](https://github.com/nocoo/hexly.ai/blob/main/docs/07-logo-usage-sop.md)
