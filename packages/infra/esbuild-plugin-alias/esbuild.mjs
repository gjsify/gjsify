import { build } from 'esbuild';
import { EXTERNALS_NODE } from '@gjsify/resolve-npm';

await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    minify: false,
    format: 'esm',
    outfile: 'dist/esm/index.mjs',
    external: [
        ...EXTERNALS_NODE,
        'typescript',
        '@deepkit/type-compiler',
        'esbuild',
        '@gjsify/esbuild-plugin-deepkit',
        '@gjsify/esbuild-plugin-gjsify',
    ],
});
