// E2E test for the prebuild-declaration invariant in
// `scripts/audit-runtimes.mjs` — "a declared platform must have a body, and
// that body must be loadable".
//
// `gjsify.platforms` is the OS-axis promise; the platform audit next to this
// one compares it against the directory names a package happens to carry and
// the targets a CI job produces. All three can agree while the promise is
// EMPTY: `@gjsify/oxfmt-native` declared `darwin-arm64` for weeks with no
// artifact behind it and `--check` exited 0 the entire time, because a target
// with no directory is simply absent from the set it compares against.
//
// The second half is the one that is easy to get wrong. A directory that
// exists proves nothing — the macOS incident (#832) was a required job that
// built two bridges and only COPIED them, and the bug hiding there was a
// missing sibling FILE that read exactly like a broken rpath. So the audit
// verifies every committed artifact structurally (machine matches its
// directory, typelib-named libraries staged, self-relative sibling
// resolution) and actually `dlopen`s the ones whose target is this host's.
//
// Fixtures are SYNTHETIC packages in a temp directory holding REAL linked
// binaries copied out of the committed prebuilds. Two reasons:
//   • proving "a missing directory fails" means removing one, and the e2e
//     suites run four-at-a-time against one shared checkout — mutating the
//     repository here would break whatever else is reading it;
//   • the binaries are real, so the ELF/Mach-O parsing under test is exercised
//     against genuine artifacts rather than hand-rolled headers.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/prebuild-declaration-invariant/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const AUDIT = join(MONOREPO_ROOT, 'scripts', 'audit-runtimes.mjs');

const { auditPrebuildArtifacts } = await import(`file://${AUDIT}`);
// The libc axis is a SECOND rule over the same committed directories, so it is
// driven from the same synthetic fixtures — the alternative would be inventing a
// parallel fixture builder and letting the two drift.
const { auditPrebuildLibc } = await import(
    `file://${join(MONOREPO_ROOT, 'packages', 'infra', 'manifest-conformance', 'lib', 'index.mjs')}`
);

/** A real, correctly-linked linux-x64 prebuild to copy from. */
const REAL_X64 = join(MONOREPO_ROOT, 'packages', 'node', 'terminal-native', 'prebuilds', 'linux-x64');
const REAL_X64_FILES = ['libgjsifyterminal.so', 'GjsifyTerminal-1.0.typelib'];
/** A real arm64 one — the wrong-machine fixture, from this x64 host's view. */
const REAL_ARM64 = join(MONOREPO_ROOT, 'packages', 'node', 'terminal-native', 'prebuilds', 'linux-arm64');
/**
 * A real GLIBC-linked pair (`libc.so.6` in DT_NEEDED, floor GLIBC_2.2.5) and a
 * real LIBC-AGNOSTIC one (GLib/GIO/GnuTLS only, no libc soname at all). The libc
 * rule's whole verdict turns on which of the two a directory holds, so both come
 * from committed artifacts rather than hand-built headers.
 */
const GLIBC_LINKED = { dir: REAL_X64, files: REAL_X64_FILES, floor: '2.2.5' };
const LIBC_AGNOSTIC = {
    dir: join(MONOREPO_ROOT, 'packages', 'node', 'tls-native', 'prebuilds', 'linux-x64'),
    files: ['libgjsifytls.so', 'GjsifyTls-1.0.typelib'],
};
/**
 * A real prebuild that records the glibc DYNAMIC LOADER, not merely `libc.so.6`.
 *
 * This is the third state, and the only one from which "cannot load on musl"
 * follows: `libc.so.6` is a musl RESERVED name (musl resolves it to itself), so a
 * glibc-linked library naming it very often loads on Alpine — six of this repo's
 * bridges provably do. `ld-linux-*.so.*` is not reserved, so musl tries to open a
 * file that does not exist and the load fails outright.
 *
 * `tls-native`'s riscv64 build is the fixture because Fedora's riscv64 toolchain
 * records the interpreter explicitly, and it is committed — the same
 * real-artifact-over-hand-built-header rule as the two above.
 */
const GLIBC_LOADER = {
    dir: join(MONOREPO_ROOT, 'packages', 'node', 'tls-native', 'prebuilds', 'linux-riscv64'),
    files: ['libgjsifytls.so', 'GjsifyTls-1.0.typelib'],
    floor: '2.27',
};

