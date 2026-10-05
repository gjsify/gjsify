// Browser UI for three-postprocessing-pixel example.
// The widget tree is the GJS window's own `pixel-window.blp`, projected and mounted by
// @gjsify/adwaita-web — one authored file, so the sidebar toggle, the `bind`s between the toggle
// and the split view and the two `[breakpoint]`s cannot drift from the GTK build.
// Ported from refs/three/examples/webgl_postprocessing_pixel.html
// Original: MIT license, three.js authors (https://threejs.org)

import { mountSharedTree } from '@gjsify/adwaita-web'; // also registers the custom elements + self-injects the stylesheet
// A showcase is served to whatever browser opens it, so it cannot assume the host has
// Adwaita Sans the way a GNOME desktop does. `import '@gjsify/adwaita-web'` names the
// family and ships no `@font-face`, so without this call the chrome renders in the host's
// default sans on macOS, on Windows and on any Linux that is not GNOME — and looks right
// only on the machine it was written on.
import { applyAdwaitaFonts } from '@gjsify/adwaita-web/fonts';
import tree from '../gjs/pixel-window.blp?shared-tree';
import { start, type PixelDemo } from '../three-demo.js';

// Idempotent, and a no-op where there is no `document` — so a build-time import of this
// module (the website slideshow does one) neither throws nor half-applies.
applyAdwaitaFonts();

export interface MountOptions {
    assetBase?: string;
}

/** Handle returned by `mount()` so hosts (e.g. the website slideshow) can pause and resume rendering. */
export interface ShowcaseHandle {
    pause(): void;
    resume(): void;
    readonly isPaused: boolean;
}

/** The one element of the mounted tree with this authored id. */
function byId(root: HTMLElement, id: string): HTMLElement {
    const el = root.querySelector<HTMLElement>(`#${id}`);
    if (el === null) throw new Error(`pixel-window.blp declares no object with the id "${id}"`);
    return el;
}

/**
 * The SpinRow ranges. On GTK they are `Gtk.Adjustment`s the window's TypeScript constructs
 * (`pixel-window.ts`), because Blueprint has no spelling for one here — so they are not in the
 * tree, and this table is the browser's copy of those three adjustments. Keep the two in step.
 * `<adw-spin-row>` has no `digits`, so the native `set_digits(2)` on the two edge rows has no
 * counterpart here.
 */
const SPIN_ROWS = {
    pixelSizeRow: { lower: 1, upper: 16, stepIncrement: 1, value: 4 },
    normalEdgeRow: { lower: 0, upper: 2, stepIncrement: 0.05, value: 0.3 },
    depthEdgeRow: { lower: 0, upper: 1, stepIncrement: 0.05, value: 0.4 },
};

export function mount(container: HTMLElement, options?: MountOptions): ShowcaseHandle {
    const { assetBase } = options ?? {};

    const { root: win } = mountSharedTree(tree, container);

    for (const [id, range] of Object.entries(SPIN_ROWS))
        byId(win, id).setAttribute('adjustment', JSON.stringify(range));
    const pixelSizeRow = byId(win, 'pixelSizeRow');
    const normalEdgeRow = byId(win, 'normalEdgeRow');
    const depthEdgeRow = byId(win, 'depthEdgeRow');
    const pixelAlignRow = byId(win, 'pixelAlignRow');
    const pauseBtn = byId(win, 'pauseButton');
    const splitView = byId(win, 'splitView');

    // Inline styles so the layout holds in the website embed too, which loads no showcase CSS.
    const glContainer = byId(win, 'glAreaContainer');
    glContainer.style.cssText = 'flex:1;position:relative;min-width:0;min-height:0';

    const canvas = document.createElement('canvas');
    canvas.id = 'webgl-canvas';
    canvas.style.cssText = 'display:block;width:100%;height:100%;position:absolute;inset:0';
    glContainer.append(canvas);

    function syncCanvasSize() {
        const w = glContainer.clientWidth;
        const h = glContainer.clientHeight;
        if (w > 0 && h > 0) {
            canvas.width = w;
            canvas.height = h;
        }
    }

    // The demo reference lives in an outer closure so the pause button and the returned handle can
    // delegate to it once it exists.
    let demo: PixelDemo | null = null;
    // Buffers pause() calls that arrive before the demo exists.
    let pendingPause = false;

    const sizeObserver = new ResizeObserver(() => {
        syncCanvasSize();
        if (!demo && canvas.width > 0 && canvas.height > 0) {
            demo = start(canvas, { assetBase });
            connectControls(
                demo,
                pixelSizeRow as AdwRow,
                normalEdgeRow as AdwRow,
                depthEdgeRow as AdwRow,
                pixelAlignRow as AdwRow,
            );
            if (pendingPause) {
                demo.pause();
                pendingPause = false;
            }
        }
    });
    sizeObserver.observe(glContainer);

    // The content area is observed too: glContainer's own observer can miss a sidebar toggle while a
    // CSS transition is running.
    const contentArea = splitView.querySelector('.adw-osv-content');
    if (contentArea) sizeObserver.observe(contentArea);

    function updatePauseButton(paused: boolean): void {
        pauseBtn.setAttribute('icon-name', paused ? 'media-playback-start-symbolic' : 'media-playback-pause-symbolic');
        pauseBtn.setAttribute('tooltip-text', paused ? 'Resume Rendering' : 'Pause Rendering');
    }
    pauseBtn.addEventListener('click', () => {
        if (demo) {
            if (demo.isPaused) demo.resume();
            else demo.pause();
            updatePauseButton(demo.isPaused);
        } else {
            pendingPause = !pendingPause;
            updatePauseButton(pendingPause);
        }
    });

    return {
        get isPaused() {
            return demo ? demo.isPaused : pendingPause;
        },
        pause() {
            if (demo) {
                demo.pause();
                updatePauseButton(true);
            } else {
                pendingPause = true;
                updatePauseButton(true);
            }
        },
        resume() {
            if (demo) {
                demo.resume();
                updatePauseButton(false);
            } else {
                pendingPause = false;
                updatePauseButton(false);
            }
        },
    };
}

// Adwaita web components expose custom properties (.value, .active) not in HTMLElement types.
type AdwRow = HTMLElement & Record<string, unknown>;

function connectControls(
    demo: PixelDemo,
    pixelSizeRow: AdwRow,
    normalEdgeRow: AdwRow,
    depthEdgeRow: AdwRow,
    pixelAlignRow: AdwRow,
) {
    pixelSizeRow.addEventListener('notify::value', () => {
        demo.effectController.pixelSize = pixelSizeRow.value as number;
    });

    normalEdgeRow.addEventListener('notify::value', () => {
        demo.effectController.normalEdgeStrength = normalEdgeRow.value as number;
    });

    depthEdgeRow.addEventListener('notify::value', () => {
        demo.effectController.depthEdgeStrength = depthEdgeRow.value as number;
    });

    pixelAlignRow.addEventListener('notify::active', () => {
        demo.effectController.pixelAlignedPanning = pixelAlignRow.active as boolean;
    });
}
