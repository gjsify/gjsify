// Ported from refs/three/examples/webgl_postprocessing_pixel.html
// Original: MIT license, three.js authors (https://threejs.org)
// Pixelation pass with optional single pixel outlines by Kody King.
// Reimplemented for GJS and browser targets using @gjsify packages.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export interface PixelEffectController {
    pixelSize: number;
    normalEdgeStrength: number;
    depthEdgeStrength: number;
    pixelAlignedPanning: boolean;
}

export interface PixelDemo {
    readonly effectController: PixelEffectController;
    render(): void;
}

export interface StartOptions {
    assetBase?: string;
}

export function start(canvas: HTMLCanvasElement, options?: StartOptions): PixelDemo {
    const assetBase = options?.assetBase ?? './';

    // Renderer
    const renderer = new THREE.WebGLRenderer({ canvas: canvas as any, antialias: false });
    renderer.shadowMap.enabled = true;
    renderer.setSize(canvas.width, canvas.height);
    renderer.debug.checkShaderErrors = true;

    // Camera (orthographic)
    const aspectRatio = canvas.width / canvas.height;
    const camera = new THREE.OrthographicCamera(-aspectRatio, aspectRatio, 1, -1, 0.1, 10);
    camera.position.y = 2 * Math.tan(Math.PI / 6);
    camera.position.z = 2;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x151729);

    // Post-processing
    const composer = new EffectComposer(renderer);
    const renderPixelatedPass = new RenderPixelatedPass(6, scene, camera);
    composer.addPass(renderPixelatedPass);
    composer.addPass(new OutputPass());

    // OrbitControls
    const controls = new OrbitControls(camera, canvas as any);
    (controls as any).maxZoom = 2;

    // Timer for animation
    const timer = new THREE.Timer();

    // Textures
    const loader = new THREE.TextureLoader();
    const texChecker = pixelTexture(loader.load(`${assetBase}assets/checker.png`));
    const texChecker2 = pixelTexture(loader.load(`${assetBase}assets/checker.png`));
    texChecker.repeat.set(3, 3);
    texChecker2.repeat.set(1.5, 1.5);

    // Meshes
    const boxMaterial = new THREE.MeshPhongMaterial({ map: texChecker2 });

    function addBox(boxSideLength: number, x: number, z: number, rotation: number) {
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(boxSideLength, boxSideLength, boxSideLength),
            boxMaterial,
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.rotation.y = rotation;
        mesh.position.set(x, boxSideLength / 2 + 0.0001, z);
        scene.add(mesh);
        return mesh;
    }

    addBox(0.4, 0, 0, Math.PI / 4);
    addBox(0.5, -0.5, -0.5, Math.PI / 4);

    const planeSideLength = 2;
    const planeMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(planeSideLength, planeSideLength),
        new THREE.MeshPhongMaterial({ map: texChecker }),
    );
    planeMesh.receiveShadow = true;
    planeMesh.rotation.x = -Math.PI / 2;
    scene.add(planeMesh);

    const crystalMesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.2),
        new THREE.MeshPhongMaterial({
            color: 0x68b7e9,
            emissive: 0x4f7e8b,
            shininess: 10,
            specular: 0xffffff,
        }),
    );
    crystalMesh.receiveShadow = true;
    crystalMesh.castShadow = true;
    scene.add(crystalMesh);

    // Lights
    scene.add(new THREE.AmbientLight(0x757f8e, 3));

    const directionalLight = new THREE.DirectionalLight(0xfffecd, 1.5);
    directionalLight.position.set(100, 100, 100);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.set(2048, 2048);
    scene.add(directionalLight);

    const spotLight = new THREE.SpotLight(0xffc100, 10, 10, Math.PI / 16, 0.02, 2);
    spotLight.position.set(2, 2, 0);
    spotLight.target.position.set(0, 0, 0);
    scene.add(spotLight.target);
    spotLight.castShadow = true;
    scene.add(spotLight);

    // Effect controller
    const effectController: PixelEffectController = {
        pixelSize: 6,
        normalEdgeStrength: 0.3,
        depthEdgeStrength: 0.4,
        pixelAlignedPanning: true,
    };

    // Helper functions
    function pixelTexture(texture: THREE.Texture) {
        texture.minFilter = THREE.NearestFilter;
        texture.magFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    function easeInOutCubic(x: number) {
        return x ** 2 * 3 - x ** 3 * 2;
    }

    function linearStep(x: number, edge0: number, edge1: number) {
        const w = edge1 - edge0;
        const m = 1 / w;
        const y0 = -m * edge0;
        return THREE.MathUtils.clamp(y0 + m * x, 0, 1);
    }

    function stopGoEased(x: number, downtime: number, period: number) {
        const cycle = (x / period) | 0;
        const tween = x - cycle * period;
        const linStep = easeInOutCubic(linearStep(tween, downtime, period));
        return cycle + linStep;
    }

    function pixelAlignFrustum(
        cam: THREE.OrthographicCamera, ar: number,
        pixelsPerScreenWidth: number, pixelsPerScreenHeight: number,
    ) {
        const worldScreenWidth = (cam.right - cam.left) / cam.zoom;
        const worldScreenHeight = (cam.top - cam.bottom) / cam.zoom;
        const pixelWidth = worldScreenWidth / pixelsPerScreenWidth;
        const pixelHeight = worldScreenHeight / pixelsPerScreenHeight;

        const camPos = new THREE.Vector3(); cam.getWorldPosition(camPos);
        const camRot = new THREE.Quaternion(); cam.getWorldQuaternion(camRot);
        const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camRot);
        const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camRot);

        const fractX = camPos.dot(camRight) / pixelWidth;
        const fractY = camPos.dot(camUp) / pixelHeight;
        const fx = (fractX - Math.round(fractX)) * pixelWidth;
        const fy = (fractY - Math.round(fractY)) * pixelHeight;

        cam.left = -ar - fx;
        cam.right = ar - fx;
        cam.top = 1.0 - fy;
        cam.bottom = -1.0 - fy;
        cam.updateProjectionMatrix();
    }

    // Animation loop
    function animate() {
        timer.update();
        const t = timer.getElapsed();

        crystalMesh.material.emissiveIntensity = Math.sin(t * 3) * 0.5 + 0.5;
        crystalMesh.position.y = 0.7 + Math.sin(t * 2) * 0.05;
        crystalMesh.rotation.y = stopGoEased(t, 2, 4) * 2 * Math.PI;

        // Apply current effect controller values
        renderPixelatedPass.setPixelSize(effectController.pixelSize);
        renderPixelatedPass.normalEdgeStrength = effectController.normalEdgeStrength;
        renderPixelatedPass.depthEdgeStrength = effectController.depthEdgeStrength;

        // Handle resize
        const w = canvas.width;
        const h = canvas.height;
        if (renderer.domElement.width !== w || renderer.domElement.height !== h) {
            renderer.setSize(w, h, false);
            composer.setSize(w, h);
            const ar = w / h;
            camera.left = -ar;
            camera.right = ar;
            camera.updateProjectionMatrix();
        }

        const rendererSize = renderer.getSize(new THREE.Vector2());
        const ar = rendererSize.x / rendererSize.y;
        if (effectController.pixelAlignedPanning) {
            pixelAlignFrustum(
                camera, ar,
                Math.floor(rendererSize.x / effectController.pixelSize),
                Math.floor(rendererSize.y / effectController.pixelSize),
            );
        } else if (camera.left !== -ar || camera.top !== 1.0) {
            camera.left = -ar;
            camera.right = ar;
            camera.top = 1.0;
            camera.bottom = -1.0;
            camera.updateProjectionMatrix();
        }

        composer.render();
    }

    // Animation loop — use requestAnimationFrame directly (GTK frame clock compatible)
    // Three.js setAnimationLoop uses self.requestAnimationFrame internally which works,
    // but we use the same on-demand pattern as the teapot demo for consistency.
    let frameCount = 0;
    let animPending = false;
    function scheduleFrame() {
        if (animPending) return;
        animPending = true;
        requestAnimationFrame((_time) => {
            animPending = false;
            animate();
            frameCount++;
            if (frameCount === 1) {
                // Debug: log render info after first frame to diagnose blank screen
                const info = renderer.info;
                console.log('[MRT-debug] canvas size:', canvas.width, 'x', canvas.height);
                console.log('[MRT-debug] render.calls:', info.render.calls, '  render.triangles:', info.render.triangles);
                console.log('[MRT-debug] WebGL error after first frame:', (canvas as any).getContext?.('webgl2')?.getError?.() ?? 'n/a');
            }
            scheduleFrame(); // continuous animation
        });
    }
    scheduleFrame();

    // Render scheduling for manual re-renders (from control changes)
    function render() {
        // Animation loop handles continuous rendering, nothing extra needed
    }

    return { effectController, render };
}
