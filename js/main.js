
    var sceneElement = document.getElementById('eqScene');

    if (!Detector.webgl) {
        Detector.addGetWebGLMessage(webglEl);
        return;
    }

    var clock = new THREE.Clock();
    var debugEl = document.getElementById("debug");


    var selectInfo = {
        x: 0,
        y: 0,
        userHasSelected: false
    };

    // Screen size
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

    var lavaShader = new THREE.ShaderMaterial(
        {
            uniforms: customUniforms,
            vertexShader:   document.getElementById( 'vertexShader'   ).textContent,
            fragmentShader: document.getElementById( 'fragmentShader' ).textContent
        }
    );

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
            addMarkerToCrust(crust,eq);
        }
    });

    document.addEventListener( 'mousedown', onDocumentMouseDown, false );
    document.addEventListener( 'touchstart', onDocumentTouchStart, false );
    document.addEventListener( 'touchmove', onDocumentTouchMove, false );
    window.addEventListener( 'resize', onWindowResize, false );

    var scene = new THREE.Scene(),
        camera = new THREE.PerspectiveCamera(40, width / height, 1, 20000),
        cameraWorldPosition = new THREE.Vector3();

    camera.position.y = -4100;
    camera.position.x = 4100;
    camera.lookAt(new THREE.Vector3(CRUST_RADIUS,CRUST_RADIUS+200,0));

    // Camera grouped into empty object with center at 0,0,0 (for easier rotating)
    var camGroup = new THREE.Object3D();
    camGroup.add(camera);
    scene.add(camGroup);

    var projector = new THREE.Projector(),
        renderer  = new THREE.WebGLRenderer( {antialiasing: true });

    renderer.setSize(width, height);

    // Lights
    scene.add(new THREE.AmbientLight(0x660000));

    var light = new THREE.PointLight( 0xffffff, 3, 10000 );
    light.position.set( 0, 0, 0 );


    scene.add( light );

    var crust = createCrust(CRUST_RADIUS, SEGMENTS),
        outerCore = createOuterCore(OUTER_CORE_RADIUS, SEGMENTS),
        markers = [];



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

        scene.updateMatrixWorld();

        cameraWorldPosition.setFromMatrixPosition( camera.matrixWorld );

        if (selectInfo.userHasSelected){
            selectInfo.userHasSelected = false;
            checkSelectInfo();
        }

        renderer.render(scene, camera);
    }

    function animate() {
        requestAnimationFrame(animate);
        render();
        var delta = clock.getDelta();
        customUniforms.time.value += delta;
    }

    function addMarkerToCrust(crustModel,data){

        var marker = createMarker(data);
        markers.push(marker);

        crustModel.addGeoSymbol(
            new THREE.GeoSpatialMap.GeoSymbol(marker, {
                phi: data.lat,
                lambda: data.lng,
                depth: data.depth
            })
        );
    }

    function createMarker(data){

        var marker = new THREE.Object3D(),
            magnitude = data.magnitude,
            spriteSize = 10*magnitudeRadii[Math.round(magnitude)],
            markerOpacity = (magnitude/10);
        var spriteMaterial = new THREE.SpriteMaterial(
            {
                map: new THREE.ImageUtils.loadTexture( 'img/spark.png' ),
                useScreenCoordinates: false, alignment: new THREE.Vector2( 0, 0 ),
                color: 0xffffff, transparent: true, opacity:markerOpacity, blending: THREE.NormalBlending
            });
        var sprite = new THREE.Sprite( spriteMaterial );
        sprite.scale.set(spriteSize, spriteSize,spriteSize);
        marker.add(sprite); // this centers the glow at the mesh

        marker.add(new THREE.Mesh(
            new THREE.SphereGeometry(magnitudeRadii[Math.round(magnitude)], 4, 4),
            new THREE.MeshLambertMaterial( { visible:true, color: 0xffa500 } )
        ));

        // Add earthquake data to marker
        marker.userData = data;

        return marker;

    }

    function createCrust(radius, segments) {
        return new THREE.GeoSpatialMap(
            new THREE.SphereGeometry(radius, segments, segments),
            new THREE.MeshPhongMaterial({
                map:  THREE.ImageUtils.loadTexture('img/world.jpg'),
                side: THREE.DoubleSide,
                shading: THREE.SmoothShading,
                shininess: 100,
                ambient: 0x000000,
                specular:    new THREE.Color('black')
            })
        );
    }

    function createOuterCore(radius, segments) {
        console.log(customUniforms);
        return new THREE.Mesh(
            new THREE.SphereGeometry(radius, segments, segments),
            lavaShader
        );
    }

    function checkSelectInfo(){

        console.log("checkSelectInfo");
        console.log(selectInfo);
        var vector = new THREE.Vector3((selectInfo.x / window.innerWidth) * 2 - 1, -(selectInfo.y / window.innerHeight) * 2 + 1, 0.5);
        projector.unprojectVector( vector, camera );

        var raycaster = new THREE.Raycaster( cameraWorldPosition, vector.sub( cameraWorldPosition ).normalize()),
            intersects,
            intersectFound = false;

        intersects = raycaster.intersectObjects( markers,true );
        console.log (intersects);
        for(var i= 0, l=intersects.length;i<l;i++){
            if (intersects[i].object instanceof THREE.Sprite){
                intersectFound = true;
                $("#detail").fadeOut(500, function(){
                    onMarkerSelect(intersects[ i ].object.parent);
                });
                break;
            }
        }
        if (!intersectFound) $("#detail").fadeOut(1000);

    }

    function onMarkerSelect(intersect){

        var mapImageUrl = "http://maps.googleapis.com/maps/api/staticmap?center=###&zoom=2&format=png&sensor=false&size=400x100&maptype=roadmap&visual_refresh=true&style=feature:water|element:geometry.fill|color:0x000000|visibility:on&style=element:labels.text|visibility:off&style=feature:administrative|visibility:off&style=feature:landscape|visibility:on|color:0x1b264c&style=feature:transit|visibility:off&style=feature:poi|visibility:off";

        crust.traverse(function(o){
            var mesh = o.children[1];       //    Should be the Mesh
            if (o.id === intersect.id){
                console.log(mesh);

                $("#detail-location").html(o.userData.title);
                $("#detail-magnitude").html("<h1>Magnitude</h1>"+o.userData.magnitude);
                $("#detail-depth").html("<h1>Depth</h1>"+Math.round(o.userData.depth*0.621371)+" miles");
                $("#detail").css(
                    'background-image', 'url('+mapImageUrl.replace("###", o.userData.lat+","+ o.userData.lng)+')'
                ).fadeIn();

                mesh.material.color.setHex(0xffffff);
            } else {
               if (mesh && mesh instanceof THREE.Mesh) mesh.material.color.setHex(0xffa500);
            }
        });

    }

    function onDocumentMouseDown( event ) {

        event.preventDefault();


        // Handle the detecting in the render loop, not here. Just record what happened for now.
        selectInfo.userHasSelected = true;
        selectInfo.x = event.clientX;
        selectInfo.y = event.clientY;


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

            selectInfo.userHasSelected = true;
            selectInfo.x = event.clientX;
            selectInfo.y = event.clientY;

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

    function onWindowResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize( window.innerWidth, window.innerHeight );
    }

