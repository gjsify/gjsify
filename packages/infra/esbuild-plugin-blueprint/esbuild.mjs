import { build } from 'esbuild';
import { EXTERNALS_NODE } from '@gjsify/resolve-npm';

await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    minify: false,
    format: 'esm',
    platform: 'node',
    outfile: 'dist/esm/index.mjs',
    external: [
        ...EXTERNALS_NODE,
        'esbuild',
        'execa',
    ],
});
