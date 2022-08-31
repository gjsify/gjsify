import { build as _build } from 'esbuild';
import { join, dirname, basename } from 'path';
import { gjsify } from '@gjsify/esbuild-plugin-gjsify';
import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const NODE_PACKAGES = [
    'cluster',
    'domain',
    'stream',
    'util',
    'assertion_error',
    'console',
    'module',
    'process',
    'v8',
    'assert',
    'constants',
    'events',
    'https',
    'net',
    'punycode',
    'string_decoder',
    'tty',
    'async_hooks',
    'fs',
    'sys',
    'vm',
    'http',
    'querystring',
    'upstream_modules',
    'wasi',
    'crypto',
    'inspector',
    'os',
    'timers',
    'buffer',
    'dgram',
    'global',
    'path',
    'readline',
    'url',
    'worker_threads',
    'diagnostics_channel',
    'http2',
    'module_all',
    'repl',
    'zlib',
    'child_process',
    'dns',
    'module_esm',
    'perf_hooks',
    'tls',
];

const NOT_REAL_NODE_PACKAGES = ['global'];

const NODE_ENTRIES = NODE_PACKAGES.map(name => `./original/node/${name}.ts`);
const NODE_ENTRIES_IMPORTS = NODE_PACKAGES.map(name => `./${name}.ts`);

const FILE_EXTENSION_REGEX = /\.(js|cjs|mjs|ts|mts|cts|tsx)$/;


const buildNodeModules = async () => {
    const pkg = JSON.parse(
        await readFile(
            new URL('./package.json', import.meta.url)
        )
    );

    if (!pkg.module) {
        throw new Error("package.json: The module properties are required!");
    }

    await _build({
        entryPoints: NODE_ENTRIES,
        outdir: 'lib/node',
        bundle: true,
        minify: false,
        sourcemap: false,
        platform: "browser",
        loader: {
            '.ts': 'ts',
            '.mts': 'ts',
            '.cts': 'ts',
            '.tsx': 'ts',
            '.mtsx': 'ts',
            '.ctsx': 'ts',
        },

        // "firefox60" // Since GJS 1.53.90
        // "firefox68" // Since GJS 1.63.90
        // "firefox78" // Since GJS 1.65.90
        // "firefox91" // Since GJS 1.71.1
        // "firefox102" // Since GJS 1.73.2
        target: ['firefox91'],

        // external: [...NODE_ENTRIES_IMPORTS, 'gi://*'],

        format: 'esm',
        plugins: [
            {
                name: 'esbuild-deno-loader-plugin',
                setup(build) {
                    build.onResolve({ filter: FILE_EXTENSION_REGEX }, async (args )=> {
                        let isEntryImport = false;
                        const absolutePath = join(args.resolveDir, args.path);
                        const dir = dirname(absolutePath);
                        const base = basename(absolutePath);
                        let resolvedPath = join(args.resolveDir, args.path);
                        let pkgName = '';
                        let npmPkgImport = '';
                        let namespace = 'file';

                        const isEntryPoint = NODE_ENTRIES.includes(args.path);

                        if(isEntryPoint) {
                            return {
                                path: absolutePath,
                                external: false,
                                namespace,
                            }
                        }

                        if(dir.endsWith('original/node')) {
                            pkgName = basename(absolutePath).split('.')[0]
                            if(NODE_PACKAGES.includes(pkgName)) {
                                isEntryImport = true;
                            }
                        }

                        if(isEntryImport) {
                            npmPkgImport = `@gjsify/deno_std/node/${pkgName}`;
                            resolvedPath = npmPkgImport;
                            namespace = npmPkgImport;
                        }

                        return {
                            path: resolvedPath,
                            external: isEntryImport,
                            namespace: namespace,
                        }
                    });
                }
            }
        ]
    });
}

const generateNodeTypeDefinitions = async () => {
    for (const pkgName of NODE_PACKAGES) {
        // TODO build this types with tsc?
        if(NOT_REAL_NODE_PACKAGES.includes(pkgName)) {
            continue
        }

        const path = join(__dirname, 'lib/node/', pkgName + '.d.ts');

        let content = '';
        if(pkgName === 'constants') {
            content = `import * as constants from 'constants';export = constants;`
        } else {
            content = `export * from '${pkgName}';`;
        }

        await writeFile(path, content);
    }
}

await buildNodeModules();
await generateNodeTypeDefinitions();