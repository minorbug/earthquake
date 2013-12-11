(function(){
    var sceneElement = document.getElementById('eqScene');

    if (!Detector.webgl) {
        Detector.addGetWebGLMessage(webglEl);
        return;
    }

    var clock = new THREE.Clock();

    var width  = window.innerWidth,
        height = window.innerHeight,
        windowHalfX = width / 2,
        windowHalfY = height / 2;

    // Earth Model
    var CRUST_RADIUS = 6367,
        OUTER_CORE_RADIUS = 3600,
        MARKER_SEGMENTS = 16,
        SEGMENTS = 32;


    // core material
    var noiseTexture = new THREE.ImageUtils.loadTexture( 'img/cloud.png' );
    noiseTexture.wrapS = noiseTexture.wrapT = THREE.RepeatWrapping;

    var lavaTexture = new THREE.ImageUtils.loadTexture( 'img/core.jpg' );
    lavaTexture.wrapS = lavaTexture.wrapT = THREE.RepeatWrapping;

    var customUniforms = {
        baseTexture: 	{ type: "t", value: lavaTexture },
        baseSpeed: 		{ type: "f", value: 0.005 },
        noiseTexture: 	{ type: "t", value: noiseTexture },
        noiseScale:		{ type: "f", value: 0.1337 },
        alpha: 			{ type: "f", value: 1.0 },
        time: 			{ type: "f", value: 1.0 }
    };
    console.log(customUniforms);

    // MagnitudeLUT (will round to nearest integer);
    var magnitudeRadii = [10, 12.5, 20, 37.5, 50, 72.5, 100, 132.5, 170, 212.5, 260];


    // Touch and click rotation tracking
    var targetRotationX = 0,
        targetRotationY = 0,
        targetCameraRotationY = 0,
        targetRotationOnMouseDownX = 0,
        targetRotationOnMouseDownY = 0,
        mouseX = 0,
        mouseY = 0,
        mouseXOnMouseDown = 0,
        mouseYOnMouseDown = 0;

    $(document).on('getEarthquakeData_success', function(event,data){


         for (var i=0, l=data.earthquakes.length; i<l;i++){
            var eq = data.earthquakes[i];
            addMarkerToCrust(crust,eq.lat,eq.lng,eq.depth,eq.magnitude);
        }
    });

    document.addEventListener( 'mousedown', onDocumentMouseDown, false );
    document.addEventListener( 'touchstart', onDocumentTouchStart, false );
    document.addEventListener( 'touchmove', onDocumentTouchMove, false );

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(60, width / height, 1, 15000);
    camera.position.y = 3900;
    camera.position.x = -3900;
    camera.lookAt(new THREE.Vector3(CRUST_RADIUS,CRUST_RADIUS+1200,0));

    // Camera grouped into empty object with center at 0,0,0 (for easier rotating)
    var camGroup = new THREE.Object3D();
    camGroup.add(camera);
    scene.add(camGroup);

    var renderer = new THREE.WebGLRenderer( {antialiasing: true });
    renderer.setSize(width, height);

    // Lights
    scene.add(new THREE.AmbientLight(0xCC3333));

    var crust = createCrust(CRUST_RADIUS, SEGMENTS),
        outerCore = createOuterCore(OUTER_CORE_RADIUS, SEGMENTS);



    crust.setTexturesEdgeLongitude(-180.806168);
    outerCore.rotation.x = 90;


    scene.add(crust);
    //scene.add(outerCore);


    sceneElement.appendChild(renderer.domElement);
    animate();

    GeoJSON.loadEarthquakeData('all','week');

    function render(){
        camGroup.rotation.x += ( -targetRotationX - camGroup.rotation.x ) * 0.05;
        camGroup.rotation.z += ( targetRotationY - camGroup.rotation.z ) * 0.05;
        camGroup.rotation.y += ( targetCameraRotationY - camGroup.rotation.y ) * 0.15;
        renderer.render(scene, camera);
    }

    function animate() {
        requestAnimationFrame(animate);
        render();
        var delta = clock.getDelta();
        customUniforms.time.value += delta;
    }

    function addMarkerToCrust(crustModel,lat,lng,depth, magnitude){
        crustModel.addGeoSymbol(
            new THREE.GeoSpatialMap.GeoSymbol(createMarker(magnitude), {
                phi: lat,
                lambda: lng,
                depth: depth
            })
        );
    }

    function createMarker(magnitude){
        var marker = new THREE.Object3D(),
            spriteSize = 10*magnitudeRadii[Math.round(magnitude)],
            markerOpacity = (magnitude/10);
        var spriteMaterial = new THREE.SpriteMaterial(
            {
                map: new THREE.ImageUtils.loadTexture( 'img/spark.png' ),
                useScreenCoordinates: false, alignment: new THREE.Vector2( 0, 0 ),
                color: 0xff0000, transparent: true, opacity:markerOpacity, blending: THREE.NormalBlending
            });
        var sprite = new THREE.Sprite( spriteMaterial );
        sprite.scale.set(spriteSize, spriteSize,spriteSize);
        marker.add(sprite); // this centers the glow at the mesh

        marker.add(new THREE.Mesh(
            new THREE.SphereGeometry(magnitudeRadii[Math.round(magnitude)], 4, 4),
            new THREE.MeshLambertMaterial( { visible:false } )
        ));

        return marker;

    }

    function createCrust(radius, segments) {
        return new THREE.GeoSpatialMap(
            new THREE.SphereGeometry(radius, segments, segments),
            new THREE.MeshBasicMaterial({
                map:  THREE.ImageUtils.loadTexture('img/world.jpg'),
                side: THREE.BackSide,
                specular:    new THREE.Color('grey')
            })
        );
    }

    function createOuterCore(radius, segments) {
        console.log(customUniforms);
        return new THREE.Mesh(
            new THREE.SphereGeometry(radius, segments, segments),
            new THREE.ShaderMaterial(
                {
                    uniforms: customUniforms,
                    vertexShader:   document.getElementById( 'vertexShader'   ).textContent,
                    fragmentShader: document.getElementById( 'fragmentShader' ).textContent
                }
            )
        );
    }

    function onDocumentMouseDown( event ) {

        event.preventDefault();

        document.addEventListener( 'mousemove', onDocumentMouseMove, false );
        document.addEventListener( 'mouseup', onDocumentMouseUp, false );
        document.addEventListener( 'mouseout', onDocumentMouseOut, false );

        // rotate camera controls (for PCs only. TODO: Add two-finger rotate for touch)
        document.addEventListener("keydown", onDocumentKeyDown, false);

        mouseXOnMouseDown = event.clientX - windowHalfX;
        mouseYOnMouseDown = event.clientY - windowHalfY;
        targetRotationOnMouseDownX = targetRotationX;
        targetRotationOnMouseDownY = targetRotationY;
    }

    function onDocumentKeyDown(e){
        var key = e.keyCode;
        if (key === 65 || key === 37){  // "W" or left arrow
            targetCameraRotationY += 0.5;
        }
        else if (key == 68 || key === 39){ // "D" or right arrow
            targetCameraRotationY  -=  0.5;
        }
        console.log(targetCameraRotationY);
    }

    function onDocumentMouseMove( event ) {

        mouseX = event.clientX - windowHalfX;
        mouseY = event.clientY - windowHalfY;

        targetRotationX = targetRotationOnMouseDownX + ( mouseX - mouseXOnMouseDown ) * 0.02;
        targetRotationY = targetRotationOnMouseDownY + ( mouseY - mouseYOnMouseDown ) * 0.02;
    }

    function onDocumentMouseUp( event ) {

        document.removeEventListener( 'mousemove', onDocumentMouseMove, false );
        document.removeEventListener( 'mouseup', onDocumentMouseUp, false );
        document.removeEventListener( 'mouseout', onDocumentMouseOut, false );
    }

    function onDocumentMouseOut( event ) {

        document.removeEventListener( 'mousemove', onDocumentMouseMove, false );
        document.removeEventListener( 'mouseup', onDocumentMouseUp, false );
        document.removeEventListener( 'mouseout', onDocumentMouseOut, false );
    }

    function onDocumentTouchStart( event ) {

        if ( event.touches.length == 1 ) {

            event.preventDefault();

            mouseXOnMouseDown = event.touches[ 0 ].pageX - windowHalfX;
            mouseYOnMouseDown = event.touches[ 0 ].pageY - windowHalfY;
            targetRotationOnMouseDownX = targetRotationX;
            targetRotationOnMouseDownY = targetRotationY;

        }
    }

    function onDocumentTouchMove( event ) {

        if ( event.touches.length == 1 ) {

            event.preventDefault();

            mouseX = event.touches[ 0 ].pageX - windowHalfX;
            mouseY = event.touches[ 0 ].pageY - windowHalfY;
            targetRotationX = targetRotationOnMouseDownX + ( mouseX - mouseXOnMouseDown ) * 0.05;
            targetRotationY = targetRotationOnMouseDownY + ( mouseY - mouseYOnMouseDown ) * 0.05;

        }
    }

})();