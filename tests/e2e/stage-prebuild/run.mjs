// E2E test for `scripts/stage-prebuild.mjs` — the shared native-prebuild stager.
//
// Regression guard for the OS/arch axis. Eleven packages used to stage their
// prebuild with a hand-written one-liner:
//
//     mkdir -p prebuilds/linux-x64 && cp build/libfoo.so … prebuilds/linux-x64/
//
// which is wrong twice off Linux/x86_64: the target directory is hard-coded,
// and so is the `.so` suffix — a macOS build emits `.dylib`, so `cp` fails and
// `gjsify workspace <pkg> build:prebuilds` cannot stage anything at all. That
// is the reason the darwin prebuilds had to be produced by a bespoke CI job
// rather than by the package's own script.
//
// Two properties this pins, because both are load-bearing for the audit:
//
//   1. The directory name is taken from the package's own `gjsify.platforms`
//      declaration, never invented — an undeclared host is a hard error, so a
//      local build cannot create a target CI does not reproduce.
//   2. Artifacts are matched by EXTENSION, not by filename, so renaming a
//      library in meson.build cannot silently ship a stale/partial set.
//   3. The target carries the host's LIBC: a build on musl stages into
//      `<os>-<arch>-musl` and NEVER falls back to `<os>-<arch>`. The fallback
//      would be the tempting behaviour and is exactly wrong — the unsuffixed
//      directory is the DEFAULT build a glibc host resolves, so a musl-linked
//      library there is an artifact that cannot load on the platform it is
//      published for. Injected `libc` values are how that branch is tested from
//      a glibc host, since there is no musl runner in this repo's CI.
//
// The host's own target is IMPORTED (`hostStagingTarget`) rather than composed
// from `process.platform`/`process.arch`, per the standing item in
// `status/open-todos.md`: nine fixtures recomposed that name and the last
// vocabulary change had to fix all nine by hand, missing one because a composed
// string never appears as a literal.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/stage-prebuild/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const STAGER = join(MONOREPO_ROOT, 'scripts', 'stage-prebuild.mjs');

const { pickDeclaredTarget, resolveHostLibc, hostStagingTarget } = await import(`file://${STAGER}`);

/** The one target this host stages into — imported, never recomposed. */
const HOST_TARGET = hostStagingTarget();

/** Build a throwaway package with a `build/` dir holding `files`. */
function fixture(platforms, files) {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-stage-'));
    writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: '@gjsify/fixture-native', gjsify: { prebuilds: 'prebuilds', platforms } }),
    );
    mkdirSync(join(dir, 'build'), { recursive: true });
    for (const f of files) writeFileSync(join(dir, 'build', f), f);
    return dir;
}

function runStager(dir, ...extra) {
    return execFileSync(process.execPath, [STAGER, dir, ...extra], { encoding: 'utf8' });
}

/** A POST-SPLIT bridge: declares platforms, owns no `prebuilds/` (ADR 0017). */
function splitBridgeFixture(platforms, files) {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-stage-split-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@gjsify/fixture-bridge', gjsify: { platforms } }));
    mkdirSync(join(dir, 'build'), { recursive: true });
    for (const f of files) writeFileSync(join(dir, 'build', f), f);
    return dir;
}

