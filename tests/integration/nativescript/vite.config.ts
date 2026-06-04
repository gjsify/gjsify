// Whole Vite config for the NativeScript build. `defineNativescriptConfig`
// composes @nativescript/vite, fixes the two constructs Vite 8 / Rolldown reject
// (function-replacement aliases dropped, @rollup/plugin-commonjs removed), then
// layers gjsify's NativeScript transforms (gi://→empty, platform resolution,
// __ANDROID__/__IOS__/__DEV__ defines, node-builtin alias routing, and the
// css-tree → bundled-dist alias that keeps @nativescript/core's css-tree
// `createRequire` data-loads out of the bundle).
import { defineNativescriptConfig } from '@gjsify/nativescript-vite';

export default defineNativescriptConfig();
