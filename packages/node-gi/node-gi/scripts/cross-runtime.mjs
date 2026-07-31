// SPDX-License-Identifier: MIT
// Run the cross-runtime conformance subset on Node, Bun or Deno.
//
//   node scripts/cross-runtime.mjs <node|bun|deno>
//
// NB: the filename deliberately avoids Node's default test glob (`*-test.mjs`,
// `*.test.mjs`, …) so `node --test` does not pick this orchestrator up as a test.
//
// The addon is Node-API, so it loads and runs on Bun and Deno too — this proves
// the shared surface actually behaves there. The `node` leg runs the SAME curated
// subset on Node: it is the display-free proof used where the full GTK/display
// suite is not wired (the `macos` job in node-gi.yml, which builds the addon from
// Homebrew GTK/GI and can't yet drive a GTK window). On Linux/x86_64 + arm64 the
// AUTHORITATIVE Node run stays the full `npm test`; this leg is the headless core.
//
// It runs a CURATED subset, one process PER FILE, and excludes:
//   • display/GTK tests (gtk-smoke, adw-smoke, gtk-template*, strv-construct,
//     interface-props) — need Xvfb, a separate CI leg;
//   • the --expose-gc toggle-ref stress leg (gc-identity, gc-cross-thread) — needs
//     a gc global + is Node's authoritative GC-safety gate;
//   • mainloop / runasync co-pump assertions AND the `pump` suite (the uv-driven
//     GLib auto-pump) — they test the Node-only libuv↔GLib integration (Bun/Deno
//     use the portable startMainContextPump; a blocking run() does not co-pump
//     the runtime loop there, by design).
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
import { maybeReexecForGtkRuntime } from '../gtk-runtime.js';

// Batteries-included GTK (macOS): re-exec THIS runner once with the bundle's
// DYLD_FALLBACK_LIBRARY_PATH set, BEFORE it spawns any child, so every per-file
// child inherits the fallback at launch (dyld only reads it then) and no child
// needs to re-exec inside the test-runner pool. No-op off darwin / without a
// bundle / once already covered. Never returns on re-exec.
maybeReexecForGtkRuntime();

// Files verified green on BOTH bun and deno (per-file). Keep alphabetical.
const CONFORMANCE = [
  'arrays',
  'boxed-out',
  'async-error',
  'blocking-run-checkpoint',
  'bytes',
  'cairo',
  'cairo-canvas2d',
  'call-function',
  'callbacks',
  'closure-exception',
  'construct-camelcase',
  'dbus-async', // self-skips without a session bus; run the subset under dbus-run-session to cover it
  'enums-constants',
  'gclosure-in-args',
  'gettext',
  'gi',
  'globals',
  'gobject',
  'gtype',
  'int64',
  'methods',
  'multilevel-subclass',
  'out-params',
  'paramspec',
  'paramspec-object',
  'proxy-fallback',
  'register-class',
  'register-class-decorator',
  'register-class-props',
  'registerclass-inplace',
  'signals',
  'smoke',
  'static-camel',
  'struct-construct',
  'system',
  'variant',
  'vfunc',
  'vfunc-chainup',
];

const runtime = process.argv[2];
if (runtime !== 'node' && runtime !== 'bun' && runtime !== 'deno') {
  console.error('usage: node scripts/cross-runtime.mjs <node|bun|deno> [--only a,b,c]');
  process.exit(2);
}

