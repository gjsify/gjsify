import { build as _build } from 'esbuild';
import { gjsify, EXTERNALS_NODE } from '@gjsify/esbuild-plugin-gjsify';
import { readFile } from 'fs/promises';

const baseConfig = {
    entryPoints: ['src/index.ts'],
    bundle: true,
    minify: false,
    sourcemap: false,
    platform: "browser"
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
        external: ['gi://*'],
        outfile: pkg.module,
        format: 'esm',
    });

    await _build({
        ...baseConfig,
        external: ['gi://*'],
        platform: "browser",
        entryPoints: ['src/test.ts'],
        outfile: 'test.gjs.js',
        plugins: [
            gjsify({debug: true, platform: 'gjs'}),
        ]
    });

    await _build({
        ...baseConfig,
        external: [...EXTERNALS_NODE, 'gi://*'],
        platform: "browser",
        entryPoints: ['src/test.ts'],
        outfile: 'test.node.cjs',
        format: 'cjs'
    });
}

build();