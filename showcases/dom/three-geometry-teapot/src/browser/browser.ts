// Browser UI for three-geometry-teapot example.
// The widget tree is the GJS window's own `teapot-window.blp`, projected and mounted by
// @gjsify/adwaita-web — one authored file, so the sidebar toggle, the `bind`s between the toggle
// and the split view and the two `[breakpoint]`s cannot drift from the GTK build.

import { mountSharedTree } from '@gjsify/adwaita-web'; // also registers the custom elements + self-injects the stylesheet
// A showcase is served to whatever browser opens it, so it cannot assume the host has
// Adwaita Sans the way a GNOME desktop does. `import '@gjsify/adwaita-web'` names the
// family and ships no `@font-face`, so without this call the chrome renders in the host's
// default sans on macOS, on Windows and on any Linux that is not GNOME — and looks right
// only on the machine it was written on.
import { applyAdwaitaFonts } from '@gjsify/adwaita-web/fonts';
import tree from '../gjs/teapot-window.blp?shared-tree';
import {
    start,
    TESS_VALUES,
    SHADING_VALUES,
    DEFAULT_TESS_INDEX,
    DEFAULT_SHADING_INDEX,
    type TeapotDemo,
} from '../three-demo.js';

// Idempotent, and a no-op where there is no `document` — so a build-time import of this
// module (the website slideshow does one) neither throws nor half-applies.
applyAdwaitaFonts();

export interface MountOptions {
    /** Base path for loading texture assets (forwarded to three-demo). */
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
    if (el === null) throw new Error(`teapot-window.blp declares no object with the id "${id}"`);
    return el;
}

/**
 * Mounts the teapot window's shared tree into `container`.
 *
 * The two combo rows' models are not in the tree: on GTK they are `Gtk.StringList`s the window's
 * TypeScript builds (`teapot-window.ts`), and Blueprint has no spelling for a list model here. The
 * browser reads the same `TESS_VALUES` / `SHADING_VALUES` / `DEFAULT_*_INDEX` from `three-demo.ts`
 * and writes them onto the rows, so the lists themselves have one source; only the wiring is copied.
 */
export function mount(container: HTMLElement, options?: MountOptions): ShowcaseHandle {
    const { root: win } = mountSharedTree(tree, container);

    const tessRow = byId(win, 'tessRow');
    const shadingRow = byId(win, 'shadingRow');
    for (const [row, values, selected] of [
        [tessRow, TESS_VALUES.map(String), DEFAULT_TESS_INDEX],
        [shadingRow, [...SHADING_VALUES], DEFAULT_SHADING_INDEX],
    ] as const) {
        row.setAttribute('model', JSON.stringify(values));
        row.setAttribute('selected', String(selected));
    }
    const lidRow = byId(win, 'lidRow');
    const bodyRow = byId(win, 'bodyRow');
    const bottomRow = byId(win, 'bottomRow');
    const fitLidRow = byId(win, 'fitLidRow');
    const nonblinnRow = byId(win, 'nonblinnRow');
    const pauseBtn = byId(win, 'pauseButton');

    // Inline styles so the layout holds in the website embed too, which loads no showcase CSS.
    const glContainer = byId(win, 'glAreaContainer');
    glContainer.style.cssText = 'flex:1;position:relative;min-width:0;min-height:0';

    const canvas = document.createElement('canvas');
    canvas.id = 'webgl-canvas';
    canvas.style.cssText = 'display:block;width:100%;height:100%;position:absolute;inset:0';
    glContainer.append(canvas);

    // Also covers a slide becoming visible after `display: none`, which reports a size for the first
    // time.
    canvas.width = glContainer.clientWidth;
    canvas.height = glContainer.clientHeight;

    let demo: TeapotDemo | null = null;
    // Buffers pause() calls that arrive before the demo exists.
    let pendingPause = false;
    new ResizeObserver(() => {
        const w = glContainer.clientWidth;
        const h = glContainer.clientHeight;
        if (w > 0 && h > 0) {
            canvas.width = w;
            canvas.height = h;
            if (!demo) {
                demo = start(canvas, { assetBase: options?.assetBase });
                connectControls(
                    demo,
                    tessRow as AdwRow,
                    shadingRow as AdwRow,
                    lidRow as AdwRow,
                    bodyRow as AdwRow,
                    bottomRow as AdwRow,
                    fitLidRow as AdwRow,
                    nonblinnRow as AdwRow,
                );
                if (pendingPause) {
                    demo.pause();
                    pendingPause = false;
                }
            } else {
                demo.render();
            }
        }
    }).observe(glContainer);

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

// Adwaita web components expose custom properties (.selected, .active) not in HTMLElement types.
type AdwRow = HTMLElement & Record<string, unknown>;

function connectControls(
    demo: TeapotDemo,
    tessRow: AdwRow,
    shadingRow: AdwRow,
    lidRow: AdwRow,
    bodyRow: AdwRow,
    bottomRow: AdwRow,
    fitLidRow: AdwRow,
    nonblinnRow: AdwRow,
) {
    tessRow.addEventListener('notify::selected', () => {
        demo.effectController.newTess = TESS_VALUES[tessRow.selected as number];
        demo.render();
    });

    shadingRow.addEventListener('notify::selected', () => {
        demo.effectController.newShading = SHADING_VALUES[shadingRow.selected as number];
        demo.render();
    });

    const toggleRows: Array<[AdwRow, 'lid' | 'body' | 'bottom' | 'fitLid' | 'nonblinn']> = [
        [lidRow, 'lid'],
        [bodyRow, 'body'],
        [bottomRow, 'bottom'],
        [fitLidRow, 'fitLid'],
        [nonblinnRow, 'nonblinn'],
    ];
    for (const [row, key] of toggleRows) {
        row.addEventListener('notify::active', () => {
            demo.effectController[key] = Boolean(row.active);
            demo.render();
        });
    }
}
