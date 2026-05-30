// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by vm-browserify
// (James Halliday + browserify contributors, MIT).
//
// NOTE: no true context isolation. Browsers do not expose a
// SpiderMonkey/V8 Realm API to userland JS without resorting to <iframe>
// tricks (and even those leak globals). `runInNewContext` here is
// best-effort via `Function`-scope only — sandbox properties are injected
// as local variables, but the code can still reach `globalThis`, `window`,
// `document`, prototype chains and any closure that survives top-level.
// This matches Node's own vm contract: vm is NOT a security boundary.
//
// This file is the browser entry point selected by the package's `"browser"`
// field + `exports."."` `"browser"` condition (Rolldown/Vite browser builds
// honour both via `mainFields:['browser','module','main']` and
// `conditionNames:['import','browser']`).
//
// API coverage (slot: polyfill):
//   - `runInThisContext(code)`        → `eval(code)` in current scope
//   - `runInNewContext(code,sandbox)` → `new Function(...keys, body)(...vals)`
//   - `runInContext(code,sandbox)`    → delegates to `runInNewContext`
//   - `createContext(sandbox?)`       → marks sandbox via Symbol
//   - `isContext(obj)`                → checks the marker
//   - `compileFunction(code,params?)` → `new Function(...params, code)`
//   - `Script` class                  → caches code, replays the above
//
// ENOTSUP (no browser equivalent):
//   - `Module`, `SourceTextModule`, `SyntheticModule`
//   - `measureMemory`, `constants.DONT_CONTEXTIFY`

const contextSymbol = Symbol('vm.context');

function _enotsup(api: string): Error {
    const err = new Error(`@gjsify/vm: ${api} is not supported in the browser polyfill`) as Error & {
        code?: string;
    };
    err.code = 'ENOTSUP';
    return err;
}

// ─── runInThisContext ──────────────────────────────────────────────────────

export function runInThisContext(code: string, _options?: Record<string, unknown>): unknown {
    // Indirect eval keeps execution in the global scope, matching Node's
    // `vm.runInThisContext` semantics (no access to local-scope identifiers
    // from the caller). `(0, eval)(...)` is the canonical indirect-eval form.
    return (0, eval)(code);
}

// ─── runInNewContext / runInContext ────────────────────────────────────────

export function runInNewContext(
    code: string,
    context?: Record<string, unknown>,
    _options?: Record<string, unknown>,
): unknown {
    const sandbox = context || {};
    const keys = Object.keys(sandbox);
    const values = keys.map((k) => sandbox[k]);
    // The `return eval(<json>)` trick keeps `code` in eval-mode so it can
    // contain declarations + statements + a trailing expression — same as
    // Node's vm.runInNewContext.
    const fn = new Function(...keys, `return eval(${JSON.stringify(code)})`);
    return fn(...values);
}

export function runInContext(
    code: string,
    context: Record<string, unknown>,
    _options?: Record<string, unknown>,
): unknown {
    return runInNewContext(code, context);
}

// ─── createContext / isContext ─────────────────────────────────────────────

export function createContext(context?: Record<string, unknown>): Record<string, unknown> {
    const ctx = context || {};
    Object.defineProperty(ctx, contextSymbol, { value: true, enumerable: false });
    return ctx;
}

export function isContext(context: unknown): boolean {
    if (typeof context !== 'object' || context === null) {
        throw new TypeError(
            `The "object" argument must be of type object. Received ${context === null ? 'null' : `type ${typeof context}`}`,
        );
    }
    return (context as Record<symbol, unknown>)[contextSymbol] === true;
}

// ─── compileFunction ───────────────────────────────────────────────────────

export function compileFunction(
    code: string,
    params?: string[],
    _options?: { parsingContext?: Record<string, unknown>; contextExtensions?: object[] },
): Function {
    const paramNames = params || [];
    return new Function(...paramNames, code);
}

// ─── Script ────────────────────────────────────────────────────────────────

export class Script {
    private _code: string;

    constructor(code: string, _options?: Record<string, unknown>) {
        this._code = code;
    }

    runInThisContext(_options?: Record<string, unknown>): unknown {
        return (0, eval)(this._code);
    }

    runInNewContext(context?: Record<string, unknown>, _options?: Record<string, unknown>): unknown {
        return runInNewContext(this._code, context);
    }

    runInContext(context: Record<string, unknown>, _options?: Record<string, unknown>): unknown {
        return runInNewContext(this._code, context);
    }

    createCachedData(): Uint8Array {
        return new Uint8Array(0);
    }
}

// ─── ENOTSUP stubs ─────────────────────────────────────────────────────────

export class Module {
    constructor(_code: string, _options?: Record<string, unknown>) {
        throw _enotsup('vm.Module');
    }
}

export class SourceTextModule {
    constructor(_code: string, _options?: Record<string, unknown>) {
        throw _enotsup('vm.SourceTextModule');
    }
}

export class SyntheticModule {
    constructor(_exportNames: string[], _evaluateCallback: () => void, _options?: Record<string, unknown>) {
        throw _enotsup('vm.SyntheticModule');
    }
}

export function measureMemory(_options?: Record<string, unknown>): Promise<unknown> {
    return Promise.reject(_enotsup('vm.measureMemory'));
}

export const constants = {
    DONT_CONTEXTIFY: Symbol('vm.constants.DONT_CONTEXTIFY'),
    USE_MAIN_CONTEXT_DEFAULT_LOADER: Symbol('vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER'),
};

export default {
    runInThisContext,
    runInNewContext,
    runInContext,
    createContext,
    isContext,
    compileFunction,
    Script,
    Module,
    SourceTextModule,
    SyntheticModule,
    measureMemory,
    constants,
};
