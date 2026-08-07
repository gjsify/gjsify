#!/usr/bin/env node
// gjsify CLI entry point. The whole command surface lives in `cli-app.ts`
// (`runCli`), factored out so that `gjsify run` can dispatch a `gjsify
// <subcommand>` script IN-PROCESS instead of spawning a fresh gjs — the
// nested-gjs explosion that makes the GJS-first build orchestration thrash CI.
// This file is just the executable wrapper around `runCli`.
import { hideBin } from 'yargs/helpers';
import { runCli } from './cli-app.js';
import { gjsExit } from '@gjsify/rolldown-plugin-gjsify/runtime';

try {
    await runCli(hideBin(process.argv));
} catch (err) {
    // A command handler (or yargs) rejected. Print the message cleanly and exit
    // 1 on BOTH runtimes. Without this, the rejection escapes the entry's
    // top-level await as an UNHANDLED rejection: Node prints it, but GJS surfaces
    // a scary `Gjs-CRITICAL **: Module … threw an exception` that buries the
    // real, already-actionable message (e.g. "gjsify build: no usable bundler
    // engine under GJS — build the facade first or run under Node"). See #597.
    //
    // The `code` is printed WITH the message, not dropped. Errors in this CLI
    // carry npm's own codes on purpose — `badPlatformError()` documents that it
    // reproduces npm's `EBADPLATFORM` payload "so a consumer's error handling
    // (and a human reading the message) sees what npm reports" — and npm itself
    // prints the code (`npm ERR! code EBADPLATFORM`) rather than only the prose.
    //
    // It has to be explicit here because this catch became the SINGLE printer:
    // before the `.fail()` handler in `cli-app.ts`, yargs logged the error OBJECT
    // and the code came along for free. Printing `err.message` alone silently
    // dropped it for every coded error, which is what turned
    // `tests/e2e/install-optional-both-blocks` red on `main` — it asserts the
    // code is visible, and the prose it still printed did not contain it.
    const code =
        typeof err === 'object' && err !== null && typeof (err as { code?: unknown }).code === 'string'
            ? (err as { code: string }).code
            : '';
    const message = err instanceof Error ? err.message : String(err);
    console.error(code && !message.includes(code) ? `${code}: ${message}` : message);
    if (process.env.GJSIFY_DEBUG && err instanceof Error && err.stack) console.error(err.stack);
    // `process.exitCode` is the gentle Node idiom (streams flush). GJS has no
    // atexit hook and would exit 0 at natural shutdown, so force a non-zero exit
    // via `imports.system.exit` there (no-op on Node, where `imports` is unset).
    process.exitCode = 1;
    gjsExit(1);
}
