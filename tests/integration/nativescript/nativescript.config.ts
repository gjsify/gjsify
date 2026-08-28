import type { NativeScriptConfig } from '@nativescript/core';

export default {
    id: 'org.gjsify.NsTest',
    appPath: 'app',
    appResourcesPath: 'App_Resources',
    // Build through Vite → @gjsify/nativescript-vite's `defineNativescriptConfig()`
    // (vite.config.ts), which makes @nativescript/vite build under Vite 8 / Rolldown
    // and layers gjsify's NativeScript transforms — the same path proven on the
    // three.js teapot showcase.
    bundler: 'vite',
    bundlerConfigPath: 'vite.config.ts',
    android: {
        v8Flags: '--expose_gc',
        markingMode: 'none',
    },
} as NativeScriptConfig;
