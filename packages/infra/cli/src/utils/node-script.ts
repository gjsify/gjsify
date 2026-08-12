// `gjsify run --node-script <file>` — run an UNBUNDLED `.mjs`/`.js` that imports
// `node:*` builtins, on whatever runtime the CLI itself is executing on.
//
// A repo script that imports only `node:fs`/`node:path`/`node:url` — all polyfilled — is not
// intrinsically Node-bound; what was missing is a way to RUN one under GJS, whose ESM loader
// has no `node:` URI scheme and no node_modules walker, so `gjs -m <script>.mjs` dies on the
// first import. That gap is why a Node-less host could install gjsify, resolve every native
// prebuild, and then fail `build:infra` at `node scripts/process-template.mjs` (see
// `status/open-todos.md`).
//
// Rejected alternative: commit a `dist/*.gjs.mjs` per script — one more artifact each under
// the committed-bundle freshness gate, scaling with the number of scripts. This is ONE
// mechanism serving every script in the repo and every consumer's too.
//
//   node / bun / deno host → spawn the file on that runtime; no bundling, no cost.
//   gjs host               → bundle `--app gjs` (which maps `node:fs` → `@gjsify/fs`,
//                            injects the globals the script reads, and resolves bare
//                            specifiers), then run the bundle.
//
// "the globals the script reads" is auto-detection, and it is a syntactic answer to a
// runtime question — it cannot see that a branch is dead. The script's own package overrides
// it through `gjsify.nodeScript` / `gjsify.globals` (`Config.forNodeScript`), which is where
// the declaration has to live because the shim path has no command line to put a flag on.
//
// `import.meta.url` is the whole trick: the bundle does not live where the source lives, and
// a script's own location is how it finds what it operates on — all four scripts this was
// built for derive their package root from `dirname(fileURLToPath(import.meta.url))`. Left
// alone that is the BUNDLE's URL, so every one would write its output into the cache
// directory; the source file's URL is therefore baked in as a compile-time define, exactly
// as `config.ts`'s `loadConfigViaGjsBundle` does for a `gjsify.config.js` that reads its own
// siblings. `process.argv` needs no such care: the `--app gjs` bundle already exposes
// `[gjs, <bundle>, ...args]`.

import { existsSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostRuntime } from '@gjsify/rolldown-plugin-gjsify/runtime';
import { Config } from '../config.js';
import { runGjsBundle } from './run-gjs.js';
import { runRuntimeBundle } from './run-node.js';

export interface RunNodeScriptOptions {
    /** Exit the process when the script succeeds. See `RunGjsBundleOptions.exitOnSuccess`. */
    exitOnSuccess?: boolean;
}

/**
 * Whether the on-the-fly GJS bundle may be reused across runs.
 *
 * OFF by default: `bundleFileForGjsCached` invalidates on the ENTRY file's mtime plus the
 * project lockfile, which covers a plugin or a config but NOT a repo script, whose imports
 * are workspace packages that change without any lockfile write. A stale bundle there does
 * not fail loudly — the script runs and EMITS BUILD OUTPUT from code that no longer exists
 * in the tree, and a build script is the worst place to reintroduce that.
 *
 * The cost is one bundle per invocation, and only under GJS. `GJSIFY_NODE_SCRIPT_CACHE=1`
 * opts in for a host that would rather have the seconds back.
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
        // Node/bun/deno load the file as-is; bundling would only add a step and a way to
        // differ from what the runtime would have done itself. `quiet` because the echo
        // would print `node <file>` — what the package.json script already reads — behind
        // ~2 kB of native-library env, a dozen times per build chain.
        await runRuntimeBundle(host, scriptPath, extraArgs, { exitOnSuccess: options.exitOnSuccess, quiet: true });
        return;
    }

    // Dynamic import keeps the bundler machinery out of the eager module graph
    // of every `gjsify run`, matching how config.ts pulls it.
    const { BuildAction } = await import('../actions/build.js');
    // Anchored at the SCRIPT, not at the cwd: during a monorepo build the cwd is the repo
    // root, and the policy that matters belongs to the package the script lives in. Without
    // it a script only gets `--globals auto`, which reads what the bundled code REFERENCES
    // and cannot tell a live branch from a dead one — `@gjsify/adwaita-web`'s stylesheet
    // build is the case that proves the difference: auto-detection saw dart-sass's browser
    // half, injected the DOM registers, and the resulting bundle both demanded `gi://Gdk`
    // and reported `process.versions.node`, which sent dart-sass down a Node path that a
    // bundled ESM artifact cannot serve.
    const { globals, excludeGlobals } = await new Config().forNodeScript(scriptPath);
    let bundlePath: string;
    try {
        bundlePath = await BuildAction.bundleFileForGjsCached(scriptPath, {
            cacheSubdir: 'node-scripts',
            label: basename(scriptPath),
            cache: scriptCacheEnabled(),
            // A script is executed, never imported — no default export to preserve.
            preserveDefaultExport: false,
            define: { 'import.meta.url': JSON.stringify(pathToFileURL(scriptPath).href) },
            globals,
            excludeGlobals,
        });
    } catch (err) {
        throw new Error(
            `gjsify run --node-script: failed to bundle ${scriptPath} for GJS. ` +
                `The script must import only what gjsify can provide under GJS (node: builtins, ` +
                `workspace packages, pure-JS npm deps). (${(err as Error).message})`,
        );
    }

    // Quiet for the same reason as the node path above; the bundle's location is
    // deterministic (`node_modules/.cache/gjsify/node-scripts/<name>-<hash>.mjs`).
    await runGjsBundle(bundlePath, extraArgs, { exitOnSuccess: options.exitOnSuccess, quiet: true });
}
