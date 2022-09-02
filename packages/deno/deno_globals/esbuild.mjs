import { build as _build } from 'esbuild';
import { gjsify, EXTERNALS_NODE } from '@gjsify/esbuild-plugin-gjsify';
import { readFile } from 'fs/promises';

const baseConfig = {
    entryPoints: ['src/index.ts'],
    bundle: true,
    minify: false,
    sourcemap: false,
    platform: "browser",
    external: [...EXTERNALS_NODE, 'gi://*'],
}

const build = async () => {
    const pkg  = JSON.parse(
        await readFile(
          new URL('./package.json', import.meta.url)
        )
    );

    if (!pkg.module) {
        throw new Error("package.json: The module properties are required!");
    }

    await _build({
        ...baseConfig,
        outfile: pkg.module,
        format: 'esm',
    });

    await _build({
        ...baseConfig,
        entryPoints: ['src/test.ts'],
        outfile: 'test.gjs.js',
        plugins: [
            gjsify({debug: false}),
        ]
    });

    await _build({
        ...baseConfig,
        entryPoints: ['src/test.ts'],
        outfile: 'test.deno.js',
        format: 'esm',
        plugins: [
            gjsify({debug: false}),
        ]
    });
}

build();