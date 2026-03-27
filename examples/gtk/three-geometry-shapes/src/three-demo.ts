// Ported from refs/three/examples/webgl_geometry_shapes.html
// Original: MIT license, three.js contributors
// Modifications: removed Stats/pointer events (auto-rotation), adapted for GTK canvas

import * as THREE from 'three';

export function start(canvas: HTMLCanvasElement) {
    const renderer = new THREE.WebGLRenderer({ canvas: canvas as any, antialias: true });
    renderer.setSize(canvas.width, canvas.height);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);

    const camera = new THREE.PerspectiveCamera(50, canvas.width / canvas.height, 1, 1000);
    camera.position.set(0, 150, 500);
    scene.add(camera);

    const light = new THREE.PointLight(0xffffff, 2.5, 0, 0);
    camera.add(light);

    const group = new THREE.Group();
    group.position.y = 50;
    scene.add(group);

    // Load texture with repeat wrapping
    const loader = new THREE.TextureLoader();
    const texture = loader.load('./uv_grid_opengl.jpg');
    // colorSpace conversion skipped: requires canvas 2D context (not available in GTK)
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(0.008, 0.008);

    function addShape(
        shape: THREE.Shape,
        extrudeSettings: THREE.ExtrudeGeometryOptions,
        color: number,
        x: number, y: number, z: number,
        rx: number, ry: number, rz: number,
        s: number,
    ) {
        // Flat shape with texture
        let geometry: THREE.BufferGeometry = new THREE.ShapeGeometry(shape);
        let mesh = new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({ side: THREE.DoubleSide, map: texture }));
        mesh.position.set(x, y, z - 175);
        mesh.rotation.set(rx, ry, rz);
        mesh.scale.set(s, s, s);
        group.add(mesh);

        // Flat shape (colored)
        geometry = new THREE.ShapeGeometry(shape);
        mesh = new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({ color, side: THREE.DoubleSide }));
        mesh.position.set(x, y, z - 125);
        mesh.rotation.set(rx, ry, rz);
        mesh.scale.set(s, s, s);
        group.add(mesh);

        // Extruded shape
        geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        mesh = new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({ color }));
        mesh.position.set(x, y, z - 75);
        mesh.rotation.set(rx, ry, rz);
        mesh.scale.set(s, s, s);
        group.add(mesh);

        addLineShape(shape, color, x, y, z, rx, ry, rz, s);
    }

    function addLineShape(
        shape: THREE.Shape | THREE.Path,
        color: number,
        x: number, y: number, z: number,
        rx: number, ry: number, rz: number,
        s: number,
    ) {
        // Lines
        (shape as THREE.Shape).autoClose = true;

        const points = shape.getPoints();
        const spacedPoints = shape.getSpacedPoints(50);

        const geometryPoints = new THREE.BufferGeometry().setFromPoints(points);
        const geometrySpacedPoints = new THREE.BufferGeometry().setFromPoints(spacedPoints);

        // Solid line
        let line: THREE.Line = new THREE.Line(geometryPoints, new THREE.LineBasicMaterial({ color }));
        line.position.set(x, y, z - 25);
        line.rotation.set(rx, ry, rz);
        line.scale.set(s, s, s);
        group.add(line);

        // Line from equidistance sampled points
        line = new THREE.Line(geometrySpacedPoints, new THREE.LineBasicMaterial({ color }));
        line.position.set(x, y, z + 25);
        line.rotation.set(rx, ry, rz);
        line.scale.set(s, s, s);
        group.add(line);

        // Vertices from real points
        let particles: THREE.Points = new THREE.Points(geometryPoints, new THREE.PointsMaterial({ color, size: 4 }));
        particles.position.set(x, y, z + 75);
        particles.rotation.set(rx, ry, rz);
        particles.scale.set(s, s, s);
        group.add(particles);

        // Equidistance sampled points
        particles = new THREE.Points(geometrySpacedPoints, new THREE.PointsMaterial({ color, size: 4 }));
        particles.position.set(x, y, z + 125);
        particles.rotation.set(rx, ry, rz);
        particles.scale.set(s, s, s);
        group.add(particles);
    }

    // --- Shape definitions ---

    // California
    const californiaPts: THREE.Vector2[] = [];
    californiaPts.push(new THREE.Vector2(610, 320));
    californiaPts.push(new THREE.Vector2(450, 300));
    californiaPts.push(new THREE.Vector2(392, 392));
    californiaPts.push(new THREE.Vector2(266, 438));
    californiaPts.push(new THREE.Vector2(190, 570));
    californiaPts.push(new THREE.Vector2(190, 600));
    californiaPts.push(new THREE.Vector2(160, 620));
    californiaPts.push(new THREE.Vector2(160, 650));
    californiaPts.push(new THREE.Vector2(180, 640));
    californiaPts.push(new THREE.Vector2(165, 680));
    californiaPts.push(new THREE.Vector2(150, 670));
    californiaPts.push(new THREE.Vector2(90, 737));
    californiaPts.push(new THREE.Vector2(80, 795));
    californiaPts.push(new THREE.Vector2(50, 835));
    californiaPts.push(new THREE.Vector2(64, 870));
    californiaPts.push(new THREE.Vector2(60, 945));
    californiaPts.push(new THREE.Vector2(300, 945));
    californiaPts.push(new THREE.Vector2(300, 743));
    californiaPts.push(new THREE.Vector2(600, 473));
    californiaPts.push(new THREE.Vector2(626, 425));
    californiaPts.push(new THREE.Vector2(600, 370));
    californiaPts.push(new THREE.Vector2(610, 320));
    for (let i = 0; i < californiaPts.length; i++) californiaPts[i].multiplyScalar(0.25);
    const californiaShape = new THREE.Shape(californiaPts);

    // Triangle
    const triangleShape = new THREE.Shape()
        .moveTo(80, 20)
        .lineTo(40, 80)
        .lineTo(120, 80)
        .lineTo(80, 20);

    // Heart
    const hx = 0, hy = 0;
    const heartShape = new THREE.Shape()
        .moveTo(hx + 25, hy + 25)
        .bezierCurveTo(hx + 25, hy + 25, hx + 20, hy, hx, hy)
        .bezierCurveTo(hx - 30, hy, hx - 30, hy + 35, hx - 30, hy + 35)
        .bezierCurveTo(hx - 30, hy + 55, hx - 10, hy + 77, hx + 25, hy + 95)
        .bezierCurveTo(hx + 60, hy + 77, hx + 80, hy + 55, hx + 80, hy + 35)
        .bezierCurveTo(hx + 80, hy + 35, hx + 80, hy, hx + 50, hy)
        .bezierCurveTo(hx + 35, hy, hx + 25, hy + 25, hx + 25, hy + 25);

    // Square
    const sqLength = 80;
    const squareShape = new THREE.Shape()
        .moveTo(0, 0)
        .lineTo(0, sqLength)
        .lineTo(sqLength, sqLength)
        .lineTo(sqLength, 0)
        .lineTo(0, 0);

    // Rounded rectangle
    const roundedRectShape = new THREE.Shape();
    (function roundedRect(ctx: THREE.Shape, x: number, y: number, width: number, height: number, radius: number) {
        ctx.moveTo(x, y + radius);
        ctx.lineTo(x, y + height - radius);
        ctx.quadraticCurveTo(x, y + height, x + radius, y + height);
        ctx.lineTo(x + width - radius, y + height);
        ctx.quadraticCurveTo(x + width, y + height, x + width, y + height - radius);
        ctx.lineTo(x + width, y + radius);
        ctx.quadraticCurveTo(x + width, y, x + width - radius, y);
        ctx.lineTo(x + radius, y);
        ctx.quadraticCurveTo(x, y, x, y + radius);
    })(roundedRectShape, 0, 0, 50, 50, 20);

    // Track
    const trackShape = new THREE.Shape()
        .moveTo(40, 40)
        .lineTo(40, 160)
        .absarc(60, 160, 20, Math.PI, 0, true)
        .lineTo(80, 40)
        .absarc(60, 40, 20, 2 * Math.PI, Math.PI, true);

    // Circle
    const circleRadius = 40;
    const circleShape = new THREE.Shape()
        .moveTo(0, circleRadius)
        .quadraticCurveTo(circleRadius, circleRadius, circleRadius, 0)
        .quadraticCurveTo(circleRadius, -circleRadius, 0, -circleRadius)
        .quadraticCurveTo(-circleRadius, -circleRadius, -circleRadius, 0)
        .quadraticCurveTo(-circleRadius, circleRadius, 0, circleRadius);

    // Fish
    const fishShape = new THREE.Shape()
        .moveTo(hx, hy)
        .quadraticCurveTo(hx + 50, hy - 80, hx + 90, hy - 10)
        .quadraticCurveTo(hx + 100, hy - 10, hx + 115, hy - 40)
        .quadraticCurveTo(hx + 115, hy, hx + 115, hy + 40)
        .quadraticCurveTo(hx + 100, hy + 10, hx + 90, hy + 10)
        .quadraticCurveTo(hx + 50, hy + 80, hx, hy);

    // Arc circle with hole
    const arcShape = new THREE.Shape()
        .moveTo(50, 10)
        .absarc(10, 10, 40, 0, Math.PI * 2, false);
    const holePath = new THREE.Path()
        .moveTo(20, 10)
        .absarc(10, 10, 10, 0, Math.PI * 2, true);
    arcShape.holes.push(holePath);

    // Smiley with holes
    const smileyShape = new THREE.Shape()
        .moveTo(80, 40)
        .absarc(40, 40, 40, 0, Math.PI * 2, false);
    const smileyEye1Path = new THREE.Path()
        .moveTo(35, 20)
        .absellipse(25, 20, 10, 10, 0, Math.PI * 2, true);
    const smileyEye2Path = new THREE.Path()
        .moveTo(65, 20)
        .absarc(55, 20, 10, 0, Math.PI * 2, true);
    const smileyMouthPath = new THREE.Path()
        .moveTo(20, 40)
        .quadraticCurveTo(40, 60, 60, 40)
        .bezierCurveTo(70, 45, 70, 50, 60, 60)
        .quadraticCurveTo(40, 80, 20, 60)
        .quadraticCurveTo(5, 50, 20, 40);
    smileyShape.holes.push(smileyEye1Path);
    smileyShape.holes.push(smileyEye2Path);
    smileyShape.holes.push(smileyMouthPath);

    // Spline shape
    const splinepts: THREE.Vector2[] = [];
    splinepts.push(new THREE.Vector2(70, 20));
    splinepts.push(new THREE.Vector2(80, 90));
    splinepts.push(new THREE.Vector2(-30, 70));
    splinepts.push(new THREE.Vector2(0, 0));
    const splineShape = new THREE.Shape()
        .moveTo(0, 0)
        .splineThru(splinepts);

    // --- Add all shapes ---

    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
        depth: 8,
        bevelEnabled: true,
        bevelSegments: 2,
        steps: 2,
        bevelSize: 1,
        bevelThickness: 1,
    };

    addShape(californiaShape, extrudeSettings, 0xf08000, -300, -100, 0, 0, 0, 0, 1);
    addShape(triangleShape, extrudeSettings, 0x8080f0, -180, 0, 0, 0, 0, 0, 1);
    addShape(roundedRectShape, extrudeSettings, 0x008000, -150, 150, 0, 0, 0, 0, 1);
    addShape(trackShape, extrudeSettings, 0x008080, 200, -100, 0, 0, 0, 0, 1);
    addShape(squareShape, extrudeSettings, 0x0040f0, 150, 100, 0, 0, 0, 0, 1);
    addShape(heartShape, extrudeSettings, 0xf00000, 60, 100, 0, 0, 0, Math.PI, 1);
    addShape(circleShape, extrudeSettings, 0x00f000, 120, 250, 0, 0, 0, 0, 1);
    addShape(fishShape, extrudeSettings, 0x404040, -60, 200, 0, 0, 0, 0, 1);
    addShape(smileyShape, extrudeSettings, 0xf000f0, -200, 250, 0, 0, 0, Math.PI, 1);
    addShape(arcShape, extrudeSettings, 0x804000, 150, 0, 0, 0, 0, 0, 1);
    addShape(splineShape, extrudeSettings, 0x808080, -50, -100, 0, 0, 0, 0, 1);

    addLineShape(arcShape.holes[0], 0x804000, 150, 0, 0, 0, 0, 0, 1);

    for (let i = 0; i < smileyShape.holes.length; i += 1) {
        addLineShape(smileyShape.holes[i], 0xf000f0, -200, 250, 0, 0, 0, Math.PI, 1);
    }

    // Auto-rotation replaces pointer-drag rotation
    renderer.setAnimationLoop(() => {
        group.rotation.y += 0.003;
        renderer.render(scene, camera);
    });
}
