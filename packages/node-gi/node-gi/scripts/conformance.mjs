// SPDX-License-Identifier: MIT
// Golden-diff conformance harness for @gjsify/node-gi — the exactness oracle.
//
//   node scripts/conformance.mjs [--runtimes=gjs,node,bun,deno] [--filter=<substr>] [--update-golden]
//
// Small self-contained `gi://` programs (conformance/programs/*.conf.mjs) run
// UNCHANGED on all four runtimes and their STDOUT must be byte-identical to the
// committed golden file (conformance/golden/<name>.txt):
//   • gjs  — `gjs -m <program>` (native gi://, ambient print — the REFERENCE);
//     gjs is also asserted against the golden: a gjs↔golden drift means either
//     GJS changed or the golden is stale, and MUST fail loudly.
//   • node/bun/deno — a generated runtime twin (conformance/dist/<name>.node.mjs,
//     gitignored): the globals shim + requireGi prepended, each
//     `import X from 'gi://Ns?version=V';` rewritten to `const X = requireGi(...)`.
//     Relative imports into the package — no bundler, no node_modules.
//   • gjs-napi — node-gi THE ADDON run under GJS via the @gjsify/napi N-API shim
//     (a differential oracle: NOT native gi://, NOT a production path). Each
//     program becomes a `gjsify build --app gjs` bundle (gi:// → requireGi; the
//     .node routed through the shim by node-gi's gjs host mode) run with `gjs -m`,
//     and its stdout must match the same golden. OPT-IN + heavy (one build per
//     program) → not in the default set; select it with `--runtimes=gjs-napi`.
//
// Only STDOUT is compared (gjs may emit GLib warnings on stderr); stderr is
// shown on failure for diagnosis. Children run with LC_ALL=C so locale can't
// flavor the output, and NODE_GI_NATIVE defaults to `build` so local runs
// exercise the just-built addon (CI may override, e.g. `prebuild`).
//
// Ledger contract (conformance/ledger.json — STRICT, the whole point):
//   • a FAILING program×runtime combo WITH a ledger entry → reported LEDGERED
//     (a documented, committed exclusion — not a failure);
//   • a failing combo WITHOUT a ledger entry → failure;
//   • a PASSING combo that still has a ledger entry → failure ("stale ledger
//     entry — remove it").
// Exit 0 only with zero unexpected results. gjs/node never auto-skip (gjs
// missing on PATH is a hard error unless --runtimes excludes it); bun/deno
// auto-skip with a diagnostic when not installed.
//
// NB: the filename deliberately avoids Node's default test glob (`*.test.mjs`,
// …) so `node --test` does not pick this orchestrator up as a test.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const programsDir = join(pkgRoot, 'conformance', 'programs');
const goldenDir = join(pkgRoot, 'conformance', 'golden');
const distDir = join(pkgRoot, 'conformance', 'dist');
const ledgerPath = join(pkgRoot, 'conformance', 'ledger.json');

// The four twinless/twin runtimes (default matrix) + `gjs-napi`: node-gi THE
// ADDON run under GJS through the @gjsify/napi N-API shim (a differential oracle
// against native `gi://`). gjs-napi is NOT in the default set — it is a heavy,
// opt-in leg (one `gjsify build --app gjs` per program) selected explicitly with
// `--runtimes=gjs-napi`. See the gjs-napi block further below.
const ALL_RUNTIMES = ['gjs', 'node', 'bun', 'deno', 'gjs-napi'];
const DEFAULT_RUNTIMES = ['gjs', 'node', 'bun', 'deno'];
// gjs IS the reference (its output IS the golden) → never ledgered. Every other
// runtime — the Node-API trio AND gjs-napi (node-gi-under-shim, NOT native gi://)
// — is a differential target whose deviations must be ledgered with a real reason.
const LEDGERABLE_RUNTIMES = ['node', 'bun', 'deno', 'gjs-napi'];

const usage =
  'usage: node scripts/conformance.mjs [--runtimes=gjs,node,bun,deno,gjs-napi] [--filter=<substr>] [--update-golden]';

