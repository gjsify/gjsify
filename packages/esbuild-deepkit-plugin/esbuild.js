const esbuild = require('esbuild');
const pkg = require('./package.json');

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
        '@deepkit/type-compiler',
    ]
}

esbuild.build({
    ...baseConfig,
    outfile: pkg.main,
    format: 'cjs',
    platform: "node",
});

esbuild.build({
    ...baseConfig,
    outfile: pkg.module,
    format: 'esm',
});