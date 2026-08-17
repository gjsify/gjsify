// E2E test for the prebuild-declaration invariant in
// `scripts/audit-runtimes.mjs` — "a declared platform must have a body, and
// that body must be loadable".
//
// Half 1 exists because a target with no directory is simply absent from the
// set the platform audit compares: `@gjsify/oxfmt-native` declared
// `darwin-arm64` for weeks with no artifact behind it and `--check` exited 0.
// Half 2 exists because a directory that exists proves nothing — the macOS
// incident (#832) was a required job that built two bridges and only COPIED
// them, and the bug hiding there was a missing sibling FILE that read exactly
// like a broken rpath.
//
// Fixtures are SYNTHETIC packages in a temp directory holding REAL linked
// binaries copied out of the committed prebuilds: proving "a missing directory
// fails" means removing one, and the e2e suites run four-at-a-time against one
// shared checkout, so mutating the repository would break whatever else reads
// it — while real binaries exercise the ELF/Mach-O parsing under test against
// genuine artifacts rather than hand-rolled headers.

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
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const AUDIT = join(MONOREPO_ROOT, 'scripts', 'audit-runtimes.mjs');

const { auditPrebuildArtifacts } = await import(`file://${AUDIT}`);
// The libc axis is a SECOND rule over the same committed directories, driven from
// the same fixtures so the two fixture builders cannot drift apart.
const { auditPrebuildLibc, platformPackageDirName } = await import(
    `file://${join(MONOREPO_ROOT, 'packages', 'infra', 'manifest-conformance', 'lib', 'index.mjs')}`
);

/**
 * Where a bridge's committed prebuild for one target lives: since ADR 0017 a
 * SIBLING per-target package (`<bridge>-<target>/prebuilds/<target>/`), not a
 * directory inside the bridge.
 *
 * Derived through `platformPackageDirName()` rather than composed here, because a
 * composed path string never appears as a literal to grep for — the `<os>-<arch>`
 * unification had to sweep nine such fixtures by hand and missed one
 * (`status/open-todos.md`), and all four of this file's strings broke on the split.
 */
const realPrebuild = (pillar, bridge, target) =>
    join(MONOREPO_ROOT, 'packages', pillar, platformPackageDirName(bridge, target), 'prebuilds', target);

/** A real, correctly-linked linux-x64 prebuild to copy from. */
const REAL_X64 = realPrebuild('node', 'terminal-native', 'linux-x64');
/** The COMPLETE set a committed directory owes — what every PASS fixture must be. */
const REAL_X64_FILES = ['libgjsifyterminal.so', 'GjsifyTerminal-1.0.typelib', 'GjsifyTerminal-1.0.gir'];
/**
 * The same set MINUS the `.gir`, derived so the two lists provably differ in
 * exactly one file; the input every `.gir` assertion below is driven from.
 */
const REAL_X64_NO_GIR = REAL_X64_FILES.filter((f) => !f.endsWith('.gir'));
/** A real arm64 one — the wrong-machine fixture, from this x64 host's view. */
const REAL_ARM64 = realPrebuild('node', 'terminal-native', 'linux-arm64');
/**
 * A real GLIBC-linked pair (`libc.so.6` in DT_NEEDED, floor GLIBC_2.2.5) and a real
 * LIBC-AGNOSTIC one (GLib/GIO/GnuTLS only, no libc soname). The libc rule's whole
 * verdict turns on which of the two a directory holds, so both are real artifacts.
 */