// ---- flags ------------------------------------------------------------------
let runtimes = DEFAULT_RUNTIMES;
let filter = '';
let updateGolden = false;
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--runtimes=')) {
    runtimes = arg
      .slice('--runtimes='.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (arg.startsWith('--filter=')) {
    filter = arg.slice('--filter='.length);
  } else if (arg === '--update-golden') {
    updateGolden = true;
  } else {
    console.error(`conformance: unknown argument '${arg}'\n${usage}`);
    process.exit(2);
  }
}
for (const rt of runtimes) {
  if (!ALL_RUNTIMES.includes(rt)) {
    console.error(`conformance: unknown runtime '${rt}' (expected: ${ALL_RUNTIMES.join(', ')})\n${usage}`);
    process.exit(2);
  }
}
if (updateGolden && !runtimes.includes('gjs')) {
  console.error('conformance: --update-golden needs the gjs leg (goldens are the gjs output)');
  process.exit(2);
}

// Children env: LC_ALL=C keeps locale out of the output; NODE_GI_NATIVE=build
// pins local verification to the just-built addon (harmless where index.js
// predates the knob; CI's cross-runtime legs may override with `prebuild`).
const childEnv = { ...process.env, NODE_GI_NATIVE: process.env.NODE_GI_NATIVE ?? 'build', LC_ALL: 'C' };

// ---- gjs-napi leg wiring ----------------------------------------------------
// node-gi-the-addon run UNDER GJS via the @gjsify/napi N-API shim. Each program
// becomes a `gjsify build --app gjs` bundle (node-gi's node:* imports → the
// @gjsify/* polyfills; the addon routed through the shim by node-gi's gjs host
// mode) run with `gjs -m`. Reuses the packages/napi/napi/test/nodegi-gate.mjs
// recipe: GJSIFY_CLI_ENTRY, NODE_GI_NATIVE pinned to an absolute addon path, and
// GI_TYPELIB_PATH/LD_LIBRARY_PATH pointed at the shim prebuild so
// `imports.gi.GjsifyNapi` resolves. Bundles are cached under conformance/dist/
// (gitignored); clear it after editing node-gi or the shim (the bundle inlines
// node-gi's JS).
const repoRoot = join(pkgRoot, '..', '..', '..'); // packages/node-gi/node-gi → gjsify repo root
const napiPkg = join(repoRoot, 'packages', 'napi', 'napi');
// The @gjsify/napi shim prebuild dir uses the `linux-x86_64` uname-style triple
// (build:prebuilds hardcodes it), NOT Node's `${platform}-${arch}` (`linux-x64`).
const shimTriple = process.platform === 'linux' && process.arch === 'x64' ? 'linux-x86_64' : `${process.platform}-${process.arch}`;
const shimPrebuildDir = join(napiPkg, 'prebuilds', shimTriple);
const cliEntry = process.env.GJSIFY_CLI_ENTRY || join(repoRoot, 'packages', 'infra', 'cli', 'lib', 'index.js');

// The node-gi addon as an ABSOLUTE path (a --app gjs bundle anchors import.meta
// at the bundle, so node-gi's package-relative probing can't find it — it must be
// pinned via NODE_GI_NATIVE). Mirrors index.js nativeCandidates() `prefer` order.
function resolveNodeGiAddon() {
  const prefer = childEnv.NODE_GI_NATIVE; // 'build' by default here
  const release = join(pkgRoot, 'build', 'Release', 'node_gi.node');
  const debug = join(pkgRoot, 'build', 'Debug', 'node_gi.node');
  const prebuild = join(pkgRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'node_gi.node');
  let order;
  if (prefer === 'prebuild') order = [prebuild];
  else if (prefer && prefer !== 'build') order = [prefer]; // an explicit path to a node_gi.node
  else order = [release, debug, prebuild]; // 'build' / unset → the just-built addon
  return order.find((p) => existsSync(p)) ?? null;
}
const nodeGiAddon = resolveNodeGiAddon();

// ---- discovery --------------------------------------------------------------
const programs = readdirSync(programsDir)
  .filter((f) => f.endsWith('.conf.mjs'))
  .sort()
  .map((f) => ({ name: f.slice(0, -'.conf.mjs'.length), file: join(programsDir, f) }))
  .filter((p) => p.name.includes(filter));
if (programs.length === 0) {
  console.error(`conformance: no programs match (dir ${programsDir}, filter '${filter}')`);
  process.exit(2);
}

