// Whole Vite config for the NativeScript build. `defineNativescriptConfig`
// composes @nativescript/vite, fixes the two constructs Vite 8 / Rolldown reject
// (function-replacement aliases dropped, @rollup/plugin-commonjs removed), then
// layers gjsify's NativeScript transforms (gi://→empty, platform resolution,
// __ANDROID__/__IOS__/__DEV__ defines, node-builtin alias routing).
import { defineNativescriptConfig } from '@gjsify/nativescript-vite';
import { fileURLToPath } from 'node:url';

// `@nativescript/core`'s CSS parser pulls in `css-tree`, whose `data.js` /
// `data-patch.js` / `version.js` load their data via `createRequire(import.meta.url)`
// (`mdn-data/*.json`, `../package.json`). Rolldown can't statically resolve those
// dynamic requires, so they survive into the bundle and throw on the NativeScript
// V8 runtime ("Module evaluation promise rejected"). css-tree ships a
// self-contained `dist/csstree.esm.js` with the data inlined (no `createRequire`);
// aliasing the bare `css-tree` specifier to it keeps those requires out of the
// bundle. This belongs in `gjsifyNativescript()` so every NS app gets it — tracked
// as a follow-up in STATUS.md; carried here meanwhile.
const cssTree = fileURLToPath(new URL('./node_modules/css-tree/dist/csstree.esm.js', import.meta.url));

export default defineNativescriptConfig(
    {},
    {
        resolve: { alias: { 'css-tree': cssTree } },
    },
);
