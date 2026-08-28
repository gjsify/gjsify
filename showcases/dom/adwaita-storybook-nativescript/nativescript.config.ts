import type { NativeScriptConfig } from '@nativescript/core';

export default {
    id: 'org.gjsify.AdwaitaStorybook',
    appPath: 'app',
    appResourcesPath: 'App_Resources',
    // Use Vite as the bundler. The actual Vite config (vite.config.ts) is
    // @gjsify/nativescript-vite's `defineNativescriptConfig()`, which composes
    // @nativescript/vite (the Vite 8 / Rolldown / HMR `8.x` line) and layers
    // gjsify's NativeScript transforms.
    bundler: 'vite',
    bundlerConfigPath: 'vite.config.ts',
    android: {
        v8Flags: '--expose_gc',
        markingMode: 'none',
    },
} as NativeScriptConfig;
