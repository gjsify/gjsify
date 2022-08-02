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

    if (!pkg.main && !pkg.module) {
        throw new Error("package.json: The main or module properties are required!");
    }

    // if (pkg.main) {
    //     await _build({
    //         ...baseConfig,
    //         outfile: pkg.main,
    //         format: 'cjs',
    //     });    
    // }

    if (pkg.module) {
        await _build({
            ...baseConfig,
            outfile: pkg.module,
            format: 'esm',
        });
    }

    if (pkg.test) {
        await _build({
            ...baseConfig,
            entryPoints: ['src/test.ts'],
            outfile: pkg.test,
            plugins: [
                gjsify({debug: true}),
            ]
        })
    }
}

build();