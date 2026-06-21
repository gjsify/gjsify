// Node-free orchestration: a GJS-runnable `gjsify` on PATH.
//
// The CLI's npm `bin` (`node_modules/.bin/gjsify`) is the NODE entry — useless
// in a node-free environment (the Flatpak sandbox has no Node). But multi-
// package orchestration and compound package scripts resolve `gjsify` from
// PATH and would hit that Node bin:
//   - `gjsify workspace`/`foreach` spawn `<pm> run <script>` per package; under
//     GJS the package manager is `gjsify` itself, and `spawn('gjsify', …)`
//     searches PATH.
//   - a compound script like `gjsify run a && gjsify run b` is executed via
//     `/bin/sh -c …`, and the shell resolves each `gjsify` from PATH.
// Both fail without Node (`spawn npm ENOENT`, `gjsify: not found`).
//
// Fix: under GJS, write a tiny wrapper that re-invokes the running GJS bundle
// under `gjs -m`, and prepend its directory to `process.env.PATH` so every
// child process (and grandchild, via the inherited `GJSIFY_SHIM_DIR` marker)
// resolves `gjsify` to a GJS-runnable executable. No-op on Node.

import { mkdtempSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGjs } from '@gjsify/rolldown-plugin-gjsify/runtime';

let _ensured = false;

/**
 * Ensure a GJS-runnable `gjsify` is on `process.env.PATH` for child processes.
 * Idempotent per process; children inherit the shim via `GJSIFY_SHIM_DIR` and
 * reuse it instead of creating their own. No-op when not running under GJS.
 */
export function ensureGjsifyShimOnPath(): void {
    if (_ensured || !isGjs()) return;
    _ensured = true;

    // A parent gjsify (also under GJS) already created the shim — reuse it so
    // nested orchestration doesn't pile up temp dirs / PATH entries.
    const inherited = process.env.GJSIFY_SHIM_DIR;
    if (inherited && existsSync(join(inherited, 'gjsify'))) {
        if (!(process.env.PATH ?? '').split(delimiter).includes(inherited)) {
            process.env.PATH = inherited + delimiter + (process.env.PATH ?? '');
        }
        return;
    }

    // `import.meta.url` resolves to the running GJS bundle (cli.gjs.mjs) — the
    // whole CLI collapses into that single file, so this module's URL is it.
    const selfBundle = fileURLToPath(import.meta.url);
    const gjs = process.env.GJS_CONSOLE || 'gjs';
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-shim-'));
    const shim = join(dir, 'gjsify');
    writeFileSync(shim, `#!/bin/sh\nexec "${gjs}" -m "${selfBundle}" "$@"\n`, { mode: 0o755 });
    chmodSync(shim, 0o755);

    process.env.GJSIFY_SHIM_DIR = dir;
    process.env.PATH = dir + delimiter + (process.env.PATH ?? '');
}
