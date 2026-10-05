// Browser UI for canvas2d-fireworks example.
// The widget tree is the GJS window's own `fireworks-window.blp`, projected and mounted by
// @gjsify/adwaita-web — one authored file, so the sidebar toggle, the `bind`s between the toggle
// and the split view and the two `[breakpoint]`s cannot drift from the GTK build.

import { mountSharedTree } from '@gjsify/adwaita-web'; // also registers the custom elements + self-injects the stylesheet
// A showcase is served to whatever browser opens it, so it cannot assume the host has
// Adwaita Sans the way a GNOME desktop does. `import '@gjsify/adwaita-web'` names the
// family and ships no `@font-face`, so without this call the chrome renders in the host's
// default sans on macOS, on Windows and on any Linux that is not GNOME — and looks right
// only on the machine it was written on.
import { applyAdwaitaFonts } from '@gjsify/adwaita-web/fonts';
import tree from '../gjs/fireworks-window.blp?shared-tree';
import { start, type FireworksDemo } from '../fireworks.js';

// Idempotent, and a no-op where there is no `document` — so a build-time import of this
// module (the website slideshow does one) neither throws nor half-applies.
applyAdwaitaFonts();

/** Handle returned by `mount()` so hosts (e.g. the website slideshow) can pause and resume rendering. */
export interface ShowcaseHandle {
    pause(): void;
    resume(): void;
    readonly isPaused: boolean;
}

/** The one element of the mounted tree with this authored id. */
function byId(root: HTMLElement, id: string): HTMLElement {
    const el = root.querySelector<HTMLElement>(`#${id}`);
    if (el === null) throw new Error(`fireworks-window.blp declares no object with the id "${id}"`);
    return el;
}

/**
 * The SpinRow ranges. On GTK they are `Gtk.Adjustment`s the window's TypeScript constructs
 * (`fireworks-window.ts`), because Blueprint has no spelling for one here — so they are not in the
 * tree, and this table is the browser's copy of those three adjustments. Keep the two in step.
 */
const SPIN_ROWS = {
    particleCountRow: { lower: 10, upper: 100, stepIncrement: 1, value: 30 },
    autoIntervalRow: { lower: 50, upper: 1000, stepIncrement: 50, value: 200 },
    maxBurstRadiusRow: { lower: 50, upper: 300, stepIncrement: 10, value: 160 },
};

export function mount(container: HTMLElement): ShowcaseHandle {
    const { root: win } = mountSharedTree(tree, { into: container });

    for (const [id, range] of Object.entries(SPIN_ROWS))
        byId(win, id).setAttribute('adjustment', JSON.stringify(range));
    const particleCountRow = byId(win, 'particleCountRow');
    const autoIntervalRow = byId(win, 'autoIntervalRow');
    const maxBurstRadiusRow = byId(win, 'maxBurstRadiusRow');
    const autoFireworksRow = byId(win, 'autoFireworksRow');
    const pauseBtn = byId(win, 'pauseButton');
    const splitView = byId(win, 'splitView');

    // Canvas container — inline styles so the showcase is self-contained and works regardless
    // of host CSS.
    const canvasContainer = byId(win, 'canvasContainer');
    canvasContainer.style.cssText = 'flex:1;position:relative;min-width:0;min-height:0;background:#000';

    const canvas = document.createElement('canvas');
    canvas.id = 'fireworks-canvas';
    canvas.style.cssText = 'display:block;width:100%;height:100%;position:absolute;inset:0';
    canvasContainer.append(canvas);

    // Sync canvas buffer to container dimensions
    function syncCanvasSize() {
        const w = canvasContainer.clientWidth;
        const h = canvasContainer.clientHeight;
        if (w > 0 && h > 0) {
            canvas.width = w;
            canvas.height = h;
        }
    }

    // Start fireworks once the canvas has a size. We keep the demo reference
    // in an outer closure so the pause button and the returned ShowcaseHandle
    // can delegate to it once it's alive.
    let demo: FireworksDemo | null = null;
    // Buffers pause() calls that arrive before the demo exists (lazy mount
    // racing with the slideshow calling pause() on the non-active slide).
    let pendingPause = false;

    const sizeObserver = new ResizeObserver(() => {
        syncCanvasSize();
        if (!demo && canvas.width > 0 && canvas.height > 0) {
            demo = start(canvas);
            connectControls(
                demo,
                particleCountRow as AdwRow,
                autoIntervalRow as AdwRow,
                maxBurstRadiusRow as AdwRow,
                autoFireworksRow as AdwRow,
            );
            if (pendingPause) {
                demo.pause();
                pendingPause = false;
            }
        }
    });
    sizeObserver.observe(canvasContainer);

    const contentArea = splitView.querySelector('.adw-osv-content');
    if (contentArea) sizeObserver.observe(contentArea);

    // Pause button wiring — toggles demo state and swaps the icon.
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
    demo: FireworksDemo,
    particleCountRow: AdwRow,
    autoIntervalRow: AdwRow,
    maxBurstRadiusRow: AdwRow,
    autoFireworksRow: AdwRow,
) {
    particleCountRow.addEventListener('notify::value', () => {
        demo.effectController.particleCount = particleCountRow.value as number;
    });

    autoIntervalRow.addEventListener('notify::value', () => {
        demo.effectController.autoInterval = autoIntervalRow.value as number;
    });

    maxBurstRadiusRow.addEventListener('notify::value', () => {
        demo.effectController.maxBurstRadius = maxBurstRadiusRow.value as number;
    });

    autoFireworksRow.addEventListener('notify::active', () => {
        demo.effectController.autoFireworks = autoFireworksRow.active as boolean;
    });
}
