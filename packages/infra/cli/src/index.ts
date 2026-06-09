#!/usr/bin/env node
// gjsify CLI entry point. The whole command surface lives in `cli-app.ts`
// (`runCli`), factored out so that `gjsify run` can dispatch a `gjsify
// <subcommand>` script IN-PROCESS instead of spawning a fresh gjs — the
// nested-gjs explosion that makes the GJS-first build orchestration thrash CI.
// This file is just the executable wrapper around `runCli`.
import { hideBin } from 'yargs/helpers';
import { runCli } from './cli-app.js';

await runCli(hideBin(process.argv));
