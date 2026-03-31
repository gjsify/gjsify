// Ported from refs/three/examples/webgl_geometry_teapot.html
// Original: MIT license, three.js contributors
// Reimplemented as platform-agnostic module for GJS and browser targets.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TeapotGeometry } from 'three/addons/geometries/TeapotGeometry.js';

export type ShadingMode = 'wireframe' | 'flat' | 'smooth' | 'glossy' | 'textured' | 'reflective';

export interface TeapotEffectController {
    newTess: number;
    lid: boolean;
    body: boolean;
    bottom: boolean;
    fitLid: boolean;
    nonblinn: boolean;
    newShading: ShadingMode;
}

export interface TeapotDemo {
    readonly effectController: TeapotEffectController;
    /** Call after changing effectController properties to schedule a re-render. */
    render(): void;
}

const TEAPOT_SIZE = 300;

export function start(canvas: HTMLCanvasElement): TeapotDemo {
    // Renderer
    const renderer = new THREE.WebGLRenderer({ canvas: canvas as any, antialias: true });
    renderer.setSize(canvas.width, canvas.height);

    // Camera
    const camera = new THREE.PerspectiveCamera(45, canvas.width / canvas.height, 1, 80000);
    camera.position.set(-600, 550, 1300);

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xAAAAAA);

    // Lights
    const ambientLight = new THREE.AmbientLight(0x7c7c7c, 2.0);
    scene.add(ambientLight);

    const light = new THREE.DirectionalLight(0xFFFFFF, 2.0);
    light.position.set(0.32, 0.39, 0.7);
    scene.add(light);

    // Texture map
    const textureMap = new THREE.TextureLoader().load('./assets/uv_grid_opengl.jpg');
    textureMap.wrapS = textureMap.wrapT = THREE.RepeatWrapping;
    textureMap.anisotropy = 16;
    textureMap.colorSpace = THREE.SRGBColorSpace;

    // Reflection map (cubemap)
    const path = './assets/pisa/';
    const urls = ['px.png', 'nx.png', 'py.png', 'ny.png', 'pz.png', 'nz.png'];
    const textureCube = new THREE.CubeTextureLoader().setPath(path).load(urls);

    // Materials
    const materials: Record<ShadingMode, THREE.Material> = {
        'wireframe': new THREE.MeshBasicMaterial({ wireframe: true }),
        'flat': new THREE.MeshPhongMaterial({ specular: 0x000000, flatShading: true, side: THREE.DoubleSide }),
        'smooth': new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }),
        'glossy': new THREE.MeshPhongMaterial({ color: 0xc0c0c0, specular: 0x404040, shininess: 300, side: THREE.DoubleSide }),
        'textured': new THREE.MeshPhongMaterial({ map: textureMap, side: THREE.DoubleSide }),
        'reflective': new THREE.MeshPhongMaterial({ envMap: textureCube, side: THREE.DoubleSide }),
    };

    // OrbitControls
    const cameraControls = new OrbitControls(camera, canvas as any);
    cameraControls.addEventListener('change', render);

    // Effect controller — external GUI mutates this, then calls render()
    const effectController: TeapotEffectController = {
        newTess: 15,
        lid: true,
        body: true,
        bottom: true,
        fitLid: false,
        nonblinn: false,
        newShading: 'glossy',
    };

    // Track last-rendered state for change detection
    let tess = -1; // force initial creation
    let bBottom: boolean;
    let bLid: boolean;
    let bBody: boolean;
    let bFitLid: boolean;
    let bNonBlinn: boolean;
    let shading: ShadingMode;
    let teapot: THREE.Mesh | undefined;

    function createNewTeapot() {
        if (teapot !== undefined) {
            teapot.geometry.dispose();
            scene.remove(teapot);
        }

        const geometry = new TeapotGeometry(
            TEAPOT_SIZE,
            tess,
            effectController.bottom,
            effectController.lid,
            effectController.body,
            effectController.fitLid,
            !effectController.nonblinn,
        );

        teapot = new THREE.Mesh(geometry, materials[shading]);
        scene.add(teapot);
    }

    function doRender() {
        // Check if parameters changed
        if (effectController.newTess !== tess ||
            effectController.bottom !== bBottom ||
            effectController.lid !== bLid ||
            effectController.body !== bBody ||
            effectController.fitLid !== bFitLid ||
            effectController.nonblinn !== bNonBlinn ||
            effectController.newShading !== shading) {

            tess = effectController.newTess;
            bBottom = effectController.bottom;
            bLid = effectController.lid;
            bBody = effectController.body;
            bFitLid = effectController.fitLid;
            bNonBlinn = effectController.nonblinn;
            shading = effectController.newShading;

            createNewTeapot();
        }

        // Reflective mode uses cubemap as background
        if (shading === 'reflective') {
            scene.background = textureCube;
        } else {
            scene.background = null;
        }

        // Handle resize
        const w = canvas.width;
        const h = canvas.height;
        if (renderer.domElement.width !== w || renderer.domElement.height !== h) {
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }

        renderer.render(scene, camera);
    }

    // Render scheduling: coalesce multiple render requests into one frame.
    // In GTK, the GL context is only current inside the frame pipeline (rAF),
    // so direct calls from signal handlers would fail.
    let renderPending = false;
    function render() {
        if (renderPending) return;
        renderPending = true;
        requestAnimationFrame(() => {
            renderPending = false;
            doRender();
        });
    }

    // Initial render
    render();

    return {
        effectController,
        render,
    };
}
