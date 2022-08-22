import { build as _build } from 'esbuild';
import { gjsify, NODE_EXTERNALS } from '@gjsify/esbuild-plugin-gjsify';
import { readFile } from 'fs/promises';

const baseConfig = {
    entryPoints: ['src/index.ts'],
    bundle: true,
    minify: false,
    sourcemap: true,
    platform: "browser",
    external: [...NODE_EXTERNALS, 'gi://*'],
}

const build = async () => {
    const pkg  = JSON.parse(
        await readFile(
          new URL('./package.json', import.meta.url)
        )
    );

    if (!pkg.module) {
        throw new Error("package.json: The module properties is required!");
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
        outfile: 'test.node.cjs',
        format: 'cjs',
        platform: 'node'
    });
}

build();