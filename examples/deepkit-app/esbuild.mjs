import { build } from "esbuild";
import { deepkit } from '@gjsify/esbuild-plugin-deepkit';
import { gjsify } from '@gjsify/esbuild-plugin-gjsify';

await build({
    entryPoints: ['src/index.ts'],
    outfile: 'dist/index.js',
    plugins: [
        gjsify({}, { debug: true }),
        deepkit(),
    ],
})