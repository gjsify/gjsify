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

export const GJS_PROCESS_STUB =
    'if(typeof globalThis.process==="undefined"){' +
        'const _s=imports.system,_G=imports.gi.GLib;' +
        'globalThis.process={' +
            'platform:"linux",arch:"x64",version:"v20.0.0",' +
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
            'stderr:{write(s){printerr(s)}},stdout:{write(s){print(s)}},stdin:null,' +
            'exitCode:undefined,' +
            'nextTick(fn,...a){Promise.resolve().then(()=>fn(...a))},' +
            'hrtime(t){return t?[0,0]:[0,0]},' +
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
}

export function processStubPlugin(options: ProcessStubPluginOptions = {}): Plugin {
    const banner = composeBanner(GJS_PROCESS_STUB, options.userBanner ?? '');
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
