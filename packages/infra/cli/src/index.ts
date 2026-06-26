#!/usr/bin/env node
// gjsify CLI entry point. The whole command surface lives in `cli-app.ts`
// (`runCli`), factored out so that `gjsify run` can dispatch a `gjsify
// <subcommand>` script IN-PROCESS instead of spawning a fresh gjs — the
// nested-gjs explosion that makes the GJS-first build orchestration thrash CI.
// This file is just the executable wrapper around `runCli`.
import { hideBin } from 'yargs/helpers';
import { runCli } from './cli-app.js';

try {
    await runCli(hideBin(process.argv));
} catch (err) {
    // A command handler (or yargs) rejected. Print the message cleanly and exit
    // 1 on BOTH runtimes. Without this, the rejection escapes the entry's
    // top-level await as an UNHANDLED rejection: Node prints it, but GJS surfaces
    // a scary `Gjs-CRITICAL **: Module … threw an exception` that buries the
    // real, already-actionable message (e.g. "gjsify build: no usable bundler
    // engine under GJS — build the facade first or run under Node"). See #597.
    console.error(err instanceof Error ? err.message : String(err));
    if (process.env.GJSIFY_DEBUG && err instanceof Error && err.stack) console.error(err.stack);
    // `process.exitCode` is the gentle Node idiom (streams flush). GJS has no
    // atexit hook and would exit 0 at natural shutdown, so force a non-zero exit
    // via `imports.system.exit` there (no-op on Node, where `imports` is unset).
    process.exitCode = 1;
    const gjs = (globalThis as { imports?: { system?: { exit?: (c: number) => void } } }).imports;
    gjs?.system?.exit?.(1);
}
