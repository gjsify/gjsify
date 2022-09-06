import { build } from 'esbuild';
import { readFile } from 'fs/promises';

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
    minify: true,
    external: [
        'fs',
        'util',
        'path',
        'process',
        'util',
        'typescript',
        'module',
        '@deepkit/type-compiler',
    ]
}

if (pkg.main) {
    build({
        ...baseConfig,
        outfile: pkg.main,
        format: 'cjs',
        platform: "node",
    });    
}

if (pkg.module) {
    build({
        ...baseConfig,
        outfile: pkg.module,
        format: 'esm',
    });
}