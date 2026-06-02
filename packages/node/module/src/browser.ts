// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target.
//
// Reference: refs/node/lib/internal/modules/cjs/loader.js (surface mirror)
//
// Slot: "browser:partial" — `builtinModules`/`isBuiltin` work (they report the
// real Node built-in set, same as the GJS impl); `createRequire` returns a
// function that throws because a browser ESM bundle has no synchronous CommonJS
// `require`. Matches what `vite-plugin-node-polyfills` ships for `module`.
//
// `node:module` in the browser is a partial stub. We expose:
//   - `builtinModules` — the canonical Node built-in name list (same as the GJS
//     impl). `module.builtinModules` is a static catalog in Node, independent of
//     whether a given runtime can resolve a built-in, so reporting the real list
//     is the honest answer (`isBuiltin('fs') === true` matches every other
//     runtime). The names themselves are statically aliased at build time by
//     `--app browser`.
//   - `isBuiltin(name)` — subpath-aware membership test against `builtinModules`
//     (`fs`, `node:fs`, `fs/promises` → true; npm packages → false).
//   - `createRequire(url)` returns a function that throws when called: built-in
//     specifiers throw ERR_REQUIRE_ESM (a browser ESM bundle can't synchronously
//     require a built-in), everything else throws ERR_MODULE_NOT_FOUND. The
//     function carries the `cache`, `extensions`, `resolve` properties Node's
//     `require` has so static property-reads don't crash before the call hits.
//   - `syncBuiltinESMExports()` no-op.
//
// `node-stdlib-browser` lists `module` as `(none)`; `vite-plugin-node-polyfills`
// ships a comparable minimal shape so that npm packages that *probe* for
// `createRequire` (typescript, ts-node, …) at bundle time don't blow up.

type ErrnoLike = Error & { code?: string; requireStack?: string[] };

function moduleNotFound(specifier: string): ErrnoLike {
    const err: ErrnoLike = new Error(
        `Cannot find module '${specifier}' from the browser bundle — Node 'require' is not available in this runtime. Use ES module imports instead.`,
    );
    err.code = 'ERR_MODULE_NOT_FOUND';
    return err;
}

function requireEsm(specifier: string): ErrnoLike {
    const err: ErrnoLike = new Error(
        `Cannot require built-in module '${specifier}' synchronously from a browser ESM bundle. Use 'import' (or its async dynamic form) instead.`,
    );
    err.code = 'ERR_REQUIRE_ESM';
    return err;
}

// Canonical Node built-in catalog (mirrors the GJS impl's list). Kept as a
// static list because `module.builtinModules` is a fixed catalog in Node —
// browser resolvability does not change which names ARE built-ins.
export const builtinModules: string[] = [
    'assert',
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
    'domain',
    'events',
    'fs',
    'http',
    'http2',
    'https',
    'inspector',
    'module',
    'net',
    'os',
    'path',
    'perf_hooks',
    'process',
    'punycode',
    'querystring',
    'readline',
    'repl',
    'stream',
    'string_decoder',
    'sys',
    'timers',
    'tls',
    'tty',
    'url',
    'util',
    'v8',
    'vm',
    'wasi',
    'worker_threads',
    'zlib',
];

export const isBuiltin = (name: string): boolean => {
    if (!name) return false;
    const n = name.startsWith('node:') ? name.slice(5) : name;
    const base = n.split('/')[0];
    return builtinModules.includes(n) || builtinModules.includes(base);
};

// Minimal NodeRequire-shaped function (subset). Bundles that statically
// reference `require.resolve(...)` will get an ENOTFOUND for any specifier;
// bundles that only read the prop surface (`require.cache`) get a plain object.
interface BrowserRequireFn {
    (id: string): unknown;
    resolve: ((req: string, _opts?: { paths?: string[] }) => string) & {
        paths: (_req: string) => string[] | null;
    };
    cache: Record<string, unknown>;
    extensions: Record<string, unknown>;
    main: undefined;
}

export function createRequire(_filename: string | URL): BrowserRequireFn {
    const requireFn = ((specifier: string): unknown => {
        throw isBuiltin(specifier) ? requireEsm(specifier) : moduleNotFound(specifier);
    }) as BrowserRequireFn;
    requireFn.resolve = Object.assign(
        (specifier: string, _opts?: { paths?: string[] }): string => {
            throw isBuiltin(specifier) ? requireEsm(specifier) : moduleNotFound(specifier);
        },
        { paths: (_req: string): string[] | null => null },
    );
    requireFn.cache = Object.create(null) as Record<string, unknown>;
    requireFn.extensions = Object.create(null) as Record<string, unknown>;
    requireFn.main = undefined;
    return requireFn;
}

// Node also exposes `Module` as a constructor for the CJS loader internals;
// in the browser there's no useful behaviour, so we ship a stub that
// satisfies `instanceof Module` probes without any state.
export class Module {
    id: string;
    filename: string | null = null;
    loaded = false;
    parent: Module | null = null;
    children: Module[] = [];
    exports: Record<string, unknown> = {};
    paths: string[] = [];
    constructor(id = '', parent: Module | null = null) {
        this.id = id;
        this.parent = parent;
    }
    require(specifier: string): never {
        throw isBuiltin(specifier) ? requireEsm(specifier) : moduleNotFound(specifier);
    }
    static builtinModules: string[] = builtinModules;
    static isBuiltin: typeof isBuiltin = isBuiltin;
    static createRequire: typeof createRequire = createRequire;
    static syncBuiltinESMExports(): void {}
    static findSourceMap(): undefined {
        return undefined;
    }
}

export const syncBuiltinESMExports = (): void => {};

// `findSourceMap` is a noop in the browser bundle (no source-map registry).
export const findSourceMap = (): undefined => undefined;

export default Module;
