# Simplification: remove core, heat haze, hover-arrows, and earthquake rings

**Date:** 2026-04-28
**Branch:** `feat/plate-motion`
**Status:** Spec ready for implementation

## Goal

Cut four visual subsystems out of the earthquake visualizer. After this work, the scene is a hollow crust sphere with land/antarctica masking and plate boundary lines on the inside, plus pulsing earthquake blob markers. Nothing else.

## Scope of removal

1. **Magma core** — the 3D orb, the volumetric fluid layer, and the legacy "Core glow" rim baked into the crust shader.
2. **Heat haze** — the screen-space post-process that warps pixels around the core.
3. **Plate-motion arrows + hover** — the entire arrow layer, including hover-to-reveal, marching pulse, the debug overlay, and the boundary-flow dash animation. Plate boundary **lines stay**; only the arrows / interaction / flow toggle go.
4. **Earthquake ripple rings** — the expanding circle "ping" rings that radiate from each marker. The blob (deforming icosahedron) stays.

## Files deleted

- `src/core.js`
- `src/coreVolFluid.js`
- `src/postFX.js`
- `src/plateMotion.js`
- `src/plateMotionMath.js`
- `src/plateMotionMath.test.js`
- `data/pb2002_poles.json`
- `scripts/inspect-core.js`
- `scripts/inspect-flame.js`
- `scripts/inspect-haze.js`
- `scripts/inspect-haze-orbit.js`
- `scripts/inspect-falloff.js`
- `scripts/inspect-plate-motion.js`
- `scripts/inspect-plate-wake.js`
- `scripts/inspect-pole.js`
- `scripts/inspect-volfluid.js`
- `scripts/inspect-volfluid-debug.js`

The retained data file `data/pb2002_steps_with_plates.geojson` is still consumed by `src/atlas.js` for boundary-line geometry. Retained inspect scripts: `inspect-dist.js`, `inspect-geo.js`, `inspect-mask.js`, `inspect.js`, `prep-atlas-data.js`.

## Code changes per surviving file

### `src/main.js`

- Drop imports: `loadCore`, `buildPostFX`, the dynamic `loadCoreVolFluid`, and the dynamic `loadPlateMotion`.
- Drop the env-flag conditionals for `ENABLE_MAGMA_FLUID` and `ENABLE_PLATE_MOTION`, including the explanatory comment block about Bun's `--define` substitution (no longer relevant).
- Drop `core`, `volFluid`, `plateMotion`, and `postFX` locals.
- Drop the `window.addEventListener('resize', () => postFX.setSize(...))` listener.
- Animate loop becomes:

  ```js
  function animate() {
      requestAnimationFrame(animate);
      controls.update();
      scene.updateMatrixWorld();
      updateUniforms(clock.getElapsedTime());
      renderer.render(scene, camera);
  }
  ```

  No composer, no `core.update`, no `volFluid.update`, no `plateMotion.update`, no `postFX.update`.
- During implementation, verify `src/scene.js` already handles renderer resize on its own. If not, add a one-line resize listener in `main.js` for `renderer.setSize(window.innerWidth, window.innerHeight)`.

### `src/atlas.js`

The crust shader currently mixes mask color with a magma-rim glow term that uses `coreColor`/`coreIntensity`/`coreFalloff`. With magma removed, the rim has no source. The shader collapses to mask-sample-and-branch:

- Remove uniforms `coreColor`, `coreIntensity`, `coreFalloff` from `crustMat`.
- Remove the `vWorldPos` varying from `crustVert` and `crustFrag` (it exists only to feed the rim term).
- Remove the rim/fresnel block in `crustFrag` (lines computing `worldNormal`, `viewDir`, `ndv`, `rim`, and the `+ coreColor * rim * coreIntensity` term).
- Remove the corresponding three lines in `applyColors` that set those uniforms.
- The comment block above `crustFrag` referencing core glow and heat-haze should be reduced to a one-line description of what the shader does.

### `src/markers.js`

- Remove the `ringVert` and `ringFrag` shader strings.
- Remove `makeRingMaterial`, `buildRingsForMarker`, `orientRingsToSurface`, and the `onRingCountChange` listener registration at the bottom of the file.
- Drop the `onRingCountChange` import from `./tuning.js`.
- In `createBlobMarker`: remove `_ringPhaseSeed`, `_rings`, `_needsOrient` fields from `marker.userData`; remove the `buildRingsForMarker(marker)` call.
- In `updateUniforms`: remove the `_needsOrient`/`orientRingsToSurface` block and the entire `rings` update loop. Keep the blob update.
- The `PlaneGeometry`, `Quaternion`, `Vector3`, `DoubleSide`, and `NormalBlending` Three.js imports become unused; drop them. Keep `Object3D`, `Mesh`, `IcosahedronGeometry`, `ShaderMaterial`, `Color`.

### `src/tuning.js`

- Drop these keys from `defaults`: `maxReachMin`, `maxReachMax`, `cycleSec`, `alphaExp`, `thicknessFrac`, `thicknessFalloff`, `ringCount`.
- Drop `ringCountListeners`, the `onRingCountChange` export, and the special-case `ringCtl` handling in `buildGui`.
- Drop the entire "Rings" GUI folder.
- The reset handler simplifies — no need to compare `prevRingCount` or fire ring listeners.

### `src/atlasTuning.js`

- Drop these keys from `defaults`: `coreColor`, `coreIntensity`, `coreFalloff` (the legacy crust-rim sliders); all `haze*` keys; all `core*` orb keys (`coreEnabled`, `coreRadius`, `coreBrightness`, `coreSpeed`, `coreHotColor`, `coreCoolColor`, `coreRimBoost`); all `fluid*` keys; all plate-motion keys (`plateMotionEnabled`, `arrowsEnabled`, `flowEnabled`, `arrowDensity`, `arrowScale`, `arrowColor`, `arrowThickness`, `flowSpeed`, `flowOpacity`).
- Drop the GUI folders: "Core glow", "Heat haze", "Magma core", "Magma fluid", "Plate motion".
- The remaining folders are: "Colors", "Geometry", "Visibility".

### `package.json`

- Remove the `build:no-fluid` script (no fluid module to flag).
- Remove the `build:no-plate-motion` script (no plate-motion module to flag).
- Surviving scripts: `dev`, `build`, `prep-data`.

## Stale localStorage

Users who have run prior versions have `eq-atlas-tuning` and `eq-marker-tuning` blobs in `localStorage` containing the dropped keys. Both modules' load loop only copies keys that are present in the current `defaults`, so unknown stored keys are silently ignored on read. No migration code is needed; the extra bytes are inert.

## Testing

- The only existing test file (`src/plateMotionMath.test.js`) is being deleted along with its module. No remaining tests to update.
- Manual verification after the change: run `bun run dev`, open the page in a browser, confirm:
  - Earthquake markers appear as deforming blobs (no expanding rings).
  - Plate boundary lines render with their three color groups (ridges/transforms/subduction); no arrows visible anywhere; hovering a line does nothing extra.
  - The center of the planet is empty (no orb, no fluid, no rim glow on the inner crust limb).
  - No screen-space wobble around the centre when the camera orbits (no haze).
  - Both GUI panels open without errors and contain only the expected reduced sets of folders.
  - Browser console is clean of errors and warnings.

## Out of scope

- Folding `tuning.js` and `atlasTuning.js` together (Approach C from brainstorming) — refactoring beyond the simplification ask.
- Cleaning up unrelated commented-out code or unused imports outside the touched files.
- Migrating away from `localStorage` for persistence.
