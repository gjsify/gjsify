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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
    parseCiPlatforms,
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
        const ctx = createContext({ root: MONOREPO_ROOT, discoveryRoots: ['packages'] });
        const { matrixRows } = await platformRows(ctx);
        const table = parseMarkdownMatrix(renderPlatformMatrix(matrixRows, { markdown: true }));
        const rowFor = (name) => matrixRows.find((r) => r.name === name);
        /**
         * The per-target package's OWN `gjsify.platformsUncommitted` reason for
         * `<bridge, target>`, read from its manifest rather than from the rows
         * under test — a pin that derived its expectation from the same map the
         * renderer reads would be tautological and could not fail.
         */
        const deferral = (bridge, target) =>
            ctx.get(platformPackageName(bridge, target))?.manifest?.gjsify?.platformsUncommitted?.[target];
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
        // The mirror claim: these two commit an artifact for every target they
        // declare — EXCEPT one a per-target package explicitly defers. That
        // carve-out is not a softening, it is the only honest reading of a
        // newly-declared target: `@gjsify/webgl-win32-x64` exists and says in its
        // own manifest why it holds no bytes yet, and `commit-prebuilds` lands
        // the directory and deletes that reason in ONE commit
        // (`clear-committed-platform-exemptions.mjs`). So this expectation flips
        // back to `✓` on its own the moment the artifact arrives, while a target
        // that is `○` with NOTHING saying why still fails here.
        for (const name of ['@gjsify/tls-native', '@gjsify/webgl']) {
            const row = rowFor(name);
            assert.ok(row, `${name} is not in the matrix any more`);
            for (const target of row.declared) {
                const why = deferral(name, target);
                assert.equal(
                    table[name][canonicalPlatform(target)],
                    why ? '○' : '✓',
                    why
                        ? `${name} ${target}: ${platformPackageName(name, target)} defers its artifact (${why}), so the honest glyph is \`○\`.`
                        : `${name} ${target}: nothing defers this target, so a committed artifact is the promise — a glyph other than \`✓\` means the directory is gone or the deferral was deleted without one arriving.`,
                );
            }
        }
    });
});

