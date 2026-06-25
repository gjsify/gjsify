import type { NativeScriptConfig } from '@nativescript/core';

export default {
    id: 'studio.artandcode.gjsify.adwaita',
    appPath: 'app',
    appResourcesPath: 'App_Resources',
    // Use Vite as the bundler. The actual Vite config (vite.config.ts) is
    // @gjsify/nativescript-vite's `defineNativescriptConfig()`, which composes
    // @nativescript/vite (here the Vite 8 / Rolldown / HMR `8.x` line) and layers
    // gjsify's NativeScript transforms. On the 8.x line, gjsify's applyVite8Fixes
    // patches reduce to a no-op (upstream handles Vite 8 / Rolldown natively).
    bundler: 'vite',
    bundlerConfigPath: 'vite.config.ts',
    android: {
        v8Flags: '--expose_gc',
        markingMode: 'none',
    },
} as NativeScriptConfig;