/** @type {string[]} */ const tmpDirs = [];
function scratch() {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-prebuild-invariant-'));
    tmpDirs.push(dir);
    return dir;
}
process.on('exit', () => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

/**
 * Build one synthetic row in the shape `collectNativePackages()` produces.
 *
 * @param {object} opts
 * @param {string[]} opts.declared `gjsify.platforms`
 * @param {Record<string, string[]>} [opts.stage] target → files to copy from a
 *   real prebuild (`from` selects which one)
 * @param {string} [opts.from] source prebuild directory (default: the x64 one)
 * @param {Record<string, string>} [opts.extraFiles] target → {name: contents}
 * @param {*} [opts.uncommitted] raw `gjsify.platformsUncommitted` value
 * @param {boolean} [opts.namesPrebuildDir] whether `gjsify.prebuilds` is set
 */
function pkg({ declared, stage = {}, from = REAL_X64, extraFiles = {}, uncommitted = null, namesPrebuildDir = true }) {
    const root = scratch();
    const prebuildDir = join(root, 'prebuilds');
    mkdirSync(prebuildDir, { recursive: true });
    for (const [target, names] of Object.entries(stage)) {
        mkdirSync(join(prebuildDir, target), { recursive: true });
        for (const n of names) copyFileSync(join(from, n), join(prebuildDir, target, n));
    }
    for (const [target, files] of Object.entries(extraFiles)) {
        mkdirSync(join(prebuildDir, target), { recursive: true });
        for (const [name, contents] of Object.entries(files)) {
            writeFileSync(join(prebuildDir, target, name), contents);
        }
    }
    const shipped = [...new Set([...Object.keys(stage), ...Object.keys(extraFiles)])].sort();
    return {
        name: '@gjsify/fixture',
        path: 'packages/fixture',
        tier: 3,
        builder: 'meson',
        declared: [...declared].sort(),
        shipped,
        prebuildsField: namesPrebuildDir ? 'prebuilds' : null,
        prebuildDir,
        uncommitted,
    };
}

/** @param {object} row */
const failuresFor = (row) => auditPrebuildArtifacts([row]).failures;

describe('prebuild invariant — half 1: a declared platform must have a body', () => {
    it('FAILS on a declared target with no prebuild directory (the oxfmt-native gap)', () => {
        const problems = failuresFor(
            pkg({ declared: ['linux-x64', 'darwin-arm64'], stage: { 'linux-x64': REAL_X64_FILES } }),
        );
        assert.equal(problems.length, 1);
        assert.match(problems[0], /declares `darwin-arm64` but ships no `prebuilds\/darwin-arm64\/`/);
        // The message must name BOTH ways out, or the next person picks the
        // one that hides the gap.
        assert.match(problems[0], /gjsify\.platformsUncommitted/);
    });

    it('PASSES once the directory is there', () => {
        assert.deepEqual(failuresFor(pkg({ declared: ['linux-x64'], stage: { 'linux-x64': REAL_X64_FILES } })), []);
    });

    it('FAILS on a directory with a typelib but no shared library', () => {
        const problems = failuresFor(
            pkg({ declared: ['linux-x64'], stage: { 'linux-x64': ['GjsifyTerminal-1.0.typelib'] } }),
        );
        assert.equal(problems.length, 1);
        assert.match(problems[0], /holds no `\.so`/);
    });

    it('FAILS on a directory with a shared library but no typelib — GI cannot reach it', () => {
        const problems = failuresFor(
            pkg({ declared: ['linux-x64'], stage: { 'linux-x64': ['libgjsifyterminal.so'] } }),
        );
        assert.equal(problems.length, 1);
        assert.match(problems[0], /holds no `\.typelib`/);
    });

    it('does NOT apply to a package that names no `gjsify.prebuilds` directory (node-gyp)', () => {
        // `@gjsify/node-gi` builds on install / ships from a release artifact,
        // so this repo owes no committed body for its declared targets.
        assert.deepEqual(failuresFor(pkg({ declared: ['linux-x64', 'win32-x64'], namesPrebuildDir: false })), []);
    });
});

describe('prebuild invariant — half 2: a body that exists must be loadable', () => {
    it('FAILS on an image whose machine does not match its directory (the QEMU leg)', () => {
        // An arm64 ELF staged as linux-x64. This is the check that caught the
        // emulated prebuild legs shipping host x86-64 into
        // `prebuilds/linux-{ppc64,s390x,riscv64}/` — and the ONE loadability
        // defect a cross-arch target can be caught for from any host, because
        // the machine is in the file header.
        const problems = failuresFor(
            pkg({ declared: ['linux-x64'], from: REAL_ARM64, stage: { 'linux-x64': REAL_X64_FILES } }),
        );
        assert.ok(problems.length >= 1, 'expected the machine mismatch to be reported');
        assert.match(problems[0], /is a linux\/arm64 image in a `linux-x64` directory/);
    });

    it('FAILS when the typelib names a library that is not staged beside it', () => {
        // The typelib records `libgjsifyterminal.so`; stage a DIFFERENTLY
        // named real library instead, exactly as a `meson.build` rename that
        // the staging step follows but the typelib does not would produce.
        const row = pkg({ declared: ['linux-x64'], stage: { 'linux-x64': ['GjsifyTerminal-1.0.typelib'] } });
        copyFileSync(join(REAL_X64, 'libgjsifyterminal.so'), join(row.prebuildDir, 'linux-x64', 'libgjsifyrenamed.so'));
        const problems = failuresFor(row);
        assert.equal(problems.length, 1);
        assert.match(problems[0], /records shared library `libgjsifyterminal\.so`, which is NOT staged/);
    });

    it('FAILS on a file with a library extension that is not a library at all', () => {
        const problems = failuresFor(
            pkg({
                declared: ['linux-x64'],
                stage: { 'linux-x64': REAL_X64_FILES },
                extraFiles: { 'linux-x64': { 'libtruncated.so': 'not an image' } },
            }),
        );
        assert.ok(
            problems.some((p) => /is neither ELF, Mach-O nor PE/.test(p)),
            problems.join('\n'),
        );
    });

    it('FAILS on a `.typelib` that does not carry the GI magic', () => {
        const problems = failuresFor(
            pkg({
                declared: ['linux-x64'],
                stage: { 'linux-x64': ['libgjsifyterminal.so'] },
                extraFiles: { 'linux-x64': { 'Fake-1.0.typelib': 'x'.repeat(128) } },
            }),
        );
        assert.ok(
            problems.some((p) => /does not carry the GI typelib magic/.test(p)),
            problems.join('\n'),
        );
    });

    it('reports how far it got — structural everywhere, functional only on this host', () => {
        const { stats } = auditPrebuildArtifacts([
            pkg({
                declared: ['linux-x64', 'linux-arm64'],
                stage: { 'linux-x64': REAL_X64_FILES },
                from: REAL_X64,
                extraFiles: {},
            }),
        ]);
        // linux-arm64 is declared but not staged here, so only the host
        // directory is counted — the point of the assertion is that the two
        // numbers are tracked SEPARATELY and neither is inferred from the
        // other. A cross-arch directory can never join `loaded`.
        assert.equal(stats.dirs, 1);
        assert.ok(stats.loaded + stats.hostSkipped >= 0);
    });
});

describe('prebuild invariant — the escape hatch is honest, not a mute button', () => {
    const REASON = 'built + uploaded by napi.yml; no job commits it back here';

    it('accepts a declared-but-uncommitted target with a reason, and SAYS so', () => {
        const { failures, notes, stats } = auditPrebuildArtifacts([
            pkg({
                declared: ['linux-x64', 'darwin-arm64'],
                stage: { 'linux-x64': REAL_X64_FILES },
                uncommitted: { 'darwin-arm64': REASON },
            }),
        ]);
        assert.deepEqual(failures, []);
        assert.equal(stats.uncommitted, 1);
        // Exempt is not the same as silent: the reason has to surface on every
        // run, or the field becomes the silent gap it replaced.
        assert.ok(
            notes.some((n) => n.includes('darwin-arm64') && n.includes(REASON)),
            notes.join('\n'),
        );
    });

    it('REJECTS an exemption with no reason', () => {
        const problems = failuresFor(
            pkg({
                declared: ['linux-x64', 'darwin-arm64'],
                stage: { 'linux-x64': REAL_X64_FILES },
                uncommitted: { 'darwin-arm64': '   ' },
            }),
        );
        assert.ok(
            problems.some((p) => /needs a non-empty reason/.test(p)),
            problems.join('\n'),
        );
    });

    it('REJECTS exempting a target the package does not even declare', () => {
        const problems = failuresFor(
            pkg({
                declared: ['linux-x64'],
                stage: { 'linux-x64': REAL_X64_FILES },
                uncommitted: { 'darwin-arm64': REASON },
            }),
        );
        assert.ok(
            problems.some((p) => /you can only defer shipping something you promise/.test(p)),
            problems.join('\n'),
        );
    });

    it('REJECTS a stale exemption once the artifact IS committed', () => {
        // Otherwise the hatch outlives its cause and quietly exempts a
        // directory that is now under the full contract.
        const problems = failuresFor(
            pkg({
                declared: ['linux-x64'],
                stage: { 'linux-x64': REAL_X64_FILES },
                uncommitted: { 'linux-x64': REASON },
            }),
        );
        assert.ok(
            problems.some((p) => /IS committed now/.test(p)),
            problems.join('\n'),
        );
    });

    it('REJECTS a malformed exemption value', () => {
        const problems = failuresFor(
            pkg({
                declared: ['linux-x64'],
                stage: { 'linux-x64': REAL_X64_FILES },
                uncommitted: ['darwin-arm64'],
            }),
        );
        assert.ok(
            problems.some((p) => /must be an object mapping/.test(p)),
            problems.join('\n'),
        );
    });

    it('REJECTS the field on a package that owes no committed artifacts', () => {
        const problems = failuresFor(
            pkg({
                declared: ['linux-x64'],
                namesPrebuildDir: false,
                uncommitted: { 'linux-x64': REASON },
            }),
        );
        assert.ok(
            problems.some((p) => /is not under that contract at all/.test(p)),
            problems.join('\n'),
        );
    });
});

// ─── the libc axis ──────────────────────────────────────────────────────────
//
// `prebuild-artifacts` above proves a declared target has a loadable body. It
// says nothing about the C LIBRARY that body needs, and before `prebuild-libc`
// nothing did: not one package in the tree declared `libc`, so every native
// bridge installed happily on Alpine and then failed at `dlopen` — the least
// diagnosable shape there is. The glibc floor was equally unmeasured, which hid
// that ONE artifact (`@gjsify/lightningcss-native`, GLIBC_2.39) sets the whole
// repo's Linux baseline while its siblings sit as low as 2.2.5.

/**
 * A synthetic row in the shape `collectLibcPackages()` produces — the
 * `prebuild-artifacts` row plus the two manifest fields this rule reads
 * (`libc` is a plain npm field; `gjsify.glibcRequires` is new).
 *
 * @param {object} opts
 * @param {string[]} opts.declared `gjsify.platforms`
 * @param {Record<string, {dir: string, files: string[]}>} [opts.stage] target → real prebuild to copy
 * @param {Record<string, Record<string, string>>} [opts.extraFiles] target → {name: contents}
 * @param {*} [opts.libc] raw npm `libc` value
 * @param {*} [opts.glibcRequires] raw `gjsify.glibcRequires` value
 * @param {*} [opts.uncommitted] raw `gjsify.platformsUncommitted` value
 */
function libcPkg({ declared, stage = {}, extraFiles = {}, libc, glibcRequires, uncommitted = null }) {
    const root = scratch();
    const prebuildDir = join(root, 'prebuilds');
    mkdirSync(prebuildDir, { recursive: true });
    for (const [target, source] of Object.entries(stage)) {
        mkdirSync(join(prebuildDir, target), { recursive: true });
        for (const n of source.files) copyFileSync(join(source.dir, n), join(prebuildDir, target, n));
    }
    for (const [target, files] of Object.entries(extraFiles)) {
        mkdirSync(join(prebuildDir, target), { recursive: true });
        for (const [name, contents] of Object.entries(files)) {
            writeFileSync(join(prebuildDir, target, name), contents);
        }
    }
    const manifest = { name: '@gjsify/fixture' };
    if (libc !== undefined) manifest.libc = libc;
    const manifestGjsify = {};
    if (glibcRequires !== undefined) manifestGjsify.glibcRequires = glibcRequires;
    return {
        name: '@gjsify/fixture',
        path: 'packages/fixture',
        tier: 3,
        builder: 'meson',
        declared: [...declared].sort(),
        shipped: [...new Set([...Object.keys(stage), ...Object.keys(extraFiles)])].sort(),
        prebuildsField: 'prebuilds',
        prebuildDir,
        uncommitted,
        manifest,
        manifestGjsify,
    };
}

/** @param {object} row */
const libcFailures = (row) => auditPrebuildLibc([row]).failures;

describe('prebuild-libc — the `libc` field must match the binaries', () => {
    it('does NOT demand `libc` from a glibc-LINKED target with no glibc loader', () => {
        // THE CORRECTION. The obvious rule — "links glibc ⇒ declare
        // libc: ["glibc"]" — is what this rule shipped with, and a container probe
        // on alpine:3.24 disproved it: musl treats a DT_NEEDED of `libc.so.6` as a
        // request for ITSELF (a reserved name it refuses to reload), so six of this
        // repo's glibc bridges load AND run on musl. Demanding the field from them
        // would make every package manager refuse the install on Alpine —
        // postmarketOS, the platform the whole libc axis was added for.
        //
        // So this state is UNDETERMINED, not glibc-only, and the rule must neither
        // require the field nor forbid it. It says so in a note instead.
        const row = libcPkg({
            declared: ['linux-x64'],
            stage: { 'linux-x64': GLIBC_LINKED },
            glibcRequires: { 'linux-x64': '2.2.5' },
        });
        const { failures, notes } = auditPrebuildLibc([row]);
        assert.deepEqual(failures, []);
        assert.ok(
            notes.some((n) => /undetermined/.test(n) && /musl aliases libc\.so\.6 to itself/.test(n)),
            notes.join('\n'),
        );
    });

    it('FAILS when every target records the glibc LOADER and nothing declares `libc`', () => {
        // The one state from which unloadability on musl actually follows, and the
        // only one where a package-level `["glibc"]` is provably right. This is the
        // three Rust bridges on x64 — their cargo cdylib records `ld-linux-*`.
        const problems = libcFailures(
            libcPkg({
                declared: ['linux-riscv64'],
                stage: { 'linux-riscv64': GLIBC_LOADER },
                glibcRequires: { 'linux-riscv64': '2.27' },
            }),
        );
        assert.equal(problems.length, 1);
        assert.match(problems[0], /records the glibc dynamic loader/);
        assert.match(problems[0], /"libc": \["glibc"\]/);
    });

    it('PASSES once `libc: ["glibc"]` is declared', () => {
        assert.deepEqual(
            libcFailures(
                libcPkg({
                    declared: ['linux-x64'],
                    stage: { 'linux-x64': GLIBC_LINKED },
                    libc: ['glibc'],
                    glibcRequires: { 'linux-x64': '2.2.5' },
                }),
            ),
            [],
        );
    });

    it('FAILS on `libc` declared for an artifact that records NO libc soname', () => {
        // `@gjsify/tls-native`'s x64 build reaches libc only through GLib, so it
        // runs on either. A `libc` filter there refuses installs on hosts where
        // the artifact works — a promise that costs the user something and buys
        // nothing.
        const problems = libcFailures(
            libcPkg({ declared: ['linux-x64'], stage: { 'linux-x64': LIBC_AGNOSTIC }, libc: ['glibc'] }),
        );
        assert.equal(problems.length, 1);
        assert.match(problems[0], /not one of its committed Linux libraries records a libc soname/);
    });

    it('PASSES with no `libc` at all when every artifact is libc-agnostic', () => {
        assert.deepEqual(libcFailures(libcPkg({ declared: ['linux-x64'], stage: { 'linux-x64': LIBC_AGNOSTIC } })), []);
    });

    it("leaves `libc` ABSENT for a MIXED package, and names each target's musl verdict", () => {
        // The measured reality for `@gjsify/tls-native` and
        // `@gjsify/webrtc-native`: libc-agnostic on most targets, constrained on
        // one or two (Fedora's riscv64/arm64 toolchains record libc explicitly).
        // npm's `libc` is one package-level filter with no per-target dimension,
        // so declaring it would refuse the install everywhere — including where
        // the artifact genuinely works. The note is the mechanism that keeps the
        // gap visible instead of implied.
        const row = libcPkg({
            declared: ['linux-x64', 'linux-arm64'],
            stage: { 'linux-x64': LIBC_AGNOSTIC, 'linux-arm64': GLIBC_LINKED },
            glibcRequires: { 'linux-arm64': '2.2.5' },
        });
        const { failures, notes } = auditPrebuildLibc([row]);
        assert.deepEqual(failures, []);
        assert.ok(
            notes.some((n) => /deliberately ABSENT/.test(n) && /linux-arm64 undetermined/.test(n)),
            notes.join('\n'),
        );
        // Declaring it anyway is still a failure HERE — and for a reason no load
        // test can overturn: linux-x64 records no libc soname at all, so it
        // provably runs on either libc and the filter would refuse a working
        // install. That is the one mixed shape where the field stays forbidden.
        assert.ok(
            libcFailures({ ...row, manifest: { ...row.manifest, libc: ['glibc'] } }).some((p) =>
                /record no libc soname at all and therefore run on either libc/.test(p),
            ),
        );
    });

    it('FAILS on a `libc` value no package manager recognises', () => {
        const problems = libcFailures(
            libcPkg({
                declared: ['linux-x64'],
                stage: { 'linux-x64': GLIBC_LINKED },
                libc: 'glibc',
                glibcRequires: { 'linux-x64': '2.2.5' },
            }),
        );
        assert.ok(
            problems.some((p) => /must be a non-empty array of npm's own tokens/.test(p)),
            problems.join('\n'),
        );
    });
});

describe('prebuild-libc — the token must agree with what is in the directory', () => {
    it('FAILS on a `-musl` directory holding a glibc-linked library', () => {
        // Strictly worse than shipping nothing: a musl host resolves the
        // suffixed token FIRST, so this directory SHADOWS the default build that
        // might have loaded.
        const problems = libcFailures(
            libcPkg({
                declared: ['linux-x64-musl'],
                stage: { 'linux-x64-musl': GLIBC_LINKED },
                glibcRequires: { 'linux-x64-musl': '2.2.5' },
            }),
        );
        assert.ok(
            problems.some((p) => /is a musl target but its libraries link glibc/.test(p)),
            problems.join('\n'),
        );
    });

    it('accepts a `-musl` directory holding a libc-agnostic library', () => {
        // No libc soname at all is compatible with either token — the artifact
        // loads against whatever libc the host's GLib was built for.
        assert.deepEqual(
            libcFailures(libcPkg({ declared: ['linux-x64-musl'], stage: { 'linux-x64-musl': LIBC_AGNOSTIC } })),
            [],
        );
    });

    it('skips non-Linux targets entirely — npm defines `libc` as Linux-only', () => {
        const { failures, stats } = auditPrebuildLibc([
            libcPkg({
                declared: ['linux-x64', 'darwin-arm64'],
                stage: { 'linux-x64': GLIBC_LINKED },
                libc: ['glibc'],
                glibcRequires: { 'linux-x64': '2.2.5' },
            }),
        ]);
        assert.deepEqual(failures, []);
        assert.equal(stats.skippedNonLinux, 1);
        // Skipped is COUNTED, never silent — the same discipline the artifact
        // rule applies to its cross-arch boundary.
        assert.equal(stats.targets, 1);
    });
});

describe('prebuild-libc — the glibc floor is measured, never assumed', () => {
    it('FAILS when the measured floor EXCEEDS the declared one', () => {
        const problems = libcFailures(
            libcPkg({
                declared: ['linux-x64'],
                stage: { 'linux-x64': GLIBC_LINKED },
                libc: ['glibc'],
                glibcRequires: { 'linux-x64': '2.2' },
            }),
        );
        assert.ok(
            problems.some((p) =>
                /requires glibc ≥ 2\.2\.5 but `gjsify\.glibcRequires\["linux-x64"\]` promises 2\.2/.test(p),
            ),
            problems.join('\n'),
        );
    });

    it('does NOT fail on a conservative declaration above what the build needs', () => {
        // A deliberate distro baseline is a legitimate promise; failing it would
        // make one impossible to state. Reported as a note instead.
        const { failures, notes } = auditPrebuildLibc([
            libcPkg({
                declared: ['linux-x64'],
                stage: { 'linux-x64': GLIBC_LINKED },
                libc: ['glibc'],
                glibcRequires: { 'linux-x64': '2.28' },
            }),
        ]);
        assert.deepEqual(failures, []);
        assert.ok(
            notes.some((n) => /declares glibc ≥ 2\.28 but today's artifact only needs 2\.2\.5/.test(n)),
            notes.join('\n'),
        );
    });

    it('REPORTS the measured maximum when nothing is declared', () => {
        // Never a silent pass: the number is printed with the exact edit that
        // turns it into a promise the next rebuild is held to.
        const { notes } = auditPrebuildLibc([
            libcPkg({ declared: ['linux-x64'], stage: { 'linux-x64': GLIBC_LINKED }, libc: ['glibc'] }),
        ]);
        assert.ok(
            notes.some((n) => /requires glibc ≥ 2\.2\.5 .*undeclared/.test(n)),
            notes.join('\n'),
        );
    });

    it('REJECTS a floor for a target `gjsify.platforms` does not declare', () => {
        const problems = libcFailures(
            libcPkg({
                declared: ['linux-x64'],
                stage: { 'linux-x64': GLIBC_LINKED },
                libc: ['glibc'],
                glibcRequires: { 'linux-x64': '2.2.5', 'linux-s390x': '2.2' },
            }),
        );
        assert.ok(
            problems.some((p) => /names a target `gjsify\.platforms`.*does not declare/.test(p)),
            problems.join('\n'),
        );
    });

    it('REJECTS a floor on a non-Linux target and a non-string value', () => {
        assert.ok(
            libcFailures(
                libcPkg({
                    declared: ['linux-x64', 'darwin-arm64'],
                    stage: { 'linux-x64': GLIBC_LINKED },
                    libc: ['glibc'],
                    glibcRequires: { 'linux-x64': '2.2.5', 'darwin-arm64': '2.2' },
                }),
            ).some((p) => /is not a Linux target/.test(p)),
        );
        assert.ok(
            libcFailures(
                libcPkg({
                    declared: ['linux-x64'],
                    stage: { 'linux-x64': GLIBC_LINKED },
                    libc: ['glibc'],
                    glibcRequires: { 'linux-x64': 2.39 },
                }),
            ).some((p) => /must be a dotted glibc release as a STRING/.test(p)),
        );
    });

    it('FAILS on a `.so` whose ELF cannot be read, rather than calling it libc-free', () => {
        // The one outcome the rule must never produce: "records no libc.so.6,
        // therefore musl-safe" derived from a file nobody parsed. A check that
        // claims more than it did is worse than no check.
        const problems = libcFailures(
            libcPkg({
                declared: ['linux-x64'],
                stage: { 'linux-x64': GLIBC_LINKED },
                extraFiles: { 'linux-x64': { 'libtruncated.so': 'not an image' } },
                libc: ['glibc'],
                glibcRequires: { 'linux-x64': '2.2.5' },
            }),
        );
        assert.ok(
            problems.some((p) => /whose ELF could not be read .*libtruncated\.so.*NOT measured/s.test(p)),
            problems.join('\n'),
        );
    });

    it('honours the same `platformsUncommitted` exemption the artifact rule does', () => {
        // One escape hatch, read by both rules — a second spelling would be a
        // second truth.
        const { failures, stats } = auditPrebuildLibc([
            libcPkg({
                declared: ['linux-x64', 'linux-arm64'],
                stage: { 'linux-x64': GLIBC_LINKED },
                libc: ['glibc'],
                glibcRequires: { 'linux-x64': '2.2.5' },
                uncommitted: { 'linux-arm64': 'built by CI, uploaded for a release; no job commits it back here' },
            }),
        ]);
        assert.deepEqual(failures, []);
        assert.equal(stats.skippedUncommitted, 1);
    });
});
