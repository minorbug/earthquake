# Magma Volumetric Fluid Layer — Design

**Status:** landed on `feat/magma-fluid-core`. Behind a build-time flag
(`bun run build:no-fluid` excludes it from the bundle entirely).

## Problem

The original magma core was a single sphere with an FBM-noise emissive
shader. Its silhouette read as a hard, clean sphere edge — the "hard
break between core and mantle" the user pointed out. A reference image
of convective lava (vertical plumes rising through darker magma) set the
target visual: the silhouette should *dissolve* into rising flows of hot
material, not abruptly meet space.

Two earlier prototypes were tried and abandoned:

1. **Heightfield-on-sphere** (Evan-Wallace style): wave PDE drove vertex
   displacement on the core. Real sim, but the bumps were tame and the
   silhouette stayed sharp because the geometry was still bounded.
   Reverted before merge.
2. **Stam 2D fluid as sphere-surface texture only**: same shape problem.
   The fluid was real but the look was "active surface, hard edge."

The volumetric raymarched layer below is the version that actually
broke the silhouette.

## Architecture

```
┌─────────────────── camera ───────────────────┐
│                                              │
│   crust  (atlas.js, r ≈ 6367 km)             │  ← existing, unchanged
│   ┌─ shell ─ raymarched volume (r ≈ 4500    │
│   │         to 6075 km, ~1575 km thick) ─┐  │  ← NEW: coreVolFluid.js
│   │  ┌── core (FBM, r = 4500 km) ───┐    │  │  ← existing, unchanged
│   │  │                              │    │  │
│   │  └──────────────────────────────┘    │  │
│   └────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

Two co-existing layers. The FBM core is opaque and provides the orb's
solid magma body. The new shell is additively blended on top and outside
the core, painting plumes that rise off the core surface and extend into
the mantle volume between core and crust.

### Simulation (`StamFluid2D` in `src/coreVolFluid.js`)

A simplified Stable-Fluids solver runs on a 192×96 equirectangular grid
(velocity in RG, dye in R, on half-float WebGL render targets). Two
ping-pong RT pairs, two compute passes per sub-step:

1. **Velocity update** (`velocityUpdateFrag`): semi-Lagrangian advection
   of velocity by itself + buoyancy from local dye density + a vertical
   kick at active hot spots + viscous damping.
2. **Dye update** (`dyeUpdateFrag`): semi-Lagrangian advection of dye
   by velocity + Gaussian injection from active hot spots + linear
   decay.

The classic Stam pressure-projection step is **omitted** for speed and
simplicity. The flow is therefore compressible — visually that reads as
billowing/expansion rather than tight vortices, which matches "rising
plume" aesthetics fine. Adding Jacobi pressure projection later is
straightforward (one more shader and one more RT pair).

Two sub-steps per frame (sim dt ≈ render dt / 2) so plumes rise visibly
faster than a single-step integrator would deliver.

**Hot spots** are the energy injection mechanism, managed JS-side:
- Spawned as Poisson events at `cfg.spawnRate` (~3.2 / sec by default).
- Each lives 1.3–2.4 s with a sin-bell intensity envelope over its
  lifetime (smooth ramp up, smooth fade out — no hard edges in the
  forcing).
- Up to `MAX_HOTSPOTS = 16` concurrent. Older ones expire naturally.
- UV bias: longitude clamped to ~the camera-facing hemisphere
  (`u ∈ [0.25, 0.75]`); latitude is uniform-on-sphere clipped away from
  the equirectangular pole singularities.
- Pre-warm: the constructor runs 60 sub-steps with 5 seed hot spots so
  the page loads with already-established plumes instead of a quiet
  first second.

Hot spots are passed to both kernels as a `vec3[16]` uniform array
where `xyz = (u, v, intensity)`; intensity ≤ 0 means "slot empty," so
the shader's loop early-exits.

### Rendering (raymarched shell)

A `SphereGeometry` of radius `coreRadius * 1.35` is added to the scene
with a custom `ShaderMaterial`:

- `side: BackSide` — camera sits *inside* this shell (camera dist ≈ 5800
  km, shell outer ≈ 6075 km), so we want the inner surface to draw.
- `depthTest: false` — the back face's z-depth is *behind* the opaque
  core, so the test would reject it. Disabling is safe because the
  raymarcher itself terminates at the inner core radius (the orb still
  occludes plumes that are physically behind it from the camera's
  view).
- `depthWrite: false` — purely additive emission; nothing else samples
  the shell's depth.
- `blending: AdditiveBlending` — plumes brighten whatever's behind them
  (core, crust back-face, void).

The fragment shader raymarches **camera → fragment** through the volume:

```glsl
ro = cameraPosition; rd = normalize(vWorldPos - ro);
tStart = max(rayHitOuterNear, 0.0);
tEnd   = min(rayHitInnerNear, rayHitOuterFar);  // stop at core or back face
for (i = 0..40):
    p = ro + rd * (tStart + jitter + i * stepSize)
    uv = sphericalToEquirect(normalize(p))
    dye = texture2D(dyeMap, uv).r
    altitude = (length(p) - innerRadius) / shellThickness
    profile  = pow(1 - altitude, 1.6)            // taper with height
    detail   = vnoise(p * 0.0014 + time)         // billowing detail
    density  = dye * profile * detail * intensity
    // additive front-to-back composition
    accum += (1 - accum.a) * heatColor * stepAlpha
