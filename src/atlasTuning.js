// src/atlasTuning.js — atlas styling state + lil-gui panel + persistence.
import GUI from 'lil-gui';

const STORAGE_KEY = 'eq-atlas-tuning';

const defaults = {
    // Colors
    oceanColor:      '#0a1428',
    landColor:       '#3e5d8a',
    antarcticaColor: '#9aa8c5',
    ridgeColor:      '#d840ff', // OSR, CRB
    subColor:        '#6020c0', // OCB, CCB, SUB
    transformColor:  '#f0c060', // OTF, CTF
    otherColor:      '#ffffff',
    otherAlpha:      0.18,
    // Geometry
    boundaryWidth:   1.0,
    // Visibility
    showLand:        true,
    showBoundaries:  true,
    // Faults (GEM Global Active Faults)
    showFaults:    true,
    faultColor:    '#7a5a3c',
    faultWidth:    0.5,    // multiplier on boundaryWidth
    faultOpacity:  0.4,
    // Slabs (USGS Slab2 depth contours)
    showSlabs:          true,
    slabWidth:          0.5,    // multiplier on boundaryWidth
    slabOpacity:        0.6,
    slabColorStrategy:  'viridis',
};

function loadStored() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}

const stored = loadStored();
export const atlasTuning = {};
for (const k in defaults) atlasTuning[k] = Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : defaults[k];

function save() {
    try {
        const snap = {};
        for (const k in defaults) snap[k] = atlasTuning[k];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    } catch (e) {}
}

const colorListeners = [];
const visibilityListeners = [];

export function onAtlasColorChange(cb)      { colorListeners.push(cb); }
export function onAtlasVisibilityChange(cb) { visibilityListeners.push(cb); }

function fireColors() {
    for (const cb of colorListeners) {
        try { cb(atlasTuning); } catch (e) { console.error('atlasTuning color listener:', e); }
    }
}
function fireVisibility() {
    for (const cb of visibilityListeners) {
        try { cb(atlasTuning); } catch (e) { console.error('atlasTuning visibility listener:', e); }
    }
}

export function buildAtlasGui() {
    const gui = new GUI({ width: 300, title: 'Atlas' });
    // Default lil-gui placement is top-right; the marker-tuning panel
    // (tuning.js) lives there. Move this one to top-left so they don't
    // overlap or fight for cursor space.
    gui.domElement.style.left  = '0';
    gui.domElement.style.right = 'auto';

    const allControllers = [];
    const bindColor = (ctl) => { ctl.onChange(() => { save(); fireColors(); }); allControllers.push(ctl); return ctl; };
    const bindVis   = (ctl) => { ctl.onChange(() => { save(); fireVisibility(); }); allControllers.push(ctl); return ctl; };

    const fColors = gui.addFolder('Colors');
    bindColor(fColors.addColor(atlasTuning, 'oceanColor'));
    bindColor(fColors.addColor(atlasTuning, 'landColor'));
    bindColor(fColors.addColor(atlasTuning, 'antarcticaColor'));
    bindColor(fColors.addColor(atlasTuning, 'ridgeColor'));
    bindColor(fColors.addColor(atlasTuning, 'subColor'));
    bindColor(fColors.addColor(atlasTuning, 'transformColor'));
    bindColor(fColors.addColor(atlasTuning, 'otherColor'));
    bindColor(fColors.add(atlasTuning, 'otherAlpha', 0, 1, 0.01));

    const fGeom = gui.addFolder('Geometry');
    bindColor(fGeom.add(atlasTuning, 'boundaryWidth', 0, 12, 0.1));

    const fFaults = gui.addFolder('Faults');
    bindVis  (fFaults.add(atlasTuning, 'showFaults'));
    bindColor(fFaults.addColor(atlasTuning, 'faultColor'));
    bindColor(fFaults.add(atlasTuning, 'faultWidth',   0, 2, 0.05));
    bindColor(fFaults.add(atlasTuning, 'faultOpacity', 0, 1, 0.01));

    const fSlabs = gui.addFolder('Slabs (Slab2)');
    bindVis  (fSlabs.add(atlasTuning, 'showSlabs'));
    bindColor(fSlabs.add(atlasTuning, 'slabWidth',   0, 2, 0.05));
    bindColor(fSlabs.add(atlasTuning, 'slabOpacity', 0, 1, 0.01));
    bindColor(fSlabs.add(atlasTuning, 'slabColorStrategy', ['viridis', 'markerExtended', 'single']));

    const fVis = gui.addFolder('Visibility');
    bindVis(fVis.add(atlasTuning, 'showLand'));
    bindVis(fVis.add(atlasTuning, 'showBoundaries'));

    gui.add({
        reset: () => {
            for (const k in defaults) atlasTuning[k] = defaults[k];
            save();
            allControllers.forEach((c) => c.updateDisplay());
            fireColors();
            fireVisibility();
        },
    }, 'reset').name('Reset atlas');
}
