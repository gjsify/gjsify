// Browser UI for three-geometry-teapot example.
// Mirrors the GJS/Adwaita UI from gjs/teapot-window.ts using @gjsify/adwaita-web.

import '@gjsify/adwaita-web';
import { start, TESS_VALUES, SHADING_VALUES, DEFAULT_TESS_INDEX, DEFAULT_SHADING_INDEX, type TeapotDemo, type StartOptions } from '../three-demo.js';

export interface MountOptions {
    /** Base path for loading texture assets (forwarded to three-demo). */
    assetBase?: string;
}

/**
 * Create the Adwaita teapot UI and mount it into the given container.
 * The container receives an adw-window with sidebar controls and a WebGL canvas.
 */
export function mount(container: HTMLElement, options?: MountOptions) {
    // Build UI — mirrors teapot-window.blp structure
    const win = document.createElement('adw-window');
    win.setAttribute('width', '1100');
    win.setAttribute('height', '700');

    const headerBar = document.createElement('adw-header-bar');
    headerBar.setAttribute('title', 'Three.js Teapot');

    const body = document.createElement('div');
    body.className = 'adw-window-body';

    // Sidebar with controls
    const sidebar = document.createElement('div');
    sidebar.className = 'adw-sidebar';
    const sidebarContent = document.createElement('div');
    sidebarContent.className = 'adw-sidebar-content';

    // Geometry group
    const geoGroup = document.createElement('adw-preferences-group');
    geoGroup.setAttribute('title', 'Geometry');

    const tessRow = document.createElement('adw-combo-row');
    tessRow.setAttribute('title', 'Tessellation Level');
    tessRow.setAttribute('items', JSON.stringify(TESS_VALUES.map(String)));
    tessRow.setAttribute('selected', String(DEFAULT_TESS_INDEX));

    const lidRow = document.createElement('adw-switch-row');
    lidRow.setAttribute('title', 'Display Lid');
    lidRow.setAttribute('active', '');

    const bodyRow = document.createElement('adw-switch-row');
    bodyRow.setAttribute('title', 'Display Body');
    bodyRow.setAttribute('active', '');

    const bottomRow = document.createElement('adw-switch-row');
    bottomRow.setAttribute('title', 'Display Bottom');
    bottomRow.setAttribute('active', '');

    const fitLidRow = document.createElement('adw-switch-row');
    fitLidRow.setAttribute('title', 'Snug Lid');

    const nonblinnRow = document.createElement('adw-switch-row');
    nonblinnRow.setAttribute('title', 'Original Scale');

    geoGroup.append(tessRow, lidRow, bodyRow, bottomRow, fitLidRow, nonblinnRow);

    // Material group
    const matGroup = document.createElement('adw-preferences-group');
    matGroup.setAttribute('title', 'Material');

    const shadingRow = document.createElement('adw-combo-row');
    shadingRow.setAttribute('title', 'Shading');
    shadingRow.setAttribute('items', JSON.stringify([...SHADING_VALUES]));
    shadingRow.setAttribute('selected', String(DEFAULT_SHADING_INDEX));

    matGroup.append(shadingRow);

    sidebarContent.append(geoGroup, matGroup);
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

    // Sync canvas size with container
    new ResizeObserver(() => {
        canvas.width = glContainer.clientWidth;
        canvas.height = glContainer.clientHeight;
    }).observe(glContainer);
    canvas.width = glContainer.clientWidth;
    canvas.height = glContainer.clientHeight;

    // Start three.js and connect controls — mirrors connectControls()
    const demo = start(canvas, { assetBase: options?.assetBase });
    connectControls(demo, tessRow, shadingRow, lidRow, bodyRow, bottomRow, fitLidRow, nonblinnRow);
}

function connectControls(
    demo: TeapotDemo,
    tessRow: any, shadingRow: any,
    lidRow: any, bodyRow: any, bottomRow: any,
    fitLidRow: any, nonblinnRow: any,
) {
    tessRow.addEventListener('notify::selected', () => {
        demo.effectController.newTess = TESS_VALUES[tessRow.selected];
        demo.render();
    });

    shadingRow.addEventListener('notify::selected', () => {
        demo.effectController.newShading = SHADING_VALUES[shadingRow.selected];
        demo.render();
    });

    for (const [row, key] of [
        [lidRow, 'lid'], [bodyRow, 'body'], [bottomRow, 'bottom'],
        [fitLidRow, 'fitLid'], [nonblinnRow, 'nonblinn'],
    ] as const) {
        row.addEventListener('notify::active', () => {
            (demo.effectController as any)[key] = row.active;
            demo.render();
        });
    }
}
