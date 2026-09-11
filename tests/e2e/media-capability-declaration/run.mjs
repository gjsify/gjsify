// E2E test for the `media-capabilities` conformance rule — "a runtime bundle that
// promises to decode a format ships the plugin behind it, and a format it does NOT
// decode is written down".
//
// WHY IT EXISTS. `@gjsify/gtk-runtime-win32-x64` shipped a GStreamer payload with no MP3
// decoder in it while both darwin bundles carried one, and a person running an
// application on Windows is what found it. Every gate on the way to npm was green: the
// bundle's own `gtk/manifest.json` records `windowingData.gstPlugins`, a COUNT, and a
// count cannot be wrong about WHICH.
//
// WHY SYNTHETIC FIXTURES. The payload of a real bundle is 80-130 MB, gitignored, and
// assembled on a macOS or Windows runner — so it is absent from every checkout and from
// this Linux CI leg. What the rule READS of it is the set of file NAMES in one directory,
// so an empty file named `libgstmpg123.dylib` is a faithful fixture for the question
// being asked and a misleading one for any other. The suite says which question that is
// on every assertion: file presence is a NECESSARY condition for a decoder and not a
// sufficient one, and the sufficient half is asked of the running registry, on the target
// OS, by `packages/node-gi/node-gi/test/gst-elements.test.mjs`.
//
// AND THE REAL TREE IS ASSERTED TOO, at the end. A rule driven only by fixtures it wrote
// itself is a rule that can be correct about nothing: the last suite holds the three
// published bundle packages, by name, against the shape this file spends its length
// checking — so deleting a declaration, or a bundle package quietly losing one, is a red
// run here and not merely a red run somewhere a payload happens to exist.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CONFORMANCE = join(MONOREPO_ROOT, 'packages', 'infra', 'manifest-conformance', 'lib', 'index.mjs');

const { auditMediaCapabilities, collectMediaBundles, createContext, gstPluginBaseName, readGstPluginDir } =
    await import(`file://${CONFORMANCE}`);

/** The three published bundles, spelled once. */
const BUNDLE_PACKAGES = [
    '@gjsify/gtk-runtime-darwin-arm64',
    '@gjsify/gtk-runtime-darwin-x64',
    '@gjsify/gtk-runtime-win32-x64',
];

/** Where a bundle keeps its plugins, in every one of the three. */
const PLUGIN_DIR = 'gtk/lib/gstreamer-1.0';

const WAV = { format: 'WAV / PCM', plugin: 'wavparse', element: 'wavparse' };
const MP3 = { format: 'MP3', plugin: 'mpg123', element: 'mpg123audiodec' };

/**
 * A bundle record in the shape `collectMediaBundles` produces, so the audit is driven with
 * exactly what the rule hands it and no adapter sits between the two.
 */
function bundleRecord(name, dir, capabilities, files = ['index.js', 'gtk']) {
    return { name, path: `packages/node-gi/${name.replace('@gjsify/', '')}`, dir, files, capabilities };
}

/** A declaration in the shape the three real packages carry. */
function capabilities({ decode = [WAV], gaps = [], gstPluginDir = PLUGIN_DIR } = {}) {
    return { gstPluginDir, audioDecode: decode, gaps };
}

/**
 * Lay down a payload directory holding one file per plugin, in a real archive spelling.
 *
 * `libgst<name>.dylib` on purpose rather than a single canonical form: the prefix and the
 * extension are exactly what a previous reader got wrong, skipping all 83 plugins of a
 * bundle at exit 0 because a `^libgst` strip left the Windows leaf unmatched.
 */
function stagePayload(root, plugins, { spelling = (name) => `libgst${name}.dylib` } = {}) {
    const dir = join(root, PLUGIN_DIR);
    mkdirSync(dir, { recursive: true });
    for (const plugin of plugins) writeFileSync(join(dir, spelling(plugin)), '');
    return root;
}

function scratch(tag) {
    return mkdtempSync(join(tmpdir(), `gjsify-media-${tag}-`));
}

/** Every failure line, joined — asserted on by substring, never by index. */
const text = (result) => result.failures.join('\n');

