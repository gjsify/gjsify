// Synchronous `globalThis.process` stub injected as a GJS bundle banner.
//
// Some npm packages (glob, path-scurry, readable-stream, …) access
// `globalThis.process.platform` at their top-level during lazy `__esm`
// initialisation — BEFORE any `import`-triggered side effects fire. A
// banner runs before everything, including bundler helpers and all
// bundled module code, making it the only reliable injection point for
// a synchronous global that must exist from byte 1 of execution.
//
// Only installed if `process` is absent; the full @gjsify/process
// implementation (with EventEmitter, real streams, etc.) is wired up
// later via `--globals auto` (which injects @gjsify/node-globals/register/process).
//
// Kept as a single line: the banner runs before any source-map-aware
// machinery, so newlines here would shift every line number by one. Single
// line = zero source-map drift for the actual bundle code below.
import type { Plugin } from 'rolldown';

import { BUNDLE_URL_BANNER } from './bundle-url-banner.js';
import { GJS_WELLKNOWN_SYMBOLS_STUB } from './wellknown-symbols-banner.js';

// Every GJS ambient global is reached through `globalThis.` — NEVER as a bare
// identifier. The banner shares the module's top-level scope with the bundled
// code, so a bare `imports` binds to any top-level `const imports` a bundled
// module declares — and since the banner runs at byte 1, that binding is still
// in its temporal dead zone: `ReferenceError: can't access lexical declaration
// 'imports' before initialization`, thrown at load, before a single line of
// program code runs. `@girs/gjs`'s `gjs.js` declares exactly that
// (`const imports = globalThis.imports || {}`), so the failure is real and
// arrives whenever tree-shaking happens to retain that module. It was found
// via `@gjsify/web-streams`, whose GJS test leg died the moment `@gjsify/utils`
// became more shakeable — but nothing about it is specific to either package.
export const GJS_PROCESS_STUB =
    'if(typeof globalThis.process==="undefined"){' +
    'const _s=globalThis.imports.system,_G=globalThis.imports.gi.GLib;' +
    // process.hrtime needs a `.bigint` property attached to the function
    // itself (Node API shape: `process.hrtime.bigint()` — used by execa,
    // perf-tracking libs, …). Build it as a named local so we can
    // attach the property before stashing it on the stub object.
    'const _h=t=>t?[0,0]:[0,0];_h.bigint=()=>0n;' +
    // `platform`/`arch`, answered LAZILY by the same `uname -sm` probe
    // `@gjsify/process` uses (`packages/node/process/src/internal/uname.ts`),
    // with `@gjsify/utils`' `platform-names.ts` mapping tables inlined minimally
    // — a banner runs before the module system exists and cannot import the
    // canonical ones. Those two are the source of truth; keep this in step or a
    // bundle answers differently depending on whether it pulled
    // `@gjsify/process` in. These used to be the literals `"linux"`/`"x64"`,
    // which is a WRONG answer on two of three OSes rather than a missing one.
    // Lazy, so the cost falls only on a bundle that reads the field AND never
    // loads `@gjsify/process` (whose register replaces this object): nothing is
    // spawned at load. Windows is answered from the environment — `uname` is not
    // on a native Windows PATH, and the env answer is exact.
    'let _pc;const _p=()=>{if(_pc)return _pc;_pc={platform:"linux",arch:"x64"};' +
    'try{' +
    'if(_G.getenv("OS")==="Windows_NT"||_G.getenv("SystemRoot")){' +
    'const a=(_G.getenv("PROCESSOR_ARCHITECTURE")||"").toLowerCase();' +
    '_pc={platform:"win32",arch:a==="arm64"?"arm64":a==="x86"?"ia32":"x64"};return _pc}' +
    'const _r=_G.spawn_sync(null,["uname","-sm"],null,_G.SpawnFlags.SEARCH_PATH,null);' +
    'if(_r&&_r[0]&&_r[1]){const _t=new TextDecoder().decode(_r[1]).trim().split(/\\s+/);' +
    'if(_t.length>1){const s=_t[0],m=_t[_t.length-1].toLowerCase();' +
    '_pc={platform:s==="Linux"?"linux":s==="Darwin"?"darwin":/^CYGWIN/i.test(s)?"cygwin":' +
    '/^(MINGW|MSYS|Windows)/i.test(s)?"win32":s.toLowerCase(),' +
    'arch:m==="x86_64"||m==="amd64"?"x64":m==="aarch64"||m==="arm64"?"arm64":' +
    '/^i[3-6]86$/.test(m)?"ia32":m.startsWith("arm")?"arm":m}}}' +
    '}catch(e){/* no GLib spawn, or spawn refused: the linux/x64 fallback stands */}' +
    'return _pc};' +
    'globalThis.process={' +
    'get platform(){return _p().platform},get arch(){return _p().arch},version:"v20.0.0",' +
    'env:new Proxy({},{' +
    'get(_,p){return typeof p==="string"?(_G.getenv(p)??undefined):undefined},' +
    'set(_,p,v){if(typeof p==="string")_G.setenv(p,String(v),true);return true},' +
    'has(_,p){return typeof p==="string"&&_G.getenv(p)!==null},' +
    'deleteProperty(_,p){if(typeof p==="string")_G.unsetenv(p);return true},' +
    'ownKeys(){return _G.listenv()??[]},' +
    'getOwnPropertyDescriptor(_,p){const v=_G.getenv(p);return v!==null?{value:v,writable:true,enumerable:true,configurable:true}:undefined}' +
    '}),' +
    'argv:_s?.programArgs?["gjs",_s.programInvocationName||"",..._s.programArgs]:["gjs"],' +
    'versions:{},config:{},' +
    'cwd(){return _G.get_current_dir()||"/"},' +
    'exit(c){_s.exit(c??0)},' +
    'stderr:{write(s){globalThis.printerr(s)}},stdout:{write(s){globalThis.print(s)}},stdin:null,' +
    'exitCode:undefined,' +
    'nextTick(fn,...a){Promise.resolve().then(()=>fn(...a))},' +
    'hrtime:_h,' +
    '};' +
    '}';

