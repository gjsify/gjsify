import { build } from 'esbuild';
import { readFile } from 'fs/promises';

const pkg  = JSON.parse(
    await readFile(
      new URL('./package.json', import.meta.url)
    )
);

const baseConfig = {
    entryPoints: ['src/index.ts'],
    bundle: true,
    minify: true,
    external: [
        'fs',
        'fs/promises',
        'util',
        'path',
        'process',
        'util',
        'typescript',
        '@deepkit/type-compiler',
        'esbuild',
        // '@gjsify/resolve-npm', can't be required in cjs builds
        '@gjsify/esbuild-plugin-transform-ext',
        '@gjsify/esbuild-plugin-deno-loader',
        '@gjsify/esbuild-plugin-gjsify',
    ]
}

if(pkg.main) {
    build({
        ...baseConfig,
        outfile: pkg.main,
        format: 'cjs',
        platform: "node",
    });
}

if(pkg.main) {
    build({
        ...baseConfig,
        outfile: pkg.module,
        format: 'esm',
    });
}