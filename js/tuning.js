// tuning.js — owns window.tuning + dat.GUI panel + localStorage persistence.
(function () {
    var STORAGE_KEY = 'eq-marker-tuning';

    var defaults = {
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
        midHex:   '#ff7733',
        cyanHex:  '#22ccff',
        depthNormKm: 300,
        // Globals
        ringCount: 3,
        visible: true
    };

    function loadStored() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return {};
            return JSON.parse(raw);
        } catch (e) { return {}; }
    }

    function save() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tuning)); } catch (e) {}
    }

    var stored = loadStored();
    var tuning = {};
    for (var k in defaults) tuning[k] = stored.hasOwnProperty(k) ? stored[k] : defaults[k];

    var ringCountListeners = [];
    tuning.onRingCountChange = function (cb) { ringCountListeners.push(cb); };

    function copyJson() {
        var snapshot = {};
        for (var k in defaults) snapshot[k] = tuning[k];
        var json = JSON.stringify(snapshot, null, 2);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(json);
        } else {
            // Fallback
            var ta = document.createElement('textarea');
            ta.value = json;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (e) {}
            document.body.removeChild(ta);
        }
        console.log('Tuning JSON copied:\n' + json);
    }

    var allControllers = [];

    function resetToDefaults() {
        var prevRingCount = tuning.ringCount;
        for (var k in defaults) tuning[k] = defaults[k];
        save();
        for (var i = 0; i < allControllers.length; i++) allControllers[i].updateDisplay();
        if (prevRingCount !== tuning.ringCount) {
            for (var j = 0; j < ringCountListeners.length; j++) ringCountListeners[j](tuning.ringCount);
        }
    }

    function buildGui() {
        var gui = new dat.GUI({ width: 300 });

        function bindSave(controller) {
            controller.onChange(save);
            allControllers.push(controller);
            return controller;
        }

        var fBlob = gui.addFolder('Blob');
        bindSave(fBlob.add(tuning, 'radiusMin',    5,  200));
        bindSave(fBlob.add(tuning, 'radiusMax',   50,  400));
        bindSave(fBlob.add(tuning, 'deformAmpMin', 0,    1, 0.01));
        bindSave(fBlob.add(tuning, 'deformAmpMax', 0,    1, 0.01));
        bindSave(fBlob.add(tuning, 'pulseHzMin',   0,    3, 0.05));
        bindSave(fBlob.add(tuning, 'pulseHzMax',   0,    5, 0.05));
        fBlob.open();

        var fRings = gui.addFolder('Rings');
        bindSave(fRings.add(tuning, 'maxReachMin',     1,  20, 0.1));
        bindSave(fRings.add(tuning, 'maxReachMax',     1,  30, 0.1));
        bindSave(fRings.add(tuning, 'cycleSec',      0.5,   8, 0.1));
        bindSave(fRings.add(tuning, 'alphaExp',      0.5,   3, 0.05));
        bindSave(fRings.add(tuning, 'thicknessFrac', 0.02, 0.3, 0.005));
        bindSave(fRings.add(tuning, 'thicknessFalloff', 0,   1, 0.01));
        fRings.open();

        var fColor = gui.addFolder('Color');
        bindSave(fColor.addColor(tuning, 'emberHex'));
        bindSave(fColor.addColor(tuning, 'midHex'));
        bindSave(fColor.addColor(tuning, 'cyanHex'));
        bindSave(fColor.add(tuning, 'depthNormKm', 50, 1000, 10));
        fColor.open();

        var fGlobals = gui.addFolder('Globals');
        var ringCtl = fGlobals.add(tuning, 'ringCount', 1, 6, 1);
        ringCtl.onChange(function (v) {
            save();
            for (var i = 0; i < ringCountListeners.length; i++) ringCountListeners[i](v);
        });
        bindSave(fGlobals.add(tuning, 'visible'));
        allControllers.push(ringCtl);
        fGlobals.add({ copyAsJson: copyJson }, 'copyAsJson').name('Copy as JSON');
        fGlobals.add({ reset: resetToDefaults }, 'reset').name('Reset to defaults');
        fGlobals.open();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', buildGui);
    } else {
        buildGui();
    }

    window.tuning = tuning;
})();
