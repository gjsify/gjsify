// Browser UI for three-loader-ldraw example.
// The widget tree is the GJS window's own `ldraw-window.blp`, projected and mounted by
// @gjsify/adwaita-web — one authored file, so the control groups and the GL area cannot drift
// from the GTK build.
// Ported from refs/three/examples/webgl_loader_ldraw.html
// Original: MIT license, three.js authors (https://threejs.org)
// This software uses the LDraw Parts Library (http://www.ldraw.org), CC BY 2.0.

// The root import self-applies the compiled stylesheet, which is why the
// `@gjsify/adwaita-web/style.css` side-effect import that used to sit here was
// dead twice over: under this build css-as-string turns it into a string a
// side-effect import discards, and under a real CSS pipeline it injects the same
// rules a SECOND time (`style.css.d.ts` says so).
import { mountSharedTree } from '@gjsify/adwaita-web';
// A showcase is served to whatever browser opens it, so it cannot assume the host has
// Adwaita Sans the way a GNOME desktop does. `import '@gjsify/adwaita-web'` names the
// family and ships no `@font-face`, so without this call the chrome renders in the host's
// default sans on macOS, on Windows and on any Linux that is not GNOME — and looks right
// only on the machine it was written on.
import { applyAdwaitaFonts } from '@gjsify/adwaita-web/fonts';
import tree from '../gjs/ldraw-window.blp?shared-tree';
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

/** The one element of the mounted tree with this authored id. */
function byId(root: HTMLElement, id: string): HTMLElement {
    const el = root.querySelector<HTMLElement>(`#${id}`);
    if (el === null) throw new Error(`ldraw-window.blp declares no object with the id "${id}"`);
    return el;
}

/**
 * The values `ldraw-window.ts` sets in TypeScript because Blueprint has no spelling for them
 * here, so they are not in the tree and this is the browser's copy. Keep the two in step.
 *
 * | id                 | attribute    | value                                   | GTK counterpart                               |
 * | ------------------ | ------------ | --------------------------------------- | --------------------------------------------- |
 * | `modelRow`         | `model`      | `MODEL_LIST` names                      | `set_model(Gtk.StringList.new(…))`            |
 * | `modelRow`         | `selected`   | `DEFAULT_MODEL_INDEX`                   | `set_selected(DEFAULT_MODEL_INDEX)`           |
 * | `buildingStepRow`  | `adjustment` | `lower 0, upper 0, stepIncrement 1, value 0` | `set_adjustment(new Gtk.Adjustment(…))`  |
 *
 * `upper` and `value` of the building step follow the loaded model (see the `start` callback).
 */
const TS_ONLY = {
    modelRow: { model: MODEL_LIST.map((m) => m.name), selected: DEFAULT_MODEL_INDEX },
    buildingStepRow: { lower: 0, upper: 0, stepIncrement: 1, value: 0 },
};

export function mount(container: HTMLElement, options?: MountOptions): ShowcaseHandle {
    const { assetBase } = options ?? {};

    const { root: win } = mountSharedTree(tree, { into: container });

    const modelRow = byId(win, 'modelRow');
    const flatColorsRow = byId(win, 'flatColorsRow');
    const mergeModelRow = byId(win, 'mergeModelRow');
    const smoothNormalsRow = byId(win, 'smoothNormalsRow');
    const buildingStepRow = byId(win, 'buildingStepRow');
    const displayLinesRow = byId(win, 'displayLinesRow');
    const conditionalLinesRow = byId(win, 'conditionalLinesRow');

    modelRow.setAttribute('model', JSON.stringify(TS_ONLY.modelRow.model));
    modelRow.setAttribute('selected', String(TS_ONLY.modelRow.selected));
    buildingStepRow.setAttribute('adjustment', JSON.stringify(TS_ONLY.buildingStepRow));

    // A showcase has two hosts — the standalone page and the website embed — and only the former
    // loads `browser/webgl.css`, so the layout has to live here rather than in that stylesheet.
    const glContainer = byId(win, 'glAreaContainer');
    glContainer.style.cssText = 'flex:1;position:relative;min-width:0;min-height:0';

    const canvas = document.createElement('canvas');
    canvas.id = 'webgl-canvas';
    canvas.style.cssText = 'display:block;width:100%;height:100%;position:absolute;inset:0';
    glContainer.append(canvas);

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
        buildingStepRow.setAttribute(
            'adjustment',
            JSON.stringify({ ...TS_ONLY.buildingStepRow, upper: numSteps - 1, value: numSteps - 1 }),
        );
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
