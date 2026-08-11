import { defineNativescriptConfig } from '@gjsify/nativescript-vite';

// `defineNativescriptConfig` composes @nativescript/vite, layers gjsify's NativeScript transforms
// and — on the 2.x line this showcase pins — fixes the two constructs Rolldown rejects.
//
// The second argument merges in last. @nativescript/canvas-polyfill `require()`s
// @nativescript/audio-context and @nativescript/canvas-media inside a try/catch, which a
// canvas/WebGL-only app never executes, so they are external and stay out of the bundle.
export default defineNativescriptConfig(
    {},
    {
        build: { rollupOptions: { external: [/@nativescript\/audio-context/, /@nativescript\/canvas-media/] } },
    },
);
