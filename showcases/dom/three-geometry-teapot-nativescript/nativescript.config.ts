import type { NativeScriptConfig } from '@nativescript/core';

export default {
    id: 'org.gjsify.Teapot',
    appPath: 'app',
    appResourcesPath: 'App_Resources',
    // Use Vite as the bundler. The actual Vite config (vite.config.ts) is
    // @gjsify/nativescript-vite's `defineNativescriptConfig()`, which makes
    // @nativescript/vite build under Vite 8 / Rolldown + layers gjsify's
    // NativeScript transforms.
    bundler: 'vite',
    bundlerConfigPath: 'vite.config.ts',
    android: {
        v8Flags: '--expose_gc',
        markingMode: 'none',
    },
} as NativeScriptConfig;
