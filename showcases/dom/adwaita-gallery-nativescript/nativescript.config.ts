import type { NativeScriptConfig } from '@nativescript/core';

export default {
    id: 'org.gjsify.AdwaitaGalleryXml',
    appPath: 'app',
    appResourcesPath: 'App_Resources',
    // Vite, through @gjsify/nativescript-vite's `defineNativescriptConfig()` — the
    // same composer the storybook showcase beside this one uses. Its
    // xmlns-barrel registration is load-bearing HERE and nowhere else in this repo:
    // every template names `xmlns:adw="~/adw"` or `xmlns:gtk="~/gtk"`, and neither
    // barrel has an `.xml` sibling, so upstream's bundler context would not register
    // them.
    bundler: 'vite',
    bundlerConfigPath: 'vite.config.ts',
    android: {
        v8Flags: '--expose_gc',
        markingMode: 'none',
    },
} as NativeScriptConfig;
