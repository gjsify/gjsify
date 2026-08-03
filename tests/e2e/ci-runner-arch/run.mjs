// E2E test for the pure functions of
// `scripts/manifest-conformance/rules/platforms-ci.mjs` — the repo-scoped half
// of the OS axis. Four questions, each with its own `describe` below: the
// runner-label → `<os>-<arch>` derivation the file is named for, the
// release-only target set, release coverage, and the glyphs the platform matrix
// renders.
//
// The platform audit learns which targets CI PRODUCES by reading each job's
// `runs-on`, and attributes those targets to the packages the job builds. When
// a job declares no `arch:` matrix key the arch comes from the label alone —
// and that is the one input with no second opinion anywhere: the declared,
// built and committed sets can all agree while describing the WRONG
// architecture, because every side is reading the same mistaken derivation.
// Nothing goes red; the promise is simply about a different machine than the
// artifact.
//
// GitHub's macOS labels make this concrete. `macos-15-intel` (the last x86_64
// image Actions offers, until August 2027) and `macos-15` differ by a suffix
// and by architecture, and `-large` vs `-xlarge` differ by ONE CHARACTER while
// meaning opposite architectures. So the derivation is pinned here per label
// rather than left to the OS-keyed default table.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/ci-runner-arch/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const RULE = join(MONOREPO_ROOT, 'scripts', 'manifest-conformance', 'rules', 'platforms-ci.mjs');
const LIB = join(MONOREPO_ROOT, 'packages', 'infra', 'manifest-conformance', 'lib', 'index.mjs');

const {
    archFromRunner,
    auditReleaseCoverage,
    creditPlatformArtifacts,
    osFromRunner,
    parseMatrixIncludes,
    platformRows,
    releaseOnlyTargets,
    renderPlatformMatrix,
} = await import(`file://${RULE}`);
const { canonicalPlatform, createContext, platformPackageDirName, platformPackageName } = await import(`file://${LIB}`);

/** `<os>-<arch>` exactly as the audit composes it from a bare runner label. */
const target = (runsOn) => `${osFromRunner(runsOn)}-${archFromRunner(runsOn)}`;

describe('runner label → OS', () => {
    it('maps each hosted-runner family', () => {
        assert.equal(osFromRunner('ubuntu-24.04'), 'linux');
        assert.equal(osFromRunner('macos-latest'), 'darwin');
        assert.equal(osFromRunner('macos-15-intel'), 'darwin');
        assert.equal(osFromRunner('windows-latest'), 'win32');
    });
});

describe('runner label → arch', () => {
    it('reads Apple silicon from the bare macOS labels', () => {
        for (const label of ['macos-latest', 'macos-14', 'macos-15', 'macos-26']) {
            assert.equal(target(label), 'darwin-arm64', label);
        }
    });

    it('reads Intel from the `-intel` labels', () => {
        // The regression this file exists for: with the OS-keyed default alone
        // these came back `darwin-arm64`, so an Intel job silently credited the
        // arm64 target and the declared-vs-built check stayed green about the
        // wrong machine.
        for (const label of ['macos-15-intel', 'macos-26-intel']) {
            assert.equal(target(label), 'darwin-x64', label);
        }
    });

    it('distinguishes `-large` (Intel) from `-xlarge` (Apple silicon)', () => {
        // One character apart, opposite architectures — and `-large` contains
        // no substring that would hint at Intel, so an order-dependent read
        // that tests `-large` first would call every `-xlarge` runner x64.
        assert.equal(target('macos-latest-large'), 'darwin-x64');
        assert.equal(target('macos-15-large'), 'darwin-x64');
        assert.equal(target('macos-latest-xlarge'), 'darwin-arm64');
        assert.equal(target('macos-15-xlarge'), 'darwin-arm64');
    });

    it('keeps the Linux arm label working', () => {
        assert.equal(target('ubuntu-24.04-arm'), 'linux-arm64');
        assert.equal(target('ubuntu-24.04'), 'linux-x64');
    });

    it('falls back to the OS default for an unknown label', () => {
        // A label the table does not recognise must not throw — the audit
        // treats an unparsed job as unverified, never as broken.
        assert.equal(target('some-self-hosted-runner'), 'linux-x64');
        assert.equal(target('windows-2025'), 'win32-x64');
    });
});

