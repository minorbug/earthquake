// src/main.js — entry. Wires scene, controls, feed, markers, tuning, detail.
import { Clock } from 'three';
import { createScene, CRUST_RADIUS } from './scene.js';
import { buildGui } from './tuning.js';
import { loadEarthquakes, geoToVec3 } from './feed.js';
import { createBlobMarker, updateUniforms, getAllMarkers } from './markers.js';
import { attachControls } from './controls.js';
import { showDetail, hideDetail } from './detail.js';
import { atlasTuning, buildAtlasGui } from './atlasTuning.js';
import { loadAtlas } from './atlas.js';
import { loadCore } from './core.js';
import { buildPostFX } from './postFX.js';

const probe = document.createElement('canvas');
if (!probe.getContext('webgl2') && !probe.getContext('webgl')) {
    document.body.innerHTML = '<p style="color:#fff;font:14px sans-serif;padding:20px">WebGL is required.</p>';
    throw new Error('no webgl');
}

const eqScene = document.getElementById('eqScene');
const { scene, camera, camGroup, renderer } = createScene(eqScene);
buildGui();
buildAtlasGui();
const atlas = loadAtlas({ scene, radius: CRUST_RADIUS });
const crust = atlas.crust;
const core = loadCore({ scene });
// Magma volumetric fluid layer is a build-time-optional feature. The check
// references `process.env.ENABLE_MAGMA_FLUID` literally so Bun's `--define`
// substitutes it inline at this exact site — dead-code elimination then
// drops the if-branch *and* the dynamic import inside, keeping
// coreVolFluid.js out of the bundle entirely when disabled. Anything else
// (a constant in another module, a destructured alias, a getter) defeats
// the substitution and the module ends up bundled even when unreachable.
// Build with: `bun run build:no-fluid` (or set ENABLE_MAGMA_FLUID=false in
// the dev server env).
let volFluid = null;
if (process.env.ENABLE_MAGMA_FLUID !== 'false') {
    const { loadCoreVolFluid } = await import('./coreVolFluid.js');
    volFluid = loadCoreVolFluid({ scene, renderer, camera });
}
// Plate motion vectors. Build-time-optional via process.env.ENABLE_PLATE_MOTION.
let plateMotion = null;
if (process.env.ENABLE_PLATE_MOTION !== 'false') {
    const { loadPlateMotion } = await import('./plateMotion.js');
    plateMotion = loadPlateMotion({ scene, radius: CRUST_RADIUS, atlas });
}
const postFX = buildPostFX({ renderer, scene, camera });
window.addEventListener('resize', () => postFX.setSize(window.innerWidth, window.innerHeight));

const loadingOverlay = document.getElementById('loadingoverlay');
const clock = new Clock();

const controls = attachControls({
    camera,
    camGroup,
    markers: getAllMarkers(),
    onSelect: (marker) => showDetail(marker.userData),
    onMiss:   () => hideDetail(),
});

(async function boot() {
    try {
        const eqs = await loadEarthquakes();
        for (const eq of eqs) {
            const marker = createBlobMarker(eq);
            marker.position.copy(geoToVec3(eq.lat, eq.lng, eq.depth));
            crust.add(marker);
        }
        loadingOverlay.classList.remove('show');
    } catch (e) {
        console.error('Earthquake fetch failed:', e);
    }
})();

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    scene.updateMatrixWorld();
    const t = clock.getElapsedTime();
    updateUniforms(t);
    core.update(t);
    if (volFluid) volFluid.update(t);
    if (plateMotion) plateMotion.update(t);
    postFX.update(t);
    postFX.composer.render();
}
animate();

if (typeof window !== 'undefined') {
    window.__eqDebug = { scene, camera, camGroup, geoToVec3, atlasTuning };
}
