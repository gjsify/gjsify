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
    format: 'esm',
}

const build = async () => {
    const pkg  = JSON.parse(
        await readFile(
          new URL('./package.json', import.meta.url)
        )
    );

    if (!pkg.module || !pkg.main) {
        throw new Error("package.json: The module or main property is required!");
    }

    if (pkg.module) {
        await _build({
            ...baseConfig,
            outfile: pkg.module,
            format: 'esm',
        });
    }

    if (pkg.main) {
        await _build({
            ...baseConfig,
            platform: 'node',
            outfile: pkg.main,
            format: 'cjs',
        });
    }

    await _build({
        ...baseConfig,
        entryPoints: ['src/test.ts'],
        outfile: 'test.gjs.js',
        plugins: [
            gjsify({debug: true}),
        ]
    });

    await _build({
        ...baseConfig,
        entryPoints: ['src/test.ts'],
        outfile: 'test.node.js',
        format: 'esm',
        platform: 'node'
    });
}

build();