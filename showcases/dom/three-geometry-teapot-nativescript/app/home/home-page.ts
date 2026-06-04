// NativeScript code-behind for the teapot page. Reuses the platform-agnostic
// seam `../three-demo` UNCHANGED (the same `start(canvas)` that runs on GNOME +
// browser). The only NS-specific work is feeding it the native
// @nativescript/canvas element + a file:// asset base rooted at the bundled app.

import { knownFolders, type NavigatedData } from '@nativescript/core';
import { start, type TeapotDemo } from '../three-demo';

export function onNavigatingTo(_args: NavigatedData) {
    // no-op
}

let demo: TeapotDemo | undefined;

// `ready` fires with the native Canvas as `args.object`. @nativescript/canvas's
// element is HTMLCanvas-shaped at runtime (the canvas-polyfill imported first in
// app.ts fills the rest), so three's WebGLRenderer({ canvas }) accepts it.
// oxlint-disable-next-line typescript/no-explicit-any -- the NS `ready` event payload is untyped; `args.object` is the native Canvas
export function onCanvasReady(args: any) {
    try {
        const canvas = args.object;

        // Assets (uv_grid_opengl.jpg + pisa/*.png cube map) are bundled under app/.
        const appPath = knownFolders.currentApp().path;
        const assetBase = `file://${appPath}/`;
        console.log('[teapot] assetBase', assetBase);

        // three-demo creates its own WebGLRenderer({ canvas }) → three.js asks the
        // canvas for a webgl2 context (proven to work on @nativescript/canvas).
        demo = start(canvas, { assetBase });
        demo.render();
        console.log('[teapot] started + first render');
    } catch (e) {
        console.log('[teapot] ERROR', e, (e as Error | undefined)?.stack);
    }
}
