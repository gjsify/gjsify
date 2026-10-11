import type { NativeScriptConfig } from '@nativescript/core';

export default {
    // Its own id, never shared: a device this runs on also carries the other NS apps of
    // this repo (`org.gjsify.NsTest`, `org.gjsify.AdwaitaGalleryXml`, …) and an install
    // REPLACES whatever holds the id.
    id: 'org.gjsify.NsGiTest',
    appPath: 'app',
    appResourcesPath: 'App_Resources',
    // Vite, through @gjsify/nativescript-vite's `defineNativescriptConfig()` — the same
    // composer the polyfill suite and the NS showcases use. Load-bearing here for one
    // reason beyond bundling: it sets `resolve.conditions` to include `nativescript`, so
    // `@gjsify/node-gi`'s `#host` import resolves to `host.nativescript.js` rather than
    // the Node host, which is what reaches `libnode_gi.so` through the NS module loader.
    bundler: 'vite',
    bundlerConfigPath: 'vite.config.ts',
    android: {
        v8Flags: '--expose_gc',
        markingMode: 'none',
    },
} as NativeScriptConfig;
