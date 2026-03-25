import { build } from 'esbuild';
import { deepkitPlugin } from '@gjsify/esbuild-plugin-deepkit';

build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    minify: true,
    outfile: 'dist/index.js',
    format: 'esm',
    platform: "node",
    external: ['@deepkit/type'],
    plugins: [deepkitPlugin()],
});
