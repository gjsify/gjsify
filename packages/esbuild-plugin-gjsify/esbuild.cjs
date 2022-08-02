const esbuild = require('esbuild');
const pkg = require('./package.json');

if (!pkg.main && !pkg.module) {
    throw new Error("package.json: The main or module properties are required!");
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

// if (pkg.main) {
//     esbuild.build({
//         ...baseConfig,
//         outfile: pkg.main,
//         format: 'cjs',
//         platform: "node",
//     });    
// }

if (pkg.module) {
    esbuild.build({
        ...baseConfig,
        outfile: pkg.module,
        format: 'esm',
    });
}