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
    // Rings
    maxReachMin: 3,
    maxReachMax: 8,
    cycleSec: 3.0,
    alphaExp: 1.5,
    thicknessFrac: 0.08,
    thicknessFalloff: 0.2,
    // Color
    emberHex: '#ffeebb',
    midHex: '#ff7733',
    cyanHex: '#22ccff',
    depthNormKm: 300,
    // Globals
    ringCount: 3,
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

const ringCountListeners = [];
export function onRingCountChange(cb) { ringCountListeners.push(cb); }

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

    const bind = (ctl) => { ctl.onChange(save); allControllers.push(ctl); return ctl; };

    const fBlob = gui.addFolder('Blob');
    bind(fBlob.add(tuning, 'radiusMin',     5,  200));
    bind(fBlob.add(tuning, 'radiusMax',    50,  400));
    bind(fBlob.add(tuning, 'deformAmpMin',  0,    1, 0.01));
    bind(fBlob.add(tuning, 'deformAmpMax',  0,    1, 0.01));
    bind(fBlob.add(tuning, 'pulseHzMin',    0,    3, 0.05));
    bind(fBlob.add(tuning, 'pulseHzMax',    0,    5, 0.05));

    const fRings = gui.addFolder('Rings');
    bind(fRings.add(tuning, 'maxReachMin',     1,  20, 0.1));
    bind(fRings.add(tuning, 'maxReachMax',     1,  30, 0.1));
    bind(fRings.add(tuning, 'cycleSec',      0.5,   8, 0.1));
    bind(fRings.add(tuning, 'alphaExp',      0.5,   3, 0.05));
    bind(fRings.add(tuning, 'thicknessFrac', 0.02, 0.3, 0.005));
    bind(fRings.add(tuning, 'thicknessFalloff', 0,   1, 0.01));

    const fColor = gui.addFolder('Color');
    bind(fColor.addColor(tuning, 'emberHex'));
    bind(fColor.addColor(tuning, 'midHex'));
    bind(fColor.addColor(tuning, 'cyanHex'));
    bind(fColor.add(tuning, 'depthNormKm', 50, 1000, 10));

    const fGlobals = gui.addFolder('Globals');
    const ringCtl = fGlobals.add(tuning, 'ringCount', 1, 6, 1);
    ringCtl.onChange((v) => { save(); ringCountListeners.forEach(cb => cb(v)); });
    allControllers.push(ringCtl);
    bind(fGlobals.add(tuning, 'visible'));
    fGlobals.add({ copyAsJson: copyJson }, 'copyAsJson').name('Copy as JSON');
    fGlobals.add({
        reset: () => {
            const prevRingCount = tuning.ringCount;
            for (const k in defaults) tuning[k] = defaults[k];
            save();
            allControllers.forEach(c => c.updateDisplay());
            if (prevRingCount !== tuning.ringCount) ringCountListeners.forEach(cb => cb(tuning.ringCount));
        },
    }, 'reset').name('Reset to defaults');
}
