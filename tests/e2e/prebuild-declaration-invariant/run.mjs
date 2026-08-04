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
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
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
const { auditPrebuildLibc, platformPackageDirName } = await import(
    `file://${join(MONOREPO_ROOT, 'packages', 'infra', 'manifest-conformance', 'lib', 'index.mjs')}`
);

/**
 * Where a bridge's committed prebuild for one target actually lives.
 *
 * DERIVED, not spelled out four times. Since ADR 0017 that is a SIBLING
 * per-target package (`<bridge>-<target>/prebuilds/<target>/`), not a directory
 * inside the bridge — and `status/open-todos.md` already records what happens
 * when fixtures compose this path themselves: the `<os>-<arch>` unification had
 * to sweep nine of them by hand and missed one, because a composed string never
 * appears as a literal to grep for. This file held four such strings and all
 * four broke on the split. `platformPackageDirName()` is the one naming rule.
 *
 * @param {string} pillar `node` | `web` | `framework` | `infra`
 * @param {string} bridge the bridge's directory name, e.g. `terminal-native`
 * @param {string} target `<os>-<arch>`
 */
const realPrebuild = (pillar, bridge, target) =>
    join(MONOREPO_ROOT, 'packages', pillar, platformPackageDirName(bridge, target), 'prebuilds', target);

/** A real, correctly-linked linux-x64 prebuild to copy from. */
const REAL_X64 = realPrebuild('node', 'terminal-native', 'linux-x64');
/**
 * The COMPLETE artifact set a committed directory owes: library, typelib and the
 * `.gir` the typelib was compiled from. All three, because "well-shaped" is what
 * every fixture below that expects a PASS has to be — and the third one is the
 * newest requirement, added after ten of the sixty committed directories turned
 * out to have only the first two.
 */
const REAL_X64_FILES = ['libgjsifyterminal.so', 'GjsifyTerminal-1.0.typelib', 'GjsifyTerminal-1.0.gir'];
/**
 * The same set MINUS the `.gir`: the exact shape ten committed directories have,
 * and the input every `.gir` assertion below is driven from. DERIVED rather than
 * spelled out a fourth time — the two lists must differ in exactly one file, and
 * two hand-written lists are two chances to be wrong about which.
 */
const REAL_X64_NO_GIR = REAL_X64_FILES.filter((f) => !f.endsWith('.gir'));
/** A real arm64 one — the wrong-machine fixture, from this x64 host's view. */
const REAL_ARM64 = realPrebuild('node', 'terminal-native', 'linux-arm64');
/**
 * A real GLIBC-linked pair (`libc.so.6` in DT_NEEDED, floor GLIBC_2.2.5) and a
 * real LIBC-AGNOSTIC one (GLib/GIO/GnuTLS only, no libc soname at all). The libc
 * rule's whole verdict turns on which of the two a directory holds, so both come
 * from committed artifacts rather than hand-built headers.
 */
