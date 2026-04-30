// src/slab2.js — USGS Slab2 depth-contour render layer.
//
// Builds one LineSegments2 per subduction zone, with all 8 depth contours
// combined inside the per-zone geometry. Per-vertex colors come from the
// active color strategy. A `uGlow` uniform on each material allows future
// click-to-glow per zone — not wired to interaction yet.
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import slabsJson from '../data/slab2_contours.geojson' with { type: 'json' };
import { atlasTuning, onAtlasColorChange, onAtlasVisibilityChange } from './atlasTuning.js';
import { resolveStrategy } from './slabColors.js';

// Group features by zone code so we can build one mesh per zone.
function groupByZone(features) {
    const groups = new Map();
    for (const f of features) {
        const z = f.properties.zone;
        if (!groups.has(z)) groups.set(z, []);
        groups.get(z).push(f);
    }
    return groups;
}

// Convert (lon, lat, depthKm) → 3D position on a sphere of radius
// (CRUST_RADIUS - depthKm). Returns [x, y, z].
//
// Coordinate convention matches src/feed.js's geoToVec3 with depth=0,
// then radially shrinks. The phi/theta math is the same equirectangular
// projection used elsewhere in the codebase.
const TEXTURE_EDGE_LNG = -180.806168; // matches feed.js + atlas.js
const DEG = Math.PI / 180;
function geoToVec3Depth(lat, lng, depthKm, crustRadius) {
    const r = crustRadius - depthKm;
    const phi = (90 - lat) * DEG;
    const theta = (180 - (lng - TEXTURE_EDGE_LNG)) * DEG;
    const sp = Math.sin(phi);
    return [r * sp * Math.cos(theta), r * Math.cos(phi), r * sp * Math.sin(theta)];
}

// Build one zone mesh. Combines all features for the zone into one
// LineSegmentsGeometry. Each feature is a LineString; we expand it into
// adjacent vertex pairs (segment endpoints) since LineSegments2 expects
// segment-pair data, not a continuous polyline.
function buildZoneMesh(zone, features, strategy, crustRadius) {
    const positions = [];   // flat [x,y,z, x,y,z, ...] in segment order
    const colors = [];      // flat [r,g,b, r,g,b, ...] one per *original* vertex
    for (const f of features) {
        const depthKm = f.properties.depth_km;
        const colorObj = strategy(depthKm);
        const coords = f.geometry.coordinates;
        for (let i = 0; i < coords.length - 1; i++) {
            const [lon0, lat0] = coords[i];
            const [lon1, lat1] = coords[i + 1];
            const a = geoToVec3Depth(lat0, lon0, depthKm, crustRadius);
            const b = geoToVec3Depth(lat1, lon1, depthKm, crustRadius);
            positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
            // Two vertices per segment, both same color (whole contour is one depth)
            colors.push(colorObj.r, colorObj.g, colorObj.b, colorObj.r, colorObj.g, colorObj.b);
        }
    }

    // LineSegmentsGeometry interprets positions as independent segment pairs:
    // each 6 floats (x1,y1,z1, x2,y2,z2) defines one segment. That matches
    // our segment-pair layout above. LineGeometry would chain everything as
    // a polyline and draw spurious cross-feature arcs between unrelated
    // depth contours within a zone. Same class atlas.js uses for plate
    // boundaries and faults.
    //
    // IMPORTANT: setColors() is a fat-line API on the geometry; do NOT mix
    // it with a normal BufferGeometry color attribute — they're different
    // paths.
    const geo = new LineSegmentsGeometry();
    geo.setPositions(new Float32Array(positions));
    geo.setColors(new Float32Array(colors));

    const mat = new LineMaterial({
        vertexColors: true,
        transparent: true,
        opacity: atlasTuning.slabOpacity,
        linewidth: Math.max(0.05, atlasTuning.slabWidth * atlasTuning.boundaryWidth),
        worldUnits: false,
        dashed: false,
    });
    mat.resolution.set(window.innerWidth, window.innerHeight);

    // Future click-to-glow hook: each mesh exposes a uGlowRef on userData.
    // The shader-side wiring (uniform injection via onBeforeCompile + a
    // fragment-shader patch that brightens output by uGlow) is deferred
    // until the click-to-glow handler is implemented — that task can pin
    // the regex against the live three.js LineMaterial source instead of
    // guessing here. For now setGlow(zone, factor) just stores the value;
    // visual effect will appear when the future task wires the shader.
    const uGlowRef = { value: 0.0 };

    const mesh = new LineSegments2(geo, mat);
    mesh.renderOrder = 1;
    mesh.userData = { zone, isSlab: true, uGlowRef };
    mesh.visible = atlasTuning.showSlabs;
    return mesh;
}

export function loadSlab2({ scene, radius }) {
    const grouped = groupByZone(slabsJson.features);
    const slabZones = new Map();   // zone → mesh
    let strategy = resolveStrategy(atlasTuning.slabColorStrategy);

    for (const [zone, features] of grouped) {
        const mesh = buildZoneMesh(zone, features, strategy, radius);
        scene.add(mesh);
        slabZones.set(zone, mesh);
    }

    // Resize handler — keep LineMaterial.resolution in sync with viewport.
    function updateResolution() {
        const w = window.innerWidth, h = window.innerHeight;
        for (const mesh of slabZones.values()) {
            mesh.material.resolution.set(w, h);
        }
    }
    window.addEventListener('resize', updateResolution);

    // Apply per-color-change updates from atlasTuning.
    function applyColors(t) {
        const next = resolveStrategy(t.slabColorStrategy);
        const strategyChanged = next !== strategy;
        strategy = next;
        for (const [zone, mesh] of slabZones) {
            mesh.material.opacity = Math.min(1, t.slabOpacity);
            mesh.material.linewidth = Math.max(0.05, t.slabWidth * t.boundaryWidth);
            if (strategyChanged) {
                // Rebuild the color buffer for this zone.
                const features = grouped.get(zone);
                const colors = [];
                for (const f of features) {
                    const c = strategy(f.properties.depth_km);
                    const segCount = f.geometry.coordinates.length - 1;
                    for (let i = 0; i < segCount; i++) {
                        colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
                    }
                }
                mesh.geometry.setColors(new Float32Array(colors));
            }
        }
    }
    onAtlasColorChange(applyColors);

    // Apply visibility updates.
    onAtlasVisibilityChange((t) => {
        for (const mesh of slabZones.values()) {
            mesh.visible = t.showSlabs;
        }
    });

    return {
        // Future-flex hooks (not consumed in v1, but designed in).
        setColorStrategy: (name) => {
            atlasTuning.slabColorStrategy = name;
            applyColors(atlasTuning);
        },
        setVisible: (zone, bool) => {
            const m = slabZones.get(zone);
            if (m) m.visible = bool;
        },
        setGlow: (zone, factor) => {
            const m = slabZones.get(zone);
            if (m) m.userData.uGlowRef.value = factor;
        },
        zones: slabZones,
    };
}
