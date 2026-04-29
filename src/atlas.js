// src/atlas.js — vector atlas: rasterized land/antarctica mask + plate boundaries.
//
// The crust sphere uses a custom ShaderMaterial that samples a Canvas2D mask
// rasterized from the GeoJSON sources. Polygons are drawn in equirectangular
// projection, which natively handles antimeridian-spanning features (Eurasia+Africa,
// Antarctica) that would break a flat 2D triangulator like earcut.
//
// Plate boundaries use LineSegments2/LineMaterial so that `boundaryWidth` maps
// to real line thickness (world units, km) instead of just opacity.
import {
    Mesh,
    SphereGeometry,
    ShaderMaterial,
    CanvasTexture,
    LinearFilter,
    DoubleSide,
    Color,
} from 'three';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineSegments2 }        from 'three/examples/jsm/lines/LineSegments2.js';
import { LineMaterial }         from 'three/examples/jsm/lines/LineMaterial.js';
import { geoToVec3 } from './feed.js';
import { atlasTuning, onAtlasColorChange, onAtlasVisibilityChange } from './atlasTuning.js';
import landJson from '../data/ne_110m_land.geojson' with { type: 'json' };
import antarcticaJson from '../data/ne_110m_antarctica.geojson' with { type: 'json' };
import boundariesJson from '../data/pb2002_steps_with_plates.geojson' with { type: 'json' };

// Must match feed.js's geoToVec3 internal constant.
const TEXTURE_EDGE_LNG = -180.806168;
// Camera sits inside the crust sphere. Boundaries need to be slightly INSIDE
// the crust radius to render between camera and the crust's inner surface.
const BOUNDARY_RADIUS_FACTOR = 0.999;
const MASK_WIDTH = 4096;
const MASK_HEIGHT = 2048;

// PB2002 STEPCLASS code → tuning palette key + extra alpha multiplier.
const BOUNDARY_GROUPS = [
    { key: 'ridge',     types: ['OSR', 'CRB'], colorKey: 'ridgeColor',     alphaMult: 1.0 },
    { key: 'transform', types: ['OTF', 'CTF'], colorKey: 'transformColor', alphaMult: 1.0 },
    { key: 'sub',       types: ['SUB'],        colorKey: 'subColor',       alphaMult: 1.4 },
    { key: 'conv',      types: ['OCB', 'CCB'], colorKey: 'subColor',       alphaMult: 1.0 },
    // anything else falls into 'other'
];

// ---- Rasterize land + antarctica into a Canvas2D mask ----
//   r=0    → ocean (cat 0)
//   r≈85   → land  (cat 1)
//   r≈170  → antarctica (cat 2)
function rasterizeMask(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    function drawFeatures(featureCollection, fillStyle) {
        ctx.fillStyle = fillStyle;
        for (const feature of featureCollection.features) {
            const g = feature.geometry;
            const polygons = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
            for (const polygon of polygons) {
                ctx.beginPath();
                for (let r = 0; r < polygon.length; r++) {
                    const ring = polygon[r];
                    for (let i = 0; i < ring.length; i++) {
                        const [lng, lat] = ring[i];
                        // No wrap: lng=180 and lng=-180 must map to DIFFERENT canvas
                        // x values so polygons with explicit antimeridian/pole bridges
                        // (e.g. Antarctica's (180,-90)→(-180,-90) edge) form a proper
                        // bottom-of-canvas bridge instead of a zero-length collapse.
                        const x = ((lng - TEXTURE_EDGE_LNG) / 360) * width;
                        const y = ((90 - lat) / 180) * height;
                        if (i === 0) ctx.moveTo(x, y);
                        else ctx.lineTo(x, y);
                    }
                    ctx.closePath();
                }
                ctx.fill('evenodd');
            }
        }
    }
    drawFeatures(landJson,       'rgb(85,85,85)');    // ≈ 0.333
    drawFeatures(antarcticaJson, 'rgb(170,170,170)'); // ≈ 0.667
    return canvas;
}