// ---- ledger -----------------------------------------------------------------
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
if (!Array.isArray(ledger.entries)) {
  console.error(`conformance: ${ledgerPath} must have an "entries" array`);
  process.exit(2);
}
const allProgramNames = readdirSync(programsDir)
  .filter((f) => f.endsWith('.conf.mjs'))
  .map((f) => f.slice(0, -'.conf.mjs'.length));
for (const e of ledger.entries) {
  // Shape-validate every entry up front so a typo'd entry can't silently excuse
  // an unrelated failure: known program, ledgerable runtime, non-empty reason.
  if (!allProgramNames.includes(e.program)) {
    console.error(`conformance: ledger entry for unknown program '${e.program}' — remove it`);
    process.exit(1);
  }
  if (!LEDGERABLE_RUNTIMES.includes(e.runtime)) {
    console.error(
      `conformance: ledger entry '${e.program}' has runtime '${e.runtime}' (must be one of: ${LEDGERABLE_RUNTIMES.join('|')})`,
    );
    process.exit(1);
  }
  if (typeof e.reason !== 'string' || e.reason.trim() === '') {
    console.error(`conformance: ledger entry '${e.program}' × '${e.runtime}' needs a non-empty reason`);
    process.exit(1);
  }
}
const ledgered = (program, runtime) =>
  ledger.entries.find((e) => e.program === program && e.runtime === runtime);

// ---- runtime availability ---------------------------------------------------
function isOnPath(cmd) {
  try {
    const res = spawnSync(cmd, ['--version'], { stdio: 'ignore', timeout: 15000 });
    return res.status === 0;
  } catch {
    return false;
  }
}