describe('media-capabilities — the declaration is checked with no payload at all', () => {
    it('passes a well-formed declaration and SAYS it inspected no artifact', () => {
        const dir = scratch('nopayload');
        const result = auditMediaCapabilities([
            bundleRecord('@gjsify/gtk-runtime-a', dir, capabilities({ decode: [WAV, MP3] })),
        ]);
        assert.deepEqual(result.failures, []);
        assert.equal(result.stats.inspected, 0);
        // The vacuity guard, and the reason it is an assertion rather than a comment: a rule
        // that quietly reports "clean" over an artifact it never opened is the shape every
        // check in this area exists to remove. It has to SAY so on a PASSING run.
        assert.match(result.notes.join('\n'), /payload NOT INSPECTED/);
        rmSync(dir, { recursive: true, force: true });
    });

    it('fails a bundle that ships a payload and declares nothing', () => {
        const result = auditMediaCapabilities([
            bundleRecord('@gjsify/gtk-runtime-a', scratch('undeclared'), undefined),
        ]);
        assert.match(text(result), /declares no `gjsify\.mediaCapabilities`/);
    });

    it('fails a declaration whose package no longer ships the payload the trigger keys on', () => {
        // THE TRIGGER, HELD AGAINST ITSELF. `files` is an ordinary edit, and narrowing the real
        // win32 bundle's to `gtk/bin` + `gtk/lib` + `gtk/share` took it out of this rule AND out
        // of `bundled-license` at exit 0, with the whole MP3 declaration still in the tarball —
        // measured, the audit reporting two bundles where the repository publishes three.
        // `field-coverage` cannot see it: it matches key NAMES across the tree, so the bundles
        // that stayed satisfied coverage for the one that left.
        const result = auditMediaCapabilities([
            bundleRecord('@gjsify/gtk-runtime-a', scratch('untriggered'), capabilities(), [
                'index.js',
                'gtk/bin',
                'gtk/lib',
            ]),
        ]);
        assert.match(text(result), /ship no `gtk\/` payload directory/);
    });

    it('does not let an untriggered package oblige the real bundles to answer for it', () => {
        // A package outside the trigger is a finding on its own and must not become a second one
        // on every bundle that never heard of its formats — a failure naming innocent packages is
        // how a check gets read as noise and then switched off.
        const result = auditMediaCapabilities([
            bundleRecord('@gjsify/gtk-runtime-a', scratch('speaks3'), capabilities({ decode: [WAV] })),
            bundleRecord('@gjsify/rogue', scratch('rogue'), capabilities({ decode: [WAV, MP3] }), ['index.js']),
        ]);
        assert.equal(result.failures.length, 1);
        assert.match(text(result), /@gjsify\/rogue/);
        assert.doesNotMatch(text(result), /says nothing about MP3/);
    });

    it('fails a declaration that is present and says nothing at all', () => {
        // `{}` is the shape between "absent" and "two empty arrays", and it is the one a hand
        // edit produces: the key is there, so `field-coverage` is satisfied by its NAME, and
        // both arrays are `undefined` rather than empty. Demanded by name so the difference
        // cannot be read as a clean bundle.
        const result = auditMediaCapabilities([bundleRecord('@gjsify/gtk-runtime-a', scratch('bare'), {})]);
        assert.match(text(result), /needs both an `audioDecode` and a `gaps` array/);
    });

    it('fails a declaration that claims nothing and excuses nothing', () => {
        // An empty declaration reads as a present one to every consumer and is what a check
        // iterating it would report as clean.
        const result = auditMediaCapabilities([
            bundleRecord('@gjsify/gtk-runtime-a', scratch('empty'), capabilities({ decode: [], gaps: [] })),
        ]);
        assert.match(text(result), /claims nothing and declares no gap/);
    });

    it('fails a gap with no reason, because the reason is the whole of it', () => {
        const result = auditMediaCapabilities([
            bundleRecord(
                '@gjsify/gtk-runtime-a',
                scratch('nowhy'),
                capabilities({ gaps: [{ format: 'MP3', plugin: 'mpg123', element: 'mpg123audiodec' }] }),
            ),
        ]);
        assert.match(text(result), /gaps\[0\]: no `why`/);
    });

    it('fails a gap that names neither a plugin nor a format, since nothing could retire it', () => {
        const result = auditMediaCapabilities([
            bundleRecord('@gjsify/gtk-runtime-a', scratch('vaguegap'), capabilities({ gaps: [{ why: 'reasons' }] })),
        ]);
        assert.match(text(result), /names neither a `plugin` nor a `format`/);
    });

    it('fails a format declared as both taken and not taken', () => {
        const result = auditMediaCapabilities([
            bundleRecord(
                '@gjsify/gtk-runtime-a',
                scratch('both'),
                capabilities({ decode: [MP3], gaps: [{ ...MP3, why: 'and also not' }] }),
            ),
        ]);
        assert.match(text(result), /already declared in `audioDecode`/);
    });

    it('fails a claim missing the plugin or the element — half an oracle is not one', () => {
        const result = auditMediaCapabilities([
            bundleRecord(
                '@gjsify/gtk-runtime-a',
                scratch('half'),
                capabilities({ decode: [{ format: 'MP3', element: 'mpg123audiodec' }] }),
            ),
        ]);
        // The plugin is the half a Linux host can check; the element is the half only the
        // target OS can. Dropping either leaves a claim nothing anywhere can refute.
        assert.match(text(result), /audioDecode\[0\]: `plugin` is missing/);
    });

    it('fails a `gstPluginDir` the tarball does not ship, or one that leaves the package', () => {
        const unshipped = auditMediaCapabilities([
            bundleRecord(
                '@gjsify/gtk-runtime-a',
                scratch('unshipped'),
                capabilities({ gstPluginDir: 'build/gstreamer-1.0' }),
            ),
        ]);
        assert.match(text(unshipped), /which no `files` entry ships/);

        const escaping = auditMediaCapabilities([
            bundleRecord('@gjsify/gtk-runtime-a', scratch('escaping'), capabilities({ gstPluginDir: '/usr/lib/gst' })),
        ]);
        assert.match(text(escaping), /not a path inside the package/);
    });
});