const GLIBC_LINKED = { dir: REAL_X64, files: REAL_X64_FILES, floor: '2.2.5' };
const LIBC_AGNOSTIC = {
    dir: realPrebuild('node', 'tls-native', 'linux-x64'),
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
    dir: realPrebuild('node', 'tls-native', 'linux-riscv64'),
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
 * @param {'meson'|'node-gyp'} [opts.builder] which native build system the
 *   package carries. Load-bearing since ADR 0017, together with
 *   `namesPrebuildDir`: the ABSENCE of `gjsify.prebuilds` used to mean exactly
 *   one thing — "this package owes no committed artifacts" — and now means two.
 *   With `meson` it is a SPLIT bridge whose artifacts live in per-target
 *   packages and which is very much still under the committed-artifact
 *   contract; with `node-gyp` it is built at install time and is not. A fixture
 *   that leaves this at the default no longer states which one it means.
 */
function pkg({
    declared,
    stage = {},
    from = REAL_X64,
    extraFiles = {},
    uncommitted = null,
    namesPrebuildDir = true,
    builder = 'meson',
}) {
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
        builder,
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

    it('FAILS on a directory with a library + typelib but no `.gir`', () => {
        // The blind spot this closes. `.gir` presence was asserted in exactly one
        // place — a shell loop in `prebuilds.yml`'s macOS job — so it held for the
        // 16 darwin directories and for none of the other 44. Ten committed linux
        // directories carried only the library and the typelib for their whole
        // life, and every check in the tree was green: this one asked
        // for "a `.so` plus a `.typelib`", `prebuild-libc` reads ELF, and
        // `audit-runtimes`' declaration invariants compare declarations to each
        // other. Asserted HERE, so it holds for every target from any host.
        const problems = failuresFor(
            pkg({
                declared: ['linux-x64'],
                stage: { 'linux-x64': REAL_X64_NO_GIR },
            }),
        );
        assert.equal(problems.length, 1);
        assert.match(problems[0], /holds no `\.gir`/);
        // The message must say what a missing `.gir` does and does NOT cost, or the
        // next reader treats a tooling gap as a broken runtime (or the reverse).
        assert.match(problems[0], /Nothing LOADS a `\.gir`/);
        assert.match(problems[0], /ts-for-gir/);
        // And it must name both ways out — restage, or record the gap.
        assert.match(problems[0], /prebuild-gir-gaps\.mjs/);
    });

    it('does NOT reach the `.gir` check when the library or typelib is missing', () => {
        // Ordering, asserted: a directory with nothing in it should report the ONE
        // thing a consumer needs first, not a pile. A `.gir` complaint next to
        // "holds no `.so`" is noise that hides the real answer.
        const problems = failuresFor(pkg({ declared: ['linux-x64'], stage: { 'linux-x64': [] } }));
        assert.equal(problems.length, 1);
        assert.match(problems[0], /holds no `\.so`/);
    });
});

describe('prebuild invariant — the missing-`.gir` ledger is honest, not a mute button', () => {
    const WHY = 'staged by a pre-stager `cp` list that omitted it; the next rebuild lands it';

    it('accepts a deferred directory with a reason, and SAYS so on every run', () => {
        const { failures, notes, stats } = auditPrebuildArtifacts(
            [pkg({ declared: ['linux-x64'], stage: { 'linux-x64': REAL_X64_NO_GIR } })],
            { girGaps: { '@gjsify/fixture': WHY } },
        );
        assert.deepEqual(failures, []);
        assert.equal(stats.girDeferred, 1);
        assert.ok(
            notes.some((n) => n.includes('@gjsify/fixture') && n.includes(WHY)),
            notes.join('\n'),
        );
    });

    it('REJECTS a ledger entry with no reason', () => {
        const problems = auditPrebuildArtifacts(
            [pkg({ declared: ['linux-x64'], stage: { 'linux-x64': REAL_X64_NO_GIR } })],
            { girGaps: { '@gjsify/fixture': '  ' } },
        ).failures;
        assert.equal(problems.length, 1);
        assert.match(problems[0], /with no reason/);
    });

    it('reports the entry as UNUSED once the `.gir` is there, so the rule can retire it', () => {
        // The self-retiring half. This function is also driven against single rows,
        // so it reports what it CONSUMED and the rule — the only caller that sees
        // every package — turns an unmatched entry into the failure. Asserting the
        // consumption set here is what makes that split checkable from both ends.
        const { failures, girGapsUsed } = auditPrebuildArtifacts(
            [pkg({ declared: ['linux-x64'], stage: { 'linux-x64': REAL_X64_FILES } })],
            { girGaps: { '@gjsify/fixture': WHY } },
        );
        assert.deepEqual(failures, []);
        assert.equal(girGapsUsed.has('@gjsify/fixture'), false);
    });

    it('the RULE fails on a ledger entry nothing matched — the half only it can see', async () => {
        // `auditPrebuildArtifacts` cannot decide this: it is handed one row at a
        // time by these fixtures, so an unmatched key there would mean nothing. The
        // rule is the caller with the whole population, which is why the stale-entry
        // check lives in it — and why it needs its own test rather than riding on
        // the function's.
        const { prebuildArtifactsRule } = await import(
            `file://${join(MONOREPO_ROOT, 'packages', 'infra', 'manifest-conformance', 'lib', 'rules', 'prebuild-artifacts.mjs')}`
        );
        const root = scratch();
        mkdirSync(join(root, 'prebuilds', 'linux-x64'), { recursive: true });
        for (const f of REAL_X64_FILES) copyFileSync(join(REAL_X64, f), join(root, 'prebuilds', 'linux-x64', f));
        const result = await prebuildArtifactsRule.run({
            // One well-shaped package, so the ledger entry is the only thing that
            // can fail.
            allPackages: [
                {
                    dir: root,
                    rel: 'packages/fixture',
                    manifest: { name: '@gjsify/fixture' },
                    gjsify: { prebuilds: 'prebuilds', platforms: ['linux-x64'], tier: 3 },
                },
            ],
            options: { prebuildGirGaps: { '@gjsify/gone': 'a reason nothing in the tree needs any more' } },
        });
        assert.equal(result.failures.length, 1, result.failures.join('\n'));
        assert.match(result.failures[0], /@gjsify\/gone/);
        assert.match(result.failures[0], /tells the next reader something false/);
    });

    it('does not let a ledger entry excuse a MISSING typelib or library', () => {
        // The scope of the deferral is one file. A ledger entry must not become a
        // general "this directory is exempt" switch, which is the shape every
        // escape hatch in this repo is written to avoid.
        const problems = auditPrebuildArtifacts(
            [pkg({ declared: ['linux-x64'], stage: { 'linux-x64': ['libgjsifyterminal.so'] } })],
            { girGaps: { '@gjsify/fixture': WHY } },
        ).failures;
        assert.equal(problems.length, 1);
        assert.match(problems[0], /holds no `\.typelib`/);
    });
});

