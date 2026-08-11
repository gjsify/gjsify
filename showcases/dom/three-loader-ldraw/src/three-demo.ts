// Ported from refs/three/examples/webgl_loader_ldraw.html
// Original: MIT license, three.js authors (https://threejs.org)
// This software uses the LDraw Parts Library (http://www.ldraw.org), CC BY 2.0.
// Reimplemented for GJS and browser targets using @gjsify packages.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LDrawLoader } from 'three/addons/loaders/LDrawLoader.js';
import { LDrawUtils } from 'three/addons/utils/LDrawUtils.js';
import { LDrawConditionalLineMaterial } from 'three/addons/materials/LDrawConditionalLineMaterial.js';
import { MODEL_LIST, DEFAULT_MODEL_INDEX, type ModelEntry } from './models.js';

export { MODEL_LIST, DEFAULT_MODEL_INDEX, type ModelEntry };

export interface LDrawEffectController {
    modelIndex: number;
    flatColors: boolean;
    mergeModel: boolean;
    buildingStep: number;
    smoothNormals: boolean;
    displayLines: boolean;
    conditionalLines: boolean;
}

export interface LDrawDemo {
    readonly effectController: LDrawEffectController;
    reloadObject(resetCamera: boolean): void;
    updateVisibility(): void;
    numBuildingSteps: number;
    /** Stop the render loop — the website embed calls this when it scrolls out of view. */
    pause(): void;
    /** Restart the render loop after `pause()`. */
    resume(): void;
    readonly isPaused: boolean;
}

export interface StartOptions {
    assetBase?: string;
}

export type OnModelLoaded = (numBuildingSteps: number) => void;

