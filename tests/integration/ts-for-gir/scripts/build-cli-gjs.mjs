#!/usr/bin/env node
// Builds dist/cli.gjs.mjs by invoking `gjsify build` with absolute alias
// paths. The CLI's `--alias` flag is resolved by esbuild's alias-plugin
// relative to the importing module (which lives in `node_modules/...`),
// so relative paths like `./src/stubs/typedoc.ts` fail to resolve. This
// wrapper computes `--alias` values as absolute paths anchored on the
// suite's own root, making the build invocation portable across machines.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const SUITE_ROOT = resolve(dirname(__filename), '..');
const STUBS = join(SUITE_ROOT, 'src', 'stubs');

// Cut the dependency tree at the highest level we can to keep the bundle
// small. `@ts-for-gir/generator-{html-doc,json}` are stubbed because each
// pulls in the heavy `typedoc` (+ `@ts-for-gir/typedoc-theme`) tree, and the
// CLI only uses one named export from each.
const aliases = [
  `@ts-for-gir/generator-html-doc=${join(STUBS, 'generator-html-doc.ts')}`,
  `@ts-for-gir/generator-json=${join(STUBS, 'generator-json.ts')}`,
  `typedoc=${join(STUBS, 'typedoc.ts')}`,
  `@inquirer/prompts=${join(STUBS, 'inquirer-prompts.ts')}`,
  `inquirer=${join(STUBS, 'inquirer-prompts.ts')}`,
].join(',');

const args = [
  'build',
  'src/cli.entry.ts',
  '--app', 'gjs',
  '--outfile', 'dist/cli.gjs.mjs',
  '--define', '__TS_FOR_GIR_VERSION__="4.0.0-rc.8"',
  '--alias', aliases,
];

const result = spawnSync('gjsify', args, { cwd: SUITE_ROOT, stdio: 'inherit' });
process.exit(result.status ?? 1);
