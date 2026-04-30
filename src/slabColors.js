// src/slabColors.js — Slab2 color Strategy registry.
//
// Two parallel APIs:
//   - colorStrategies[name](depthKm) — discrete per-stop, used by the
//     contour ring layer (8 fixed depths).
//   - continuousColorFromDepth(depthKm, name) — smooth lerp between
//     adjacent stops, used by the surface mesh layer (continuous depth).
//
// Adding a new strategy requires THREE edits:
//   1. Define the stops array.
//   2. Register the discrete fn in `colorStrategies`.
//   3. Register the stops array in `STOPS_BY_NAME`.
//   4. Add the strategy name to the dropdown options array in
//      atlasTuning.js's "Slabs (Slab2)" folder. lil-gui dropdowns aren't
//      reactive — the options list is captured at folder-build time.
import { Color } from 'three';

// Max depth for the continuous lerp's normalization. Matches the contour
// layer's deepest depth and the surface prep script's MAX_DEPTH_KM.
const MAX_DEPTH_KM = 700;

// The 8 depth contours we render, in km. The depth values must be a subset
// of what's in data/slab2_contours.geojson (set by scripts/prep-slab2.js).
export const DEPTHS = [40, 100, 200, 300, 400, 500, 600, 700];

// ---- Strategy: viridis (default) -----------------------------------------
// 8-stop sample from the viridis colormap, perceptually uniform purple→yellow.
// Hex values picked to roughly match the canonical viridis at 8 evenly spaced
// positions in [0,1].
const VIRIDIS_STOPS = [
    '#440154', // 40 km (shallowest)
    '#482878',
    '#3e4a89',
    '#31688e',
    '#26828e',
    '#1f9e89',
    '#35b779',
    '#fde725', // 700 km (deepest)
];

function depthIndex(depthKm) {
    const i = DEPTHS.indexOf(depthKm);
    return i >= 0 ? i : 0;  // unknown depth → use shallowest color (defensive)
}

function viridis(depthKm) {
    return new Color(VIRIDIS_STOPS[depthIndex(depthKm)]);
}

// ---- Strategy: markerExtended -------------------------------------------
// Reuses the earthquake-marker palette for shallow contours (40, 100, 200,
// 300 km), then extends into deep indigos for 400-700. Visual continuity
// with the existing earthquake markers (which use ember/mid/cyan via
// tuning.emberHex/midHex/cyanHex).
const MARKER_EXTENDED_STOPS = [
    '#ffeebb', // 40  — ember (shallow)
    '#ff7733', // 100 — mid
    '#22ccff', // 200 — cyan
    '#3344aa', // 300 — deep blue
    '#221166', // 400
    '#11084a', // 500
    '#080530', // 600
    '#03021a', // 700 — near-black
];

function markerExtended(depthKm) {
    return new Color(MARKER_EXTENDED_STOPS[depthIndex(depthKm)]);
}

// ---- Strategy: single ---------------------------------------------------
// All depths share one muted color. Depth distinction comes only from
// the contour's radial position. Useful as a low-information-density
// fallback or for debugging.
function single(_depthKm) {
    return new Color('#7a5a3c');
}

// ---- Public registry -----------------------------------------------------
export const colorStrategies = {
    viridis,
    markerExtended,
    single,
};

// Resolve a strategy by name with safe fallback.
export function resolveStrategy(name) {
    return colorStrategies[name] || colorStrategies.viridis;
}

// ---- Continuous variant for the surface layer ---------------------------
// Maps each strategy's stops array by name. Used by continuousColorFromDepth
// so surfaces can lerp smoothly across depth instead of snapping to one of
// the 8 discrete contour colors. Keep in sync with `colorStrategies`.
const STOPS_BY_NAME = {
    viridis:        VIRIDIS_STOPS,
    markerExtended: MARKER_EXTENDED_STOPS,
    single:         ['#7a5a3c', '#7a5a3c'],   // flat — lerp is a no-op
};

// Smoothly interpolate between adjacent stops of the named strategy
// based on (depthKm / MAX_DEPTH_KM). Falls back to viridis on unknown
// names. Returns a fresh THREE.Color (callers commonly read .r/.g/.b).
const _tmpA = new Color();
const _tmpB = new Color();
export function continuousColorFromDepth(depthKm, strategyName) {
    const stops = STOPS_BY_NAME[strategyName] || VIRIDIS_STOPS;
    const tNorm = Math.max(0, Math.min(1, depthKm / MAX_DEPTH_KM));
    const t = tNorm * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(t));
    const frac = t - i;
    _tmpA.set(stops[i]);
    _tmpB.set(stops[i + 1]);
    // Return a NEW color; _tmp* are reused next call.
    return _tmpA.clone().lerp(_tmpB, frac);
}