describe('media-capabilities — one bundle answers for every format another speaks about', () => {
    // THE PASS THAT WOULD HAVE CAUGHT IT. The win32 payload lost three decoders and nothing
    // was wrong anywhere: the builder copied what the archive had, the manifest counted what
    // was copied, and no artifact was ever obliged to answer for another's claims.
    it('fails the bundle that simply says nothing about a format', () => {
        const result = auditMediaCapabilities([
            bundleRecord('@gjsify/gtk-runtime-a', scratch('speaks'), capabilities({ decode: [WAV, MP3] })),
            bundleRecord('@gjsify/gtk-runtime-b', scratch('silent'), capabilities({ decode: [WAV] })),
        ]);
        assert.match(text(result), /@gjsify\/gtk-runtime-b: says nothing about MP3/);
    });

    it('accepts the same asymmetry once it is written down as a gap', () => {
        const result = auditMediaCapabilities([
            bundleRecord('@gjsify/gtk-runtime-a', scratch('speaks2'), capabilities({ decode: [WAV, MP3] })),
            bundleRecord(
                '@gjsify/gtk-runtime-b',
                scratch('declared'),
                capabilities({ decode: [WAV], gaps: [{ ...MP3, why: 'the archive carries no libmpg123' }] }),
            ),
        ]);
        assert.deepEqual(result.failures, []);
    });

    it('names WHO claims the format, so the failure is actionable from the line alone', () => {
        const result = auditMediaCapabilities([
            bundleRecord('@gjsify/gtk-runtime-a', scratch('who1'), capabilities({ decode: [WAV, MP3] })),
            bundleRecord('@gjsify/gtk-runtime-b', scratch('who2'), capabilities({ decode: [WAV] })),
        ]);
        assert.match(text(result), /which @gjsify\/gtk-runtime-a declares an answer for/);
    });
});