describe('stage-prebuild: target selection', () => {
    it('matches the host on the ONE `${platform}-${arch}` spelling', () => {
        const declared = ['linux-x64', 'linux-arm64', 'darwin-arm64', 'win32-x64'];
        assert.equal(pickDeclaredTarget(declared, 'linux', 'x64'), 'linux-x64');
        assert.equal(pickDeclaredTarget(declared, 'linux', 'arm64'), 'linux-arm64');
        assert.equal(pickDeclaredTarget(declared, 'darwin', 'arm64'), 'darwin-arm64');
        assert.equal(pickDeclaredTarget(declared, 'win32', 'x64'), 'win32-x64');
        // Identical in both vocabularies — nothing to translate.
        assert.equal(pickDeclaredTarget(['linux-riscv64'], 'linux', 'riscv64'), 'linux-riscv64');
    });

    it('does NOT accept the retired uname spelling', () => {
        // The stager is a WRITE path: accepting `linux-x86_64` here is how a
        // second spelling would creep back onto disk. A declaration in the old
        // vocabulary fails the audit (`scripts/audit-runtimes.mjs --check`) and
        // fails here too, with the actionable "not in `gjsify.platforms`"
        // message — never by silently staging into an undeclared directory.
        assert.equal(pickDeclaredTarget(['linux-x86_64'], 'linux', 'x64'), null);
        assert.equal(pickDeclaredTarget(['linux-aarch64'], 'linux', 'arm64'), null);
    });

    it('returns null for a host the package does not declare', () => {
        const declared = ['linux-x64'];
        assert.equal(pickDeclaredTarget(declared, 'win32', 'x64'), null);
        assert.equal(pickDeclaredTarget(declared, 'darwin', 'arm64'), null);
        assert.equal(pickDeclaredTarget(declared, 'linux', 'riscv64'), null);
    });

    it('does not confuse one OS for another at the same arch', () => {
        assert.equal(pickDeclaredTarget(['darwin-arm64'], 'linux', 'arm64'), null);
    });

    it('stages a musl build into the -musl target', () => {
        const declared = ['linux-x64', 'linux-x64-musl'];
        assert.equal(pickDeclaredTarget(declared, 'linux', 'x64', 'musl'), 'linux-x64-musl');
        // …and a glibc build into the default build, from the SAME declaration.
        assert.equal(pickDeclaredTarget(declared, 'linux', 'x64', 'glibc'), 'linux-x64');
        assert.equal(pickDeclaredTarget(declared, 'linux', 'x64'), 'linux-x64');
    });

    it('does NOT fall back to the default build on a musl host', () => {
        // The whole libc axis in one assertion. `linux-x64` IS declared, so a
        // "closest match" stager would use it — and would write a musl-linked
        // library into the directory a GLIBC host resolves, producing an
        // artifact that cannot load on the platform it is published for.
        // `audit-runtimes --check`'s `prebuild-libc` rule fails on exactly that,
        // so the stager must refuse first, with a message naming the token.
        assert.equal(pickDeclaredTarget(['linux-x64'], 'linux', 'x64', 'musl'), null);
    });

    it('never selects a -musl target for a glibc host', () => {
        // A musl artifact cannot load against glibc, so this must be a clean
        // miss rather than a "the only Linux directory there is" match.
        assert.equal(pickDeclaredTarget(['linux-x64-musl'], 'linux', 'x64', 'glibc'), null);
        assert.equal(pickDeclaredTarget(['linux-x64-musl'], 'linux', 'x64'), null);
    });

    it('ignores a musl claim on an OS that has no musl', () => {
        assert.equal(pickDeclaredTarget(['darwin-arm64'], 'darwin', 'arm64', 'musl'), 'darwin-arm64');
        assert.equal(pickDeclaredTarget(['darwin-arm64-musl'], 'darwin', 'arm64', 'musl'), null);
    });
});

describe('stage-prebuild: host libc detection', () => {
    it('trusts the glibc runtime version, then the musl loader probe', () => {
        // Two independent facts, one pure decision. `glibcVersionRuntime` is
        // present iff the running process is linked against glibc; the loader
        // probe is a fact about the SYSTEM, which is what answers on a musl host
        // where the first is simply absent.
        assert.equal(resolveHostLibc({ platform: 'linux', glibcVersionRuntime: '2.42' }), 'glibc');
        assert.equal(resolveHostLibc({ platform: 'linux', muslLoaderPresent: true }), 'musl');
        assert.equal(resolveHostLibc({ platform: 'linux', muslLoaderPresent: false }), 'glibc');
    });

    it('reports no libc axis off Linux', () => {
        // npm defines `libc` as Linux-only; every other OS ships one C library.
        assert.equal(resolveHostLibc({ platform: 'darwin', muslLoaderPresent: true }), null);
        assert.equal(resolveHostLibc({ platform: 'win32' }), null);
    });

    it('derives a host target that differs from `<platform>-<arch>` only by the libc suffix', () => {
        // Host-agnostic shape assertion, so this passes on the glibc runners AND
        // on an Alpine developer machine. It is also the property that makes
        // `hostStagingTarget()` safe to use as the fixtures' only source for the
        // directory name: whatever the host, the token is the canonical
        // `<os>-<arch>` plus at most `-musl`.
        const base = `${process.platform}-${process.arch}`;
        assert.ok(
            HOST_TARGET === base || HOST_TARGET === `${base}-musl`,
            `host target ${HOST_TARGET} is neither ${base} nor ${base}-musl`,
        );
    });
});

