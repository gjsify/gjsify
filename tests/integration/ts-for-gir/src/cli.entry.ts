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
// All GJS-specific lifecycle (parking a GLib MainLoop for async I/O, draining
// it on exit, scheduling `imports.system.exit` from a fresh main-loop
// iteration so it doesn't deadlock a microtask continuation) is handled by
// the @gjsify/* polyfills. This entry stays Node-idiomatic.

import { APP_NAME, APP_USAGE, APP_VERSION } from '@ts-for-gir/lib';
import { analyze, copy, create, doc, generate, json, list } from '@ts-for-gir/cli';
import yargs, { type CommandModule } from 'yargs';
import { hideBin } from 'yargs/helpers';

try {
  await yargs(hideBin(process.argv))
    .scriptName(APP_NAME)
    .strict()
    .usage(APP_USAGE)
    .version(APP_VERSION)
    // `.exitProcess(false)` keeps yargs from calling `process.exit`
    // synchronously for `--help`/`--version`/validation failures — we route
    // every outcome through `parseAsync` + a single explicit `process.exit`
    // call below. `.fail(false)` makes yargs throw validation errors instead
    // of swallowing them when exitProcess is off.
    .exitProcess(false)
    .fail(false)
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
  process.exit(0);
} catch (err) {
  // Print just the message — passing the whole instance to `console.error`
  // triggers a slow JSON-stringify path on GJS that can stall for tens of
  // seconds before exit.
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
