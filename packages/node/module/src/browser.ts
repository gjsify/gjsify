// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target.
//
// Reference: refs/node/lib/internal/modules/cjs/loader.js (surface mirror)
//
// Slot: "browser:partial" — `builtinModules`/`isBuiltin` work; `createRequire`
// returns a function that throws ERR_MODULE_NOT_FOUND for every specifier.
// Matches what `vite-plugin-node-polyfills` ships for `module`.
//
// `node:module` in the browser is a partial stub. We expose:
//   - `builtinModules` as an empty array (no built-ins resolvable from a
//     browser bundle — every Node built-in is statically aliased at build
//     time by `--app browser`).
//   - `isBuiltin(name)` returns `false` (consistent with builtinModules=[]).
//   - `createRequire(url)` returns a function that throws ERR_MODULE_NOT_FOUND
//     for any specifier it's called with. The function carries the `cache`,
//     `extensions`, `resolve` properties Node's `require` has so static
//     property-reads don't crash before the call hits.
//   - `syncBuiltinESMExports()` no-op.
//
// `node-stdlib-browser` lists `module` as `(none)`; `vite-plugin-node-polyfills`
// ships exactly this minimal shape so that npm packages that *probe* for
// `createRequire` (typescript, ts-node, …) at bundle time don't blow up.

type ErrnoLike = Error & { code?: string; requireStack?: string[] };

function moduleNotFound(specifier: string): ErrnoLike {
    const err: ErrnoLike = new Error(
        `Cannot find module '${specifier}' from the browser bundle — Node 'require' is not available in this runtime. Use ES module imports instead.`,
    );
    err.code = 'ERR_MODULE_NOT_FOUND';
    return err;
}

export const builtinModules: string[] = [];
export const isBuiltin = (_name: string): boolean => false;

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
        throw moduleNotFound(specifier);
    }) as BrowserRequireFn;
    requireFn.resolve = Object.assign(
        (specifier: string, _opts?: { paths?: string[] }): string => {
            throw moduleNotFound(specifier);
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
        throw moduleNotFound(specifier);
    }
    static builtinModules: string[] = [];
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
