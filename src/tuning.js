// src/tuning.js — lil-gui panel + tuning state + localStorage + JSON export + reset.
import GUI from 'lil-gui';

const STORAGE_KEY = 'eq-marker-tuning';

const defaults = {
    // Blob
    radiusMin: 15,
    radiusMax: 180,
    deformAmpMin: 0.15,
    deformAmpMax: 0.45,
    pulseHzMin: 0.4,
    pulseHzMax: 1.6,
    // Color
    emberHex: '#ffeebb',
    midHex: '#ff7733',
    cyanHex: '#22ccff',
    depthNormKm: 300,
    // Volcanoes (Smithsonian GVP — Holocene-active)
    showVolcanoes: true,
    volcanoColor:  '#ff5533',
    volcanoSize:   12,
    // Globals
    visible: true,
};

function loadStored() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}

const stored = loadStored();
export const tuning = {};
for (const k in defaults) tuning[k] = Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : defaults[k];

function save() {
    try {
        const snap = {};
        for (const k in defaults) snap[k] = tuning[k];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    } catch (e) {}
}

// External listeners for tuning changes — used by volcanoes.js (and any
// future per-event layer) to react when relevant tunables change.
const tuningListeners = [];
export function onTuningChange(cb) { tuningListeners.push(cb); }
function fireTuning() {
    for (const cb of tuningListeners) {
        try { cb(tuning); } catch (e) { console.error('tuning listener:', e); }
    }
}

function copyJson() {
    const snap = {};
    for (const k in defaults) snap[k] = tuning[k];
    const json = JSON.stringify(snap, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json);
    } else {
        const ta = document.createElement('textarea');
        ta.value = json;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
    }
    console.log('Tuning JSON copied:\n' + json);
}

export function buildGui() {
    const gui = new GUI({ width: 300 });
    const allControllers = [];

    const bind = (ctl) => { ctl.onChange(() => { save(); fireTuning(); }); allControllers.push(ctl); return ctl; };

    const fBlob = gui.addFolder('Blob');
    bind(fBlob.add(tuning, 'radiusMin',     5,  200));
    bind(fBlob.add(tuning, 'radiusMax',    50,  400));
    bind(fBlob.add(tuning, 'deformAmpMin',  0,    1, 0.01));
    bind(fBlob.add(tuning, 'deformAmpMax',  0,    1, 0.01));
    bind(fBlob.add(tuning, 'pulseHzMin',    0,    3, 0.05));
    bind(fBlob.add(tuning, 'pulseHzMax',    0,    5, 0.05));

    const fColor = gui.addFolder('Color');
    bind(fColor.addColor(tuning, 'emberHex'));
    bind(fColor.addColor(tuning, 'midHex'));
    bind(fColor.addColor(tuning, 'cyanHex'));
    bind(fColor.add(tuning, 'depthNormKm', 50, 1000, 10));

    const fVolc = gui.addFolder('Volcanoes');
    bind(fVolc.add(tuning, 'showVolcanoes'));
    bind(fVolc.addColor(tuning, 'volcanoColor'));
    bind(fVolc.add(tuning, 'volcanoSize', 4, 32, 1));

    const fGlobals = gui.addFolder('Globals');
    bind(fGlobals.add(tuning, 'visible'));
    fGlobals.add({ copyAsJson: copyJson }, 'copyAsJson').name('Copy as JSON');
    fGlobals.add({
        reset: () => {
            for (const k in defaults) tuning[k] = defaults[k];
            save();
            allControllers.forEach(c => c.updateDisplay());
            fireTuning();
        },
    }, 'reset').name('Reset to defaults');
}
