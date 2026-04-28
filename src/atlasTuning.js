// src/atlasTuning.js — atlas styling state + lil-gui panel + persistence.
import GUI from 'lil-gui';

const STORAGE_KEY = 'eq-atlas-tuning';

const defaults = {
    // Colors
    oceanColor:      '#0a1428',
    landColor:       '#3e5d8a',
    antarcticaColor: '#9aa8c5',
    coreColor:       '#ff3008',
    coreIntensity:   0.35,
    coreFalloff:     2.0,
    // Heat-haze post-FX (screen-space ripple over bottom strip)
    hazeAmount:      0.5,   // distortion magnitude (0–1)
    hazeHeight:      0.10,  // fraction of viewport from bottom that ripples
    hazeSpeed:       1.0,   // wave temporal scale
    // Magma core (real 3D orb at origin)
    coreEnabled:     true,
    coreRadius:      4500,    // km. Camera sits at ~5800; this fills the lower viewport.
    coreBrightness:  1.0,
    coreSpeed:       1.0,     // animation rate
    coreHotColor:    '#ffd060', // peaks of magma flow
    coreCoolColor:   '#a01a08', // troughs
    coreRimBoost:    0.6,     // fresnel rim brightness multiplier
    // Magma volumetric fluid layer (Stam-style 2D sim + raymarched shell).
    // Disabled at build time via `bun run build:no-fluid`.
    fluidEnabled:    true,
    fluidIntensity:  1.0,     // raymarcher emission master multiplier
    fluidBuoyancy:   3.0,     // dye→velocity force; higher = faster rising plumes
    fluidDecay:      0.32,    // dye dissipation per second
    fluidSpawnRate:  3.2,     // average new hot spots per second
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
    // Plate motion vectors layer (PB2002 Euler poles + flow shader).
    plateMotionEnabled: true,
    arrowsEnabled:      true,
    flowEnabled:        true,
    arrowDensity:       5.0,    // sample spacing in degrees of arc
    arrowScale:         1.0,
    flowSpeed:          1.0,
    flowOpacity:        0.7,
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
    gui.domElement.style.marginTop = '8px';

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

    const fCore = gui.addFolder('Core glow');
    bindColor(fCore.addColor(atlasTuning, 'coreColor'));
    bindColor(fCore.add(atlasTuning, 'coreIntensity', 0, 2, 0.01));
    bindColor(fCore.add(atlasTuning, 'coreFalloff', 0.25, 4, 0.05).name('coreFalloff (lower = wider)'));

    const fHaze = gui.addFolder('Heat haze');
    bindColor(fHaze.add(atlasTuning, 'hazeAmount', 0, 1, 0.01));
    bindColor(fHaze.add(atlasTuning, 'hazeHeight', 0, 0.5, 0.01));
    bindColor(fHaze.add(atlasTuning, 'hazeSpeed', 0, 3, 0.05));

    const fCoreOrb = gui.addFolder('Magma core');
    bindVis(fCoreOrb.add(atlasTuning, 'coreEnabled'));
    bindColor(fCoreOrb.add(atlasTuning, 'coreRadius', 500, 5000, 50));
    bindColor(fCoreOrb.add(atlasTuning, 'coreBrightness', 0, 3, 0.01));
    bindColor(fCoreOrb.add(atlasTuning, 'coreSpeed', 0, 3, 0.05));
    bindColor(fCoreOrb.add(atlasTuning, 'coreRimBoost', 0, 2, 0.01));
    bindColor(fCoreOrb.addColor(atlasTuning, 'coreHotColor'));
    bindColor(fCoreOrb.addColor(atlasTuning, 'coreCoolColor'));

    const fFluid = gui.addFolder('Magma fluid');
    bindVis(fFluid.add(atlasTuning, 'fluidEnabled'));
    bindColor(fFluid.add(atlasTuning, 'fluidIntensity', 0, 3, 0.05));
    bindColor(fFluid.add(atlasTuning, 'fluidBuoyancy', 0, 6, 0.1));
    bindColor(fFluid.add(atlasTuning, 'fluidDecay', 0.05, 1.0, 0.01));
    bindColor(fFluid.add(atlasTuning, 'fluidSpawnRate', 0, 10, 0.1));

    const fPlate = gui.addFolder('Plate motion');
    bindVis(fPlate.add(atlasTuning, 'plateMotionEnabled'));
    bindVis(fPlate.add(atlasTuning, 'arrowsEnabled'));
    bindVis(fPlate.add(atlasTuning, 'flowEnabled'));
    bindColor(fPlate.add(atlasTuning, 'arrowDensity', 2, 15, 0.5));
    bindColor(fPlate.add(atlasTuning, 'arrowScale',   0, 3, 0.05));
    bindColor(fPlate.add(atlasTuning, 'flowSpeed',    0, 4, 0.05));
    bindColor(fPlate.add(atlasTuning, 'flowOpacity',  0, 1, 0.01));

    const fGeom = gui.addFolder('Geometry');
    bindColor(fGeom.add(atlasTuning, 'boundaryWidth', 0, 3, 0.05));

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
