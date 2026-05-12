// Shim for `unicorn-magic` under --app gjs.
//
// The upstream package gates the full API (`toPath`, `traversePathUp`,
// `rootDirectory`, `execFile`, `execFileSync`) behind the `"node"`
// conditional exports entry. Under --app gjs we intentionally omit
// the `node` resolve-condition (cross-fetch-ponyfill ships
// Node-only code under that key — see `app/gjs.ts` conditionNames
// comment), so a bare `import { toPath } from 'unicorn-magic'` falls
// back to `default.js` which only exposes `delay`.
//
// This shim mirrors the node.js entry verbatim — the underlying
// `node:url`/`node:path`/`node:child_process`/`node:util` imports
// route through `@gjsify/{url,path,child_process,util}` under GJS
// and through real Node-internals under Node. The aliasPlugin
// points `unicorn-magic` here for --app gjs builds.
//
// Source-of-truth: refs/unicorn-magic/node.js (when added — for
// now mirrored from node_modules/unicorn-magic@0.3.0).

import { promisify } from 'node:util';
import { execFile as execFileCallback, execFileSync as execFileSyncOriginal } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileOriginal = promisify(execFileCallback);

export function toPath(urlOrPath) {
    return urlOrPath instanceof URL ? fileURLToPath(urlOrPath) : urlOrPath;
}

export function rootDirectory(pathInput) {
    return path.parse(toPath(pathInput)).root;
}

export function traversePathUp(startPath) {
    return {
        *[Symbol.iterator]() {
            let currentPath = path.resolve(toPath(startPath));
            let previousPath;

            while (previousPath !== currentPath) {
                yield currentPath;
                previousPath = currentPath;
                currentPath = path.resolve(currentPath, '..');
            }
        },
    };
}

const TEN_MEGABYTES_IN_BYTES = 10 * 1024 * 1024;

export async function execFile(file, arguments_, options = {}) {
    return execFileOriginal(file, arguments_, {
        maxBuffer: TEN_MEGABYTES_IN_BYTES,
        ...options,
    });
}

export function execFileSync(file, arguments_ = [], options = {}) {
    return execFileSyncOriginal(file, arguments_, {
        maxBuffer: TEN_MEGABYTES_IN_BYTES,
        ...options,
    });
}

// Re-export from default.js so the union API (delay + node helpers)
// stays intact for callers that import both.
export async function delay(opts: { seconds?: number; milliseconds?: number } = {}): Promise<void> {
    const { seconds, milliseconds } = opts;
    let duration: number;
    if (typeof seconds === 'number') duration = seconds * 1000;
    else if (typeof milliseconds === 'number') duration = milliseconds;
    else throw new TypeError('Expected an object with either `seconds` or `milliseconds`.');
    return new Promise<void>((resolveFn) => setTimeout(resolveFn, duration));
}