// Optional `--only a,b,c` restricts the run to a subset (e.g. the env-free CORE
// leg that excludes the non-addon-linked Pango/Gdk/Graphene backers). Unknown
// names are a hard error so a typo can't silently shrink the gate.
const onlyIdx = process.argv.indexOf('--only');
let files = CONFORMANCE;
if (onlyIdx >= 0) {
  const wanted = (process.argv[onlyIdx + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = wanted.filter((w) => !CONFORMANCE.includes(w));
  if (unknown.length) {
    console.error(`--only: unknown conformance file(s): ${unknown.join(', ')}`);
    process.exit(2);
  }
  files = CONFORMANCE.filter((f) => wanted.includes(f));
}

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
// Per-runtime argv + the binary to spawn. Node runs its own `node --test` (via
// process.execPath so the current Node runs the children); Bun/Deno spawn their
// PATH binary. One process per file keeps Node's isolation identical to Bun/Deno,
// which share a process across files by default.
const argsFor = (file) =>
  runtime === 'node'
    ? ['--test', file]
    : runtime === 'bun'
      ? ['test', file]
      : ['test', '-A', '--node-modules-dir=auto', file];
const runtimeBin = runtime === 'node' ? process.execPath : runtime;

// Deno's N-API env teardown can abort a test FILE with a non-zero exit AFTER every
// assertion in it has already passed — no test summary is printed, the process just
// exits non-zero once the last subtest reported `ok`. It is NONDETERMINISTIC in two
// ways: it lands on a DIFFERENT file run-to-run (struct-construct one run, out-params
// the next, gobject the next) AND on a DIFFERENT platform run-to-run (macos-arm64 one
// run, linux-arm64 the next).
//
// Its FREQUENCY tracks the auto-armed pump's ADDON ENTRIES between test files, which is
// why the pump's beat is addon-silent while idle (gi.js pumpBeat + the zero-napi
// `pumpPendingCount` view): when `requireGi` first auto-armed the pump on Bun/Deno with
// an ungated tick, the GTK/Adw smoke leg went from exit 0 to a deterministic 139, and a
// finer A/B showed the DISPATCH volume is not even required — a query-only tick (one
// napi call, no dispatch) still crashed 3/3 while a tick that never enters the addon
// exited 0, and stopping/unref'ing the pump at teardown did not help. With the
// view-gated beat the smoke leg is back to exit 0 (10/10) and this suite sees the race
// only where a file's OWN JS-armed GLib work runs close to teardown (measured on one
// Fedora 44 desktop WITH a session bus: 2/38 files, both "every announced test passed,
// then SIGSEGV"). It is the same pre-existing race, not a new one: it also reproduces
// with an explicit `startMainContextPump()` call on the pre-fix engine, the crashing
// thread carries only deno/V8 JIT frames (GLib's own threads are idle), and a plain
// `deno run <bundle>` of the same work exits 0. Bun is unaffected (38/38 with the pump
// armed).
//
// ROOT CAUSE (#47, diagnosed against deno 2.9.3, glibc/gobject, exit 139 = SIGSEGV):
// a segfault inside libgobject g_type_fundamental, called from the boxed-handle
// External finalizer (marshal.cc FreeBoxedHandleRecord -> g_boxed_free) with a
// GARBAGE GType. `napi_create_external` registers its finalizer BOTH in Deno's
// ref_tracker (run on the main thread by MainWorker::run_napi_ref_finalizers) AND as
// a V8 weak Reference (js_native_api.rs `weak_callback`). At isolate DISPOSAL V8
// fires the second-pass weak callback on the isolate-owning tokio thread, over
// Reference state Deno's teardown is concurrently freeing, so it hands our finalizer
// a stale `finalize_data` — g_boxed_free then reads a garbage gtype and segfaults.
// This is NOT node-gi-fixable: (1) the corrupt pointer IS the finalizer's own `data`
// argument — dereferencing it is the crash, and there is no way to validate a boxed
// record without dereferencing it; (2) Deno fires NO env-cleanup hook before these
// weak callbacks (they run BEFORE NapiState::Drop, lib.rs), so a global teardown flag
// is never set in time; (3) the env still reports JS-available at the callback, so a
// #730-style NodeGiJsAvailable(env) gate does not trip either. All three seams were
// tried empirically and none catch it — like the worker.terminate() SIGSEGV, it is a
// Deno-runtime limitation, and this results-based carve-out is the correct treatment.
//
// So on DENO (all platforms) we gate on the per-subtest RESULTS parsed from Deno's
// own output instead of the process exit code: if every test the run announced
// actually ran and none reported FAILED, a non-zero exit is the known teardown
// artifact (non-gating). A real assertion failure (a FAILED line) OR a truncated run
// (fewer results than the "running N tests" header promised — i.e. a genuine mid-test
// crash) still HARD-gates. node / bun keep exit-code gating unchanged. See #47.
const denoTeardownCarveout = runtime === 'deno';

// BUN was investigated for the SAME teardown class (#58) and is deliberately NOT
// carved out — it stays on plain exit-code gating (above). The Deno root cause does
// not transfer to Bun's N-API teardown, confirmed both by mechanism and empirically:
//   • Mechanism: for a non-EXPERIMENTAL module (node-addon-api) Bun DEFERS the boxed-
//     handle External finalizer — NapiExternal's destructor enqueues a NapiFinalizerTask
//     onto the JS/main-thread event loop instead of running it inline
//     (napi.h mustDeferFinalizers()/napi_internal_enqueue_finalizer). At env teardown
//     the finalizers run single-threaded on the JS thread, under DeferGCForAWhile, with
//     napi_internal_remove_finalizer dedup — so FreeBoxedHandleRecord always receives
//     node-gi's OWN valid BoxedHandle* (its gtype is intact), never a stale finalize_data
//     handed over by a concurrent runtime-worker weak callback. That concurrency — V8
//     firing the second-pass weak callback on the isolate-owning tokio thread over
//     Reference state Deno is freeing — IS the Deno crash, and Bun has no equivalent
//     (its own crash marker even reads `panic(main thread)`).
//   • Empirically: ~7000 Bun runs (arrays + the GObject/boxed-heavy files incl. `methods`,
//     full 37-file suite ×40, a probe holding 30k live boxed handles to process exit,
//     random --smol GC pressure) produced 0 crashes / 0 cores. The SAME box + harness
//     reproduces the Deno crash readily (8 SIGSEGV/SIGABRT cores; gdb: SIGSEGV inside
//     libgobject-2.0.so.0 on a runtime-worker thread, main thread idle in epoll_wait).
// So a `pass>0 && fail===0 && <crash marker>` Bun carve-out would only MASK a real
// node-gi/Bun teardown bug if one ever appears. Do NOT add one on inference: if Bun ever
// hard-crashes here, re-confirm with a gdb backtrace (the Deno determination's bar) first.

// Parse Deno's test output into { expected, ran, failed } by counting its per-subtest
// result lines ("<name> ... ok|FAILED|ignored (<dur>)") and the "running N tests from"
// headers. ANSI colour codes are stripped first. `teardownArtifact` is true iff every
// announced test ran and none failed (so a non-zero exit is the post-pass teardown
// abort), false on any FAILED line or a short run (crash before all tests reported).
function classifyDenoOutput(out) {
  // oxlint-disable-next-line eslint/no-control-regex -- matching the ESC control character IS the point: this strips Deno's ANSI SGR colour codes before parsing its output
  const clean = out.replace(/\x1b\[[0-9;]*m/g, '');
  let expected = 0;
  // `tests?` — Deno prints "running 1 test from …" (singular) for a one-test file.
  // Matching only the plural left `expected` at 0 there, which made the carve-out's
  // `expected > 0` guard fail and hard-gated a file whose single test had PASSED
  // (dbus-async, on a host that actually has a session bus).
  for (const m of clean.matchAll(/running (\d+) tests? from /g)) expected += Number(m[1]);
  const passed = (clean.match(/ \.\.\. ok \(/g) || []).length;
  const ignored = (clean.match(/ \.\.\. ignored/g) || []).length;
  const failed = (clean.match(/ \.\.\. FAILED/g) || []).length;
  const ran = passed + ignored + failed;
  return { expected, ran, passed, ignored, failed, teardownArtifact: expected > 0 && ran === expected && failed === 0 };
}

// Which native binary the children load (see index.js nativeCandidates). Default
// to the JUST-BUILT addon so a stale staged prebuild can't shadow local
// verification; CI's cross-runtime job overrides with NODE_GI_NATIVE=prebuild to
// keep validating the prebuild load path (Deno's install path) explicitly.
const nativePref = process.env.NODE_GI_NATIVE ?? 'build';

console.log(`node-gi: running ${files.length} conformance files on ${runtime} (one process per file)\n`);
let failed = 0;
let softFailed = 0;
for (const base of files) {
  const file = join('test', `${base}.test.mjs`);
  const res = spawnSync(runtimeBin, argsFor(file), {
    cwd: pkgRoot,
    encoding: 'utf8',
    env: { ...process.env, NODE_GI_NATIVE: nativePref },
  });
  const teardown = denoTeardownCarveout && res.status !== 0
    ? classifyDenoOutput((res.stdout || '') + '\n' + (res.stderr || ''))
    : null;
  if (res.status === 0) {
    console.log(`  ✓ ${base}`);
  } else if (teardown?.teardownArtifact) {
    softFailed++;
    console.log(
      `  ⚠ ${base} (known non-gating: deno teardown-exit after ${teardown.ran}/${teardown.expected} tests passed, 0 failed — see #47)`,
    );
  } else {
    failed++;
    console.log(`  ✗ ${base}`);
    console.error((res.stdout || '') + '\n' + (res.stderr || ''));
  }
}

const green = files.length - failed - softFailed;
console.log(
  `\n${runtime}: ${green}/${files.length} conformance files green` +
    (softFailed ? `, ${softFailed} known non-gating` : '') +
    (failed ? `, ${failed} FAILED` : ''),
);
process.exit(failed === 0 ? 0 : 1);
