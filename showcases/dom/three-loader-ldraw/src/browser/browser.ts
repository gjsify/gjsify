// Browser UI for three-loader-ldraw example.
// Mirrors the GJS/Adwaita UI using @gjsify/adwaita-web.
// Ported from refs/three/examples/webgl_loader_ldraw.html
// Original: MIT license, three.js authors (https://threejs.org)
// This software uses the LDraw Parts Library (http://www.ldraw.org), CC BY 2.0.

// The root import self-applies the compiled stylesheet, which is why the
// `@gjsify/adwaita-web/style.css` side-effect import that used to sit here was
// dead twice over: under this build css-as-string turns it into a string a
// side-effect import discards, and under a real CSS pipeline it injects the same
// rules a SECOND time (`style.css.d.ts` says so).
import '@gjsify/adwaita-web';
// A showcase is served to whatever browser opens it, so it cannot assume the host has
// Adwaita Sans the way a GNOME desktop does. `import '@gjsify/adwaita-web'` names the
// family and ships no `@font-face`, so without this call the chrome renders in the host's
// default sans on macOS, on Windows and on any Linux that is not GNOME — and looks right
// only on the machine it was written on.
import { applyAdwaitaFonts } from '@gjsify/adwaita-web/fonts';
import type { AdwOverlaySplitView } from '@gjsify/adwaita-web';
import { start, MODEL_LIST, DEFAULT_MODEL_INDEX, type LDrawDemo } from '../three-demo.js';

// Idempotent, and a no-op where there is no `document` — so a build-time import of this
// module (the website slideshow does one) neither throws nor half-applies.
applyAdwaitaFonts();

export interface MountOptions {
    assetBase?: string;
}

/**
 * What the website's `<ShowcaseEmbed>` holds on to: it pauses a demo that
 * scrolls out of view, so an always-animating scene does not keep a GPU busy
 * off-screen.
 */
export interface ShowcaseHandle {
    pause(): void;
    resume(): void;
    readonly isPaused: boolean;
}

export function mount(container: HTMLElement, options?: MountOptions): ShowcaseHandle {
    const { assetBase } = options ?? {};

    const win = document.createElement('adw-window');
    win.setAttribute('width', '1100');
    win.setAttribute('height', '700');

    const headerBar = document.createElement('adw-header-bar');
    headerBar.setAttribute('title', 'LDraw Loader');

    // A showcase has two hosts — the standalone page and the website embed — and only the former
    // loads `browser/webgl.css`, so the layout has to live here rather than in that stylesheet.
    const splitView = document.createElement('adw-overlay-split-view') as AdwOverlaySplitView;
    splitView.setAttribute('min-sidebar-width', '280');
    splitView.setAttribute('max-sidebar-width', '400');
    splitView.setAttribute('sidebar-width-fraction', '0.30');
    splitView.setAttribute('show-sidebar', '');

    // Inline styles for the same reason as the GL container below.
    const sidebarContent = document.createElement('div');
    sidebarContent.setAttribute('slot', 'sidebar');
    sidebarContent.className = 'adw-sidebar-content';
    sidebarContent.style.cssText = 'padding:12px;display:flex;flex-direction:column;gap:12px';

    const modelGroup = document.createElement('adw-preferences-group');
    modelGroup.setAttribute('title', 'Model');

    const modelRow = document.createElement('adw-combo-row');
    modelRow.setAttribute('title', 'Model');
    modelRow.setAttribute('items', JSON.stringify(MODEL_LIST.map((m) => m.name)));
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

    // GL container (content slot) — inline styles so the showcase
    // is self-contained and works regardless of host CSS.
    const glContainer = document.createElement('div');
    glContainer.setAttribute('slot', 'content');
    glContainer.id = 'gl-area-container';
    glContainer.style.cssText = 'flex:1;position:relative;min-width:0;min-height:0';

    const canvas = document.createElement('canvas');
    canvas.id = 'webgl-canvas';
    canvas.style.cssText = 'display:block;width:100%;height:100%;position:absolute;inset:0';
    glContainer.append(canvas);

    splitView.append(sidebarContent, glContainer);
    win.append(headerBar, splitView);
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
        // oxlint-disable-next-line typescript/no-explicit-any -- adw-spin-row is a custom element with no TypeScript type for .value property
        (buildingStepRow as any).value = numSteps - 1;
    });

    connectControls(
        demo,
        modelRow as AdwRow,
        flatColorsRow as AdwRow,
        mergeModelRow as AdwRow,
        smoothNormalsRow as AdwRow,
        buildingStepRow as AdwRow,
        displayLinesRow as AdwRow,
        conditionalLinesRow as AdwRow,
    );

    return {
        pause: () => demo.pause(),
        resume: () => demo.resume(),
        get isPaused() {
            return demo.isPaused;
        },
    };
}

// Adwaita web components expose custom properties (.selected, .active, .value) not in HTMLElement types.
type AdwRow = HTMLElement & Record<string, unknown>;

function connectControls(
    demo: LDrawDemo,
    modelRow: AdwRow,
    flatColorsRow: AdwRow,
    mergeModelRow: AdwRow,
    smoothNormalsRow: AdwRow,
    buildingStepRow: AdwRow,
    displayLinesRow: AdwRow,
    conditionalLinesRow: AdwRow,
) {
    modelRow.addEventListener('notify::selected', () => {
        demo.effectController.modelIndex = modelRow.selected as number;
        demo.reloadObject(true);
    });

    flatColorsRow.addEventListener('notify::active', () => {
        demo.effectController.flatColors = flatColorsRow.active as boolean;
        demo.reloadObject(false);
    });

    mergeModelRow.addEventListener('notify::active', () => {
        demo.effectController.mergeModel = mergeModelRow.active as boolean;
        demo.reloadObject(false);
    });

    smoothNormalsRow.addEventListener('notify::active', () => {
        demo.effectController.smoothNormals = smoothNormalsRow.active as boolean;
        demo.reloadObject(false);
    });

    buildingStepRow.addEventListener('notify::value', () => {
        demo.effectController.buildingStep = buildingStepRow.value as number;
        demo.updateVisibility();
    });

    displayLinesRow.addEventListener('notify::active', () => {
        demo.effectController.displayLines = displayLinesRow.active as boolean;
        demo.updateVisibility();
    });

    conditionalLinesRow.addEventListener('notify::active', () => {
        demo.effectController.conditionalLines = conditionalLinesRow.active as boolean;
        demo.updateVisibility();
    });
}
