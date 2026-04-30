# Bathymetry / Ocean Depth Shading

**Date:** 2026-04-30
**Status:** Spec ready for implementation

## Goal

Tint the ocean by depth: brighter near continental shelves and abyssal plains, darker over deep trenches. Gives subduction zones (which our slab + contour layers visualize from the inside) some visual weight where they meet the surface — the trench is now visible as a band before the slab descends. Source: ETOPO 2022 60-arc-second bedrock elevation grid.

This is the next deferred Stage B+ item from the post-faults roadmap, after the slab surfaces shipped (`docs/superpowers/specs/2026-04-29-slab2-surfaces-design.md`).

## Source

**Dataset:** NOAA NCEI ETOPO 2022 (60 Arc-Second Geoid Bedrock Elevation, NetCDF-4 / HDF5).

**License:** U.S. Government work — public domain. No legal attribution requirement; the canonical citation is included for credit.

**Citation:** *NOAA National Centers for Environmental Information (2022). ETOPO 2022 15 Arc-Second Global Relief Model. doi:10.25921/fd45-gt74.*

**File format:** NetCDF-4 / HDF5 — same parser (`h5wasm`, already a dev dep) we use for Slab2 grids. Variables: typically `lon`, `lat`, `z` (elevation in meters; negative below sea level).

**Source URL:** https://www.ngdc.noaa.gov/thredds/fileServer/global/ETOPO2022/60s/60s_bed_elev_netcdf/ETOPO_2022_v1_60s_N90W180_bed.nc — verify at implementation time. Full file is ~466 MB.

## Prep

New `scripts/prep-bathymetry.js`:

1. **Cache check.** If `data/.cache/etopo_2022_60s.nc` exists and is non-empty, skip the download. Otherwise, download from NCEI and write to that path. (`data/.cache/` should be gitignored.)
2. **Parse.** Load via h5wasm. Read `z` (Float32 array, shape ~21600 × 10800), plus `lon` and `lat` axes.
3. **Downsample.** Stride decimation by 30 in each dimension → 720 × 360 grid. Simple sampling (no averaging), good enough for a smooth gradient at globe scale.
4. **Mask + normalize.** For each downsampled cell:
   - If elevation ≥ 0 (land), output a sentinel value (255 = sea level).
   - Else compute `depth = -elevation` (positive meters), clamp to `[0, 11000]`, then `normalized = sqrt(depth / 11000)`. The sqrt curve emphasizes the difference between abyssal (~4000–5000 m) and trenches (~7000–11000 m), which a linear ramp would visually flatten.
   - Encode `(1 - normalized) * 255` as `uint8` (so 0 = max depth = darkest, 255 = sea level = lightest).
5. **Encode PNG.** 720 × 360 grayscale 8-bit PNG via `pngjs` (`bun add -d pngjs`). Output `data/bathymetry.png` (~50–100 KB).
6. **Log summary.** Source size, downsampled resolution, output file size, depth range encountered.

`bun run prep-bathymetry` runs the script. Cached source survives between runs.

## Render

`src/atlas.js` crust shader extension. The current crust shader samples a categorical mask (ocean/land/antarctica) and emits one of three flat colors. Bathymetry replaces the ocean branch with a depth-driven lerp.

**New uniforms on `crustMat`:**
- `bathymetry: Texture` — the loaded `data/bathymetry.png`, `LinearFilter`, no mipmaps, `flipY: false` to match the existing mask convention.
- `shallowOceanColor: Color`
- `deepOceanColor: Color`
- `showBathymetry: bool`

**Fragment shader change.** Replace this:

```glsl
vec3 base = oceanColor;
if (cat > 0.55) base = antarcticaColor;
else if (cat > 0.20) base = landColor;
```

with:

```glsl
vec3 oceanRgb = deepOceanColor;
if (showBathymetry) {
    float depth01 = texture2D(bathymetry, vec2(u, v)).r;  // 0=deepest, 1=sea level
    oceanRgb = mix(deepOceanColor, shallowOceanColor, depth01);
}
vec3 color = oceanRgb;
if (cat > 0.55) color = antarcticaColor;
else if (cat > 0.20) color = landColor;
```

