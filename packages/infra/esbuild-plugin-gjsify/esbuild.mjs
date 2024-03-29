import { build } from 'esbuild';
import { readFile } from 'fs/promises';
import { extname, dirname } from 'path';
import { EXTERNALS_NODE } from '@gjsify/resolve-npm';

const pkg = JSON.parse(
    await readFile(
      new URL('./package.json', import.meta.url), 'utf8'
    )
);

if (!pkg.main && !pkg.module) {
    throw new Error("package.json: The main or module property is required!");
}

const baseConfig = {
    entryPoints: ['src/index.ts'],
    bundle: true,
    minify: false,
    platform: "node",
    external: [
        ...EXTERNALS_NODE,
        'typescript',
        '@deepkit/type-compiler',
        'esbuild',
        // '@gjsify/resolve-npm', can't be required in cjs builds
        '@gjsify/esbuild-plugin-transform-ext',
        '@gjsify/esbuild-plugin-deno-loader',
        '@gjsify/esbuild-plugin-deepkit',
    ]
}

if (pkg.main) {
    build({
        ...baseConfig,
        outdir: dirname(pkg.main),
        format: 'cjs',
        outExtension: {'.js': extname(pkg.main)},
    });    
}

if (pkg.module) {
    build({
        ...baseConfig,
        outdir: dirname(pkg.module),
        format: 'esm',
        outExtension: {'.js': extname(pkg.module)},
    });
}