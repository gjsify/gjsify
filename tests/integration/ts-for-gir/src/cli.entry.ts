// Entry point used to bundle the @ts-for-gir/cli command tree for integration
// testing on GJS and Node. Mirrors `refs/ts-for-gir/packages/cli/src/start.ts`
// but lives in-project so `gjsify build` can pick it up (the upstream
// package.json `exports` map only exposes `.` → `./src/index.ts`, which
// re-exports the command modules but does not invoke yargs).
//
// `process.argv` is taken from the runtime when this bundle executes — pass
// CLI args after `--` when running via `gjsify run dist/cli.gjs.mjs -- <args>`
// or directly via `node dist/cli.node.mjs <args>`.

import { APP_NAME, APP_USAGE, APP_VERSION } from '@ts-for-gir/lib';
import { analyze, copy, create, doc, generate, json, list } from '@ts-for-gir/cli';
import yargs, { type CommandModule } from 'yargs';
import { hideBin } from 'yargs/helpers';

void yargs(hideBin(process.argv))
  .scriptName(APP_NAME)
  .strict()
  .usage(APP_USAGE)
  .version(APP_VERSION)
  .command(analyze as unknown as CommandModule)
  .command(create as unknown as CommandModule)
  .command(generate as unknown as CommandModule)
  .command(json as unknown as CommandModule)
  .command(list as unknown as CommandModule)
  .command(copy as unknown as CommandModule)
  .command(doc as unknown as CommandModule)
  .demandCommand(1)
  .help().argv;