/**
 * Compose the GJS process stub with the user-supplied banner so the result
 * is valid syntax for `gjs -m`. A leading `#!shebang` line in the user
 * banner is hoisted to byte 0 of the output. Any `#` character that appears
 * anywhere except byte 0 is a fatal SyntaxError under SpiderMonkey 128+ —
 * putting our process stub before the user's shebang would break the bundle.
 *
 * Output shape:
 *   [#!shebang\n][<process-stub>\n<rest-of-user-banner>]
 *
 * Either side of the bracket may be empty; the result is always concatenated
 * without leading whitespace.
 */
export function composeBanner(stub: string, userBanner: string): string {
    if (!userBanner) return stub;
    const shebangMatch = userBanner.match(/^#![^\n]*\n/);
    if (!shebangMatch) {
        return stub + '\n' + userBanner;
    }
    const shebang = shebangMatch[0];
    const rest = userBanner.slice(shebang.length);
    return shebang + stub + (rest ? '\n' + rest : '');
}

/**
 * Build a Rolldown plugin that injects the GJS process stub as a chunk
 * banner. Runs with `enforce: 'post'`-equivalent ordering so the stub
 * lands *after* any user `output.banner` value, except when the user
 * banner starts with a `#!shebang` line — which is hoisted to byte 0
 * by `composeBanner`.
 */
export interface ProcessStubPluginOptions {
    /** User-supplied banner string. May contain a leading `#!shebang`. */
    userBanner?: string;
    /**
     * Prepend the bundle-URL anchor banner (read by the module-resolve shim).
     * ESM-only — set by the orchestrator when `format === 'esm'`.
     */
    captureBundleUrl?: boolean;
}

export function processStubPlugin(options: ProcessStubPluginOptions = {}): Plugin {
    // The anchor capture must precede the process stub so it runs at the very
    // top of the chunk (where `import.meta.url` is the bundle's own URL). The
    // well-known-symbols polyfill must also run before any module init, so it
    // joins the byte-1 banner. All three pieces are single-line (no source-map
    // drift) and idempotent.
    const stub = (options.captureBundleUrl ? BUNDLE_URL_BANNER : '') + GJS_WELLKNOWN_SYMBOLS_STUB + GJS_PROCESS_STUB;
    const banner = composeBanner(stub, options.userBanner ?? '');
    return {
        name: 'gjsify-process-stub',
        renderChunk: {
            order: 'post' as const,
            handler(code, chunk) {
                if (!chunk.isEntry) return null;
                return { code: banner + '\n' + code, map: null };
            },
        },
    };
}