const GLIBC_LINKED = { dir: REAL_X64, files: REAL_X64_FILES, floor: '2.2.5' };
const LIBC_AGNOSTIC = {
    dir: realPrebuild('node', 'tls-native', 'linux-x64'),
    files: ['libgjsifytls.so', 'GjsifyTls-1.0.typelib'],
};
/**
 * A real prebuild that records the glibc DYNAMIC LOADER, not merely `libc.so.6` —
 * the third state, and the only one from which "cannot load on musl" follows:
 * `libc.so.6` is a musl RESERVED name (musl resolves it to itself), so a
 * glibc-linked library naming it very often loads on Alpine — six of this repo's
 * bridges provably do. `ld-linux-*.so.*` is not reserved, so musl tries to open a
 * file that does not exist and the load fails outright. `tls-native`'s riscv64
 * build is the fixture because Fedora's riscv64 toolchain records the interpreter
 * explicitly.
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
 * @param {Record<string, string[]>} [opts.stage] target → files to copy from a real
 *   prebuild (`from` selects which one)
 * @param {Record<string, string>} [opts.extraFiles] target → {name: contents}
 * @param {Record<string, Record<string, string>>} [opts.renamed] target → {newName:
 *   sourceName} — a REAL artifact copied under a second name. The debris the
 *   nothing-unexplained check exists for is a renamed library, so the fixture has
 *   to be a real one: a text stub would also trip the "not ELF" assertion and the
 *   test would pass for the wrong reason.
 * @param {'meson'|'node-gyp'} [opts.builder] load-bearing since ADR 0017: the
 *   ABSENCE of `gjsify.prebuilds` used to mean exactly one thing and now means two.
 *   With `meson` it is a SPLIT bridge whose artifacts live in per-target packages,
 *   still under the committed-artifact contract; with `node-gyp` it is built at
 *   install time and is not.
 */
function pkg({
    declared,
    stage = {},
    from = REAL_X64,
    extraFiles = {},
    renamed = {},
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
    for (const [target, names] of Object.entries(renamed)) {
        mkdirSync(join(prebuildDir, target), { recursive: true });
        for (const [as, src] of Object.entries(names)) {
            copyFileSync(join(from, src), join(prebuildDir, target, as));
        }
    }
    const shipped = [...new Set([...Object.keys(stage), ...Object.keys(extraFiles), ...Object.keys(renamed)])].sort();
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
        // Both ways out must be named, or the next person picks the one that hides the gap.
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
        // `@gjsify/node-gi` builds on install / ships from a release artifact, so this
        // repo owes no committed body for its declared targets.
        assert.deepEqual(failuresFor(pkg({ declared: ['linux-x64', 'win32-x64'], namesPrebuildDir: false })), []);
    });

    it('FAILS on a directory with a library + typelib but no `.gir`', () => {
        // The blind spot this closes: `.gir` presence was asserted in exactly one
        // place — a shell loop in `prebuilds.yml`'s macOS job — so it held for the 16
        // darwin directories and for none of the other 44. Ten committed linux
        // directories carried only library + typelib for their whole life with every
        // check green. Asserted HERE, so it holds for every target from any host.
        const problems = failuresFor(
            pkg({
                declared: ['linux-x64'],
                stage: { 'linux-x64': REAL_X64_NO_GIR },
            }),
        );
        assert.equal(problems.length, 1);
        assert.match(problems[0], /holds no `\.gir`/);
        // The message must say what a missing `.gir` does and does NOT cost, or the next
        // reader treats a tooling gap as a broken runtime (or the reverse), and it must
        // name the way out. RESTAGING is that way and the message may not bury it: the
        // deferral route is still expressible but has no producer since the ledger module
        // drained and was deleted, so pointing a reader at it first would send them to
        // write a file rather than to re-run the job that fixes this in one pass.
        assert.match(problems[0], /Nothing LOADS a `\.gir`/);
        assert.match(problems[0], /ts-for-gir/);
        assert.match(problems[0], /restage this target/);
    });

    it('does NOT reach the `.gir` check when the library or typelib is missing', () => {
        // Ordering, asserted: an empty directory reports the ONE thing a consumer needs
        // first. A `.gir` complaint next to "holds no `.so`" hides the real answer.
        const problems = failuresFor(pkg({ declared: ['linux-x64'], stage: { 'linux-x64': [] } }));
        assert.equal(problems.length, 1);
        assert.match(problems[0], /holds no `\.so`/);
    });
});

