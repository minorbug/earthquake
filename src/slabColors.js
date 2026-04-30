// src/slabColors.js — Slab2 color Strategy registry.
//
// Each strategy maps a depth-in-km to a THREE.Color. The active strategy
// is named in atlasTuning.slabColorStrategy and looked up by name from
// `colorStrategies`. Adding a new strategy requires TWO edits:
//   1. Add the function + register it in `colorStrategies` here.
//   2. Add the strategy name to the dropdown options array in
//      atlasTuning.js's "Slabs (Slab2)" folder. lil-gui dropdowns aren't
//      reactive — the options list is captured at folder-build time.
import { Color } from 'three';

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
