import { build as _build } from 'esbuild';
import { EXTERNALS_NODE } from '@gjsify/esbuild-plugin-gjsify';

// Special build for the node test
await _build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    minify: false,
    sourcemap: false,
    external: [...EXTERNALS_NODE, 'gi://*'],
    platform: "browser",
    entryPoints: ['src/test.ts'],
    outfile: 'test.node.cjs',
    format: 'cjs'
});