describe('matrix include entries → (arch, runner) pairs', () => {
    const lines = (s) => s.split('\n');

    it('pairs each arch with its own runner', () => {
        // The shape `build-prebuilds` uses. `runs-on: ${{ matrix.runner }}`
        // tells `osFromRunner` nothing, so the per-leg OS has to come from here.
        const entries = parseMatrixIncludes(
            lines(`    strategy:
      fail-fast: false
      matrix:
        include:
          - arch: x64
            runner: ubuntu-latest
          - arch: arm64
            runner: ubuntu-24.04-arm

    steps:
      - name: Build
        run: echo hi`),
        );
        assert.deepEqual(entries, [
            { arch: 'x64', runner: 'ubuntu-latest' },
            { arch: 'arm64', runner: 'ubuntu-24.04-arm' },
        ]);
    });

    it('keeps a mixed-OS matrix from producing a cross product', () => {
        // Two flat sets would yield FOUR targets — darwin-arm64, darwin-x64,
        // and two that no job builds. The pairing is what keeps the promise
        // equal to what CI actually produces.
        const entries = parseMatrixIncludes(
            lines(`      matrix:
        include:
          - arch: arm64
            runner: macos-latest
          - arch: x64
            runner: macos-15-intel`),
        );
        const targets = entries.map((e) => `${osFromRunner(e.runner)}-${e.arch}`);
        assert.deepEqual(targets, ['darwin-arm64', 'darwin-x64']);
    });

    it('reads entries that name no runner (the emulated legs)', () => {
        // `build-prebuilds-qemu` has a literal `runs-on` and arch-only entries;
        // the OS must keep coming from the job in that case.
        const entries = parseMatrixIncludes(
            lines(`      matrix:
        include:
          - arch: ppc64
            image: fedora:43
          - arch: s390x
            image: fedora:43`),
        );
        assert.deepEqual(
            entries.map((e) => e.arch),
            ['ppc64', 's390x'],
        );
        assert.equal(entries[0].runner, undefined);
    });

    it('stops at the end of the matrix block', () => {
        // A `- name:` step further down must not be read as a matrix entry.
        const entries = parseMatrixIncludes(
            lines(`      matrix:
        include:
          - arch: x64
            runner: ubuntu-latest

    steps:
      - name: Build @gjsify/thing
        run: meson compile`),
        );
        assert.equal(entries.length, 1);
        assert.equal(entries[0].name, undefined);
    });

    it('returns nothing for a job with no matrix', () => {
        assert.deepEqual(parseMatrixIncludes(lines('    runs-on: macos-latest\n    steps:\n      - run: true')), []);
    });
});

// The second question the same parser answers: not "does CI build it" but "who
// SHIPS it". A declared target this repo commits no artifact for can only reach a
// consumer inside the tarball a `release.yml` job stages, and twice now the union
// over all four workflows was green while the release shipped nothing — 0.26.0
// (win32-x64 + darwin-arm64) and #921 (darwin-x64, declared with a node-gi.yml
// matrix leg and no release leg).
describe('release-only targets', () => {
    // The three shapes `prebuildOwnership` distinguishes, as `collectNativePackages`
    // rows: only `prebuildsField` + `builder` decide it.
    const installTime = (declared) => ({
        declared,
        shipped: [],
        uncommitted: null,
        prebuildsField: null,
        builder: 'node-gyp',
    });
    const split = (declared) => ({ declared, shipped: [], uncommitted: null, prebuildsField: null, builder: 'meson' });
    const committedHere = (declared, uncommitted = null) => ({
        declared,
        shipped: declared.filter((t) => !Object.keys(uncommitted ?? {}).includes(t)),
        uncommitted,
        prebuildsField: 'prebuilds',
        builder: 'meson',
    });

    it('claims every declared target of an install-time package', () => {
        // `@gjsify/node-gi`: node-gyp, no `gjsify.prebuilds`, nothing committed for
        // ANY target — so all five have to come from a release job.
        assert.deepEqual(releaseOnlyTargets(installTime(['linux-x64', 'darwin-x64', 'win32-x64'])), [
            'linux-x64',
            'darwin-x64',
            'win32-x64',
        ]);
    });

    it('claims nothing from a split parent — the children answer for their targets', () => {
        // The parent holds the declaration but owns no artifact (ADR 0017). Reading
        // its empty `shipped` as "commits nothing" would demand a release leg for
        // every meson bridge, none of which needs one: the per-target packages are
        // published by the ordinary publish job.
        assert.deepEqual(releaseOnlyTargets(split(['linux-x64', 'darwin-arm64'])), []);
    });

    it('claims only the exempted target of a package that commits the rest', () => {
        assert.deepEqual(releaseOnlyTargets(committedHere(['linux-x64'], { 'linux-x64': 'built by release.yml' })), [
            'linux-x64',
        ]);
        assert.deepEqual(releaseOnlyTargets(committedHere(['linux-x64', 'linux-arm64'])), []);
    });

    it('accepts the legacy uname spelling on either side', () => {
        assert.deepEqual(releaseOnlyTargets(installTime(['linux-x86_64'])), ['linux-x64']);
    });
});

