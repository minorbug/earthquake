// src/atlasTuning.js — atlas styling state + lil-gui panel + persistence.
import GUI from 'lil-gui';

const STORAGE_KEY = 'eq-atlas-tuning';

const defaults = {
    // Colors
    oceanColor:      '#0a1428',
    landColor:       '#2c4870',
    antarcticaColor: '#7a90b0',
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

function fireColors()     { colorListeners.forEach((cb) => cb(atlasTuning)); }
function fireVisibility() { visibilityListeners.forEach((cb) => cb(atlasTuning)); }

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
