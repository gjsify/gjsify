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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const programsDir = join(pkgRoot, 'conformance', 'programs');
const goldenDir = join(pkgRoot, 'conformance', 'golden');
const distDir = join(pkgRoot, 'conformance', 'dist');
const ledgerPath = join(pkgRoot, 'conformance', 'ledger.json');

const ALL_RUNTIMES = ['gjs', 'node', 'bun', 'deno'];
const LEDGERABLE_RUNTIMES = ['node', 'bun', 'deno']; // gjs IS the reference — never ledgered

const usage =
  'usage: node scripts/conformance.mjs [--runtimes=gjs,node,bun,deno] [--filter=<substr>] [--update-golden]';

// ---- flags ------------------------------------------------------------------
let runtimes = ALL_RUNTIMES;
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
  const rewritten = src.replace(
    /import\s+(\w+)\s+from\s+['"]gi:\/\/(\w+)\?version=([\d.]+)['"];?/g,
    (_m, ident, ns, ver) => `const ${ident} = requireGi('${ns}', '${ver}');`,
  );
  const body = "import '../../globals.js';\n" + "import { requireGi } from '../../gi.js';\n" + rewritten;
  mkdirSync(distDir, { recursive: true });
  const out = join(distDir, `${name}.node.mjs`);
  writeFileSync(out, body);
  return out;
}

// argv to run `entry` under `runtime` (gjs runs the program itself, the others
// run the generated twin).
function argvFor(runtime, entry) {
  if (runtime === 'gjs') return ['gjs', ['-m', entry]];
  if (runtime === 'deno') return ['deno', ['run', '-A', entry]];
  return [runtime, [entry]]; // node, bun
}

function runOn(runtime, entry) {
  const [cmd, args] = argvFor(runtime, entry);
  const res = spawnSync(cmd, args, {
    cwd: pkgRoot,
    encoding: 'utf8',
    env: childEnv,
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
    let entry = file;
    if (rt !== 'gjs') {
      if (twin === null) twin = writeRuntimeTwin(name, file);
      entry = twin;
    }
    const run = runOn(rt, entry);
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