describe('release coverage', () => {
    const nodeGi = {
        name: '@gjsify/node-gi',
        path: 'packages/node-gi/node-gi',
        declared: ['linux-x64', 'darwin-x64'],
        shipped: [],
        uncommitted: null,
        prebuildsField: null,
        builder: 'node-gyp',
    };
    const cover = (...targets) => new Map([['@gjsify/node-gi', new Set(targets)]]);

    it('fails on a declared target no release job produces', () => {
        const failures = auditReleaseCoverage([nodeGi], cover('linux-x64'), new Map());
        assert.equal(failures.length, 1);
        assert.match(failures[0], /darwin-x64/);
        assert.match(failures[0], /release\.yml/);
    });

    it('passes once every release-only target has a leg', () => {
        assert.deepEqual(auditReleaseCoverage([nodeGi], cover('linux-x64', 'darwin-x64'), new Map()), []);
    });

    it('fails when release.yml produces NOTHING for the package', () => {
        // The parser reporting no coverage at all is the failing direction on
        // purpose: for these packages "no release leg" IS the defect, so an
        // unrecognised job shape can never turn into a false pass.
        assert.equal(auditReleaseCoverage([nodeGi], new Map(), new Map()).length, 2);
    });

    it('exempts a target `prebuilds.yml` builds — it is on its way to being committed', () => {
        // The TEMPORARY half of the exemption contract: `commit-prebuilds` lands the
        // directory and clears the exemption in the same commit. Between the leg
        // going green and that commit, a target legitimately has no artifact and no
        // release leg, and demanding one would block every new exotic-arch addition.
        const exotic = {
            ...nodeGi,
            name: '@gjsify/terminal-native-linux-ppc64',
            declared: ['linux-ppc64'],
            uncommitted: { 'linux-ppc64': 'emulated leg is green; commit-prebuilds has not run yet' },
            prebuildsField: 'prebuilds',
            builder: 'meson',
        };
        const built = new Map([['@gjsify/terminal-native-linux-ppc64', new Set(['linux-ppc64'])]]);
        assert.deepEqual(auditReleaseCoverage([exotic], new Map(), built), []);
    });
});

