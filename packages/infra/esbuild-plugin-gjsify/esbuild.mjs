import { build } from 'esbuild';
import { EXTERNALS_NODE } from '@gjsify/resolve-npm';

// Build main plugin bundle
await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    minify: false,
    platform: 'node',
    format: 'esm',
    outfile: 'dist/esm/index.mjs',
    external: [
        ...EXTERNALS_NODE,
        'typescript',
        '@deepkit/type-compiler',
        'esbuild',
        '@gjsify/esbuild-plugin-transform-ext',
        '@gjsify/esbuild-plugin-deepkit',
    ],
    banner: {
        js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
    },
});

// Build GJS console shim — standalone file injected into GJS bundles at build time.
// Must be ESM with a named export `console` for esbuild's inject feature.
await build({
    entryPoints: ['src/shims/console-gjs.ts'],
    bundle: false,
    minify: false,
    platform: 'neutral',
    format: 'esm',
    outfile: 'dist/shims/console-gjs.js',
});