describe('prebuild invariant — half 1b: nothing in the directory is unexplained', () => {
    // Every other assertion in this file asks whether a file that SHOULD be there
    // is. This is the opposite question, and it had no owner: `commit-prebuilds`
    // extracts dozens of artifacts INTO the existing directory without clearing
    // it, `git add` stages no deletions, and `sync-and-stage.sh` REFUSES staged
    // deletions on purpose — that refusal is the one guard stopping the job from
    // unshipping a binary, so the accumulation cannot be fixed by relaxing it.
    // A library renamed in `meson.build` therefore stays beside its successor and
    // `files: ["prebuilds"]` publishes both, forever, silently.
    it('FAILS on a library left behind under its old name', () => {
        const problems = failuresFor(
            pkg({
                declared: ['linux-x64'],
                stage: { 'linux-x64': REAL_X64_FILES },
                renamed: { 'linux-x64': { 'libgjsifyterminal-OLDNAME.so': 'libgjsifyterminal.so' } },
            }),
        );
        // Exactly one: a real artifact under a second name is well-formed, so no
        // other half has anything to say about it. That is the point — before this
        // check, nothing did.
        assert.equal(problems.length, 1, problems.join('\n'));
        assert.match(
            problems[0],
            /libgjsifyterminal-OLDNAME\.so` is in a committed prebuild directory and nothing explains it/,
        );
        // Both ways out named, so the next reader does not pick deletion for a file
        // a consumer actually needs.
        assert.match(problems[0], /If it is dead, delete it/);
        assert.match(problems[0], /make the typelib or a sibling library record it/);
    });

    it('FAILS on a stray non-artifact, which is how the real debris looked', () => {
        // The two files this check found on its first run over the tree were
        // `.gitkeep`s, left in directories that had since filled with real
        // artifacts. They were deleted rather than exempted — an allowlist would
        // have made them permanent — so this fixture is what keeps the case covered.
        const problems = failuresFor(
            pkg({
                declared: ['linux-x64'],
                stage: { 'linux-x64': REAL_X64_FILES },
                extraFiles: { 'linux-x64': { '.gitkeep': '' } },
            }),
        );
        assert.equal(problems.length, 1, problems.join('\n'));
        assert.match(problems[0], /`prebuilds\/linux-x64\/\.gitkeep` is in a committed prebuild directory/);
    });

    it('PASSES a dependency sibling, which is what the Rust cdylibs are', () => {
        // `libgjsify_lightningcss.so` is not named by any typelib — the Vala half
        // records it as a DT_NEEDED. Explaining a file by another staged library's
        // dependency list is therefore load-bearing, not a convenience: without it
        // every Rust bridge in the tree would report as debris.
        const dir = realPrebuild('infra', 'lightningcss-native', 'linux-x64');
        const { failures } = auditPrebuildArtifacts([
            {
                name: '@gjsify/fixture',
                path: 'packages/fixture',
                tier: 3,
                builder: 'meson',
                declared: ['linux-x64'],
                shipped: ['linux-x64'],
                prebuildsField: 'prebuilds',
                prebuildDir: dirname(dir),
                uncommitted: null,
            },
        ]);
        assert.deepEqual(failures, []);
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
        // This function is driven against single rows, so it can only report what it
        // CONSUMED; the rule — the one caller that sees every package — turns an
        // unmatched entry into the failure. Asserting the consumption set makes that
        // split checkable from both ends.
        const { failures, girGapsUsed } = auditPrebuildArtifacts(
            [pkg({ declared: ['linux-x64'], stage: { 'linux-x64': REAL_X64_FILES } })],
            { girGaps: { '@gjsify/fixture': WHY } },
        );
        assert.deepEqual(failures, []);
        assert.equal(girGapsUsed.has('@gjsify/fixture'), false);
    });

    it('the RULE fails on a ledger entry nothing matched — the half only it can see', async () => {
        // `auditPrebuildArtifacts` cannot decide this: handed one row at a time, an
        // unmatched key means nothing to it. The rule is the caller with the whole
        // population, so the stale-entry check lives there and needs its own test.
        const { prebuildArtifactsRule } = await import(
            `file://${join(MONOREPO_ROOT, 'packages', 'infra', 'manifest-conformance', 'lib', 'rules', 'prebuild-artifacts.mjs')}`
        );
        const root = scratch();
        mkdirSync(join(root, 'prebuilds', 'linux-x64'), { recursive: true });
        for (const f of REAL_X64_FILES) copyFileSync(join(REAL_X64, f), join(root, 'prebuilds', 'linux-x64', f));
        const result = await prebuildArtifactsRule.run({
            // One well-shaped package, so the ledger entry is the only thing that can fail.
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
        // The deferral's scope is one file: an entry must not become a general "this
        // directory is exempt" switch.
        const problems = auditPrebuildArtifacts(
            [pkg({ declared: ['linux-x64'], stage: { 'linux-x64': ['libgjsifyterminal.so'] } })],
            { girGaps: { '@gjsify/fixture': WHY } },
        ).failures;
        assert.equal(problems.length, 1);
        assert.match(problems[0], /holds no `\.typelib`/);
    });
});

// WHY THE LEDGER HERE IS SYNTHETIC, not a copy of the real file — read before
// "simplifying" it back. It WAS a copy, asserting `before.length >= 2`, while the
// whole purpose of `scripts/clear-satisfied-gir-gaps.mjs` is to reduce that file to
// `PREBUILD_GIR_GAPS = {}`. This suite runs inside
// `.github/prebuild-toolchain/gate-pushed-tree.sh`, AFTER the staging script ran the
// clearer and BEFORE the push — so the first `main` run to land the missing `.gir`
// files would have failed on the ledger it had just correctly emptied and discarded
// every downloaded binary at the gate. Same shape as the incident
// `gate-pushed-tree.sh` cites for its own existence: `tests/e2e/platform-exemption-clearing`
// seeded its fixture from a manifest the bot then cleared, and `main` was red for
// every open PR for hours. A gate whose fixture reads the state the gated job mutates
// is not a gate.
//
// So: a synthetic ledger, one test per state the real one passes through (entries
// present, partially cleared, EMPTY, file ABSENT). The only coupling kept to the real
// file is a read-only shape assertion, which holds for any entry count including none.
describe('prebuild invariant — the missing-`.gir` ledger drains without going quiet', () => {
    const REASON = 'staged by a pre-stager `cp` list that omitted it; the next rebuild lands it';
    const LEDGER_REL = join('scripts', 'manifest-conformance', 'prebuild-gir-gaps.mjs');
    const COMPLETE = ['libx.so', 'X-0.1.typelib', 'X-0.1.gir'];
    const NO_GIR = ['libx.so', 'X-0.1.typelib'];

    const clearer = () => import(`file://${join(MONOREPO_ROOT, 'scripts', 'clear-satisfied-gir-gaps.mjs')}`);

    /**
     * A synthetic monorepo root with its own ledger and its own per-target packages.
     *
     * The ledger TEXT reproduces the real one's load-bearing shape instead of copying
     * it: a doc comment, an exported shared reason, and one `    '<key>': <reason>,`
     * line per entry — the shape the clearing script's line surgery depends on. That
     * plus the shape assertion at the bottom of this suite gives the coupling a copy
     * used to give, without importing the mutable state.
     *
     * @param {Array<{name: string, files: string[]}>} entries each with the file set
     *   its committed directory holds
     * @param {string[]} [opts.unlisted] packages with an INCOMPLETE directory and NO
     *   ledger entry — the gap nothing excuses
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
            // The clearing script reads `gjsify.platforms`/`gjsify.prebuilds` rather than
            // parsing the target out of the package NAME, so a fixture must declare it.
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
        // The caller stages exactly what was written — a `git add` glob in a job that
        // pushes to `main` would sweep in whatever else was dirty.
        assert.deepEqual(paths, ['scripts/manifest-conformance/prebuild-gir-gaps.mjs']);
        assert.deepEqual(
            await keysOf(ledgerPath),
            ['@fixture/waiting-linux-x64'],
            'an entry whose file did NOT arrive still describes reality',
        );
        // Line surgery, not a regenerated file: everything but the removed entry must
        // come through byte-identical, or the prose that makes a ledger acceptable at
        // all is at the mercy of a generator.
        const text = readFileSync(ledgerPath, 'utf8');
        assert.match(text, /^\/\*\* A synthetic ledger\./);
        assert.equal(text.includes('@fixture/landed-linux-x64'), false);
    });

    it('STATE 2 — partially cleared: a second pass clears the rest and is idempotent after', async () => {
        const { clearSatisfiedGirGaps } = await clearer();
        // The state between two `prebuilds.yml` runs: one entry already gone, one still
        // open, whose `.gir` then arrives.
        const { root, ledgerPath } = ledgerFixture([{ name: '@fixture/waiting-linux-x64', files: COMPLETE }]);

        const first = await clearSatisfiedGirGaps(root);
        assert.deepEqual(first.cleared, ['@fixture/waiting-linux-x64']);
        assert.deepEqual(await keysOf(ledgerPath), [], 'the last entry leaves an EMPTY ledger, not a deleted file');

        // Running twice in one job is not hypothetical: the staging script is called once
        // per push attempt, so attempt 2 re-runs the clearer over attempt 1's tree.
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
        // `{\n};` is what deleting the last entry LINE leaves behind, and `oxfmt --check`
        // rejects it — main.yml gates on that repo-wide, and this file is written by a bot
        // pushing under `[skip ci]`, where nothing runs to say so. Asserted as TEXT rather
        // than by shelling out to `oxfmt`: the gate's runner has no `node_modules`.
        assert.match(text, /export const PREBUILD_GIR_GAPS = \{\};/);
        assert.equal(/PREBUILD_GIR_GAPS = \{\s*\n\s*\};/.test(text), false);
        // Still importable: `scripts/audit-runtimes.mjs` imports it at TOP LEVEL, so an
        // unparseable file breaks the audit itself rather than one rule.
        assert.deepEqual(await keysOf(ledgerPath), []);
        // The exported reason must survive with nothing referencing it — that is why it is
        // `export`ed: an unused module-private const is an `oxlint` error on that same
        // unwatched commit.
        const mod = await import(`file://${ledgerPath}?used=${Date.now()}`);
        assert.equal(typeof mod.WHY, 'string');
    });

    it('STATE 3 — an EMPTY ledger is a no-op, and does NOT make the rule permissive', async () => {
        const { clearSatisfiedGirGaps } = await clearer();
        // Empty is the state the ledger reaches the moment the channel works — and the
        // state the copy-the-real-file version of this test could not survive.
        const { root, ledgerPath } = ledgerFixture([], { unlisted: ['@fixture/newgap-linux-x64'] });
        assert.deepEqual(await keysOf(ledgerPath), []);
        assert.deepEqual(await clearSatisfiedGirGaps(root), { cleared: [], paths: [] });

        // The anti-loosening assertion: the fix for the blocker above is a hermetic
        // fixture, NOT a weaker bound, so "a drained ledger leaves the rule fully armed"
        // is asserted rather than assumed.
        const problems = auditPrebuildArtifacts(
            [pkg({ declared: ['linux-x64'], stage: { 'linux-x64': REAL_X64_NO_GIR } })],
            { girGaps: await keysOf(ledgerPath).then((keys) => Object.fromEntries(keys.map((k) => [k, REASON]))) },
        ).failures;
        assert.equal(problems.length, 1);
        assert.match(problems[0], /holds no `\.gir`/);
    });

    it('STATE 4 — an ABSENT ledger is a no-op, not a crash (the documented human cleanup)', async () => {
        const { clearSatisfiedGirGaps } = await clearer();
        // When the last entry goes, a HUMAN deletes the file and its import in a reviewed
        // commit — the bot may not, since `scripts/audit-runtimes.mjs` imports it at top
        // level. Between that commit and the next `commit-prebuilds` run the clearer runs
        // against a tree with no ledger, and must do nothing.
        const { root } = ledgerFixture([]);
        rmSync(join(root, LEDGER_REL));
        assert.deepEqual(await clearSatisfiedGirGaps(root), { cleared: [], paths: [] });
    });

    it('never ABSORBS a new gap: an entry for one package does not excuse another', async () => {
        // The second half of "an entry is cleared by the job that lands its file":
        // clearing must not be a general amnesty.
        const { clearSatisfiedGirGaps } = await clearer();
        const { root, ledgerPath } = ledgerFixture([{ name: '@fixture/waiting-linux-x64', files: NO_GIR }], {
            unlisted: ['@fixture/newgap-linux-x64'],
        });
        await clearSatisfiedGirGaps(root);
        // The clearer only ever REMOVES: a clearer that ADDED the gap it found would turn
        // the ledger into the mute button it is written not to be.
        assert.deepEqual(await keysOf(ledgerPath), ['@fixture/waiting-linux-x64']);

        // The rule side of the same property: an entry naming one package does not excuse
        // a DIFFERENT package's missing `.gir`.
        const problems = auditPrebuildArtifacts(
            [pkg({ declared: ['linux-x64'], stage: { 'linux-x64': REAL_X64_NO_GIR } })],
            {
                girGaps: { '@gjsify/somebody-else': REASON },
            },
        ).failures;
        assert.equal(problems.length, 1);
        assert.match(problems[0], /holds no `\.gir`/);
    });

    // The two reads of the REAL file, and the only two. Both hold for any entry count
    // AND for a ledger that has been DELETED — the documented end of this ledger's life,
    // so a test that only survives the file's existence would recreate the trap above one
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
            // RETIRED: nothing to conform, so assert the honest complement instead.
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
        // No count is asserted in either direction. That was the blocker: the deferral's
        // whole purpose is to reach zero, and the gate that runs after the clearer must be
        // able to observe zero.
        if (exported.length === 0) {
            // A `{\n};` in the drained state fails `oxfmt --check` on every PR.
            assert.match(text, /export const PREBUILD_GIR_GAPS = \{\};/);
        }
    });

    it('every importer of the real ledger is named in its own removal instruction', () => {
        // The mechanism behind STATE 4 rather than trust in it: the ledger tells a human to
        // delete the file "and its import", so a second importer appearing without that
        // sentence being updated makes the cleanup commit break a script nobody thought of.
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
    // The half the ledger could not see: if the `.gir` files never arrive, the ledger
    // never empties, every check keeps passing, and a deferral the tree calls TRANSIENT is
    // permanent. The ledger's reason promises "the next `prebuilds.yml` run that rebuilds
    // this target lands the file", so that promise is checked against the workflow.
    //
    // Driven as a PURE function over synthetic rows and a synthetic coverage map, so it
    // holds for a ledger of any size including the empty one the clearing script produces.
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
            // The parser credited the sibling, so it understood the workflow and found no
            // leg for the deferred one. That is an answer, not a blind spot.
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
        // The parser is a lightweight structural read of YAML, so a job shape it does not
        // know defeats it. Failing on THAT would redden `main` for every open PR over a
        // defect in this rule, so an empty map is reported as unverified.
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
        // `prebuild-artifacts` already fails a ledger key nothing matched; guessing what a
        // stale name meant from a rule with no view of the artifact would double-report one
        // defect and describe it worse.
        const { auditGirGapArrival } = await arrival();
        const { failures } = auditGirGapArrival([], new Map([['@fixture/live-linux-x64', new Set(['linux-x64'])]]), {
            '@fixture/gone-linux-x64': WHY,
        });
        assert.deepEqual(failures, []);
    });
});

describe('prebuild invariant — half 2: a body that exists must be loadable', () => {
    it('FAILS on an image whose machine does not match its directory (the QEMU leg)', () => {
        // An arm64 ELF staged as linux-x64: the check that caught the emulated prebuild
        // legs shipping host x86-64 into `prebuilds/linux-{ppc64,s390x,riscv64}/`, and the
        // ONE loadability defect catchable for a cross-arch target from any host, because
        // the machine is in the file header.
        const problems = failuresFor(
            pkg({ declared: ['linux-x64'], from: REAL_ARM64, stage: { 'linux-x64': REAL_X64_FILES } }),
        );
        assert.ok(problems.length >= 1, 'expected the machine mismatch to be reported');
        assert.match(problems[0], /is a linux\/arm64 image in a `linux-x64` directory/);
    });

    it('FAILS when the typelib names a library that is not staged beside it', () => {
        // The typelib records `libgjsifyterminal.so`; staging a differently named real
        // library reproduces a `meson.build` rename the staging step follows but the
        // typelib does not. The `.gir` is staged so the rename is the ONLY defect.
        const row = pkg({
            declared: ['linux-x64'],
            stage: { 'linux-x64': ['GjsifyTerminal-1.0.typelib', 'GjsifyTerminal-1.0.gir'] },
        });
        copyFileSync(join(REAL_X64, 'libgjsifyterminal.so'), join(row.prebuildDir, 'linux-x64', 'libgjsifyrenamed.so'));
        const problems = failuresFor(row);
        // BOTH halves of the rename, and the second one is why half 1b exists: the
        // name the typelib still expects is gone, AND the name that arrived is
        // accounted for by nothing. This assertion expected only the first for as
        // long as only the first had an owner.
        assert.equal(problems.length, 2, problems.join('\n'));
        assert.ok(
            problems.some((p) => /records shared library `libgjsifyterminal\.so`, which is NOT staged/.test(p)),
            problems.join('\n'),
        );
        assert.ok(
            problems.some((p) =>
                /libgjsifyrenamed\.so` is in a committed prebuild directory and nothing explains it/.test(p),
            ),
            problems.join('\n'),
        );
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
        // linux-arm64 is declared but not staged, so only the host directory is counted:
        // the two numbers are tracked SEPARATELY, neither inferred from the other, and a
        // cross-arch directory can never join `loaded`.
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
        // Exempt is not silent: the reason must surface on every run, or the field becomes
        // the silent gap it replaced.
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
        // Otherwise the hatch outlives its cause and quietly exempts a directory that is
        // now under the full contract.
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
                // node-gyp: built at INSTALL time, so nothing is ever committed and an
                // exemption from committing describes nothing. `namesPrebuildDir: false`
                // alone no longer says this — since ADR 0017 it is also what a split bridge
                // looks like, and that one is still under the contract (next test).
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
        // The distinction ADR 0017 introduced, and the one that silently inverts if the
        // rule goes back to keying on `gjsify.prebuilds`: a bridge with a native build
        // system and no prebuild directory of its own has not left the committed-artifact
        // contract, it has DELEGATED it. `@gjsify/napi` is exactly this — its darwin-arm64
        // is built by a release and never committed — so refusing the field would evict the
        // audit's one honest note from the only place it can live.
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

// The libc axis. `prebuild-artifacts` above proves a declared target has a loadable
// body but says nothing about the C LIBRARY that body needs, and before
// `prebuild-libc` nothing did: no package declared `libc`, so every native bridge
// installed happily on Alpine and then failed at `dlopen`. The glibc floor was
// equally unmeasured, which hid that ONE artifact (`@gjsify/lightningcss-native`,
// GLIBC_2.39) sets the whole repo's Linux baseline while siblings sit as low as 2.2.5.

/**
 * A synthetic row in the shape `collectLibcPackages()` produces — the
 * `prebuild-artifacts` row plus the two manifest fields this rule reads (`libc` is a
 * plain npm field, `gjsify.glibcRequires` is ours).
 *
 * @param {Record<string, {dir: string, files: string[]}>} [opts.stage] target → real prebuild to copy
 * @param {Record<string, Record<string, string>>} [opts.extraFiles] target → {name: contents}
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
        // The obvious rule — "links glibc ⇒ declare libc: ["glibc"]" — is what this rule
        // shipped with, and a container probe on alpine:3.24 disproved it: musl treats a
        // DT_NEEDED of `libc.so.6` as a request for ITSELF (a reserved name it refuses to
        // reload), so six of this repo's glibc bridges load AND run on musl. Demanding the
        // field from them would make every package manager refuse the install on Alpine —
        // postmarketOS, the platform the whole libc axis was added for. So the state is
        // UNDETERMINED, and the rule neither requires the field nor forbids it.
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
        // The one state from which unloadability on musl actually follows, and the only one
        // where a package-level `["glibc"]` is provably right: the three Rust bridges on
        // x64, whose cargo cdylib records `ld-linux-*`.
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
        // `@gjsify/tls-native`'s x64 build reaches libc only through GLib, so it runs on
        // either; a `libc` filter there refuses installs on hosts where the artifact works.
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
        // The measured reality for `@gjsify/tls-native` and `@gjsify/webrtc-native`:
        // libc-agnostic on most targets, constrained on one or two (Fedora's riscv64/arm64
        // toolchains record libc explicitly). npm's `libc` is one package-level filter with
        // no per-target dimension, so declaring it refuses the install everywhere — the
        // note is what keeps the gap visible instead of implied.
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
        // Declaring it anyway still fails, for a reason no load test can overturn:
        // linux-x64 records no libc soname at all, so it provably runs on either libc and
        // the filter would refuse a working install.
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
        // Strictly worse than shipping nothing: a musl host resolves the suffixed token
        // FIRST, so this directory SHADOWS the default build that might have loaded.
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
        // No libc soname at all suits either token — the artifact loads against whatever
        // libc the host's GLib was built for.
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
        // Skipped is COUNTED, never silent — as at the artifact rule's cross-arch boundary.
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
        // A deliberate distro baseline is a legitimate promise; failing it would make one
        // impossible to state. Reported as a note instead.
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
        // Never a silent pass: the number is printed with the exact edit that turns it into
        // a promise the next rebuild is held to.
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
        // The one outcome the rule must never produce: "records no libc.so.6, therefore
        // musl-safe" derived from a file nobody parsed.
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
        // One escape hatch, read by both rules — a second spelling would be a second truth.
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
