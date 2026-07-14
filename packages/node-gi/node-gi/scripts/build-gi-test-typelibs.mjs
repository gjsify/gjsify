// SPDX-License-Identifier: MIT
// Reproducible builder for the GI test typelibs (GIMarshallingTests-1.0,
// Regress-1.0, …) that the tier-B conformance oracle (gimarshalling/) runs
// against. The purpose-built test libraries come from GNOME's
// gobject-introspection-tests project — the SAME pinned revision GJS itself
// tests against, so the oracle and the reference runtime agree on the C side.
//
//   node scripts/build-gi-test-typelibs.mjs
//
// Everything lands under the gitignored `.gi-tests/`:
//   .gi-tests/src/    the upstream checkout at PINNED_REV
//   .gi-tests/build/  the meson out-of-tree build dir
//   .gi-tests/lib/    the collected artifacts (*.typelib + lib*.so) + rev stamp
//
// Idempotent: a second run with the stamp matching PINNED_REV and the key
// artifacts present is a no-op. Cairo is disabled (-Dcairo=false) to keep the
// dependency footprint at glib/gobject/gio — the project supports it and
// Regress still builds (it just omits the cairo cases, which GJS's
// testGIMarshalling.js does not use).
//
// LOCAL FAST PATH: when the read-only refs checkout
// refs/gjs/subprojects/gobject-introspection-tests exists AND already sits at
// PINNED_REV, it is copied instead of cloning (CI has no refs checkout and
// always clones). refs/ is never written to.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The pinned upstream revision. Source of truth: the wrap file GJS pins its
// own test suite to — refs/gjs/subprojects/gobject-introspection-tests.wrap
// ([wrap-git] revision). Bump ONLY together with a refs/gjs bump so the port
// and the C side stay in lockstep.
export const PINNED_REV = '67432ee4ebf74349cb3c848f73945b21a767e276';
export const UPSTREAM_URL = 'https://gitlab.gnome.org/GNOME/gobject-introspection-tests.git';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const giTestsDir = join(pkgRoot, '.gi-tests');
const srcDir = join(giTestsDir, 'src');
const buildDir = join(giTestsDir, 'build');
export const libDir = join(giTestsDir, 'lib');
const stampPath = join(libDir, '.pinned-rev');

// The refs checkout inside the gjsify repo (packages/node-gi/node-gi → repo root).
const refsCheckout = join(pkgRoot, '..', '..', '..', 'refs', 'gjs', 'subprojects', 'gobject-introspection-tests');

// Artifacts that MUST exist for the oracle to run; everything the build
// produces is collected, but these gate the idempotence check.
const REQUIRED_ARTIFACTS = [
  'GIMarshallingTests-1.0.typelib',
  'libgimarshallingtests.so',
  'Regress-1.0.typelib',
  'libregress.so',
];

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.error) throw res.error;
  return res.status ?? 1;
}

function capture(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return { status: res.status ?? 1, stdout: (res.stdout ?? '').trim(), stderr: (res.stderr ?? '').trim() };
}

function ensureTool(name, hint) {
  const res = spawnSync(name, ['--version'], { stdio: 'ignore' });
  if (res.error || res.status !== 0) {
    throw new Error(`build-gi-test-typelibs: '${name}' is not on PATH — ${hint}`);
  }
}

/** The HEAD revision of a git worktree, or null (also null when `dir` is only a
 * subdirectory inside some OTHER repo — git would walk up and report that repo). */
function headRevOf(dir) {
  if (!existsSync(join(dir, '.git'))) return null;
  const top = capture('git', ['-C', dir, 'rev-parse', '--show-toplevel']);
  if (top.status !== 0 || top.stdout !== dir) return null;
  const head = capture('git', ['-C', dir, 'rev-parse', 'HEAD']);
  return head.status === 0 ? head.stdout : null;
}

/** True when the stamp matches PINNED_REV and the required artifacts exist. */
export function typelibsReady() {
  if (!existsSync(stampPath)) return false;
  if (readFileSync(stampPath, 'utf8').trim() !== PINNED_REV) return false;
  return REQUIRED_ARTIFACTS.every((f) => existsSync(join(libDir, f)));
}

