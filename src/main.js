// src/main.js — entry. Wires scene, controls, feed, markers, tuning, detail.
import { Clock } from 'three';
import { createScene, CRUST_RADIUS } from './scene.js';
import { buildGui } from './tuning.js';
import { loadEarthquakes, geoToVec3 } from './feed.js';
import { createBlobMarker, updateUniforms, getAllMarkers } from './markers.js';
import { attachControls } from './controls.js';
import { showDetail, hideDetail } from './detail.js';
import { buildAtlasGui } from './atlasTuning.js';
import { loadAtlas } from './atlas.js';

const probe = document.createElement('canvas');
if (!probe.getContext('webgl2') && !probe.getContext('webgl')) {
    document.body.innerHTML = '<p style="color:#fff;font:14px sans-serif;padding:20px">WebGL is required.</p>';
    throw new Error('no webgl');
}

const eqScene = document.getElementById('eqScene');
const { scene, camera, camGroup, renderer } = createScene(eqScene);
buildGui();
buildAtlasGui();
const { crust } = loadAtlas({ scene, radius: CRUST_RADIUS });

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
    updateUniforms(clock.getElapsedTime());
    renderer.render(scene, camera);
}
animate();