// The fourth question, and the one that had no check at all until this file grew
// one: does a GLYPH in the platform matrix mean what its legend says?
//
// `✓ declared, a CI job targets it, artifact committed` was rendered for
// `@gjsify/napi` (both targets deferred by its per-target packages, the linux-x64
// directory DELETED in #960) and for `@gjsify/node-gi` (node-gyp at install time,
// no committed directory anywhere) — because ADR 0017 moved `shipped`/
// `platformsUncommitted` onto the per-target CHILD packages, which `matrixRows`
// filters out of the table, so the `○` and `⚠` branches read those fields off a
// parent that no longer carries them and were unreachable. The table is rendered
// into the website's Platform Support page, so the cell that exists to stop
// "declared" reading as "delivered" was itself claiming a delivery.
//
// Two layers, because either alone can pass while the other's failure ships:
// synthetic rows pin the FUNCTION contract for all four shapes (a real tree only
// ever holds some of them at a time), and a pass over the REAL tree pins the
// legend as a PROPERTY — a `✓` iff a `prebuilds/<target>/` directory exists —
// which cannot rot the way a copied snapshot of the table would.
describe('platform matrix glyphs', () => {
    /** A split bridge (ADR 0017): declares the targets, commits nothing itself. */
    const bridge = (name, declared, { ci = declared, builder = 'meson' } = {}) => ({
        name,
        path: `packages/node/${basename(name)}`,
        tier: 1,
        builder,
        declared,
        shipped: [],
        prebuildsField: null,
        uncommitted: null,
        ci,
    });
    /** One of that bridge's per-target packages — the tarball that holds the binary. */
    const child = (parentName, target, { committed = true, ci = [target] } = {}) => ({
        name: platformPackageName(parentName, target),
        path: `packages/node/${platformPackageDirName(basename(parentName), target)}`,
        tier: 1,
        builder: 'meson',
        declared: [target],
        shipped: committed ? [target] : [],
        prebuildsField: 'prebuilds',
        uncommitted: committed
            ? null
            : { [target]: 'built + load-tested by CI; no job commits it back into this repo' },
        ci,
    });

    /** The rendered table as `{ package: { target: glyph } }`. */
    const glyphsOf = (rows, shown) => {
        const credited = creditPlatformArtifacts(rows);
        const md = renderPlatformMatrix(
            credited.filter((r) => shown.includes(r.name)),
            { markdown: true },
        );
        return parseMarkdownMatrix(md);
    };

    it('renders `✓` where a per-target package really commits the artifact', () => {
        // The `@gjsify/tls-native` / `@gjsify/webgl` shape: the bridge contains no
        // binary, its children contain all of them. `✓` is correct here and must
        // survive the fix — a change that made every cell honest by making none of
        // them `✓` would be no better than the inversion.
        const rows = [
            bridge('@gjsify/tls-native', ['linux-x64', 'darwin-arm64']),
            child('@gjsify/tls-native', 'linux-x64'),
            child('@gjsify/tls-native', 'darwin-arm64'),
        ];
        assert.deepEqual(glyphsOf(rows, ['@gjsify/tls-native'])['@gjsify/tls-native'], {
            'darwin-arm64': '✓',
            'linux-x64': '✓',
        });
    });

    it('renders `○` when every child DEFERS its artifact', () => {
        // `@gjsify/napi`: both per-target packages carry `gjsify.platformsUncommitted`
        // — permanently, because no job commits either back (AGENTS.md § OS axis
        // enforcement, "two kinds of exemption"). This is the cell that rendered
        // `✓` while the repo held no napi binary at all.
        const rows = [
            bridge('@gjsify/napi', ['linux-x64', 'darwin-arm64']),
            child('@gjsify/napi', 'linux-x64', { committed: false }),
            child('@gjsify/napi', 'darwin-arm64', { committed: false }),
        ];
        assert.deepEqual(glyphsOf(rows, ['@gjsify/napi'])['@gjsify/napi'], {
            'darwin-arm64': '○',
            'linux-x64': '○',
        });
    });

    it('renders `○` for an install-time bridge with no per-target packages', () => {
        // `@gjsify/node-gi`: node-gyp, no `gjsify.prebuilds`, no children, nothing
        // committed for ANY target — every declared one reaches a consumer only
        // inside a `release.yml` tarball, which is what `auditReleaseCoverage` above
        // guarantees. So the honest cell is `○`, and there is no exemption entry
        // anywhere to key it on: absence of a committed artifact IS the signal.
        const rows = [bridge('@gjsify/node-gi', ['linux-x64', 'darwin-x64', 'win32-x64'], { builder: 'node-gyp' })];
        assert.deepEqual(glyphsOf(rows, ['@gjsify/node-gi'])['@gjsify/node-gi'], {
            'darwin-x64': '○',
            'linux-x64': '○',
            'win32-x64': '○',
        });
    });

    it('renders `⚠` for a committed artifact no CI job targets', () => {
        // The other branch the parent-only read made unreachable. A green tree
        // cannot show it (`auditPlatforms` fails declared-⊄-CI first), which is
        // exactly why it needs a test: `--platforms` is ALSO printed on failure, to
        // explain one.
        const rows = [
            bridge('@gjsify/terminal-native', ['linux-x64'], { ci: [] }),
            child('@gjsify/terminal-native', 'linux-x64', { ci: [] }),
        ];
        assert.equal(glyphsOf(rows, ['@gjsify/terminal-native'])['@gjsify/terminal-native']['linux-x64'], '⚠');
    });

    it('refuses rows that never went through the credit pass', () => {
        // The mechanism. Crediting AFTER `matrixRows` filters the children out finds
        // nothing to credit and silently renders `✓` everywhere — a reporting path
        // fails by answering a different question, never by exiting non-zero. So the
        // renderer demands the field instead of defaulting it.
        assert.throws(() => renderPlatformMatrix([bridge('@gjsify/webgl', ['linux-x64'])]), /artifacts/);
    });
});

