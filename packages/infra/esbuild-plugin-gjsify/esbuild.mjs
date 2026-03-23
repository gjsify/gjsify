import { build } from 'esbuild';
import { EXTERNALS_NODE } from '@gjsify/resolve-npm';

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