describe('stage-prebuild: staging', () => {
    it('copies every artifact extension, including .dylib', () => {
        const dir = fixture(
            [HOST_TARGET, 'linux-x64', 'darwin-arm64'],
            [
                'libfoo.so',
                'libfoo.dylib',
                'Foo-1.0.gir',
                'Foo-1.0.typelib',
                'meson-logs.txt', // not an artifact — must NOT be staged
            ],
        );
        try {
            runStager(dir);
            const staged = readdirSync(join(dir, 'prebuilds', HOST_TARGET)).sort();
            assert.deepEqual(staged, ['Foo-1.0.gir', 'Foo-1.0.typelib', 'libfoo.dylib', 'libfoo.so']);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('replaces a stale artifact set rather than merging into it', () => {
        const dir = fixture([HOST_TARGET, 'linux-x64', 'darwin-arm64'], ['libold.so']);
        try {
            runStager(dir);
            // Rename the library, as a meson.build edit would.
            rmSync(join(dir, 'build', 'libold.so'));
            writeFileSync(join(dir, 'build', 'libnew.so'), 'new');
            runStager(dir);
            const staged = readdirSync(join(dir, 'prebuilds', HOST_TARGET));
            assert.deepEqual(staged, ['libnew.so'], 'the renamed-away library must not survive');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('--dest stages OUTSIDE the package for a target undeclared by design', () => {
        // `prebuilds.yml`'s musl leg. After ADR 0017 a bridge owns no
        // `prebuilds/`, so `resolveStageDir` resolves to a sibling platform
        // package and REFUSES when there is none — and for this leg there never
        // is one, because it builds targets no package declares yet. Measured in
        // `alpine:3.24`: the musl build succeeds and staging failed with
        // `sab-native-linux-x64-musl/ does not exist`.
        //
        // The escape is a NAMED destination, not a relaxed default: everything
        // after it — replace-not-merge, the extension match, `checkPrebuildDir()`
        // — still runs, which is why the leg routes through this script at all
        // instead of a `cp`.
        const other = process.platform === 'linux' ? 'darwin-arm64' : 'linux-x64';
        const dir = splitBridgeFixture([other], ['libfoo.so', 'Foo-1.0.typelib']);
        const dest = mkdtempSync(join(tmpdir(), 'gjsify-stage-dest-'));
        try {
            runStager(dir, '--allow-undeclared', '--dest', dest);
            assert.deepEqual(readdirSync(join(dest, HOST_TARGET)).sort(), ['Foo-1.0.typelib', 'libfoo.so']);
            // And nothing inside the package — the directory `files` does not
            // ship and no conformance rule can see is exactly what must not appear.
            assert.ok(!readdirSync(dir).includes('prebuilds'), 'must not stage into the bridge');
        } finally {
            rmSync(dir, { recursive: true, force: true });
            rmSync(dest, { recursive: true, force: true });
        }
    });

    it('refuses --dest without --allow-undeclared', () => {
        // The two together mean "not a promised target AND not going into a
        // package". Allowing `--dest` alone would let a DECLARED target's shipped
        // artifact be redirected out of the one directory `files` ships, which is
        // the quiet failure `resolveStageDir` was written to remove.
        const dir = splitBridgeFixture([HOST_TARGET], ['libfoo.so']);
        const dest = mkdtempSync(join(tmpdir(), 'gjsify-stage-dest-'));
        try {
            assert.throws(() => runStager(dir, '--dest', dest), /requires .--allow-undeclared./);
        } finally {
            rmSync(dir, { recursive: true, force: true });
            rmSync(dest, { recursive: true, force: true });
        }
    });

    it('fails loudly on a host the package does not declare', () => {
        // Declare only a target this host cannot be.
        const other = process.platform === 'linux' ? 'darwin-arm64' : 'linux-x64';
        const dir = fixture([other], ['libfoo.so']);
        try {
            assert.throws(() => runStager(dir), /not in/i);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('refuses a declaration that omits this host’s libc variant', () => {
        // On glibc this is the plain undeclared-host case. On a musl host it is
        // the libc case, and the point of the assertion: `linux-x64` alone is not
        // a target a musl build may stage into, however tempting the fallback.
        // Either way the stager must not invent a directory.
        const base = `${process.platform}-${process.arch}`;
        const withoutHost = HOST_TARGET === base ? [`${base}-musl`] : [base];
        const dir = fixture(withoutHost, ['libfoo.so']);
        try {
            assert.throws(() => runStager(dir), /not in/i);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('fails loudly when the build produced no artifact', () => {
        const dir = fixture([HOST_TARGET, 'linux-x64', 'darwin-arm64'], ['meson-logs.txt']);
        try {
            assert.throws(() => runStager(dir), /none of/i);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