describe('media-capabilities — the declaration against the shipped files', () => {
    it('passes when every claimed plugin is in the payload', () => {
        const dir = stagePayload(scratch('good'), ['wavparse', 'mpg123', 'coreelements']);
        const result = auditMediaCapabilities([
            bundleRecord('@gjsify/gtk-runtime-a', dir, capabilities({ decode: [WAV, MP3] })),
        ]);
        assert.deepEqual(result.failures, []);
        assert.equal(result.stats.inspected, 1);
        // What it did NOT check has to survive into a PASSING run, or the green line
        // overstates the coverage.
        assert.match(result.notes.join('\n'), /necessary condition and not a sufficient one/);
        rmSync(dir, { recursive: true, force: true });
    });

    it('FAILS the defect itself: a claimed format whose plugin never shipped', () => {
        const dir = stagePayload(scratch('nompg'), ['wavparse', 'opus', 'coreelements']);
        const result = auditMediaCapabilities([
            bundleRecord('@gjsify/gtk-runtime-a', dir, capabilities({ decode: [WAV, MP3] })),
        ]);
        assert.match(text(result), /declares it decodes MP3, and the plugin behind it \(`mpg123`\) is not in/);
        rmSync(dir, { recursive: true, force: true });
    });

    it('FAILS a declared gap whose plugin has arrived, so an entry cannot outlive its cause', () => {
        const dir = stagePayload(scratch('retired'), ['wavparse', 'mpg123']);
        const result = auditMediaCapabilities([
            bundleRecord(
                '@gjsify/gtk-runtime-a',
                dir,
                capabilities({ gaps: [{ ...MP3, why: 'the archive carries no libmpg123' }] }),
            ),
        ]);
        assert.match(text(result), /declares a gap for `mpg123` \(MP3\), and the payload carries it/);
        rmSync(dir, { recursive: true, force: true });
    });

    it('FAILS a payload directory that exists and holds no plugin at all', () => {
        // An empty directory satisfies every count-shaped gate and decodes nothing. It also
        // reads identically to an ABSENT one from a `length === 0` test, which is why the
        // reader distinguishes the two rather than the caller.
        const dir = stagePayload(scratch('emptydir'), []);
        const result = auditMediaCapabilities([
            bundleRecord('@gjsify/gtk-runtime-a', dir, capabilities({ decode: [WAV] })),
        ]);
        assert.match(text(result), /exists and holds no GStreamer plugin at all/);
        rmSync(dir, { recursive: true, force: true });
    });

    it('reads a plugin file in every spelling the two archives produce', () => {
        // The parser this rule and the two builders now share. A `^libgst` strip leaves the
        // Windows leaf as `gstcoreelements`, matches nothing, and skips every plugin at exit 0.
        for (const spelling of [
            (name) => `libgst${name}.dylib`,
            (name) => `gst${name}.dll`,
            (name) => `libgst${name}.so`,
            (name) => `LIBGST${name.toUpperCase()}.DLL`,
            (name) => `libgst${name}.so.0`,
        ]) {
            const dir = stagePayload(scratch('spelling'), ['wavparse'], { spelling });
            const result = auditMediaCapabilities([
                bundleRecord('@gjsify/gtk-runtime-a', dir, capabilities({ decode: [WAV] })),
            ]);
            assert.deepEqual(result.failures, [], `${spelling('wavparse')} did not read as the wavparse plugin`);
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('takes a payload from a directory that is not the package — the staged-tarball route', () => {
        // How a bundle downloaded from npm is audited: `stage-published-gtk-runtime.mjs` writes
        // `<dest>/gtk`, so `<dest>` stands in for the package root. Without this the only host
        // that could ever compare a claim to an artifact would be the one that built it.
        const staged = stagePayload(scratch('staged'), ['wavparse']);
        const pkgDir = scratch('pkg');
        const result = auditMediaCapabilities(
            [bundleRecord('@gjsify/gtk-runtime-a', pkgDir, capabilities({ decode: [WAV] }))],
            { payloads: { '@gjsify/gtk-runtime-a': staged } },
        );
        assert.deepEqual(result.failures, []);
        assert.equal(result.stats.inspected, 1);
        rmSync(staged, { recursive: true, force: true });
        rmSync(pkgDir, { recursive: true, force: true });
    });

    it('distinguishes an absent payload from an empty one', () => {
        assert.equal(readGstPluginDir(join(scratch('absent'), 'nope')), null);
        assert.deepEqual(readGstPluginDir(join(stagePayload(scratch('empty2'), []), PLUGIN_DIR)).files, []);
    });

    it('parses a plugin file name the same way in every spelling', () => {
        assert.equal(gstPluginBaseName('libgstmpg123.dylib'), 'mpg123');
        assert.equal(gstPluginBaseName('gstmpg123.dll'), 'mpg123');
        assert.equal(gstPluginBaseName('LIBGSTMPG123.DLL'), 'mpg123');
        assert.equal(gstPluginBaseName('/a/b/libgstmpg123.so.0'), 'mpg123');
    });
});

describe('media-capabilities — the three published bundles, in this tree', () => {
    const ctx = createContext({ root: MONOREPO_ROOT, discoveryRoots: ['packages'] });
    const bundles = collectMediaBundles(ctx);
    const byName = new Map(bundles.map((bundle) => [bundle.name, bundle]));

    it('finds every bundle package, so nothing above was checked over an empty list', () => {
        // The positive fact. Every assertion in this suite is about a set the rule DERIVES,
        // and a derivation that comes back empty passes every one of them.
        assert.deepEqual(
            bundles.map((bundle) => bundle.name).sort(),
            BUNDLE_PACKAGES,
            'the bundle packages this repository publishes are not the ones the rule found',
        );
    });

    it('holds them all — the same audit `audit-runtimes --check` runs on every PR', () => {
        assert.deepEqual(auditMediaCapabilities(bundles).failures, []);
    });

    it('records the measured platform asymmetry, by name and in both directions', () => {
        // Measured on the published 0.48.0 tarballs from Linux: the darwin bundles carried
        // `mpg123`, `vorbis` and `flac` and the win32 one carried none of the three, all
        // decoders. Asserted by NAME rather than structurally, because a version of this
        // file that compared each declaration to itself would pass while measuring nothing.
        const formats = (name) => byName.get(name).capabilities.audioDecode.map((row) => row.format);
        const gapFormats = (name) => byName.get(name).capabilities.gaps.map((gap) => gap.format);

        assert.ok(formats('@gjsify/gtk-runtime-darwin-arm64').includes('MP3'));
        assert.ok(formats('@gjsify/gtk-runtime-darwin-x64').includes('MP3'));
        assert.ok(!formats('@gjsify/gtk-runtime-win32-x64').includes('MP3'));
        assert.ok(gapFormats('@gjsify/gtk-runtime-win32-x64').includes('MP3'));

        // Ogg/Vorbis is the third of that asymmetry that CLOSED, and it closed because the
        // library was available and nothing had asked for it: gvsbuild defines a `libvorbis`
        // project, the win32 GStreamer build now names it, and the format left `gaps` for the
        // claim. Held in both directions across every bundle, so a build that stops naming it
        // cannot reopen the gap by deleting one array entry (#1626).
        for (const name of BUNDLE_PACKAGES) {
            assert.ok(formats(name).includes('Ogg / Vorbis'), `${name} no longer claims Ogg / Vorbis`);
            assert.ok(!gapFormats(name).includes('Ogg / Vorbis'), `${name} declares Ogg / Vorbis as a gap again`);
        }

        // AAC is the gap every bundle has, and it is the one with no `plugin`: nothing was
        // ever going to be copied, so no file's arrival can retire it.
        for (const name of BUNDLE_PACKAGES) {
            const aac = byName.get(name).capabilities.gaps.find((gap) => gap.format?.startsWith('AAC'));
            assert.ok(aac, `${name} declares no AAC gap`);
            assert.equal(aac.plugin, undefined, `${name}'s AAC gap names a plugin, which nothing ships`);
        }
    });

    it('gives every gap a reason long enough to be one', () => {
        for (const bundle of bundles) {
            for (const gap of bundle.capabilities.gaps) {
                assert.ok(
                    gap.why.length > 40,
                    `${bundle.name}: the gap for ${gap.plugin ?? gap.format} carries no usable reason`,
                );
            }
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The same declaration's THIRD oracle: `upstream`, and the `gvsbuild-catalogue`
// rule that reads it.
//
// WHY IT EXISTS. Everything above compares a declaration to OUR artifact — the plugin
// files, and on the target the running registry. A win32 gap's REASON is neither: it is
// that gvsbuild defines no project for the library behind the element (ADR 0056 § 1), a
// statement about an external catalogue at a pinned version. Both checks above stay green
// on the day that stops being true, which is #1544's class with the sign flipped — there a
// decoder was absent and nothing said so, here a gap outlives its cause and nothing says
// so. The expiry is not hypothetical: `GVSBUILD_VERSION` is spelled in eight workflow
// `env:` blocks and gvsbuild 2026.8.0 was published while 2026.6.0 was still the pin.
//
// The rule is repo-scoped, so it is imported from `scripts/` rather than from the
// conformance package, exactly as `ci-workflow-rev-pin` imports its own.

const GVSBUILD_RULE = join(MONOREPO_ROOT, 'scripts', 'manifest-conformance', 'rules', 'gvsbuild-catalogue.mjs');
const { inspectGvsbuildCatalogue, readGvsbuildPins, upstreamEntries } = await import(`file://${GVSBUILD_RULE}`);
// The matcher and the snapshot reader are node-gi's, beside the builders whose payload the
// catalogue bounds; the rule is only their caller. Imported from the owner, so a test that
// passes here is testing the code the rule runs.
const { matchLibrary, normalizeProject, readGvsbuildCatalogue } = await import(
    `file://${join(MONOREPO_ROOT, 'packages', 'node-gi', 'scripts', 'gvsbuild-catalogue.mjs')}`
);

/** A catalogue in the committed shape, long enough to clear the vacuity floor. */
function fakeCatalogue(extra = []) {
    const filler = Array.from({ length: 50 }, (_, i) => `filler${i}`);
    return { version: '2026.6.0', modules: [...filler, 'libvorbis', 'ogg', 'opus', ...extra].sort() };
}

const PIN = [{ workflow: '.github/workflows/node-gi.yml', version: '2026.6.0' }];

/** One win32-shaped bundle: a claim whose library exists, a gap whose library does not. */
function gvsbuildBundle({ claimLibrary = 'libvorbis', gapLibrary = 'mpg123' } = {}) {
    return [
        {
            name: '@gjsify/gtk-runtime-win32-x64',
            path: 'packages/node-gi/gtk-runtime-win32-x64',
            capabilities: {
                audioDecode: [
                    {
                        format: 'Ogg / Vorbis',
                        plugin: 'vorbis',
                        element: 'vorbisdec',
                        upstream: { catalogue: 'gvsbuild', library: claimLibrary },
                    },
                ],
                gaps: [
                    {
                        format: 'MP3',
                        plugin: 'mpg123',
                        element: 'mpg123audiodec',
                        why: 'no project upstream',
                        upstream: { catalogue: 'gvsbuild', library: gapLibrary },
                    },
                ],
            },
        },
    ];
}

const gvsbuildText = (result) => result.problems.join('\n');

describe('gvsbuild-catalogue — a gap that blames an upstream catalogue is held against it', () => {
    it('passes the win32 shape: a claim whose library is there, a gap whose library is not', () => {
        const result = inspectGvsbuildCatalogue({
            catalogue: fakeCatalogue(),
            pins: PIN,
            bundles: gvsbuildBundle(),
        });
        assert.deepEqual(result.problems, []);
        // Both directions were actually exercised. A run reporting 0 and 0 has compared
        // nothing and would pass every assertion in this block.
        assert.equal(result.stats.present, 1);
        assert.equal(result.stats.absent, 1);
    });

    it('fails the day a gap’s library arrives upstream, and says what closing it takes', () => {
        // THE WHOLE POINT. Nothing else in this repository can notice: the payload is
        // unchanged, the element is still null on the target, and the gap is still declared.
        const result = inspectGvsbuildCatalogue({
            catalogue: fakeCatalogue(['libmpg123']),
            pins: PIN,
            bundles: gvsbuildBundle(),
        });
        assert.match(gvsbuildText(result), /gvsbuild 2026\.6\.0 defines libmpg123/);
        assert.match(gvsbuildText(result), /ADR 0056 § 1 step 1 now answers YES/);
        // And it says the sufficient half out loud, because libvorbis proved step 1 is not
        // it: a project in the catalogue can still fail to build with the catalogue's CMake.
        assert.match(gvsbuildText(result), /necessary and not sufficient/);
    });

    it('fails a CLAIM whose library the catalogue has no project for', () => {
        const result = inspectGvsbuildCatalogue({
            catalogue: fakeCatalogue(),
            pins: PIN,
            bundles: gvsbuildBundle({ claimLibrary: 'libflac' }),
        });
        assert.match(gvsbuildText(result), /CLAIMS the format, and gvsbuild 2026\.6\.0 defines no project module/);
    });

    it('refuses a catalogue too short to be one, BEFORE any absence is read off it', () => {
        // The vacuity direction, and it is asymmetric: a truncated snapshot answers "absent"
        // to everything, so the gaps would all pass and only the claims would fail — half a
        // signal, pointing at the declarations instead of at the snapshot.
        const result = inspectGvsbuildCatalogue({
            catalogue: { version: '2026.6.0', modules: ['glib', 'gtk'] },
            pins: PIN,
            bundles: gvsbuildBundle(),
        });
        assert.match(gvsbuildText(result), /lists 2 project module\(s\), fewer than the 40/);
    });

    it('fails a pin that moved without the snapshot, naming the workflow', () => {
        const result = inspectGvsbuildCatalogue({
            catalogue: fakeCatalogue(),
            pins: [{ workflow: '.github/workflows/release.yml', version: '2026.8.0' }],
            bundles: gvsbuildBundle(),
        });
        assert.match(gvsbuildText(result), /release\.yml` builds with gvsbuild 2026\.8\.0/);
        assert.match(gvsbuildText(result), /gvsbuild-catalogue\.mjs --update 2026\.8\.0/);
    });

    it('fails two workflows pinning different versions of the same build system', () => {
        // ADR 0056 § Consequences declined a guard over the duplicated ARGUMENT lists and was
        // right to: the declaration already holds those. The VERSION is the half a cache key
        // is derived from, so two spellings build two prefixes and the leg that proves the
        // payload stops being the leg that ships it.
        const result = inspectGvsbuildCatalogue({
            catalogue: fakeCatalogue(),
            pins: [
                { workflow: '.github/workflows/node-gi.yml', version: '2026.6.0' },
                { workflow: '.github/workflows/release.yml', version: '2026.8.0' },
            ],
            bundles: gvsbuildBundle(),
        });
        assert.match(gvsbuildText(result), /spelled 2 different ways/);
    });

    it('fails when no declaration blames the catalogue at all', () => {
        const result = inspectGvsbuildCatalogue({ catalogue: fakeCatalogue(), pins: PIN, bundles: [] });
        assert.match(gvsbuildText(result), /compared nothing and passed/);
    });

    it('fails when every `upstream` points the same way, which is how the matcher goes blind', () => {
        const bundles = gvsbuildBundle();
        delete bundles[0].capabilities.audioDecode[0].upstream;
        const result = inspectGvsbuildCatalogue({ catalogue: fakeCatalogue(), pins: PIN, bundles });
        assert.match(gvsbuildText(result), /every `upstream` declaration points the same way/);
    });

    it('leaves a catalogue it does not answer for alone, and says it did', () => {
        const bundles = gvsbuildBundle();
        bundles[0].capabilities.gaps[0].upstream = { catalogue: 'homebrew', library: 'mpg123' };
        const result = inspectGvsbuildCatalogue({ catalogue: fakeCatalogue(), pins: PIN, bundles });
        assert.match(result.notes.join('\n'), /which this rule does not answer for/);
    });

    it('matches a library the way upstream might spell it, and only then', () => {
        const modules = ['libvorbis', 'ogg', 'opus', 'adwaita_icon_theme'];
        assert.deepEqual(matchLibrary(modules, 'vorbis'), ['libvorbis']);
        assert.deepEqual(matchLibrary(modules, 'libvorbis'), ['libvorbis']);
        // A future FLAC project is `flac.py` or `libflac.py` with equal likelihood, so the
        // question is asked as a substring — an exact match would answer "still absent" to
        // one of the two spellings.
        assert.deepEqual(matchLibrary(['libflac'], 'flac'), ['libflac']);
        assert.deepEqual(matchLibrary(modules, 'flac'), []);
        assert.deepEqual(matchLibrary(modules, 'mpg123'), []);
        // gvsbuild spells one project two ways: `adwaita_icon_theme.py` IS
        // `adwaita-icon-theme`, so the comparison cannot be literal.
        assert.deepEqual(matchLibrary(modules, 'adwaita-icon-theme'), ['adwaita_icon_theme']);
        assert.equal(normalizeProject('libFLAC'), 'libflac');
        // An empty needle would match every module and turn every gap red at once.
        assert.deepEqual(matchLibrary(modules, ''), []);
    });

    it('reads the direction off the array, never off a field', () => {
        const [bundle] = gvsbuildBundle();
        assert.deepEqual(
            upstreamEntries(bundle.capabilities).map((row) => [row.kind, row.expect]),
            [
                ['audioDecode', 'present'],
                ['gaps', 'absent'],
            ],
        );
    });
});

describe('gvsbuild-catalogue — the committed snapshot and this tree', () => {
    const catalogue = readGvsbuildCatalogue();
    const pins = readGvsbuildPins(MONOREPO_ROOT);

    it('finds the workflow pins, so nothing below was checked over an empty list', () => {
        assert.ok(pins.length > 0, 'no `GVSBUILD_VERSION:` was found in .github/workflows');
        assert.deepEqual([...new Set(pins.map((pin) => pin.version))], [catalogue.version]);
    });

    it('records the measurement ADR 0056 § 3 rests on, in both directions', () => {
        // Read at 2026.6.0 from the GitHub contents API and cross-read against the PyPI wheel
        // `pipx install gvsbuild==2026.6.0` unpacks: 95 entries, byte-identical lists, no
        // `flac.py` and no `mpg123.py`. Asserted by NAME, because a version of this test
        // comparing the snapshot to itself would pass while measuring nothing.
        assert.ok(catalogue.modules.includes('libvorbis'));
        assert.ok(catalogue.modules.includes('opus'));
        assert.deepEqual(matchLibrary(catalogue.modules, 'flac'), []);
        assert.deepEqual(matchLibrary(catalogue.modules, 'mpg123'), []);
    });

    it('reads a pin out of a CRLF workflow file, which a Windows clone hands it', () => {
        // `core.autocrlf=true` is Git for Windows' installer default and `.gitattributes`
        // deliberately does not cover `*.yml`, so a Windows clone hands the reader CRLF. It
        // copes, and the reason is a language fact rather than anything in the pattern:
        // ECMAScript counts CR as a line terminator, so `$` under `/m` matches before the
        // `\r` too. That is the opposite of the obvious guess — a `[ \t\r]*` was added
        // against it and measured to change nothing — which is exactly why the property is
        // asserted instead of trusted: a rewrite splitting on `\n` would lose it silently,
        // and the symptom would be "no pin in any workflow", a red run about a line ending.
        const root = mkdtempSync(join(tmpdir(), 'gjsify-gvsbuild-crlf-'));
        mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
        const line = "    env:{EOL}      GVSBUILD_VERSION: '2026.6.0'{EOL}";
        for (const eol of ['\r\n', '\n']) {
            writeFileSync(join(root, '.github', 'workflows', 'a.yml'), line.replaceAll('{EOL}', eol));
            assert.deepEqual(readGvsbuildPins(root), [{ workflow: '.github/workflows/a.yml', version: '2026.6.0' }]);
        }
        rmSync(root, { recursive: true, force: true });
    });

    it('reads a pin however the line is spelled, because a pin it misses passes silently', () => {
        // The under-report direction again, one level below the module basenames. A pin this
        // reader does not see is a pin nothing compares to the snapshot — and the other seven
        // still agree with it, so the run that had to be red is the one that goes green.
        // Measured on the trailing-comment spelling, which is the dangerous one: annotating
        // the line is what a person does AT a bump, which is the single moment this rule
        // exists for.
        const root = mkdtempSync(join(tmpdir(), 'gjsify-gvsbuild-spelling-'));
        mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
        for (const spelling of [
            "'2026.6.0'",
            '"2026.6.0"',
            '2026.6.0',
            "'2026.6.0'  # bumped for GTK 4.22",
            '2026.6.0 # see ADR 0056 § 6',
        ]) {
            writeFileSync(
                join(root, '.github', 'workflows', 'a.yml'),
                `    env:\n      GVSBUILD_VERSION: ${spelling}\n`,
            );
            assert.deepEqual(
                readGvsbuildPins(root),
                [{ workflow: '.github/workflows/a.yml', version: '2026.6.0' }],
                `this spelling was not read: ${spelling}`,
            );
        }
        rmSync(root, { recursive: true, force: true });
    });

    it('holds the real bundles — the same audit `audit-runtimes --check` runs on every PR', () => {
        const ctx = createContext({ root: MONOREPO_ROOT, discoveryRoots: ['packages'] });
        const bundles = collectMediaBundles(ctx).map((bundle) => ({
            name: bundle.name,
            path: bundle.path,
            capabilities: bundle.capabilities,
        }));
        const result = inspectGvsbuildCatalogue({ catalogue, pins, bundles });
        assert.deepEqual(result.problems, []);
        assert.equal(result.stats.present, 2, 'the win32 bundle no longer claims a gvsbuild-backed format');
        assert.equal(result.stats.absent, 2, 'the win32 bundle no longer declares a gvsbuild-bounded gap');
    });
});
