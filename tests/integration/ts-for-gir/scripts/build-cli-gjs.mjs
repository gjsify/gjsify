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

// Stub interactive prompt libraries only — they rely on eager dynamic-import
// enumeration that bloats GJS bundles. TypeDoc and its generators now bundle
// correctly: gjsify's onLoad hook rewrites import.meta.url in each TypeDoc
// module to the build-time-known original file URL so that all relative FS
// path calculations (package.json, locales, static assets) resolve at runtime
// into node_modules, where gjsify's GLib-backed fs polyfill handles the I/O.
const aliases = [
  `@inquirer/prompts=${join(STUBS, 'inquirer-prompts.ts')}`,
  `inquirer=${join(STUBS, 'inquirer-prompts.ts')}`,
].join(',');

// __GJS_BUNDLE__=true mirrors upstream `@ts-for-gir/cli`'s build-gjs.mjs
// (gjsify/ts-for-gir#386). The flag trips a short-circuit guard in commands
// that aren't yet supported on the GJS bundle (currently only `create`,
// which depends on `dist-templates/` shipping alongside the binary —
// install.js downloads the single binary asset only). Without the define
// the guard's `typeof !== "undefined"` check is dead code and the user
// sees a confusing "Could not locate templates directory" error.
const args = [
  'build',
  'src/cli.entry.ts',
  '--app', 'gjs',
  '--outfile', 'dist/cli.gjs.mjs',
  '--define', '__TS_FOR_GIR_VERSION__="4.0.0-rc.8"',
  '--define', '__GJS_BUNDLE__=true',
  '--alias', aliases,
];

const result = spawnSync('gjsify', args, { cwd: SUITE_ROOT, stdio: 'inherit' });
process.exit(result.status ?? 1);
