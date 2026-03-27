// Ported from refs/three/examples/webgl_geometry_extrude_shapes.html
// Original: MIT license, three.js contributors
// Modifications: removed TrackballControls (auto-rotation), adapted for GTK canvas

import * as THREE from 'three';

export function start(canvas: HTMLCanvasElement) {
    const renderer = new THREE.WebGLRenderer({ canvas: canvas as any, antialias: true });
    renderer.setSize(canvas.width, canvas.height);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);

    const camera = new THREE.PerspectiveCamera(45, canvas.width / canvas.height, 1, 1000);
    camera.position.set(0, 0, 500);

    scene.add(new THREE.AmbientLight(0x666666));

    const light = new THREE.PointLight(0xffffff, 3, 0, 0);
    light.position.copy(camera.position);
    scene.add(light);

    // Mesh 1: Triangle cross-section extruded along a closed CatmullRom spline
    const closedSpline = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-60, -100, 60),
        new THREE.Vector3(-60, 20, 60),
        new THREE.Vector3(-60, 120, 60),
        new THREE.Vector3(60, 20, -60),
        new THREE.Vector3(60, -100, -60),
    ]);
    closedSpline.curveType = 'catmullrom';
    closedSpline.closed = true;

    const pts1: THREE.Vector2[] = [];
    const count = 3;
    for (let i = 0; i < count; i++) {
        const l = 20;
        const a = (2 * i / count) * Math.PI;
        pts1.push(new THREE.Vector2(Math.cos(a) * l, Math.sin(a) * l));
    }

    const shape1 = new THREE.Shape(pts1);
    const geometry1 = new THREE.ExtrudeGeometry(shape1, {
        steps: 100,
        bevelEnabled: false,
        extrudePath: closedSpline,
    });

    const material1 = new THREE.MeshLambertMaterial({ color: 0xb00000, wireframe: false });
    const mesh1 = new THREE.Mesh(geometry1, material1);
    scene.add(mesh1);

    // Mesh 2: Star cross-section extruded along a random CatmullRom spline
    const randomPoints: THREE.Vector3[] = [];
    for (let i = 0; i < 10; i++) {
        randomPoints.push(new THREE.Vector3(
            (i - 4.5) * 50,
            THREE.MathUtils.randFloat(-50, 50),
            THREE.MathUtils.randFloat(-50, 50),
        ));
    }
    const randomSpline = new THREE.CatmullRomCurve3(randomPoints);

    const pts2: THREE.Vector2[] = [];
    const numPts = 5;
    for (let i = 0; i < numPts * 2; i++) {
        const l = i % 2 === 1 ? 10 : 20;
        const a = (i / numPts) * Math.PI;
        pts2.push(new THREE.Vector2(Math.cos(a) * l, Math.sin(a) * l));
    }

    const shape2 = new THREE.Shape(pts2);
    const geometry2 = new THREE.ExtrudeGeometry(shape2, {
        steps: 200,
        bevelEnabled: false,
        extrudePath: randomSpline,
    });

    const material2 = new THREE.MeshLambertMaterial({ color: 0xff8000, wireframe: false });
    const mesh2 = new THREE.Mesh(geometry2, material2);
    scene.add(mesh2);

    // Mesh 3: Star cross-section with bevel extrude (multi-material)
    const geometry3 = new THREE.ExtrudeGeometry(shape2, {
        depth: 20,
        steps: 1,
        bevelEnabled: true,
        bevelThickness: 2,
        bevelSize: 4,
        bevelSegments: 1,
    });

    const mesh3 = new THREE.Mesh(geometry3, [material1, material2]);
    mesh3.position.set(50, 100, 50);
    scene.add(mesh3);

    // Auto-rotation replaces TrackballControls
    renderer.setAnimationLoop(() => {
        scene.rotation.y += 0.005;
        renderer.render(scene, camera);
    });
}