function ensureSource() {
  // Already checked out at the pin — nothing to do.
  if (headRevOf(srcDir) === PINNED_REV) return;

  // Local fast path: reuse the read-only refs checkout when it matches the pin.
  if (existsSync(join(refsCheckout, 'meson.build')) && headRevOf(refsCheckout) === PINNED_REV) {
    console.log(`build-gi-test-typelibs: copying refs checkout (${PINNED_REV.slice(0, 12)}) → .gi-tests/src`);
    rmSync(srcDir, { recursive: true, force: true });
    cpSync(refsCheckout, srcDir, { recursive: true });
    return;
  }

  ensureTool('git', 'install git to clone the pinned test project');
  rmSync(srcDir, { recursive: true, force: true });
  mkdirSync(srcDir, { recursive: true });

  // Prefer a shallow fetch of exactly the pinned rev (the same shape meson's
  // wrap resolver uses); fall back to a full clone when the server refuses
  // fetching an unadvertised SHA.
  console.log(`build-gi-test-typelibs: cloning ${UPSTREAM_URL} @ ${PINNED_REV.slice(0, 12)}`);
  const shallow =
    run('git', ['-C', srcDir, 'init', '--quiet']) === 0 &&
    run('git', ['-C', srcDir, 'remote', 'add', 'origin', UPSTREAM_URL]) === 0 &&
    run('git', ['-C', srcDir, 'fetch', '--quiet', '--depth', '1', 'origin', PINNED_REV]) === 0 &&
    run('git', ['-C', srcDir, 'checkout', '--quiet', '--detach', PINNED_REV]) === 0;
  if (!shallow) {
    console.log('build-gi-test-typelibs: shallow fetch failed — falling back to a full clone');
    rmSync(srcDir, { recursive: true, force: true });
    if (run('git', ['clone', '--quiet', UPSTREAM_URL, srcDir]) !== 0) {
      throw new Error(`build-gi-test-typelibs: git clone of ${UPSTREAM_URL} failed`);
    }
    if (run('git', ['-C', srcDir, 'checkout', '--quiet', '--detach', PINNED_REV]) !== 0) {
      throw new Error(`build-gi-test-typelibs: revision ${PINNED_REV} not found in ${UPSTREAM_URL}`);
    }
  }
  if (headRevOf(srcDir) !== PINNED_REV) {
    throw new Error(`build-gi-test-typelibs: checkout is not at the pinned revision ${PINNED_REV}`);
  }
}

function build() {
  ensureTool('meson', 'install meson + ninja (e.g. `dnf install meson ninja-build`)');
  // A build dir configured for a DIFFERENT source rev must not be reused —
  // simplest correct invalidation is to reconfigure from scratch whenever the
  // stamp does not match (we only get here in that case).
  rmSync(buildDir, { recursive: true, force: true });
  if (run('meson', ['setup', buildDir, srcDir, '-Dcairo=false'], { cwd: giTestsDir }) !== 0) {
    throw new Error('build-gi-test-typelibs: meson setup failed (are glib2/gobject-introspection -devel headers installed?)');
  }
  if (run('meson', ['compile', '-C', buildDir]) !== 0) {
    throw new Error('build-gi-test-typelibs: meson compile failed');
  }
}

function collectArtifacts() {
  rmSync(libDir, { recursive: true, force: true });
  mkdirSync(libDir, { recursive: true });
  // All targets land flat in the build root (typelibs + shared libraries);
  // collect every one so Regress's dependencies (Utility-1.0, libutility.so, …)
  // travel along. Files only — meson also creates lib*.so.p/ object dirs.
  const artifacts = readdirSync(buildDir, { withFileTypes: true })
    .filter((e) => e.isFile() && (e.name.endsWith('.typelib') || (e.name.startsWith('lib') && e.name.endsWith('.so'))))
    .map((e) => e.name);
  for (const f of artifacts) cpSync(join(buildDir, f), join(libDir, f));
  const missing = REQUIRED_ARTIFACTS.filter((f) => !existsSync(join(libDir, f)));
  if (missing.length > 0) {
    throw new Error(`build-gi-test-typelibs: build produced no ${missing.join(', ')} — check the meson output`);
  }
  writeFileSync(stampPath, `${PINNED_REV}\n`);
  console.log(`build-gi-test-typelibs: ${artifacts.length} artifact(s) → .gi-tests/lib (rev ${PINNED_REV.slice(0, 12)})`);
}

/** Build the typelibs if the pinned artifacts are not already present. */
export function ensureTypelibs() {
  if (typelibsReady()) {
    console.log(`build-gi-test-typelibs: up to date (rev ${PINNED_REV.slice(0, 12)}) — nothing to do`);
    return;
  }
  ensureSource();
  build();
  collectArtifacts();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    ensureTypelibs();
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exit(1);
  }
}
