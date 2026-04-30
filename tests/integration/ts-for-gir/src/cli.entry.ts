// Entry point used to bundle the @ts-for-gir/cli command tree for integration
// testing on GJS and Node. Mirrors `refs/ts-for-gir/packages/cli/src/start.ts`
// but lives in-project so `gjsify build` can pick it up (the upstream
// package.json `exports` map only exposes `.` → `./src/index.ts`, which
// re-exports the command modules but does not invoke yargs).
//
// `process.argv` is taken from the runtime when this bundle executes:
//   - Node:  node dist/cli.node.mjs <args>
//   - GJS:   gjs -m dist/cli.gjs.mjs <args>  (or `gjsify run` with env vars)
//
// On GJS, async yargs handlers (e.g. `list`, `generate`) need a running GLib
// MainLoop or the process exits before any async I/O completes. We start the
// loop inline here rather than importing `ensureMainLoop` from `@gjsify/utils`
// because that package's other source files have non-type imports of
// `@girs/glib-2.0` / `@girs/gio-2.0`, which become runtime `import "@girs/*"`
// statements in the Node bundle (since `@girs/*` is externalised). Node's
// ESM loader then walks into `@girs/glib-2.0/glib-2.0.js`, hits its
// `import 'gi://GLib?version=2.0'`, and fails with `ERR_UNSUPPORTED_ESM_URL_SCHEME`.
// Inlining the four lines below avoids dragging the rest of `@gjsify/utils`
// into either bundle.
//
// We use `parseAsync()` so `await` waits for the full handler chain, then
// `process.exit()` so the GLib loop releases the process.

import { APP_NAME, APP_USAGE, APP_VERSION } from '@ts-for-gir/lib';
import { analyze, copy, create, doc, generate, json, list } from '@ts-for-gir/cli';
import yargs, { type CommandModule } from 'yargs';
import { hideBin } from 'yargs/helpers';

interface GjsImports {
  gi: { GLib: {
    MainLoop: new (ctx: null, isRunning: boolean) => { runAsync(): void; quit(): void };
    main_depth(): number;
  } };
  system?: { exit(code: number): never };
}
const gjsImports: GjsImports | undefined = (globalThis as { imports?: GjsImports }).imports;
let gjsMainLoop: { quit(): void } | undefined;
if (gjsImports) {
  const GLibModule = gjsImports.gi.GLib;
  const loop = new GLibModule.MainLoop(null, false);
  if (GLibModule.main_depth() === 0) {
    try {
      loop.runAsync();
      gjsMainLoop = loop;
    } catch { /* loop already running on default ctx */ }
  }
}

// On GJS the exit syscall has to fire from a fresh main-loop iteration —
// calling `imports.system.exit` from inside a promise-microtask continuation
// (which is where any `await yargs.parseAsync()` resolution lands) leaves
// the process parked even after the loop is quit. Scheduling the exit on
// an idle GLib source guarantees we hand back to the loop before exiting.
// On Node we just call `process.exit` directly.
function shutdown(code: number): never {
  if (gjsImports?.system?.exit) {
    const GLibModule = gjsImports.gi.GLib as typeof gjsImports.gi.GLib & {
      idle_add: (priority: number, fn: () => boolean) => number;
      PRIORITY_DEFAULT: number;
      SOURCE_REMOVE: boolean;
    };
    GLibModule.idle_add(GLibModule.PRIORITY_DEFAULT, () => {
      gjsMainLoop?.quit();
      gjsImports.system!.exit(code);
      return GLibModule.SOURCE_REMOVE;
    });
    // Park the JS continuation forever; the idle source above will terminate
    // the process before this ever returns.
    return new Promise<never>(() => { /* never */ }) as unknown as never;
  }
  process.exit(code);
}

// `.exitProcess(false)` tells yargs to NOT call `process.exit` itself for
// `--help`/`--version`/validation failures. Without it, yargs's internal
// `process.exit(0)` runs synchronously inside `parseAsync` — on GJS that
// triggers `imports.system.exit()` while the GLib MainLoop is still parked
// in `runAsync()`, which deadlocks the process for the entire CLI test
// timeout. Letting `parseAsync` resolve normally and calling `shutdown()`
// from our own code is reliable on both runtimes.
try {
  await yargs(hideBin(process.argv))
    .scriptName(APP_NAME)
    .strict()
    .usage(APP_USAGE)
    .version(APP_VERSION)
    .exitProcess(false)
    .command(analyze as unknown as CommandModule)
    .command(create as unknown as CommandModule)
    .command(generate as unknown as CommandModule)
    .command(json as unknown as CommandModule)
    .command(list as unknown as CommandModule)
    .command(copy as unknown as CommandModule)
    .command(doc as unknown as CommandModule)
    .demandCommand(1)
    .help()
    .parseAsync();
  shutdown(0);
} catch (err) {
  // yargs `--strict` throws YError on unknown commands. Print just the
  // message — passing the whole instance to `console.error` triggers a slow
  // JSON-stringify path on GJS that can stall for tens of seconds before
  // `shutdown()` ever runs.
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  shutdown(1);
}
