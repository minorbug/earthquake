// src/slab2Surfaces.js — USGS Slab2 continuous surface render layer.
//
// Fetches a packed binary asset (data/slab2_surfaces.bin) + JSON manifest
// (data/slab2_surfaces.json) prepared by scripts/prep-slab2-surfaces.js,
// builds one Mesh per subduction zone with per-vertex colors driven by
// the active slabColorStrategy. Renders translucent (FrontSide,
// depthWrite:false) at renderOrder 0, below the contour layer (1) and
// plate boundaries (2).
import {
    Mesh,
    MeshBasicMaterial,
    BufferGeometry,
    BufferAttribute,
    DoubleSide,
} from 'three';
import { atlasTuning, onAtlasColorChange, onAtlasVisibilityChange } from './atlasTuning.js';
import { continuousColorFromDepth } from './slabColors.js';

// Fill the color BufferAttribute for one zone from its depths slice.
function fillColors(colorArray, depths, strategyName) {
    for (let i = 0; i < depths.length; i++) {
        const c = continuousColorFromDepth(depths[i], strategyName);
        const o = i * 3;
        colorArray[o]     = c.r;
        colorArray[o + 1] = c.g;
        colorArray[o + 2] = c.b;
    }
}

export function loadSlab2Surfaces({ scene }) {
    const surfaceZones = new Map();          // zone → { mesh, depths, colorAttr }
    let strategy = atlasTuning.slabColorStrategy;

    // Async load. The function returns the API synchronously; meshes
    // appear in the scene when the fetch + build resolves. Listener
    // callbacks that fire before that find no zones to iterate.
    (async function build() {
        const [manifestRes, binRes] = await Promise.all([
            fetch('/data/slab2_surfaces.json'),
            fetch('/data/slab2_surfaces.bin'),
        ]);
        if (!manifestRes.ok || !binRes.ok) {
            console.error('slab2Surfaces: fetch failed', manifestRes.status, binRes.status);
            return;
        }
        const manifest = await manifestRes.json();
        const binBuf = await binRes.arrayBuffer();

        // Slice the packed binary into typed-array views.
        const positionsAll = new Float32Array(binBuf,
            manifest.layout.positions.byteOffset, manifest.layout.positions.count);
        const depthsAll = new Float32Array(binBuf,
            manifest.layout.depths.byteOffset, manifest.layout.depths.count);
        const indicesAll = new Uint32Array(binBuf,
            manifest.layout.indices.byteOffset, manifest.layout.indices.count);

        for (const z of manifest.zones) {
            // Per-zone slices into the global buffers.
            const positionsView = positionsAll.subarray(
                z.vertexOffset * 3, (z.vertexOffset + z.vertexCount) * 3);
            const depthsView = depthsAll.subarray(
                z.vertexOffset, z.vertexOffset + z.vertexCount);
            const indicesView = indicesAll.subarray(
                z.indexOffset, z.indexOffset + z.indexCount);

            // Per-zone color attribute, populated from depths via the
            // active strategy. Rebuilt on strategy swap.
            const colorArray = new Float32Array(z.vertexCount * 3);
            fillColors(colorArray, depthsView, strategy);

            const geo = new BufferGeometry();
            geo.setAttribute('position', new BufferAttribute(positionsView, 3));
            geo.setAttribute('color',    new BufferAttribute(colorArray, 3));
            geo.setIndex(new BufferAttribute(indicesView, 1));
            geo.computeBoundingSphere();

            const mat = new MeshBasicMaterial({
                vertexColors: true,
                transparent: true,
                opacity: atlasTuning.slabSurfaceOpacity,
                side: DoubleSide,        // see slabs from either viewing angle
                depthWrite: false,       // clean translucency layering
            });

            // Future click-to-glow hook: same pattern as the contour layer.
            const uGlowRef = { value: 0.0 };

            const mesh = new Mesh(geo, mat);
            mesh.renderOrder = 0;
            mesh.visible = atlasTuning.showSlabSurfaces;
            mesh.userData = { zone: z.zone, isSlabSurface: true, uGlowRef };

            scene.add(mesh);
            surfaceZones.set(z.zone, { mesh, depths: depthsView, colorAttr: geo.getAttribute('color') });
        }
    })();

    // Live tuning — opacity / strategy.
    function applyColors(t) {
        const strategyChanged = t.slabColorStrategy !== strategy;
        strategy = t.slabColorStrategy;
        for (const { mesh, depths, colorAttr } of surfaceZones.values()) {
            mesh.material.opacity = Math.min(1, t.slabSurfaceOpacity);
            if (strategyChanged) {
                fillColors(colorAttr.array, depths, strategy);
                colorAttr.needsUpdate = true;
            }
        }
    }
    onAtlasColorChange(applyColors);

    onAtlasVisibilityChange((t) => {
        for (const { mesh } of surfaceZones.values()) {
            mesh.visible = t.showSlabSurfaces;
        }
    });

    return {
        setColorStrategy: (name) => {
            atlasTuning.slabColorStrategy = name;
            applyColors(atlasTuning);
        },
        setOpacity: (value) => {
            atlasTuning.slabSurfaceOpacity = value;
            applyColors(atlasTuning);
        },
        setVisible: (zone, bool) => {
            const entry = surfaceZones.get(zone);
            if (entry) entry.mesh.visible = bool;
        },
        setGlow: (zone, factor) => {
            const entry = surfaceZones.get(zone);
            if (entry) entry.mesh.userData.uGlowRef.value = factor;
        },
        zones: surfaceZones,
    };
}
