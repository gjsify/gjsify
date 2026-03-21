// import { globPlugin } from 'esbuild-plugin-glob';
import { build } from 'esbuild';
import { readFile } from 'fs/promises';
import { extname, dirname } from 'path';

export const EXTERNALS_NODE = [
    'assert',
    'assert/strict',
    'async_hooks',
    'buffer',
    'child_process',
    'cluster',
    'console',
    'constants',
    'crypto',
    'dgram',
    'diagnostics_channel',
    'dns',
    'dns/promises',
    'domain',
    'events',
    'fs',
    'fs/promises',
    'http',
    'http2',
    'https',
    'inspector',
    'module',
    'net',
    'os',
    'path',
    'path/common',
    'path/glob',
    'path/posix',
    'path/separator',
    'path/win32',
    'perf_hooks',
    'process',
    'punycode',
    'querystring',
    'readline',
    'readline/promises',
    'repl',
    'stream',
    'stream/web',
    'stream/consumers',
    'stream/promises',
    'string_decoder',
    'sys',
    'test',
    'timers',
    'timers/promises',
    'tls',
    'tty',
    'url',
    'util',
    'util/types',
    'v8',
    'vm',
    'wasi',
    'worker_threads',
    'zlib',
];

const pkg = JSON.parse(
    await readFile(
      new URL('./package.json', import.meta.url), 'utf8'
    )
);

if (!pkg.main && !pkg.module) {
    throw new Error("package.json: The main or module property is required!");
}

const baseConfig = {
    entryPoints: ['mod.ts'],
    bundle: true,
    minify: false,
    external: [
        ...EXTERNALS_NODE,
        'typescript',
        '@deepkit/type-compiler',
        'esbuild',
        // '@gjsify/resolve-npm', can't be required in cjs builds
        '@gjsify/esbuild-plugin-transform-ext',
        '@gjsify/esbuild-plugin-gjsify',
        '@gjsify/esbuild-plugin-deepkit',
    ],
    // plugins: [
    //     globPlugin(),
    // ]
}

// CJS
if (pkg.main) {
    build({
        ...baseConfig,
        outdir: dirname(pkg.main),
        format: 'cjs',
        outExtension: {'.js': extname(pkg.main)},
        platform: "node",
    });    
}

// ESM
if (pkg.module) {
    build({
        ...baseConfig,
        outdir: dirname(pkg.module),
        format: 'esm',
        outExtension: {'.js': extname(pkg.module)},
    });
}

// Test
build({
    ...baseConfig,
    entryPoints: ['run-tests.ts', 'mod_test.ts'],
    outdir: '.',
    format: 'esm',
    outExtension: {'.js': '.mjs'},
});