// ---- Plate boundary line geometry ----
function buildLineGeometry(features, radiusKm) {
    const positions = [];
    for (const feature of features) {
        const coords = feature.geometry.coordinates;
        for (let i = 0; i < coords.length - 1; i++) {
            const [lng0, lat0] = coords[i];
            const [lng1, lat1] = coords[i + 1];
            const a = geoToVec3(lat0, lng0, 0).normalize().multiplyScalar(radiusKm);
            const b = geoToVec3(lat1, lng1, 0).normalize().multiplyScalar(radiusKm);
            positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
    }
    const geo = new LineSegmentsGeometry();
    geo.setPositions(new Float32Array(positions));
    return geo;
}

// ---- Crust shader: samples mask, branches color, adds magma rim glow ----
const crustVert = /* glsl */`
    varying vec3 vN;
    varying vec3 vWorldPos;
    void main() {
        vN = normalize(position);
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

// Core glow: when the surface normal is grazing the camera (limb of the
// visible portion of the inner sphere), the inner core bleeds through.
// Rim term = pow(1 - |dot(normal, view)|, coreFalloff). Heat-haze
// distortion happens in screen-space (postFX.js), not in this shader.
const crustFrag = /* glsl */`
    precision highp float;
    uniform sampler2D mask;
    uniform vec3 oceanColor;
    uniform vec3 landColor;
    uniform vec3 antarcticaColor;
    uniform vec3 coreColor;
    uniform float coreIntensity;
    uniform float coreFalloff;
    varying vec3 vN;
    varying vec3 vWorldPos;

    void main() {
        float thetaDeg = degrees(atan(vN.z, vN.x));
        float u = (180.0 - thetaDeg) / 360.0;
        u = fract(u + 1.0);

        float lat = 90.0 - degrees(acos(clamp(vN.y, -1.0, 1.0)));
        float v = (90.0 - lat) / 180.0;

        float cat = texture2D(mask, vec2(u, v)).r;
        vec3 base = oceanColor;
        if (cat > 0.55) base = antarcticaColor;
        else if (cat > 0.20) base = landColor;

        vec3 worldNormal = normalize(vWorldPos);
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float ndv = abs(dot(worldNormal, viewDir));
        float rim = pow(1.0 - ndv, coreFalloff);

        vec3 color = base + coreColor * rim * coreIntensity;
        gl_FragColor = vec4(color, 1.0);
    }
`;

// ---- Public ----

export function loadAtlas({ scene, radius }) {
    // Crust: rasterized mask + shader
    const maskCanvas = rasterizeMask(MASK_WIDTH, MASK_HEIGHT);
    const maskTex = new CanvasTexture(maskCanvas);
    // CanvasTexture defaults flipY=true. Our shader's v formula
    // (v = (90 - lat)/180) and canvas drawing (y = (90 - lat)/180 * h)
    // already share orientation — flipping would invert N/S.
    maskTex.flipY = false;
    maskTex.minFilter = LinearFilter;
    maskTex.magFilter = LinearFilter;
    maskTex.generateMipmaps = false;

    const crustMat = new ShaderMaterial({
        uniforms: {
            mask:            { value: maskTex },
            oceanColor:      { value: new Color(atlasTuning.oceanColor) },
            landColor:       { value: new Color(atlasTuning.showLand ? atlasTuning.landColor : atlasTuning.oceanColor) },
            antarcticaColor: { value: new Color(atlasTuning.showLand ? atlasTuning.antarcticaColor : atlasTuning.oceanColor) },
            coreColor:       { value: new Color(atlasTuning.coreColor) },
            coreIntensity:   { value: atlasTuning.coreIntensity },
            coreFalloff:     { value: atlasTuning.coreFalloff },
        },
        vertexShader: crustVert,
        fragmentShader: crustFrag,
        side: DoubleSide,
    });
    const crust = new Mesh(new SphereGeometry(radius, 64, 32), crustMat);
    crust.renderOrder = 0;
    scene.add(crust);

    // Boundary lines
    const boundaryRadius = radius * BOUNDARY_RADIUS_FACTOR;
    const otherFeatures = [];
    const groupedFeatures = Object.fromEntries(BOUNDARY_GROUPS.map((g) => [g.key, []]));
    for (const f of boundariesJson.features) {
        const t = (f.properties && f.properties.Type) || '';
        const grp = BOUNDARY_GROUPS.find((g) => g.types.includes(t));
        if (grp) groupedFeatures[grp.key].push(f);
        else otherFeatures.push(f);
    }

    const boundaryGroups = [];
    for (const g of BOUNDARY_GROUPS) {
        const geo = buildLineGeometry(groupedFeatures[g.key], boundaryRadius);
        const mat = new LineMaterial({
            color: new Color(atlasTuning[g.colorKey]),
            linewidth: Math.max(0.1, atlasTuning.boundaryWidth),
            worldUnits: false,    // linewidth is in pixels — actually visible
            dashed: false,        // solid lines
            dashSize: 30,         // pixels
            gapSize: 20,          // pixels
            transparent: true,
            opacity: 0.95,
        });
        mat.resolution.set(window.innerWidth, window.innerHeight);
        const lines = new LineSegments2(geo, mat);
        lines.renderOrder = 2;
        scene.add(lines);
        boundaryGroups.push({ key: g.key, colorKey: g.colorKey, alphaMult: g.alphaMult, material: mat, mesh: lines, features: groupedFeatures[g.key] });
    }
    const otherGeo = buildLineGeometry(otherFeatures, boundaryRadius);
    const otherMat = new LineMaterial({
        color: new Color(atlasTuning.otherColor),
        linewidth: Math.max(0.1, atlasTuning.boundaryWidth),
        worldUnits: true,
        dashed: true,
        dashSize: 200,
        gapSize: 200,
        transparent: true,
        opacity: atlasTuning.otherAlpha,
    });
    otherMat.resolution.set(window.innerWidth, window.innerHeight);
    const otherLines = new LineSegments2(otherGeo, otherMat);
    otherLines.renderOrder = 2;
    scene.add(otherLines);
    boundaryGroups.push({ key: 'other', colorKey: 'otherColor', alphaMult: 1.0, material: otherMat, mesh: otherLines, isOther: true, features: otherFeatures });

    // Keep LineMaterial resolution in sync with viewport size.
    function updateResolution() {
        const w = window.innerWidth, h = window.innerHeight;
        for (const grp of boundaryGroups) {
            if (grp.material && grp.material.isLineMaterial) {
                grp.material.resolution.set(w, h);
            }
        }
    }
    window.addEventListener('resize', updateResolution);

    // Live tuning
    function applyColors(t) {
        crustMat.uniforms.oceanColor.value.set(t.oceanColor);
        if (t.showLand) {
            crustMat.uniforms.landColor.value.set(t.landColor);
            crustMat.uniforms.antarcticaColor.value.set(t.antarcticaColor);
        } else {
            crustMat.uniforms.landColor.value.set(t.oceanColor);
            crustMat.uniforms.antarcticaColor.value.set(t.oceanColor);
        }
        crustMat.uniforms.coreColor.value.set(t.coreColor);
        crustMat.uniforms.coreIntensity.value = t.coreIntensity;
        crustMat.uniforms.coreFalloff.value = t.coreFalloff;
        for (const g of boundaryGroups) {
            if (!g.material || !g.material.color) continue;   // guard: ShaderMaterial has no .color
            g.material.color.set(t[g.colorKey]);
            if (g.isOther) {
                g.material.opacity = Math.min(1, t.otherAlpha);
            }
            if ('linewidth' in g.material) {
                g.material.linewidth = Math.max(0.1, t.boundaryWidth);
            }
        }
    }
    onAtlasColorChange(applyColors);
    onAtlasVisibilityChange((t) => {
        applyColors(t); // showLand affects land/antarctica uniform colors
        for (const g of boundaryGroups) g.mesh.visible = t.showBoundaries;
    });

    // Diagnostic hook for headless inspection.
    if (typeof window !== 'undefined') window.__eqAtlasMaskCanvas = maskCanvas;

    return { crust, boundaryGroups, maskCanvas, maskTexture: maskTex };
}