export function start(canvas: HTMLCanvasElement, options?: StartOptions, onModelLoaded?: OnModelLoaded): LDrawDemo {
    const assetBase = options?.assetBase ?? './';
    const ldrawPath = `${assetBase}assets/models/ldraw/officialLibrary/`;

    // oxlint-disable-next-line typescript/no-explicit-any -- THREE.WebGLRenderer canvas option expects OffscreenCanvas; GJS canvas type is incompatible
    const renderer = new THREE.WebGLRenderer({ canvas: canvas as any, antialias: true });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Pass updateStyle=false: the canvas CSS width/height are owned by the host
    // container (GTK allocation / browser flex layout), we only size the
    // drawing buffer.
    renderer.setSize(canvas.width, canvas.height, false);
    // The last size handed to the renderer, tracked separately because `renderer.domElement` IS this
    // canvas: the obvious `renderer.domElement.width !== w` compares a value with itself, leaving the
    // resize branch dead and the camera aspect frozen at the first allocation.
    let prevW = canvas.width;
    let prevH = canvas.height;

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdeebed);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(45, canvas.width / canvas.height, 1, 10000);
    camera.position.set(150, 200, 250);

    // oxlint-disable-next-line typescript/no-explicit-any -- OrbitControls domElement type is HTMLElement; GJS canvas type is incompatible
    const controls = new OrbitControls(camera, canvas as any);
    controls.enableDamping = true;

    let model: THREE.Group | null = null;

    const effectController: LDrawEffectController = {
        modelIndex: DEFAULT_MODEL_INDEX,
        flatColors: false,
        mergeModel: false,
        buildingStep: 0,
        smoothNormals: true,
        displayLines: true,
        conditionalLines: true,
    };

    let numBuildingSteps = 0;

    function updateObjectsVisibility() {
        if (!model) return;
        // oxlint-disable-next-line typescript/no-explicit-any -- THREE.Object3D.traverse callback; LDraw-specific properties (isConditionalLine, buildingStep) not in THREE types
        model.traverse((c: any) => {
            if (c.isLineSegments) {
                if (c.isConditionalLine) {
                    c.visible = effectController.conditionalLines;
                } else {
                    c.visible = effectController.displayLines;
                }
            } else if (c.isGroup) {
                c.visible = c.userData.buildingStep <= effectController.buildingStep;
            }
        });
    }

    function reloadObject(resetCamera: boolean) {
        if (model) {
            scene.remove(model);
            model = null;
        }

        const entry = MODEL_LIST[effectController.modelIndex];
        if (!entry) return;

        const lDrawLoader = new LDrawLoader();
        lDrawLoader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
        // oxlint-disable-next-line typescript/no-explicit-any -- LDrawLoader.smoothNormals is a runtime property not in the three.js TypeScript types
        (lDrawLoader as any).smoothNormals = effectController.smoothNormals && !effectController.flatColors;
        lDrawLoader.setPath(ldrawPath);

        lDrawLoader.load(
            entry.file,
            (group2: THREE.Group) => {
                if (model) scene.remove(model);

                model = group2;

                // Flat colors: convert to MeshBasicMaterial (LEGO instruction look)
                if (effectController.flatColors) {
                    // oxlint-disable-next-line typescript/no-explicit-any -- THREE.Object3D.traverse callback; LDraw-specific isMesh/material not guaranteed typed
                    model.traverse((c: any) => {
                        if (c.isMesh) {
                            if (Array.isArray(c.material)) {
                                c.material = c.material.map(convertMaterial);
                            } else {
                                c.material = convertMaterial(c.material);
                            }
                        }
                    });
                }

                if (effectController.mergeModel) model = LDrawUtils.mergeObject(model);

                // Convert from LDraw coordinates: rotate 180 degrees around OX
                model.rotation.x = Math.PI;
                scene.add(model);

                numBuildingSteps = ((model.userData as Record<string, unknown>).numBuildingSteps as number) ?? 1;
                effectController.buildingStep = numBuildingSteps - 1;

                updateObjectsVisibility();

                const bbox = new THREE.Box3().setFromObject(model);
                const size = bbox.getSize(new THREE.Vector3());
                const radius = Math.max(size.x, Math.max(size.y, size.z)) * 0.5;

                if (resetCamera) {
                    controls.target0.copy(bbox.getCenter(new THREE.Vector3()));
                    controls.position0.set(-2.3, 1, 2).multiplyScalar(radius).add(controls.target0);
                    controls.reset();
                }

                onModelLoaded?.(numBuildingSteps);
            },
            undefined,
            (error: unknown) => {
                // The onError handler is load-bearing: LDrawLoader routes failures into a promise
                // chain, so without it a failed model is a silent rejection and the viewer just shows
                // the empty background.
                console.error(`[ldraw] loading ${ldrawPath}${entry.file} failed:`, error);
            },
        );
    }

    function convertMaterial(material: THREE.Material): THREE.MeshBasicMaterial {
        const m = material as THREE.MeshStandardMaterial;
        const newMat = new THREE.MeshBasicMaterial();
        newMat.color.copy(m.color);
        newMat.polygonOffset = m.polygonOffset;
        newMat.polygonOffsetUnits = m.polygonOffsetUnits;
        newMat.polygonOffsetFactor = m.polygonOffsetFactor;
        newMat.opacity = m.opacity;
        newMat.transparent = m.transparent;
        newMat.depthWrite = m.depthWrite;
        newMat.toneMapped = false;
        return newMat;
    }

    function animate() {
        controls.update();

        // canvas.width/height are the host-owned drawing buffer: GTK allocation on GJS, a parent
        // ResizeObserver in the browser.
        const w = canvas.width;
        const h = canvas.height;
        if (w !== prevW || h !== prevH) {
            prevW = w;
            prevH = h;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }

        renderer.render(scene, camera);
    }

    // requestAnimationFrame directly, which maps onto the GTK frame clock.
    let animPending = false;
    let paused = false;
    function scheduleFrame() {
        if (animPending || paused) return;
        animPending = true;
        requestAnimationFrame(() => {
            animPending = false;
            animate();
            scheduleFrame();
        });
    }
    scheduleFrame();

    reloadObject(true);

    return {
        effectController,
        reloadObject,
        updateVisibility: updateObjectsVisibility,
        pause() {
            paused = true;
        },
        resume() {
            if (!paused) return;
            paused = false;
            scheduleFrame();
        },
        get isPaused() {
            return paused;
        },
        get numBuildingSteps() {
            return numBuildingSteps;
        },
        set numBuildingSteps(v) {
            numBuildingSteps = v;
        },
    };
}
