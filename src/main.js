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
import { loadCoreVolFluid } from './coreVolFluid.js';
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
const volFluid = loadCoreVolFluid({ scene, renderer, camera });
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
    volFluid.update(t);
    postFX.update(t);
    postFX.composer.render();
}
animate();

if (typeof window !== 'undefined') {
    window.__eqDebug = { scene, camera, camGroup, geoToVec3, atlasTuning };
}
