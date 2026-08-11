// `gjsify run --node-script <file>` — run an UNBUNDLED `.mjs`/`.js` that imports
// `node:*` builtins, on whatever runtime the CLI itself is executing on.
//
// WHY THIS EXISTS
//
// A repo script like `scripts/build-assets.mjs` imports only `node:fs` /
// `node:path` / `node:url` — every one of which gjsify polyfills — so nothing
// about it is intrinsically Node-bound. What was missing is a way to RUN one
// under GJS: GJS's ESM loader has no `node:` URI scheme and no node_modules
// walker, so `gjs -m scripts/build-assets.mjs` dies on the first import. That
// single gap is why a Node-less host could install gjsify, resolve every native
// prebuild, and then fail `build:infra` at `node scripts/process-template.mjs`
// (`status/open-todos.md`, "A Node-less host cannot bootstrap a fresh CLONE").
//
// The alternative that was considered and rejected: commit a `dist/*.gjs.mjs`
// for each script. That is one more artifact per script under the committed-
// bundle freshness gate, and it scales with the number of scripts. This is ONE
// mechanism that serves every script in the repo and every consumer's too.
//
// WHAT IT DOES
//
//   node / bun / deno host → spawn the file on that runtime. Byte-for-byte what
//                            `node <file>` did before; no bundling, no cost.
//   gjs host               → bundle the file `--app gjs` (which is what maps
//                            `node:fs` → `@gjsify/fs`, injects the globals the
//                            script reads, and resolves bare specifiers), then
//                            run the bundle.
//
// `import.meta.url` IS THE WHOLE TRICK
//
// The bundle does not live where the source lives, and a script's own location
// is how it finds what it operates on — all four scripts this was built for open
// with `dirname(fileURLToPath(import.meta.url))` and derive their package root
// from it. Left alone, `import.meta.url` in the bundle is the BUNDLE's URL, so
// every one of them would write its output into the cache directory. So the
// source file's URL is baked in as a compile-time define, exactly as
// `config.ts`'s `loadConfigViaGjsBundle` does for a `gjsify.config.js` that
// reads its own siblings. `process.argv` needs no such care: the `--app gjs`
// bundle already exposes `[gjs, <bundle>, ...args]`, so `argv.slice(2)` and
// `argv.includes('--flag')` behave as they do on Node.

import { existsSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostRuntime } from '@gjsify/rolldown-plugin-gjsify/runtime';
import { runGjsBundle } from './run-gjs.js';
import { runRuntimeBundle } from './run-node.js';

export interface RunNodeScriptOptions {
    /** Exit the process when the script succeeds. See `RunGjsBundleOptions.exitOnSuccess`. */
    exitOnSuccess?: boolean;
}

/**
 * Whether the on-the-fly GJS bundle may be reused across runs.
 *
 * OFF by default, and that is deliberate. The cache `bundleFileForGjsCached`
 * implements invalidates on the ENTRY file's mtime plus the project lockfile —
 * which covers a plugin or a config (both leaf-ish, both consuming installed
 * deps) but NOT a repo script, whose imports are workspace packages that change
 * without any lockfile write. A stale bundle there does not fail loudly: the
 * script runs and EMITS BUILD OUTPUT from code that no longer exists in the
 * tree. That is the failure this repo has paid for repeatedly under a different
 * name ("it never runs the source you just edited"), and a build script is the
 * worst place to reintroduce it.
 *
 * The cost of being right is one bundle per invocation, and only under GJS —
 * node/bun/deno never bundle at all. `GJSIFY_NODE_SCRIPT_CACHE=1` opts in for a
 * host that would rather have the seconds back.
 */
function scriptCacheEnabled(): boolean {
    const v = process.env['GJSIFY_NODE_SCRIPT_CACHE'];
    return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Run `file` — an unbundled ESM script that imports `node:` builtins — on the
 * CLI's own host runtime, bundling it for GJS first when that is where we are.
 *
 * Terminal callers pass `exitOnSuccess` (a GJS main loop armed by the spawn
 * parks the process otherwise); see {@link runGjsBundle}.
 */
export async function runNodeScript(
    file: string,
    extraArgs: string[] = [],
    options: RunNodeScriptOptions = {},
): Promise<void> {
    const scriptPath = resolve(file);
    if (!existsSync(scriptPath) || !statSync(scriptPath).isFile()) {
        console.error(`gjsify run --node-script: no such file: ${scriptPath}`);
        // `return process.exit` — a bare exit falls through under GJS (see run.ts).
        return process.exit(1);
    }

    const host = hostRuntime();
    if (host !== 'gjs') {
        // Node/bun/deno can load the file as-is; bundling would only add a step
        // and a way to differ from what the runtime would have done itself.
        // `quiet`: the echo would print `node <file>` — which is exactly what the
        // package.json script already reads — behind ~2 kB of native-library env
        // that a build script never loads. Nothing is lost by leaving it out, and
        // a build chain calls this a dozen times.
        await runRuntimeBundle(host, scriptPath, extraArgs, { exitOnSuccess: options.exitOnSuccess, quiet: true });
        return;
    }

    // Dynamic import keeps the bundler machinery out of the eager module graph
    // of every `gjsify run`, matching how config.ts pulls it.
    const { BuildAction } = await import('../actions/build.js');
    let bundlePath: string;
    try {
        bundlePath = await BuildAction.bundleFileForGjsCached(scriptPath, {
            cacheSubdir: 'node-scripts',
            label: basename(scriptPath),
            cache: scriptCacheEnabled(),
            // A script is executed, never imported — no default export to preserve.
            preserveDefaultExport: false,
            define: { 'import.meta.url': JSON.stringify(pathToFileURL(scriptPath).href) },
        });
    } catch (err) {
        throw new Error(
            `gjsify run --node-script: failed to bundle ${scriptPath} for GJS. ` +
                `The script must import only what gjsify can provide under GJS (node: builtins, ` +
                `workspace packages, pure-JS npm deps). (${(err as Error).message})`,
        );
    }

    // Quiet for the same reason as the node path above; the bundle's location is
    // deterministic (`node_modules/.cache/gjsify/node-scripts/<name>-<hash>.mjs`)
    // for anyone who needs to inspect it.
    await runGjsBundle(bundlePath, extraArgs, { exitOnSuccess: options.exitOnSuccess, quiet: true });
}