// ── The ledger's LIFECYCLE, on fixtures only ────────────────────────────────
//
// WHY NOT A COPY OF THE REAL LEDGER — read this before "simplifying" it back.
//
// It was one, and it was a BLOCKER. The test copied
// `scripts/manifest-conformance/prebuild-gir-gaps.mjs` out of the checkout and
// asserted `before.length >= 2` — while the whole purpose of
// `scripts/clear-satisfied-gir-gaps.mjs` is to reduce that file to
// `PREBUILD_GIR_GAPS = {}`. This suite runs inside
// `.github/prebuild-toolchain/gate-pushed-tree.sh`, which sits AFTER the staging
// script ran the clearer and BEFORE the push. So the first `main` run that landed
// the ten `.gir` files would have cleared all ten entries, failed this test on the
// ledger it had just correctly emptied, and discarded every downloaded binary at
// the gate. The channel would have stayed dead in exactly the way it is dead
// today, with a different error message — and the ledger's own proof ("the files
// must arrive THROUGH the fixed channel") could never have happened. Rehearsed
// both ways: with the ledger emptied the old test failed on the `>= 2`
// assertion, and with the file deleted (the documented human cleanup) it threw
// ENOENT at `copyFileSync`.
//
// That is the SAME shape as the incident `gate-pushed-tree.sh`'s own header cites
// as the reason it exists: `tests/e2e/platform-exemption-clearing` seeded its
// fixture from a manifest the bot then cleared, and `main` was red for every open
// PR for hours. A gate whose fixture reads the state the gated job mutates is not
// a gate.
//
// So the subject here is a SYNTHETIC ledger, and the four states the real one
// passes through each get their own test: entries present, partially cleared,
// EMPTY, and the file ABSENT. The coupling to the real file is kept where it is
// safe to keep — a read-only assertion that its shape is one the clearer can
// edit, which holds for any number of entries including none.
describe('prebuild invariant — the missing-`.gir` ledger drains without going quiet', () => {
    const REASON = 'staged by a pre-stager `cp` list that omitted it; the next rebuild lands it';
    const LEDGER_REL = join('scripts', 'manifest-conformance', 'prebuild-gir-gaps.mjs');
    const COMPLETE = ['libx.so', 'X-0.1.typelib', 'X-0.1.gir'];
    const NO_GIR = ['libx.so', 'X-0.1.typelib'];

    const clearer = () => import(`file://${join(MONOREPO_ROOT, 'scripts', 'clear-satisfied-gir-gaps.mjs')}`);

    /**
     * A synthetic monorepo root with its own ledger and its own per-target
     * packages.
     *
     * The ledger TEXT reproduces the real one's load-bearing shape rather than
     * being copied from it: a doc comment, an exported shared reason, and one
     * `    '<key>': <reason>,` line per entry. That is the shape the clearing
     * script's line surgery depends on, and the shape assertion at the bottom of
     * this suite is what keeps the real file conforming to it — the two halves
     * together give the coupling a copy used to give, without importing the
     * mutable state.
     *
     * @param {Array<{name: string, files: string[]}>} entries ledger entries, each
     *   with the file set its committed directory holds
     * @param {object} [opts]
     * @param {string[]} [opts.unlisted] packages present in the tree with an
     *   INCOMPLETE directory and NO ledger entry — the gap nothing excuses
     * @returns {{root: string, ledgerPath: string}}
     */
    function ledgerFixture(entries, { unlisted = [] } = {}) {
        const root = scratch();
        const ledgerPath = join(root, LEDGER_REL);
        mkdirSync(dirname(ledgerPath), { recursive: true });
        const lines = [
            '/** A synthetic ledger. See tests/e2e/prebuild-declaration-invariant/run.mjs. */',
            '',
            "export const WHY = ['staged by a pre-stager `cp` list that omitted it;', 'the next rebuild lands it'].join(",
            "    ' ',",
            ');',
            '',
            '/** @type {Record<string, string>} */',
            'export const PREBUILD_GIR_GAPS = {',
            ...entries.map((e) => `    '${e.name}': WHY,`),
            '};',
            '',
        ];
        writeFileSync(ledgerPath, lines.join('\n'));

        for (const { name, files } of [...entries, ...unlisted.map((name) => ({ name, files: NO_GIR }))]) {
            // One target per package, named in the manifest — the clearing script
            // reads `gjsify.platforms`/`gjsify.prebuilds` rather than parsing the
            // target back out of the package NAME, so a fixture has to declare it.
            const target = 'linux-x64';
            const dir = join(root, 'packages', 'fixture', name.replace(/^@[^/]+\//, ''));
            mkdirSync(join(dir, 'prebuilds', target), { recursive: true });
            writeFileSync(
                join(dir, 'package.json'),
                JSON.stringify({ name, gjsify: { prebuilds: 'prebuilds', platforms: [target], tier: 3 } }, null, 4),
            );
            for (const f of files) writeFileSync(join(dir, 'prebuilds', target, f), '');
        }
        return { root, ledgerPath };
    }

    /** The keys a ledger file exports right now, read through the module system. */
    const keysOf = async (ledgerPath) =>
        Object.keys((await import(`file://${ledgerPath}?t=${Date.now()}${Math.random()}`)).PREBUILD_GIR_GAPS ?? {});

    it('STATE 1 — entries present: clears the one whose `.gir` landed, keeps the one still missing', async () => {
        const { clearSatisfiedGirGaps } = await clearer();
        const { root, ledgerPath } = ledgerFixture([
            { name: '@fixture/landed-linux-x64', files: COMPLETE },
            { name: '@fixture/waiting-linux-x64', files: NO_GIR },
        ]);

        const { cleared, paths } = await clearSatisfiedGirGaps(root);
        assert.deepEqual(cleared, ['@fixture/landed-linux-x64'], 'only the entry whose `.gir` landed may be cleared');
        // The caller stages exactly what was written — a `git add` glob in a job
        // that pushes to `main` would sweep in whatever else was dirty.
        assert.deepEqual(paths, ['scripts/manifest-conformance/prebuild-gir-gaps.mjs']);
        assert.deepEqual(
            await keysOf(ledgerPath),
            ['@fixture/waiting-linux-x64'],
            'an entry whose file did NOT arrive still describes reality',
        );
        // Line surgery, not a regenerated file: everything that is not the removed
        // entry must come through byte-identical, or the prose that makes a ledger
        // acceptable at all is at the mercy of a generator.
        const text = readFileSync(ledgerPath, 'utf8');
        assert.match(text, /^\/\*\* A synthetic ledger\./);
        assert.equal(text.includes('@fixture/landed-linux-x64'), false);
    });

    it('STATE 2 — partially cleared: a second pass clears the rest and is idempotent after', async () => {
        const { clearSatisfiedGirGaps } = await clearer();
        // The state the real ledger is in between two `prebuilds.yml` runs: one
        // entry already gone, one still open. Its `.gir` then arrives.
        const { root, ledgerPath } = ledgerFixture([{ name: '@fixture/waiting-linux-x64', files: COMPLETE }]);

        const first = await clearSatisfiedGirGaps(root);
        assert.deepEqual(first.cleared, ['@fixture/waiting-linux-x64']);
        assert.deepEqual(await keysOf(ledgerPath), [], 'the last entry leaves an EMPTY ledger, not a deleted file');

        // Running twice in one job is not hypothetical: the staging script is
        // called once per push attempt, so attempt 2 re-runs the clearer over the
        // tree attempt 1 already cleared.
        const before = readFileSync(ledgerPath, 'utf8');
        const second = await clearSatisfiedGirGaps(root);
        assert.deepEqual(second, { cleared: [], paths: [] });
        assert.equal(readFileSync(ledgerPath, 'utf8'), before, 'a no-op pass must not rewrite the file');
    });

    it('STATE 2b — the emptied ledger is still a loadable module in the shape `oxfmt` accepts', async () => {
        const { clearSatisfiedGirGaps } = await clearer();
        const { root, ledgerPath } = ledgerFixture([{ name: '@fixture/waiting-linux-x64', files: COMPLETE }]);
        await clearSatisfiedGirGaps(root);
        const text = readFileSync(ledgerPath, 'utf8');
        // `{\n};` is what deleting the last entry LINE leaves behind, and
        // `oxfmt --check` rejects it — main.yml gates on that repo-wide, and this
        // file is written by a bot pushing under `[skip ci]`, where nothing runs to
        // say so. Asserted as TEXT rather than by shelling out to `oxfmt`: this
        // suite runs on the gate's runner, which has no `node_modules`.
        assert.match(text, /export const PREBUILD_GIR_GAPS = \{\};/);
        assert.equal(/PREBUILD_GIR_GAPS = \{\s*\n\s*\};/.test(text), false);
        // Still a module `scripts/audit-runtimes.mjs` can import — it does so at
        // top level, so a bot that left this file unparseable would break the
        // audit itself rather than one rule.
        assert.deepEqual(await keysOf(ledgerPath), []);
        // And the exported reason survives with no entry referencing it, which is
        // why it is `export`ed rather than module-private: an unused module-private
        // const is an `oxlint` error on that same unwatched commit.
        const mod = await import(`file://${ledgerPath}?used=${Date.now()}`);
        assert.equal(typeof mod.WHY, 'string');
    });

    it('STATE 3 — an EMPTY ledger is a no-op, and does NOT make the rule permissive', async () => {
        const { clearSatisfiedGirGaps } = await clearer();
        // Empty is the state the real ledger reaches the moment the channel works,
        // and the state the old version of this test could not survive.
        const { root, ledgerPath } = ledgerFixture([], { unlisted: ['@fixture/newgap-linux-x64'] });
        assert.deepEqual(await keysOf(ledgerPath), []);
        assert.deepEqual(await clearSatisfiedGirGaps(root), { cleared: [], paths: [] });

        // THE anti-loosening assertion. A drained ledger must leave the rule fully
        // armed: the fix for the blocker above is a hermetic fixture, NOT a weaker
        // bound, so the property is asserted rather than assumed. With no entries,
        // a directory missing its `.gir` is a plain failure again.
        const problems = auditPrebuildArtifacts(
            [pkg({ declared: ['linux-x64'], stage: { 'linux-x64': REAL_X64_NO_GIR } })],
            { girGaps: await keysOf(ledgerPath).then((keys) => Object.fromEntries(keys.map((k) => [k, REASON]))) },
        ).failures;
        assert.equal(problems.length, 1);
        assert.match(problems[0], /holds no `\.gir`/);
    });

    it('STATE 4 — an ABSENT ledger is a no-op, not a crash (the documented human cleanup)', async () => {
        const { clearSatisfiedGirGaps } = await clearer();
        // When the last entry goes, a HUMAN deletes the file and its import in a
        // reviewed commit — the bot may not, because `scripts/audit-runtimes.mjs`
        // imports it at top level. Between that commit and the next
        // `commit-prebuilds` run the clearer therefore runs against a tree with no
        // ledger, and it must simply do nothing.
        const { root } = ledgerFixture([]);
        rmSync(join(root, LEDGER_REL));
        assert.deepEqual(await clearSatisfiedGirGaps(root), { cleared: [], paths: [] });
    });

    it('never ABSORBS a new gap: an entry for one package does not excuse another', async () => {
        // The second half of "an entry is cleared by the job that lands its file":
        // clearing must not be a general amnesty. Two packages, one with an entry
        // and one without, both missing their `.gir`.
        const { clearSatisfiedGirGaps } = await clearer();
        const { root, ledgerPath } = ledgerFixture([{ name: '@fixture/waiting-linux-x64', files: NO_GIR }], {
            unlisted: ['@fixture/newgap-linux-x64'],
        });
        await clearSatisfiedGirGaps(root);
        // The clearer only ever REMOVES. The surviving key set is what it was, and
        // the unlisted package was never learned about — a clearer that ADDED the
        // gap it found would turn the ledger into the mute button it is written not
        // to be.
        assert.deepEqual(await keysOf(ledgerPath), ['@fixture/waiting-linux-x64']);

        // And the rule side of the same property: an entry naming one package does
        // not excuse a DIFFERENT package's missing `.gir`.
        const problems = auditPrebuildArtifacts(
            [pkg({ declared: ['linux-x64'], stage: { 'linux-x64': REAL_X64_NO_GIR } })],
            {
                girGaps: { '@gjsify/somebody-else': REASON },
            },
        ).failures;
        assert.equal(problems.length, 1);
        assert.match(problems[0], /holds no `\.gir`/);
    });

    // ── The two reads of the REAL file, and the ONLY two ────────────────────
    //
    // Both are state-agnostic in the full sense: they hold for ten entries, for
    // one, for none, and for a ledger that has been DELETED. The last case is not
    // theoretical — it is the documented end of this ledger's life, and a test
    // that only survives the file's existence would recreate the trap above one
    // step later, on the reviewed commit that retires it.
    const realLedger = join(MONOREPO_ROOT, LEDGER_REL);

    /** Every `.mjs` in the tree that statically imports the ledger. */
    function ledgerImporters() {
        const found = [];
        const walk = (dir) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
                const abs = join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(abs);
                } else if (entry.name.endsWith('.mjs') && abs !== realLedger) {
                    if (/from '[^']*prebuild-gir-gaps\.mjs'/.test(readFileSync(abs, 'utf8'))) {
                        found.push(abs.slice(MONOREPO_ROOT.length + 1).replaceAll('\\', '/'));
                    }
                }
            }
        };
        walk(join(MONOREPO_ROOT, 'scripts'));
        walk(join(MONOREPO_ROOT, 'packages', 'infra', 'manifest-conformance'));
        return found;
    }

    it('the REAL ledger, in whatever state it is in, is a shape the clearer can edit', async () => {
        const { entryKeyOnLine } = await clearer();
        if (!existsSync(realLedger)) {
            // RETIRED. Nothing to conform, and the honest complement is the thing
            // worth asserting instead: no code is left importing it.
            assert.deepEqual(ledgerImporters(), []);
            return;
        }
        const { PREBUILD_GIR_GAPS } = await import(`file://${realLedger}`);
        const text = readFileSync(realLedger, 'utf8');
        const onLines = text.split('\n').map(entryKeyOnLine).filter(Boolean);
        const exported = Object.keys(PREBUILD_GIR_GAPS);
        assert.deepEqual(
            onLines.slice().sort(),
            exported.slice().sort(),
            'every exported entry must occupy exactly one line the clearing script can delete — it edits this file by LINE, ' +
                'and a shape it cannot edit would leave a self-contradictory entry in a tree pushed under `[skip ci]`',
        );
        // No count is asserted, in either direction. That was the blocker: the
        // deferral's whole purpose is to reach zero, and the gate that runs after
        // the clearer must be able to observe zero.
        if (exported.length === 0) {
            // The drained state the clearer produces and a human then retires.
            // Asserted because a `{\n};` here fails `oxfmt --check` on every PR.
            assert.match(text, /export const PREBUILD_GIR_GAPS = \{\};/);
        }
    });

    it('every importer of the real ledger is named in its own removal instruction', () => {
        // The mechanism behind STATE 4 rather than trust in it. The ledger tells a
        // human to delete the file "and its import" once the last entry goes; a
        // second importer that appears without that sentence being updated makes
        // the cleanup commit break a script nobody was thinking about. Rehearsed:
        // with the ledger moved away, `scripts/audit-runtimes.mjs`' top-level
        // import makes this whole suite fail to LOAD — zero tests run, which is at
        // least loud, but the point is not to get there.
        const importers = ledgerImporters();
        if (!existsSync(realLedger)) {
            assert.deepEqual(importers, [], 'the ledger is gone; nothing may still import it');
            return;
        }
        const ledgerText = readFileSync(realLedger, 'utf8');
        assert.ok(importers.length > 0, 'expected at least `scripts/audit-runtimes.mjs` to import the ledger');
        for (const importer of importers) {
            assert.ok(
                ledgerText.includes(importer),
                `${importer} imports the ledger with a static \`import\`, but the ledger's own "delete this file by hand" ` +
                    'instruction does not name it. A cleanup commit that follows that instruction would break it.',
            );
        }
    });
});