const available = {};
for (const rt of runtimes) {
  if (rt === 'node') {
    available.node = true; // we ARE node
  } else if (rt === 'gjs') {
    // gjs is the reference — a missing gjs must never silently degrade the
    // harness to a node-only echo chamber. Excluding it is an explicit act
    // (--runtimes=node,... without gjs).
    if (!isOnPath('gjs')) {
      console.error('conformance: gjs is not on PATH — the reference runtime is required.');
      console.error('Install gjs, or exclude it explicitly via --runtimes= (goldens stay authoritative).');
      process.exit(1);
    }
    available.gjs = true;
  } else if (rt === 'gjs-napi') {
    // Opt-in heavy oracle: every prerequisite is REQUIRED (you selected it
    // explicitly). Fail loud rather than skip, so a half-built tree can't
    // silently shrink the matrix and pass a hollow run.
    const problems = [];
    if (!isOnPath('gjs')) problems.push('gjs is not on PATH (the host runtime)');
    if (!existsSync(cliEntry)) problems.push(`gjsify Node CLI not built at ${cliEntry} (or set GJSIFY_CLI_ENTRY)`);
    if (!existsSync(shimPrebuildDir))
      problems.push(`@gjsify/napi shim prebuild missing: ${shimPrebuildDir} (run: gjsify run build:prebuilds in ${napiPkg})`);
    if (!nodeGiAddon) problems.push(`node-gi addon not built under ${join(pkgRoot, 'build')} (run: npm install / node-gyp rebuild)`);
    if (problems.length > 0) {
      console.error('conformance: the gjs-napi leg cannot run — missing prerequisites:');
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    available['gjs-napi'] = true;
  } else {
    available[rt] = isOnPath(rt);
    if (!available[rt]) console.error(`conformance: ${rt} not on PATH — skipped (install it to widen the matrix)`);
  }
}

// ---- runtime twin -----------------------------------------------------------
// The node-gi twin of a program: prepend the ambient-globals shim (print/ARGV/…)
// + requireGi, rewrite each `gi://` default import — the exact shape the gjsify
// `--app node` bundler emits, minus the bundler. Adapted from
// packages/node-gi/example/harness.mjs (writeRuntimeTwin), with RELATIVE imports
// into this package so no node_modules layout is needed.
function writeRuntimeTwin(name, file) {
  const src = readFileSync(file, 'utf8');
  const rewritten = src
    .replace(
      /import\s+(\w+)\s+from\s+['"]gi:\/\/(\w+)\?version=([\d.]+)['"];?/g,
      (_m, ident, ns, ver) => `const ${ident} = requireGi('${ns}', '${ver}');`,
    )
    // The GJS built-in `cairo` module: on gjs it is a native import; the node twin
    // resolves it to this package's L1 cairo.js (the bare `cairo` specifier the
    // gjsify --app node build aliases to @gjsify/node-gi/cairo).
    .replace(/import\s+(\w+)\s+from\s+['"]cairo['"];?/g, (_m, ident) => `import ${ident} from '../../cairo.js';`);
  const body = "import '../../globals.js';\n" + "import { requireGi } from '../../gi.js';\n" + rewritten;
  mkdirSync(distDir, { recursive: true });
  const out = join(distDir, `${name}.node.mjs`);
  writeFileSync(out, body);
  return out;
}

// The gjs-napi twin SOURCE of a program: like the node twin (gi:// → requireGi,
// bare `cairo` → this package's cairo.js) but WITHOUT globals.js — under GJS the
// ambient globals (print / imports / console / ARGV) are NATIVE, so only requireGi
// (node-gi's L1) is wired. node-gi's gjs host mode routes the addon through the
// shim. The file sits one level under conformance/ so `../../gi.js` reaches the
// package root, exactly like the node twin's dist/ files.
function gjsNapiTwinSrc(name, file) {
  const src = readFileSync(file, 'utf8');
  const rewritten = src
    .replace(
      /import\s+(\w+)\s+from\s+['"]gi:\/\/(\w+)\?version=([\d.]+)['"];?/g,
      (_m, ident, ns, ver) => `const ${ident} = requireGi('${ns}', '${ver}');`,
    )
    .replace(/import\s+(\w+)\s+from\s+['"]cairo['"];?/g, (_m, ident) => `import ${ident} from '../../cairo.js';`);
  return "import { requireGi } from '../../gi.js';\n" + rewritten;
}

// node-gi's L1 entry files whose JS is INLINED into every gjs-napi bundle. A
// stale bundle validating an OLD node-gi is the "stale dist bundle trap" — so the
// cache invalidates when either changes (the common edit), on top of the program
// source. Deeper edits (an override, a polyfill) still want a `conformance/dist/`
// wipe; the header + package.json script note that.
const inlinedNodeGiDeps = [join(pkgRoot, 'gi.js'), join(pkgRoot, 'index.js')];

// Build (or reuse a cached) `--app gjs` bundle for the gjs-napi leg. Returns the
// bundle path, or `{ buildError }` on a bundler failure. Cache key: the generated
// twin source is byte-stable AND the bundle is newer than the program source AND
// newer than node-gi's inlined L1 entry files.
function buildGjsNapiBundle(name, file) {
  mkdirSync(distDir, { recursive: true });
  const srcPath = join(distDir, `${name}.gjs-napi.src.mjs`);
  const bundlePath = join(distDir, `${name}.gjs-napi.mjs`);
  const srcBody = gjsNapiTwinSrc(name, file);
  const newestDepMs = Math.max(
    statSync(file).mtimeMs,
    ...inlinedNodeGiDeps.filter((p) => existsSync(p)).map((p) => statSync(p).mtimeMs),
  );
  const cached =
    existsSync(bundlePath) &&
    existsSync(srcPath) &&
    readFileSync(srcPath, 'utf8') === srcBody &&
    statSync(bundlePath).mtimeMs >= newestDepMs;
  writeFileSync(srcPath, srcBody);
  if (cached) return bundlePath;
  const res = spawnSync(process.execPath, [cliEntry, 'build', srcPath, '--app', 'gjs', '--outfile', bundlePath], {
    cwd: pkgRoot,
    encoding: 'utf8',
    timeout: 300 * 1000,
  });
  if (res.status !== 0 || !existsSync(bundlePath)) {
    return { buildError: `gjsify build --app gjs failed (exit ${res.status})\n${(res.stderr ?? '').trim()}` };
  }
  return bundlePath;
}

// argv to run `entry` under `runtime` (gjs / gjs-napi run a program/bundle with
// `gjs -m`, the others run the generated twin).
function argvFor(runtime, entry) {
  if (runtime === 'gjs' || runtime === 'gjs-napi') return ['gjs', ['-m', entry]];
  if (runtime === 'deno') return ['deno', ['run', '-A', entry]];
  return [runtime, [entry]]; // node, bun
}

function runOn(runtime, entry) {
  const [cmd, args] = argvFor(runtime, entry);
  // gjs-napi needs the shim on the GI/loader path (so `imports.gi.GjsifyNapi`
  // resolves) + the addon pinned to an absolute path (bundled import.meta).
  const env =
    runtime === 'gjs-napi'
      ? { ...childEnv, NODE_GI_NATIVE: nodeGiAddon, GI_TYPELIB_PATH: shimPrebuildDir, LD_LIBRARY_PATH: shimPrebuildDir }
      : childEnv;
  const res = spawnSync(cmd, args, {
    cwd: pkgRoot,
    encoding: 'utf8',
    env,
    timeout: 60 * 1000,
  });
  return {
    ok: res.status === 0,
    stdout: (res.stdout ?? '').trim(),
    stderr: (res.stderr ?? '').trim(),
    status: res.status,
  };
}

// ---- run matrix -------------------------------------------------------------
const results = new Map(); // `${program}\0${runtime}` → '✓' | '✗' | 'LEDGERED' | 'skipped'
const failures = [];

for (const { name, file } of programs) {
  const goldenPath = join(goldenDir, `${name}.txt`);

  if (updateGolden) {
    const gjs = runOn('gjs', file);
    if (!gjs.ok) {
      console.error(`conformance: ${name}: gjs failed (exit ${gjs.status}) — cannot update golden`);
      console.error(`--- stderr ---\n${gjs.stderr}`);
      process.exit(1);
    }
    mkdirSync(goldenDir, { recursive: true });
    writeFileSync(goldenPath, `${gjs.stdout}\n`);
    console.log(`conformance: golden updated: conformance/golden/${name}.txt`);
  }

  if (!existsSync(goldenPath)) {
    console.error(`conformance: ${name}: missing golden (run with --update-golden and commit it)`);
    process.exit(1);
  }
  const golden = readFileSync(goldenPath, 'utf8').trim();

  let twin = null;
  for (const rt of runtimes) {
    const key = `${name}\0${rt}`;
    if (!available[rt]) {
      results.set(key, 'skipped');
      continue;
    }
    let run;
    if (rt === 'gjs-napi') {
      const built = buildGjsNapiBundle(name, file);
      run =
        built && built.buildError
          ? { ok: false, stdout: '', stderr: built.buildError, status: null }
          : runOn(rt, built);
    } else {
      let entry = file;
      if (rt !== 'gjs') {
        if (twin === null) twin = writeRuntimeTwin(name, file);
        entry = twin;
      }
      run = runOn(rt, entry);
    }
    const pass = run.ok && run.stdout === golden;
    const excuse = LEDGERABLE_RUNTIMES.includes(rt) ? ledgered(name, rt) : undefined;

    if (pass && excuse === undefined) {
      results.set(key, '✓');
    } else if (pass && excuse !== undefined) {
      // The strict half of the contract: an exclusion must not outlive the gap.
      results.set(key, '✗');
      failures.push(`${name} × ${rt}: PASSES but has a ledger entry — stale ledger entry, remove it (reason was: ${excuse.reason})`);
    } else if (!pass && excuse !== undefined) {
      results.set(key, 'LEDGERED');
    } else {
      results.set(key, '✗');
      const detail = run.ok
        ? `stdout != golden\n--- got ---\n${run.stdout}\n--- golden ---\n${golden}`
        : `exit ${run.status}\n--- stdout ---\n${run.stdout}`;
      failures.push(`${name} × ${rt}: ${detail}\n--- stderr ---\n${run.stderr}`);
    }
  }
}

// ---- report -----------------------------------------------------------------
const nameWidth = Math.max(...programs.map((p) => p.name.length), 'program'.length);
const colWidth = Math.max(...runtimes.map((r) => r.length), 'LEDGERED'.length) + 2;
const pad = (s, w) => s.padEnd(w);
console.log(`\nconformance matrix (golden = gjs output, ${programs.length} program(s)):\n`);
console.log(pad('program', nameWidth + 2) + runtimes.map((r) => pad(r, colWidth)).join(''));
for (const { name } of programs) {
  const row = runtimes.map((rt) => pad(results.get(`${name}\0${rt}`) ?? '-', colWidth)).join('');
  console.log(pad(name, nameWidth + 2) + row);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} unexpected result(s):\n`);
  for (const f of failures) console.error(`✗ ${f}\n`);
  process.exit(1);
}
console.log('\nconformance: all green (no unexpected results)');
process.exit(0);