(Variable rename `base` → `color` matches the post-simplification crust shader's existing naming.)

The bathymetry sample reuses the existing `(u, v)` mask UV — the bathymetry PNG is rasterized in the same equirectangular projection and same `flipY` convention, so the same UV sampling yields the right texel.

**Texture loading.** In `loadAtlas`:

```js
import { TextureLoader, LinearFilter } from 'three';
import bathymetryUrl from '../data/bathymetry.png' with { type: 'file' };

const bathymetryTex = new TextureLoader().load(bathymetryUrl);
bathymetryTex.flipY = false;
bathymetryTex.minFilter = LinearFilter;
bathymetryTex.magFilter = LinearFilter;
bathymetryTex.generateMipmaps = false;
```

The `with { type: 'file' }` import gives Bun's bundler a stable URL for the asset; the bundler emits the PNG to `dist/` and the import resolves to its hashed filename. Async load completes before the user typically interacts; before load, the shader sees an undefined sampler texture (Three.js default fills with black) and `depth01 = 0` → `oceanRgb = deepOceanColor`. No crash, just temporary flat color.

**`applyColors` callback.** Add three lines to update the new uniforms when atlasTuning fires:

```js
crustMat.uniforms.shallowOceanColor.value.set(t.shallowOceanColor);
crustMat.uniforms.deepOceanColor.value.set(t.deepOceanColor);
crustMat.uniforms.showBathymetry.value = t.showBathymetry;
```

## GUI

**`atlasTuning.js` defaults.** Three new keys:

```js
showBathymetry:     true,
shallowOceanColor: '#1c3358',
deepOceanColor:    '#0a1428',
```

`oceanColor` (existing default `#0a1428`) stays in `defaults` for backward compat but is no longer consumed by the shader. Users who customized it will see no effect from the customization; they re-customize via `deepOceanColor`. Acceptable one-time migration cost.

**GUI placement.**
- "Colors" folder: insert `shallowOceanColor` and `deepOceanColor` immediately after the existing `oceanColor` controller.
- "Visibility" folder: insert `showBathymetry` after `showBoundaries`.

The existing `oceanColor` stays in the GUI (it's still in defaults) but its slider has no visible effect once bathymetry is in. A future cleanup pass could remove it; this spec doesn't.

## Data flow

```
NCEI ETOPO 2022 (.nc, 466 MB)  ──prep-bathymetry.js (cached)──▶  data/bathymetry.png (committed, ~80 KB)

data/bathymetry.png            ──Bun file import──▶            dist/<hashed>.png
                                                                    │
                                                                    ▼
                                       (browser fetch via TextureLoader)
                                                                    │
                                                                    ▼
                                              src/atlas.js crust shader
```

The bathymetry PNG ships separate from the JS bundle (Bun emits it as a sibling asset). JS bundle size unaffected.

## Attribution

ETOPO is U.S. Government public domain — no legal attribution requirement. We still cite it in three surfaces, matching the pattern set by Slab2:

1. **`#data-credits` footer in `index.html`.** Append "Bathymetry: NOAA ETOPO 2022" with link to the NCEI dataset page.
2. **`README.md` Data Sources section.** New bullet with full citation + DOI + license note.
3. **`data/LICENSE`.** New section documenting the source for `data/bathymetry.png` (and noting the cached source under `data/.cache/etopo_2022_60s.nc` which is gitignored).

## Out of scope

- **Land elevation / topography.** Only ocean. Land stays flat.
- **Bathymetric hill-shading / normal-mapped relief.** Color gradient only.
- **Region-specific highlights** (e.g., Mariana Trench callout). Global ramp treats all trenches the same.
- **Per-region tunable opacity.** Single global gradient.
- **Non-linear curve tuning.** The sqrt curve is baked at prep time; not a runtime tunable.
- **Migration of stored `oceanColor` to `deepOceanColor`.** Accepted one-time cost; users re-tweak.
- **High-resolution mode (0.25° / 1440×720).** YAGNI for v1; can add later if texels look chunky on close zoom.

## Risks

- **466 MB ETOPO download.** Cache check makes re-runs free. First-time runs take a couple of minutes on a typical home connection. Document the cache directory in the script header.
- **NetCDF variable names may differ from what's expected.** ETOPO releases sometimes use `Band1` instead of `z`, etc. Implementer should `console.log(f.keys())` after opening the file and adjust if names don't match.
- **PNG encoding via `pngjs`.** Pure JS, slow for large images, but a 720 × 360 grayscale finishes in <1s. Acceptable.
- **Texture seam at antimeridian.** Crust shader uses `fract(u + 1.0)` for u — same convention as the existing mask. Bathymetry sampled with the same UV inherits the wrap behavior, no new seam.
- **`flipY: false`** must be set explicitly. Three.js's `TextureLoader` defaults to `flipY: true` for PNGs. The existing mask CanvasTexture also sets `flipY: false` — match it.
- **localStorage compatibility.** Existing users with stored `oceanColor` get sensible defaults for the new keys. No data loss; just a cosmetic preference reset for users who tweaked `oceanColor`.

## Testing

1. **Prep step.** `bun run prep-bathymetry` succeeds. First run downloads ETOPO (~466 MB) to `data/.cache/`, subsequent runs use the cache. Output: `data/bathymetry.png` at ~50–100 KB. Visual sanity-check by opening the PNG in an image viewer — should look like a smooth grayscale world map. Continents are uniform white (sentinel), oceans are gradients with trenches as dark bands.
2. **Build clean.** `bun run build` succeeds. Bundle size: JS unchanged (~6.5 MB minified), `dist/` gains a `<hashed>.png` (~80 KB). No new runtime deps.
3. **Browser smoke test.** `bun run dev`, open at localhost:3000. Confirm:
   - Ocean visibly tinted by depth: continental shelves brighter than abyssal plains, trenches (Mariana, Tonga, Java, Peru-Chile) read as distinctly darker bands.
   - The Mariana Trench area shows the darkest tones globally.
   - `showBathymetry` toggle: when off, ocean is flat `deepOceanColor`. When on, the gradient appears.
   - Color pickers `shallowOceanColor` and `deepOceanColor` tune live.
   - No console errors. No texture loading warnings.
4. **localStorage compat.** Fresh user (clear localStorage): sees default ocean gradient. Returning user with stored `oceanColor` customization: sees default gradient (their old `oceanColor` value is in storage but has no effect; they re-tune via `deepOceanColor`).

## Acceptance

- Ocean has a visible depth gradient driven by ETOPO data.
- Trenches read as darker than abyssal plains (sqrt curve makes the difference visible).
- GUI controls (toggle + 2 color pickers) work live.
- `data/bathymetry.png` is committed (~50–100 KB).
- No new runtime dependencies; `pngjs` and `h5wasm` are dev-only.
- ETOPO is properly cited in `data/LICENSE` and the in-app `#data-credits` footer.
- `data/.cache/` is gitignored.