// Which jobs COUNT as producing a target, which is the input every declared-vs-built
// failure is computed from. Fixtures rather than the real workflow, because the claim
// is about job SHAPES: the repository has one job of each shape today and would grow
// a silent hole the day it has two.
//
// The distinction used to be "does this job download an artifact" — a job that did was
// read as a pure consumer and credited with nothing. That held only while no producer
// downloaded, and `@gjsify/webgl`'s win32 target ended it: valac does not run on
// Windows, so the artifact is built by a PAIR and the Windows half downloads the Linux
// half's generated C before compiling. Under the old test that leg produced nothing,
// and `win32-x64` could not be declared without failing the invariant against the very
// job that builds it.
describe('CI coverage — a producer may also be a consumer', () => {
    const nativePkgs = [
        { name: '@gjsify/webgl', path: 'packages/framework/webgl' },
        { name: '@gjsify/tls-native', path: 'packages/node/tls-native' },
    ];

    /** Run the parser over ONE synthetic workflow and return its `name → targets` map. */
    const coverage = async (yaml) => {
        const root = mkdtempSync(join(tmpdir(), 'gjsify-ci-coverage-'));
        try {
            mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
            writeFileSync(join(root, '.github', 'workflows', 'prebuilds.yml'), yaml);
            const map = await parseCiPlatforms(root, nativePkgs, ['prebuilds.yml']);
            return Object.fromEntries([...map].map(([name, targets]) => [name, [...targets].sort()]));
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    };

    it('credits a job that downloads an intermediate and then builds + uploads', async () => {
        const got = await coverage(`
name: fixture
jobs:
  build-prebuilds-win32:
    runs-on: windows-latest
    steps:
      - name: Download the Vala C + GIR
        uses: actions/download-artifact@v8
        with:
          name: webgl-vala-c-win32
          path: packages/framework/webgl/vala-c-export
      - name: Build @gjsify/webgl with MSVC from the imported C
        working-directory: packages/framework/webgl
        run: meson compile -C build
      - name: Upload @gjsify/webgl win32-x64 prebuilds artifact
        uses: actions/upload-artifact@v7
        with:
          path: packages/framework/webgl/prebuilds/win32-x64/
`);
        assert.deepEqual(
            got,
            { '@gjsify/webgl': ['win32-x64'] },
            'the split-build shape: this job DOES produce win32-x64, and reading its download step as proof of the opposite is what made the target undeclarable.',
        );
    });

    it('credits nothing to a job that only downloads', async () => {
        const got = await coverage(`
name: fixture
jobs:
  commit-prebuilds:
    runs-on: ubuntu-latest
    steps:
      - name: Download webgl x64 prebuilds
        uses: actions/download-artifact@v8
        with:
          path: packages/framework/webgl-linux-x64/prebuilds/linux-x64/
      - name: Download tls-native arm64 prebuilds
        uses: actions/download-artifact@v8
        with:
          path: packages/node/tls-native-linux-arm64/prebuilds/linux-arm64/
`);
        assert.deepEqual(
            got,
            {},
            'a consuming job runs on ubuntu-latest and mentions every platform package by path, so crediting it hands each of them `linux-x64` — which fails the invariant in BOTH directions at once.',
        );
    });

    it('never credits a DOWNLOAD step inside a job that also produces', async () => {
        const got = await coverage(`
name: fixture
jobs:
  build-prebuilds-win32:
    runs-on: windows-latest
    steps:
      - name: Download tls-native prebuilds to compare against
        uses: actions/download-artifact@v8
        with:
          path: packages/node/tls-native/prebuilds/linux-x64/
      - name: Collect @gjsify/webgl prebuilds
        run: node scripts/stage-prebuild.mjs packages/framework/webgl --scratch
      - name: Upload @gjsify/webgl win32-x64 prebuilds artifact
        uses: actions/upload-artifact@v7
        with:
          path: packages/framework/webgl/prebuilds/win32-x64/
`);
        assert.deepEqual(
            got,
            { '@gjsify/webgl': ['win32-x64'] },
            'the job-level test cannot separate these two steps, so the per-step one has to: a download step’s `path:` is a DESTINATION, and `@gjsify/tls-native` is not built on Windows by anything.',
        );
    });

    // THE LIBC AXIS. `prebuilds.yml`'s Alpine leg builds the same sources against
    // musl on ordinary ubuntu runners, so its `runs-on` says `linux-x64` — the
    // very target the glibc legs build and it does not. It carries `libc: musl`
    // on each matrix entry precisely so the parser composes `linux-<arch>-musl`
    // and drops it: `-musl` is not a `gjsify.platforms` token (the distinction
    // rides npm's `libc` field), so the leg proves the sources build and load on
    // musl without promising anyone a musl binary.
    //
    // The PAIR below is the point. The first fixture is what the workflow looks
    // like; the second is what deleting one key does, and it is why the key
    // cannot be "simplified" away — the same job then hands a package a platform
    // promise it never builds, the audit stays green, and the leg that really
    // builds `linux-x64` could be deleted with nothing going red.
    const alpineJob = (libcLine) => `
name: fixture
jobs:
  build-prebuilds-musl:
    runs-on: \${{ matrix.runner }}
    strategy:
      matrix:
        include:
          - arch: x64
${libcLine}
            runner: ubuntu-latest
    steps:
      - name: Build and verify every musl prebuild inside alpine:3.24
        run: docker run --rm alpine:3.24 sh .github/prebuild-toolchain/musl-build.sh
      - name: Upload @gjsify/tls-native musl prebuilds artifact
        uses: actions/upload-artifact@v7
        with:
          path: packages/node/tls-native/prebuilds/linux-x64-musl/
`;

    it('credits nothing to a leg whose matrix entries declare `libc: musl`', async () => {
        assert.deepEqual(
            await coverage(alpineJob('            libc: musl')),
            {},
            'a musl leg makes no `<os>-<arch>` promise, so it must contribute nothing to declared-vs-built.',
        );
    });

    it('credits the bare target as soon as the `libc:` key is dropped', async () => {
        assert.deepEqual(
            await coverage(alpineJob('')),
            { '@gjsify/tls-native': ['linux-x64'] },
            'this is what deleting `libc: musl` from the workflow does: the Alpine leg is credited with the glibc target it does not build. The key is load-bearing, not decoration.',
        );
    });

    it('refuses an unrecognised `libc:` value instead of folding it down', async () => {
        await assert.rejects(
            () => coverage(alpineJob('            libc: gnu')),
            /libc: gnu/,
            'an unknown value must not compose the bare token — that is the silent form of the failure the fixture above makes loud.',
        );
    });

    it('refuses `libc: musl` on a non-Linux entry', async () => {
        await assert.rejects(
            () =>
                coverage(`
name: fixture
jobs:
  build-prebuilds-macos:
    runs-on: \${{ matrix.runner }}
    strategy:
      matrix:
        include:
          - arch: arm64
            libc: musl
            runner: macos-latest
    steps:
      - name: Collect @gjsify/webgl prebuilds
        run: node scripts/stage-prebuild.mjs packages/framework/webgl --scratch
      - name: Upload @gjsify/webgl prebuilds artifact
        uses: actions/upload-artifact@v7
        with:
          path: packages/framework/webgl/prebuilds/darwin-arm64/
`),
            /Linux-only/,
            'the libc axis is Linux-only, so the token cannot be composed and the entry would otherwise read as an ordinary promise.',
        );
    });

    it('refuses a `libc:` key the include-entry path would never read', async () => {
        // The other way a libc key goes silently inert: a LIST-form matrix has no
        // `- key: value` entries, so `parseMatrixIncludes` returns nothing and the
        // whole libc branch above is skipped. The job would then be credited with
        // the bare token — the same wrong credit as a deleted key, arriving
        // through a matrix SHAPE instead. A key that is load-bearing in one code
        // path and ignored in another is worse than no key, so the shape refuses.
        await assert.rejects(
            () =>
                coverage(`
name: fixture
jobs:
  build-prebuilds-musl:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        arch: [x64]
        libc: musl
    steps:
      - name: Collect @gjsify/tls-native prebuilds
        run: node scripts/stage-prebuild.mjs packages/node/tls-native --scratch
      - name: Upload @gjsify/tls-native prebuilds artifact
        uses: actions/upload-artifact@v7
        with:
          path: packages/node/tls-native/prebuilds/linux-x64-musl/
`),
            /outside a `matrix.include` entry/,
            'the include-entry path is the only one that reads `libc:`; anywhere else it must refuse rather than compose the bare token.',
        );
    });

    // The `workflow_dispatch` exclusion, which the workflow header claims is
    // matched "character for character" and which nothing tested. It is the other
    // half of how an exploratory leg stays out of the promise audit — and the two
    // mechanisms are NOT interchangeable: dispatch-only keeps a leg out because
    // nobody receives what it builds, `libc:` keeps one out because what it builds
    // is not a platform. The musl leg moved from the first to the second, and the
    // move is only safe because both are held here.
    it('credits nothing to a job gated on workflow_dispatch', async () => {
        assert.deepEqual(
            await coverage(`
name: fixture
jobs:
  build-prebuilds-macos-experimental:
    runs-on: macos-latest
    if: github.event_name == 'workflow_dispatch'
    steps:
      - name: Build @gjsify/tls-native Vala library
        run: node scripts/stage-prebuild.mjs packages/node/tls-native --scratch --allow-undeclared
      - name: Upload @gjsify/tls-native prebuilds artifact
        uses: actions/upload-artifact@v7
        with:
          path: packages/node/tls-native/prebuilds/darwin-arm64/
`),
            {},
            'a manually-dispatched exploratory job is not a platform CI produces, so declaring its target would promise an artifact no user receives.',
        );
    });
});

// THE LIBC AXIS, AGAINST THE WORKFLOW AS IT ACTUALLY IS.
//
// The fixtures above hold the PARSER: they prove that a `libc: musl` entry is
// dropped and that an entry without one is credited. They say nothing about
// `.github/workflows/prebuilds.yml`, because every one of them writes its own
// YAML into a temp dir — so deleting `libc: musl` from the real Alpine leg left
// all of them green, and the audit green with them (measured: both keys removed,
// `node --test tests/e2e/ci-runner-arch/run.mjs` 34/34 and
// `node scripts/audit-runtimes.mjs --check --strict` exit 0). The workflow said
// in two places that deleting the key is "a defect the `ci-runner-arch` e2e
// fixtures fail on"; nothing fetched that claim from the file it is about.
//
// This block does. It lifts the REAL job out of the REAL workflow and runs the
// parser over it — so the key is load-bearing in the tree, not only in a string
// literal. The second test is the control that keeps the first from passing
// vacuously: it deletes the very lines the first relies on and shows the same
// job then hands both packages a `linux-<arch>` promise the glibc legs build and
// this one does not.
describe('the libc axis — the real prebuilds.yml', () => {
    // The two packages the Alpine leg actually compiles. Named here rather than
    // discovered, so a leg that stopped building them fails this block instead
    // of quietly measuring nothing.
    const muslPkgs = [
        { name: '@gjsify/sab-native', path: 'packages/node/sab-native' },
        { name: '@gjsify/lightningcss-native', path: 'packages/infra/lightningcss-native' },
    ];

    /** `build-prebuilds-musl`, lifted out of the real workflow as a one-job document. */
    const realMuslJob = () => {
        const lines = readFileSync(join(MONOREPO_ROOT, '.github', 'workflows', 'prebuilds.yml'), 'utf8').split('\n');
        const start = lines.indexOf('  build-prebuilds-musl:');
        assert.ok(start >= 0, '`build-prebuilds-musl` is gone from prebuilds.yml — this whole block is about it.');
        // The next job HEADER ends the slice. Anything between the two is that
        // job's comment banner, which `parseCiPlatforms` strips anyway.
        let end = start + 1;
        while (end < lines.length && !/^ {2}[A-Za-z0-9][\w-]*:\s*$/.test(lines[end])) end++;
        return ['name: prebuilds', 'jobs:', ...lines.slice(start, end)].join('\n');
    };

    /** The parser's `name → targets` map for ONE workflow document. */
    const coverage = async (yaml) => {
        const root = mkdtempSync(join(tmpdir(), 'gjsify-ci-musl-'));
        try {
            mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
            writeFileSync(join(root, '.github', 'workflows', 'prebuilds.yml'), yaml);
            const map = await parseCiPlatforms(root, muslPkgs, ['prebuilds.yml']);
            return Object.fromEntries([...map].map(([name, targets]) => [name, [...targets].sort()]));
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    };

    it('credits the Alpine leg in the real workflow with nothing', async () => {
        assert.deepEqual(
            await coverage(realMuslJob()),
            {},
            'the real `build-prebuilds-musl` must contribute no `<os>-<arch>` promise. If this fails, `libc: musl` has left its matrix entries (or an entry was added without one) and the leg is now credited with targets the glibc legs build — a green audit measuring the wrong job.',
        );
    });

    it('credits both bare targets once those `libc:` lines are deleted', async () => {
        const stripped = realMuslJob()
            .split('\n')
            .filter((line) => line.trim() !== 'libc: musl')
            .join('\n');
        assert.notEqual(stripped, realMuslJob(), 'nothing was stripped — the real job carries no `libc: musl` line.');
        assert.deepEqual(
            await coverage(stripped),
            {
                '@gjsify/lightningcss-native': ['linux-arm64', 'linux-x64'],
                '@gjsify/sab-native': ['linux-arm64', 'linux-x64'],
            },
            'the control for the test above: without the key the SAME job promises `linux-x64`/`linux-arm64` for both packages. That is what makes the first assertion a measurement rather than a tautology.',
        );
    });
});
