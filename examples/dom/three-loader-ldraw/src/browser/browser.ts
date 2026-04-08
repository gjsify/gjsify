// Browser UI for three-loader-ldraw example.
// Mirrors the GJS/Adwaita UI using @gjsify/adwaita-web.
// Ported from refs/three/examples/webgl_loader_ldraw.html
// Original: MIT license, three.js authors (https://threejs.org)
// This software uses the LDraw Parts Library (http://www.ldraw.org), CC BY 2.0.

import '@gjsify/adwaita-web';
import '@gjsify/adwaita-web/style.css';
import { start, MODEL_LIST, DEFAULT_MODEL_INDEX, type LDrawDemo } from '../three-demo.js';

export interface MountOptions {
    assetBase?: string;
}

export function mount(container: HTMLElement, options?: MountOptions) {
    const { assetBase } = options ?? {};

    // Build UI
    const win = document.createElement('adw-window');
    win.setAttribute('width', '1100');
    win.setAttribute('height', '700');

    const headerBar = document.createElement('adw-header-bar');
    headerBar.setAttribute('title', 'LDraw Loader');

    const body = document.createElement('div');
    body.className = 'adw-window-body';

    // Sidebar
    const sidebar = document.createElement('div');
    sidebar.className = 'adw-sidebar';
    const sidebarContent = document.createElement('div');
    sidebarContent.className = 'adw-sidebar-content';

    // Model group
    const modelGroup = document.createElement('adw-preferences-group');
    modelGroup.setAttribute('title', 'Model');

    const modelRow = document.createElement('adw-combo-row');
    modelRow.setAttribute('title', 'Model');
    modelRow.setAttribute('items', JSON.stringify(MODEL_LIST.map(m => m.name)));
    modelRow.setAttribute('selected', String(DEFAULT_MODEL_INDEX));

    modelGroup.append(modelRow);

    // Rendering group
    const renderGroup = document.createElement('adw-preferences-group');
    renderGroup.setAttribute('title', 'Rendering');

    const flatColorsRow = document.createElement('adw-switch-row');
    flatColorsRow.setAttribute('title', 'Flat Colors');

    const mergeModelRow = document.createElement('adw-switch-row');
    mergeModelRow.setAttribute('title', 'Merge Model');

    const smoothNormalsRow = document.createElement('adw-switch-row');
    smoothNormalsRow.setAttribute('title', 'Smooth Normals');
    smoothNormalsRow.setAttribute('active', '');

    renderGroup.append(flatColorsRow, mergeModelRow, smoothNormalsRow);

    // Display group
    const displayGroup = document.createElement('adw-preferences-group');
    displayGroup.setAttribute('title', 'Display');

    const buildingStepRow = document.createElement('adw-spin-row');
    buildingStepRow.setAttribute('title', 'Building Step');
    buildingStepRow.setAttribute('min', '0');
    buildingStepRow.setAttribute('max', '0');
    buildingStepRow.setAttribute('step', '1');
    buildingStepRow.setAttribute('value', '0');

    const displayLinesRow = document.createElement('adw-switch-row');
    displayLinesRow.setAttribute('title', 'Display Lines');
    displayLinesRow.setAttribute('active', '');

    const conditionalLinesRow = document.createElement('adw-switch-row');
    conditionalLinesRow.setAttribute('title', 'Conditional Lines');
    conditionalLinesRow.setAttribute('active', '');

    displayGroup.append(buildingStepRow, displayLinesRow, conditionalLinesRow);

    sidebarContent.append(modelGroup, renderGroup, displayGroup);
    sidebar.append(sidebarContent);

    // Separator + WebGL canvas
    const separator = document.createElement('div');
    separator.className = 'adw-separator-vertical';

    const glContainer = document.createElement('div');
    glContainer.id = 'gl-area-container';

    const canvas = document.createElement('canvas');
    canvas.id = 'webgl-canvas';
    glContainer.append(canvas);

    body.append(sidebar, separator, glContainer);
    win.append(headerBar, body);
    container.append(win);

    // Sync canvas size
    new ResizeObserver(() => {
        canvas.width = glContainer.clientWidth;
        canvas.height = glContainer.clientHeight;
    }).observe(glContainer);
    canvas.width = glContainer.clientWidth;
    canvas.height = glContainer.clientHeight;

    // Start three.js
    const demo = start(canvas, { assetBase }, (numSteps) => {
        // Update building step range when model loads
        buildingStepRow.setAttribute('max', String(numSteps - 1));
        (buildingStepRow as any).value = numSteps - 1;
    });

    connectControls(demo, modelRow, flatColorsRow, mergeModelRow, smoothNormalsRow,
        buildingStepRow, displayLinesRow, conditionalLinesRow);
}

function connectControls(
    demo: LDrawDemo,
    modelRow: any, flatColorsRow: any, mergeModelRow: any, smoothNormalsRow: any,
    buildingStepRow: any, displayLinesRow: any, conditionalLinesRow: any,
) {
    modelRow.addEventListener('notify::selected', () => {
        demo.effectController.modelIndex = modelRow.selected;
        demo.reloadObject(true);
    });

    flatColorsRow.addEventListener('notify::active', () => {
        demo.effectController.flatColors = flatColorsRow.active;
        demo.reloadObject(false);
    });

    mergeModelRow.addEventListener('notify::active', () => {
        demo.effectController.mergeModel = mergeModelRow.active;
        demo.reloadObject(false);
    });

    smoothNormalsRow.addEventListener('notify::active', () => {
        demo.effectController.smoothNormals = smoothNormalsRow.active;
        demo.reloadObject(false);
    });

    buildingStepRow.addEventListener('notify::value', () => {
        demo.effectController.buildingStep = buildingStepRow.value;
        demo.updateVisibility();
    });

    displayLinesRow.addEventListener('notify::active', () => {
        demo.effectController.displayLines = displayLinesRow.active;
        demo.updateVisibility();
    });

    conditionalLinesRow.addEventListener('notify::active', () => {
        demo.effectController.conditionalLines = conditionalLinesRow.active;
        demo.updateVisibility();
    });
}
