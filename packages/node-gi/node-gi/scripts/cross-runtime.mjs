// SPDX-License-Identifier: MIT
// Run the cross-runtime conformance subset on Bun or Deno.
//
//   node scripts/cross-runtime.mjs <bun|deno>
//
// NB: the filename deliberately avoids Node's default test glob (`*-test.mjs`,
// `*.test.mjs`, …) so `node --test` does not pick this orchestrator up as a test.
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
//     runtime loop there, by design).
//
// The Deno N-API quirks that once excluded arrays/async-error (byte-array with
// autofilled length, per-class Gio._promisify) are FIXED as of Deno 2.9.x —
// re-validated green per-file on Deno 2.9.2 + Bun 1.3.13, so both files joined
// the list. CI floats on v2.x via denoland/setup-deno.
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
  'arrays',
  'async-error',
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
  'int64',
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
  console.error('usage: node scripts/cross-runtime.mjs <bun|deno>');
  process.exit(2);
}

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const argsFor = (file) =>
  runtime === 'bun' ? ['test', file] : ['test', '-A', '--node-modules-dir=auto', file];

// Which native binary the children load (see index.js nativeCandidates). Default
// to the JUST-BUILT addon so a stale staged prebuild can't shadow local
// verification; CI's cross-runtime job overrides with NODE_GI_NATIVE=prebuild to
// keep validating the prebuild load path (Deno's install path) explicitly.
const nativePref = process.env.NODE_GI_NATIVE ?? 'build';

console.log(`node-gi: running ${CONFORMANCE.length} conformance files on ${runtime} (one process per file)\n`);
let failed = 0;
for (const base of CONFORMANCE) {
  const file = join('test', `${base}.test.mjs`);
  const res = spawnSync(runtime, argsFor(file), {
    cwd: pkgRoot,
    encoding: 'utf8',
    env: { ...process.env, NODE_GI_NATIVE: nativePref },
  });
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
