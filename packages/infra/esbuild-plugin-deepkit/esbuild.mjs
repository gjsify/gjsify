import { build } from 'esbuild';

await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    minify: true,
    format: 'esm',
    outfile: 'dist/esm/index.mjs',
    external: [
        'fs',
        'fs/promises',
        'util',
        'path',
        'process',
        'typescript',
        '@deepkit/type-compiler',
        'esbuild',
        '@gjsify/esbuild-plugin-transform-ext',
        '@gjsify/esbuild-plugin-gjsify',
    ],
});
