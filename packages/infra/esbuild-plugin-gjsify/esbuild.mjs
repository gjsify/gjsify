import { build } from 'esbuild';
import { EXTERNALS_NODE } from '@gjsify/resolve-npm';

const sharedExternals = [
    ...EXTERNALS_NODE,
    'typescript',
    '@deepkit/type-compiler',
    'esbuild',
    '@gjsify/esbuild-plugin-transform-ext',
    '@gjsify/esbuild-plugin-deepkit',
];

const sharedBanner = {
    js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
};

// Build main plugin bundle
await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    minify: false,
    platform: 'node',
    format: 'esm',
    outfile: 'dist/esm/index.mjs',
    external: sharedExternals,
    banner: sharedBanner,
});

// Build the /globals subpath — public API for the CLI's `--globals` flag
// resolution. Bundled separately so consumers can import only the
// `resolveGlobalsList` + `writeRegisterInjectFile` helpers without pulling
// in the rest of the plugin (alias, deepkit, blueprint, …).
await build({
    entryPoints: ['src/globals.ts'],
    bundle: true,
    minify: false,
    platform: 'node',
    format: 'esm',
    outfile: 'dist/esm/globals.mjs',
    external: sharedExternals,
    banner: sharedBanner,
});

// Build GJS console shim — self-contained file injected into GJS bundles at build time.
// Bundled with @gjsify/console inlined so the plugin has zero @gjsify/* polyfill deps.
// Must be ESM with a named export `console` for esbuild's inject feature.
// Uses alias to resolve from source (console may not be built yet during build:infra).
await build({
    entryPoints: ['src/shims/console-gjs.ts'],
    bundle: true,
    minify: false,
    platform: 'neutral',
    format: 'esm',
    outfile: 'dist/shims/console-gjs.js',
    alias: {
        '@gjsify/console': '../../node/console/src/index.ts',
    },
});