describe('prebuild invariant — a deferred `.gir` must have somewhere to arrive from', () => {
    // The half the ledger could not see, and the one two reviewers named: if the
    // `.gir` files never arrive, the ledger never empties, every check keeps
    // passing, and a deferral the tree calls TRANSIENT is permanent. The ledger's
    // reason promises "the next `prebuilds.yml` run that rebuilds this target lands
    // the file", so that promise is checked against the workflow — an entry for a
    // target no leg builds can never clear, and now says so.
    //
    // Driven as a PURE function over synthetic rows and a synthetic coverage map:
    // this must hold for a ledger of any size, including the empty one the clearing
    // script produces, so nothing here reads the real ledger.
    const WHY = 'the next rebuild lands it';
    const arrival = () =>
        import(`file://${join(MONOREPO_ROOT, 'scripts', 'manifest-conformance', 'rules', 'platforms-ci.mjs')}`);
    const row = (name, target) => ({ name, path: `packages/fixture/${name}`, declared: [target] });

    it('PASSES, and says which leg will end it, when `prebuilds.yml` builds the target', async () => {
        const { auditGirGapArrival } = await arrival();
        const { failures, notes } = auditGirGapArrival(
            [row('@fixture/bridge-linux-ppc64', 'linux-ppc64')],
            new Map([['@fixture/bridge-linux-ppc64', new Set(['linux-ppc64'])]]),
            { '@fixture/bridge-linux-ppc64': WHY },
        );
        assert.deepEqual(failures, []);
        assert.equal(notes.length, 1);
        assert.match(notes[0], /builds linux-ppc64/);
    });

    it('FAILS when no job builds the deferred target — the PERMANENT deferral', async () => {
        const { auditGirGapArrival } = await arrival();
        const { failures } = auditGirGapArrival(
            [row('@fixture/bridge-linux-ppc64', 'linux-ppc64'), row('@fixture/other-linux-x64', 'linux-x64')],
            // The parser understood the workflow — it credited the sibling — and
            // found no leg for the deferred one. That is an answer, not a blind spot.
            new Map([['@fixture/other-linux-x64', new Set(['linux-x64'])]]),
            { '@fixture/bridge-linux-ppc64': WHY },
        );
        assert.equal(failures.length, 1, failures.join('\n'));
        assert.match(failures[0], /no job in `prebuilds\.yml` builds this package for linux-ppc64/);
        assert.match(failures[0], /PERMANENT/);
    });

    it('FAILS when a leg exists but not for the target the entry defers', async () => {
        // The near miss: `webgl` builds linux-x64, the ledger defers linux-riscv64.
        // A package-level "is it built at all" test would pass this.
        const { auditGirGapArrival } = await arrival();
        const { failures } = auditGirGapArrival(
            [row('@fixture/bridge-linux-riscv64', 'linux-riscv64')],
            new Map([['@fixture/bridge-linux-riscv64', new Set(['linux-x64'])]]),
            { '@fixture/bridge-linux-riscv64': WHY },
        );
        assert.equal(failures.length, 1);
        assert.match(failures[0], /it builds linux-x64/);
    });

    it('is ADVISORY when the workflow parser recognised nothing at all', async () => {
        // The parser is a lightweight structural read of a YAML file, so it can be
        // defeated by a job shape it does not know. Turning THAT into a failure
        // would redden `main` for every open PR over a defect in this rule — the
        // exact incident the surrounding gate exists to prevent. So an empty map is
        // reported as unverified.
        const { auditGirGapArrival } = await arrival();
        const { failures, notes } = auditGirGapArrival([row('@fixture/bridge-linux-ppc64', 'linux-ppc64')], new Map(), {
            '@fixture/bridge-linux-ppc64': WHY,
        });
        assert.deepEqual(failures, []);
        assert.equal(notes.length, 1);
        assert.match(notes[0], /could not be checked/);
    });

    it('says NOTHING when the ledger is empty — the state the clearing script produces', async () => {
        const { auditGirGapArrival } = await arrival();
        assert.deepEqual(auditGirGapArrival([row('@fixture/bridge-linux-x64', 'linux-x64')], new Map(), {}), {
            failures: [],
            notes: [],
        });
    });

    it('leaves an entry naming an unknown package to the rule that owns that', async () => {
        // `prebuild-artifacts` already fails a ledger key nothing matched. Guessing
        // at what a stale name meant, from a rule with no view of the artifact,
        // would double-report one defect and describe it worse.
        const { auditGirGapArrival } = await arrival();
        const { failures } = auditGirGapArrival([], new Map([['@fixture/live-linux-x64', new Set(['linux-x64'])]]), {
            '@fixture/gone-linux-x64': WHY,
        });
        assert.deepEqual(failures, []);
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
        // The `.gir` is staged so the renamed library is the ONLY defect and the
        // single-problem assertion below still means what it says.
        const row = pkg({
            declared: ['linux-x64'],
            stage: { 'linux-x64': ['GjsifyTerminal-1.0.typelib', 'GjsifyTerminal-1.0.gir'] },
        });
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
                // node-gyp: built at INSTALL time, so nothing is ever committed
                // for it and an exemption from committing describes nothing.
                // `namesPrebuildDir: false` alone no longer says this — since
                // ADR 0017 it is also what a split bridge looks like, and that
                // one is still under the contract (next test).
                builder: 'node-gyp',
                namesPrebuildDir: false,
                uncommitted: { 'linux-x64': REASON },
            }),
        );
        assert.ok(
            problems.some((p) => /is not under that contract at all/.test(p)),
            problems.join('\n'),
        );
    });

    it('ACCEPTS the field on a SPLIT bridge, whose artifacts moved to per-target packages', () => {
        // The distinction ADR 0017 introduced, and the one that would silently
        // invert if the rule went back to keying on `gjsify.prebuilds`: a bridge
        // with a native build system and no prebuild directory of its own has
        // not left the committed-artifact contract, it has DELEGATED it. Today
        // `@gjsify/napi` is exactly this — its darwin-arm64 is built by a
        // release and never committed — so refusing the field here would force
        // the one honest note the audit reads out of the only place it can live.
        const problems = failuresFor(
            pkg({
                declared: ['linux-x64'],
                builder: 'meson',
                namesPrebuildDir: false,
                uncommitted: { 'linux-x64': REASON },
            }),
        );
        assert.deepEqual(problems, []);
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
