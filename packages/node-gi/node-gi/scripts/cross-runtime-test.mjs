// SPDX-License-Identifier: MIT
// Run the cross-runtime conformance subset on Bun or Deno.
//
//   node scripts/cross-runtime-test.mjs <bun|deno>
//
// The addon is Node-API, so it loads and runs on Bun and Deno too — this proves
// the shared surface actually behaves there. It runs a CURATED subset, one process
// PER FILE, and excludes:
//   • display/GTK tests (gtk-smoke, adw-smoke, gtk-template*, strv-construct,
//     interface-props) — need Xvfb, a separate CI leg;
//   • the --expose-gc toggle-ref stress leg (gc-identity, gc-cross-thread) — needs
//     a gc global + is Node's authoritative GC-safety gate;
//   • mainloop / runasync co-pump assertions — they test the Node-only libuv↔GLib
//     bridge (Bun/Deno use the portable pump; a blocking run() does not co-pump the
//     runtime loop there, by design);
//   • a few marshalling/async cases that hit Deno N-API quirks (documented in the
//     PR / STATUS.md).
//
// Per-file isolation matters: Bun and Deno share ONE process across test files by
// default (unlike Node's process-per-file pool), so cross-file GC state interferes
// — a subset that is green per-file fails when run as one process. Spawning one
// process per file matches Node's isolation and is uniformly green.
//
// This subset is the guaranteed cross-runtime contract. The authoritative full
// suite (incl. the Node-only + GC-stress legs) stays `npm test` on Node.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Files verified green on BOTH bun and deno (per-file). Keep alphabetical.
const CONFORMANCE = [
  'call-function',
  'callbacks',
  'closure-exception',
  'construct-camelcase',
  'enums-constants',
  'gettext',
  'gi',
  'globals',
  'gobject',
  'gtype',
  'methods',
  'multilevel-subclass',
  'out-params',
  'paramspec-object',
  'proxy-fallback',
  'register-class',
  'register-class-decorator',
  'register-class-props',
  'registerclass-inplace',
  'signals',
  'smoke',
  'static-camel',
  'system',
  'variant',
  'vfunc',
  'vfunc-chainup',
];

const runtime = process.argv[2];
if (runtime !== 'bun' && runtime !== 'deno') {
  console.error('usage: node scripts/cross-runtime-test.mjs <bun|deno>');
  process.exit(2);
}

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const argsFor = (file) =>
  runtime === 'bun' ? ['test', file] : ['test', '-A', '--node-modules-dir=auto', file];

console.log(`node-gi: running ${CONFORMANCE.length} conformance files on ${runtime} (one process per file)\n`);
let failed = 0;
for (const base of CONFORMANCE) {
  const file = join('test', `${base}.test.mjs`);
  const res = spawnSync(runtime, argsFor(file), { cwd: pkgRoot, encoding: 'utf8' });
  if (res.status === 0) {
    console.log(`  ✓ ${base}`);
  } else {
    failed++;
    console.log(`  ✗ ${base}`);
    console.error((res.stdout || '') + '\n' + (res.stderr || ''));
  }
}

console.log(`\n${runtime}: ${CONFORMANCE.length - failed}/${CONFORMANCE.length} conformance files green`);
process.exit(failed === 0 ? 0 : 1);