/** `renderPlatformMatrix(..., {markdown:true})` → `{ package: { target: glyph } }`. */
function parseMarkdownMatrix(md) {
    const rows = md.split('\n').filter((line) => line.startsWith('|'));
    const cells = (line) =>
        line
            .split('|')
            .slice(1, -1)
            .map((c) => c.trim());
    const header = cells(rows[0]); // package | tier | <target>…
    const out = {};
    for (const line of rows.slice(2)) {
        const cols = cells(line);
        const table = {};
        for (let i = 2; i < cols.length; i++) table[header[i]] = cols[i];
        out[cols[0].replaceAll('`', '')] = table;
    }
    return out;
}

// The same claim, against the tree as it actually is. The synthetic rows above
// describe shapes; this one cannot be satisfied by a renderer that agrees with a
// fixture and disagrees with the repository.
describe('platform matrix glyphs — the real tree', () => {
    /** Every directory a committed artifact for `<row, target>` could legally be in. */
    const artifactDirs = (row, target) => [
        join(MONOREPO_ROOT, row.path, 'prebuilds', target),
        join(MONOREPO_ROOT, dirname(row.path), platformPackageDirName(basename(row.path), target), 'prebuilds', target),
    ];

    it('shows `✓` for a declared target iff a prebuild directory is committed for it', async () => {
        const { matrixRows } = await platformRows(createContext({ root: MONOREPO_ROOT, discoveryRoots: ['packages'] }));
        assert.ok(matrixRows.length > 0, 'no native bridges found — the context or discovery root moved');
        const table = parseMarkdownMatrix(renderPlatformMatrix(matrixRows, { markdown: true }));
        for (const row of matrixRows) {
            for (const target of row.declared ?? []) {
                const canon = canonicalPlatform(target);
                const glyph = table[row.name][canon];
                const committed = artifactDirs(row, target).some(existsSync);
                assert.equal(
                    glyph === '✓',
                    committed,
                    `${row.name} ${canon}: rendered \`${glyph}\`, but a committed prebuild directory ${committed ? 'DOES' : 'does NOT'} exist (${artifactDirs(row, target).join(' | ')}). \`✓\` claims "artifact committed" and nothing else may.`,
                );
            }
        }
    });

    it('pins the two bridges this repository commits nothing for', async () => {
        const { matrixRows } = await platformRows(createContext({ root: MONOREPO_ROOT, discoveryRoots: ['packages'] }));
        const table = parseMarkdownMatrix(renderPlatformMatrix(matrixRows, { markdown: true }));
        const rowFor = (name) => matrixRows.find((r) => r.name === name);
        // Asserted over each bridge's OWN declared list rather than a target count,
        // so adding a target does not red-line this test — the claim is about the
        // package's contract, not about today's matrix width.
        for (const name of ['@gjsify/napi', '@gjsify/node-gi']) {
            const row = rowFor(name);
            assert.ok(row, `${name} is not in the matrix any more`);
            for (const target of row.declared) {
                assert.equal(
                    table[name][canonicalPlatform(target)],
                    '○',
                    `${name} ${target}: commits no artifact here (napi defers BOTH targets in its per-target packages; node-gi builds with node-gyp at install time), so the honest glyph is \`○\`. A \`✓\` here is either the rendering regression or a genuine policy change — a committed copy for ONE of a bridge's targets is the shape AGENTS.md § OS axis enforcement forbids.`,
                );
            }
        }
        for (const name of ['@gjsify/tls-native', '@gjsify/webgl']) {
            const row = rowFor(name);
            assert.ok(row, `${name} is not in the matrix any more`);
            for (const target of row.declared) {
                assert.equal(table[name][canonicalPlatform(target)], '✓', `${name} ${target}`);
            }
        }
    });
});
