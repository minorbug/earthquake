// markers.js — shaders, color helpers, blob marker factory.
(function () {

    function hexToRgb(hex) {
        var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!m) return { r: 1, g: 1, b: 1 };
        return {
            r: parseInt(m[1], 16) / 255,
            g: parseInt(m[2], 16) / 255,
            b: parseInt(m[3], 16) / 255
        };
    }

    function lerp(a, b, t) { return a + (b - a) * t; }

    function lerpRgb(c1, c2, t) {
        return {
            r: lerp(c1.r, c2.r, t),
            g: lerp(c1.g, c2.g, t),
            b: lerp(c1.b, c2.b, t)
        };
    }

    // 3-stop gradient: ember (0) → mid (0.5) → cyan (1)
    function colorForDepth(depthKm) {
        var t = Math.max(0, Math.min(1, depthKm / window.tuning.depthNormKm));
        var ember = hexToRgb(window.tuning.emberHex);
        var mid   = hexToRgb(window.tuning.midHex);
        var cyan  = hexToRgb(window.tuning.cyanHex);
        return t < 0.5
            ? lerpRgb(ember, mid, t * 2)
            : lerpRgb(mid, cyan, (t - 0.5) * 2);
    }

    // ----- Blob shader (positions are unit-sphere; mesh.scale carries radius) -----
    var blobVert = [
        'uniform float time;',
        'uniform float phaseSeed;',
        'uniform float deformAmp;',
        'uniform float pulseHz;',
        'varying vec3 vNormal;',
        'void main() {',
        '  float ph = time * pulseHz + phaseSeed;',
        '  float d = (sin(ph + 6.0 * position.x)',
        '           + sin(ph * 1.3 + 4.0 * position.y)',
        '           + sin(ph * 0.7 + 5.0 * position.z)) / 3.0;',
        '  vec3 displaced = position + normal * deformAmp * d;',
        '  vNormal = normalize(normalMatrix * normal);',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);',
        '}'
    ].join('\n');

    var blobFrag = [
        'uniform vec3 color;',
        'varying vec3 vNormal;',
        'void main() {',
        '  float rim = pow(1.0 - max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0), 1.5);',
        '  vec3 c = color + vec3(rim) * 0.4;',
        '  gl_FragColor = vec4(c, 1.0);',
        '}'
    ].join('\n');

    var ringVert = [
        'varying vec2 vUv;',
        'void main() {',
        '  vUv = uv;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
    ].join('\n');

    var ringFrag = [
        'uniform float time;',
        'uniform float phaseOffset;',
        'uniform float cycleSec;',
        'uniform float alphaExp;',
        'uniform float thicknessFrac;',
        'uniform float thicknessFalloff;',
        'uniform vec3  color;',
        'varying vec2 vUv;',
        'void main() {',
        '  float t = mod(time + phaseOffset, cycleSec) / cycleSec;',
        '  float r = length(vUv - vec2(0.5)) * 2.0;',
        '  float thick = thicknessFrac * mix(1.0, thicknessFalloff, t);',
        '  float band = 1.0 - smoothstep(0.0, thick, abs(r - t));',
        '  float alpha = band * pow(1.0 - t, alphaExp);',
        '  alpha *= mix(1.0, 0.6, t);',
        '  if (alpha < 0.01) discard;',
        '  gl_FragColor = vec4(color, alpha);',
        '}'
    ].join('\n');

    var allMarkers = [];

    function makeBlobMaterial(magnitude, depth, phaseSeed) {
        var mNorm = Math.max(0, Math.min(1, (magnitude - 4.5) / 4.5));
        var deform = lerp(window.tuning.deformAmpMin, window.tuning.deformAmpMax, mNorm);
        var hz     = lerp(window.tuning.pulseHzMin, window.tuning.pulseHzMax, mNorm);
        var c      = colorForDepth(depth);

        return new THREE.ShaderMaterial({
            uniforms: {
                time:      { type: 'f', value: 0 },
                phaseSeed: { type: 'f', value: phaseSeed },
                deformAmp: { type: 'f', value: deform },
                pulseHz:   { type: 'f', value: hz },
                color:     { type: 'v3', value: new THREE.Vector3(c.r, c.g, c.b) }
            },
            vertexShader: blobVert,
            fragmentShader: blobFrag
        });
    }

    function makeRingMaterial(magnitude, depth, phaseOffset) {
        var c = colorForDepth(depth);
        return new THREE.ShaderMaterial({
            uniforms: {
                time:             { type: 'f', value: 0 },
                phaseOffset:      { type: 'f', value: phaseOffset },
                cycleSec:         { type: 'f', value: window.tuning.cycleSec },
                alphaExp:         { type: 'f', value: window.tuning.alphaExp },
                thicknessFrac:    { type: 'f', value: window.tuning.thicknessFrac },
                thicknessFalloff: { type: 'f', value: window.tuning.thicknessFalloff },
                color:            { type: 'v3', value: new THREE.Vector3(c.r, c.g, c.b) }
            },
            vertexShader: ringVert,
            fragmentShader: ringFrag,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.NormalBlending,
            side: THREE.DoubleSide
        });
    }

    function buildRingsForMarker(marker) {
        // Remove old rings
        var oldRings = marker.userData._rings || [];
        for (var i = 0; i < oldRings.length; i++) marker.remove(oldRings[i]);

        var data = marker.userData;
        var count = window.tuning.ringCount | 0;
        var rings = [];
        var dNorm = Math.max(0, Math.min(1, data.depth / window.tuning.depthNormKm));
        var mNorm = Math.max(0, Math.min(1, (data.magnitude - 4.5) / 4.5));
        var blobRadius = lerp(window.tuning.radiusMin, window.tuning.radiusMax, mNorm);
        var maxRadius  = lerp(window.tuning.maxReachMin, window.tuning.maxReachMax, dNorm) * blobRadius;

        for (var i = 0; i < count; i++) {
            var phaseOff = (window.tuning.cycleSec * i) / count;
            var mat = makeRingMaterial(data.magnitude, data.depth, phaseOff);
            // Plane disk geometry, unit-radius (scaled by mesh scale)
            var geo = new THREE.PlaneGeometry(2, 2, 1, 1); // -1..1 in x and y; uv 0..1
            var ring = new THREE.Mesh(geo, mat);
            ring.scale.set(maxRadius, maxRadius, maxRadius);
            ring.userData._kind = 'ring';
            marker.add(ring);
            rings.push(ring);
        }
        marker.userData._rings = rings;
    }

    function orientRingsToSurface(marker) {
        // marker.position is local to crust; crust is centered at origin.
        // Surface normal is just the normalized local position.
        if (marker.position.lengthSq() < 1e-6) return;
        var normal = marker.position.clone().normalize();

        // PlaneGeometry's default normal is +Z. We want the plane's +Z to align with `normal`.
        // r64 lacks Quaternion.setFromUnitVectors — derive axis-angle from +Z to normal.
        var quat = new THREE.Quaternion();
        var zAxis = new THREE.Vector3(0, 0, 1);
        var dot = zAxis.dot(normal);
        if (dot > 0.999999) {
            quat.set(0, 0, 0, 1); // identity
        } else if (dot < -0.999999) {
            quat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
        } else {
            var axis = new THREE.Vector3().crossVectors(zAxis, normal).normalize();
            quat.setFromAxisAngle(axis, Math.acos(dot));
        }

        var rings = marker.userData._rings || [];
        for (var i = 0; i < rings.length; i++) {
            rings[i].quaternion.copy(quat);
        }
    }

    function createBlobMarker(data) {
        var marker = new THREE.Object3D();
        var phaseSeed = Math.random() * 6.28318;
        var mNorm = Math.max(0, Math.min(1, (data.magnitude - 4.5) / 4.5));
        var radius = lerp(window.tuning.radiusMin, window.tuning.radiusMax, mNorm);

        var blobMat = makeBlobMaterial(data.magnitude, data.depth, phaseSeed);
        var blobGeo = new THREE.IcosahedronGeometry(1, 2);
        var blob = new THREE.Mesh(blobGeo, blobMat);
        blob.scale.set(radius, radius, radius);
        blob.userData = data;
        blob.userData._kind = 'blob';
        marker.add(blob);

        marker.userData = data;
        marker.userData._phaseSeed = phaseSeed;
        marker.userData._ringPhaseSeed = Math.random() * 1000; // seconds; desyncs ring cycles across markers
        marker.userData._blob = blob;
        marker.userData._rings = [];
        marker.userData._needsOrient = true;

        buildRingsForMarker(marker);
        allMarkers.push(marker);
        return marker;
    }

    function updateMarkerUniforms(time) {
        if (!allMarkers.length) return;
        for (var i = 0, l = allMarkers.length; i < l; i++) {
            var m = allMarkers[i];
            m.visible = !!window.tuning.visible;

            if (m.userData._needsOrient && m.position.lengthSq() > 1e-6) {
                orientRingsToSurface(m);
                m.userData._needsOrient = false;
            }

            var blob = m.userData._blob;
            if (blob) {
                var u = blob.material.uniforms;
                u.time.value = time;

                // Re-evaluate per-marker derived values from current tuning
                var data = m.userData;
                var mNorm = Math.max(0, Math.min(1, (data.magnitude - 4.5) / 4.5));
                var radius = lerp(window.tuning.radiusMin, window.tuning.radiusMax, mNorm);
                blob.scale.set(radius, radius, radius);
                u.deformAmp.value = lerp(window.tuning.deformAmpMin, window.tuning.deformAmpMax, mNorm);
                u.pulseHz.value   = lerp(window.tuning.pulseHzMin, window.tuning.pulseHzMax, mNorm);
                var c = colorForDepth(data.depth);
                u.color.value.set(c.r, c.g, c.b);
            }

            var rings = m.userData._rings || [];
            if (rings.length) {
                var data2 = m.userData;
                var mNorm2 = Math.max(0, Math.min(1, (data2.magnitude - 4.5) / 4.5));
                var dNorm2 = Math.max(0, Math.min(1, data2.depth / window.tuning.depthNormKm));
                var blobR  = lerp(window.tuning.radiusMin, window.tuning.radiusMax, mNorm2);
                var maxR   = lerp(window.tuning.maxReachMin, window.tuning.maxReachMax, dNorm2) * blobR;
                var c2 = colorForDepth(data2.depth);
                for (var k = 0; k < rings.length; k++) {
                    var ring = rings[k];
                    var ru = ring.material.uniforms;
                    ru.time.value             = time;
                    ru.cycleSec.value         = window.tuning.cycleSec;
                    ru.alphaExp.value         = window.tuning.alphaExp;
                    ru.thicknessFrac.value    = window.tuning.thicknessFrac;
                    ru.thicknessFalloff.value = window.tuning.thicknessFalloff;
                    ru.color.value.set(c2.r, c2.g, c2.b);
                    // phaseOffset = per-ring stagger + per-marker random desync
                    ru.phaseOffset.value = (data2._ringPhaseSeed || 0) + (window.tuning.cycleSec * k) / rings.length;
                    ring.scale.set(maxR, maxR, maxR);
                }
            }
        }
    }

    if (window.tuning && window.tuning.onRingCountChange) {
        window.tuning.onRingCountChange(function () {
            for (var i = 0; i < allMarkers.length; i++) {
                buildRingsForMarker(allMarkers[i]);
                orientRingsToSurface(allMarkers[i]);
            }
        });
    }

    window.Markers = {
        colorForDepth: colorForDepth,
        hexToRgb: hexToRgb,
        blobVert: blobVert,
        blobFrag: blobFrag,
        createBlobMarker: createBlobMarker,
        buildRingsForMarker: buildRingsForMarker,
        updateMarkerUniforms: updateMarkerUniforms,
        allMarkers: allMarkers
    };

})();