```

The dye field is 2D — one value per (lng, lat). The "volumetric" look
comes from sampling that 2D field at every 3D ray sample (so the same
column has the same dye but radially extruded with the altitude
profile) plus the 3D animated noise (`vnoise`) that breaks up the
extrusion into billowing detail. This is *not* true 3D dye; it's an
extruded 2D field with noise-modulated density. Cheap, effective, looks
volumetric.

40 raymarch steps per fragment with screen-space jitter to avoid
banding.

### Build flag

`process.env.ENABLE_MAGMA_FLUID` is referenced **literally** in the if
condition in `src/main.js`:

```js
let volFluid = null;
if (process.env.ENABLE_MAGMA_FLUID !== 'false') {
    const { loadCoreVolFluid } = await import('./coreVolFluid.js');
    volFluid = loadCoreVolFluid({ scene, renderer, camera });
}
```

Bun's `--define` substitution operates on literal `process.env.X`
patterns. Two consequences:

1. **The if must reference the literal pattern at the use site.**
   Aliasing through a `FEATURES` constant or a destructured variable
   defeats the substitution and the module ends up bundled even when
   unreachable. (Tried both — DCE didn't fire.)
2. **The dynamic `import()` inside lets Bun's tree-shaker drop
   `coreVolFluid.js` entirely** when the if-branch is statically
   eliminated. With a static import, the module would remain bundled.

`index.html` stubs `window.process` so dev builds (where `--define`
doesn't run) don't ReferenceError; production builds replace the
literal at compile time so the stub is dead air there.

```
bun run build           → 1,344,264 bytes, fluid included
bun run build:no-fluid  → 1,332,876 bytes, zero traces
```

### Tuning controls

Exposed via the existing atlas `lil-gui` panel under "Magma fluid":

| Control | Range | Default | What it does |
|---|---|---|---|
| `fluidEnabled` | bool | true | Hide the shell entirely |
| `fluidIntensity` | 0–3 | 1.0 | Raymarcher emission master multiplier |
| `fluidBuoyancy` | 0–6 | 3.0 | Dye→velocity force; higher = faster rising plumes |
| `fluidDecay` | 0.05–1.0 | 0.32 | Dye dissipation per second |
| `fluidSpawnRate` | 0–10 | 3.2 | Average new hot spots per second |

Persisted to `localStorage` via the existing `eq-atlas-tuning` key.

Other parameters (damping, hotspot radius, hotspot buoyancy kick,
inject strength, lifetime range, raymarch step count, accumulation
multipliers) are intentionally left as developer-tuned constants in the
source — exposing every knob would make the panel impossible.

## Performance

Per frame, with feature on at default settings:

- 4 fluid passes (2 sub-steps × 2 kernels) at 192×96 resolution. Each
  is a single full-screen quad render with a tight fragment shader.
  Negligible (sub-ms) on M-class GPUs.
- 1 raymarch pass at full viewport, 40 steps per fragment, each step
  doing a 2D texture sample + minor noise. The dominant cost.

On a 1200×800 viewport: ~960k fragments × 40 steps = 38M texture
samples per frame. ~2–4 ms on M1+. The whole render budget is comfortably
within 60 fps on dev hardware.

## Known limitations

- **Equirectangular pole singularity.** The 192×96 grid has all top-row
  texels mapping to the north pole (and bottom to south). Hot spots
  near the poles produce visual artifacts. Mitigated by clipping
  hot-spot latitude away from the poles. A cube-map representation
  would fix this properly at a real implementation cost.
- **Pressure-free fluid is compressible.** Looks fine for plumes;
  wouldn't work for tight vortex shedding. Adding Jacobi projection is
  a clean follow-up.
- **2D dye + radial extrusion ≠ true 3D fluid.** Plumes have the same
  cross-section at every altitude (modulo the noise detail). For
  classic "tornado" or "billowing cloud" shapes you'd need real 3D
  dye, which would be a much larger build (3D textures, several
  evenings).
- **Camera-facing hot-spot bias.** Default camera looks ~+X; spawn UV
  is hard-coded to that hemisphere so plumes appear where they're
  visible. If the user orbits, the back side ends up un-plumed. A
  proper fix would update the bias each frame from the current camera
  forward; the prototype skips that for simplicity.

## Files

```
src/coreVolFluid.js       # the whole fluid layer (sim + raymarch + lifecycle)
src/main.js               # build-flag-gated dynamic import
src/atlasTuning.js        # GUI panel + persisted state
index.html                # window.process stub for dev builds
package.json              # build:no-fluid script
scripts/inspect-volfluid.js, inspect-volfluid-debug.js   # Playwright captures
```
