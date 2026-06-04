import { defineNativescriptConfig } from '@gjsify/nativescript-vite';

// Whole Vite config for the NativeScript build. `defineNativescriptConfig`
// composes @nativescript/vite, fixes the two constructs Vite 8 / Rolldown
// reject, and layers gjsify's NativeScript transforms.
//
// The second argument is merged in last: @nativescript/canvas-polyfill
// `require()`s @nativescript/audio-context / @nativescript/canvas-media inside a
// try/catch; a canvas/WebGL-only app like this teapot never executes them, so
// mark them external to keep them out of the bundle.
export default defineNativescriptConfig(
    {},
    {
        build: { rollupOptions: { external: [/@nativescript\/audio-context/, /@nativescript\/canvas-media/] } },
    },
);
