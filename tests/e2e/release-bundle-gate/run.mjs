// E2E test for the two halves of the GTK-runtime release gate:
// `packages/node-gi/scripts/verify-bundle-manifest.mjs` (the gate itself) and
// `scripts/check-workflow-inline-scripts.mjs` (the guard that keeps it a script).
//
// WHY THIS SUITE EXISTS
//
// `release.yml` triggers on `release` / `workflow_dispatch` only. Nothing on a pull
// request has ever executed its steps, which is how the bundle gate shipped DEAD: two
// inline `node -e '…'` blocks — one bash, one pwsh — each ending in
//
//     … data sets ${verified.map((v) => v.id).join('+')}`);
//
// inside a single-quoted shell string. The shell closed the body at the quote before
// `+`, node received `join(+)` and died with `SyntaxError: Unexpected token ')'`
// before evaluating one assertion. All three v0.28.0 `@gjsify/gtk-runtime-*` publish
// legs failed there while every bundle they gated was CORRECT (darwin-arm64
// `windowing: true`, `dataBytes: 20247017`, 25 backed typelibs, 65 license texts;
// win32-x64 the same shape at 5628218 / 37). `cli`, `node-gi` and `napi` went out at
// 0.28.0; the three bundles stayed at 0.27.1 — the one version whose defects that
// gate had just been written to prevent shipping.
//
// So this suite IS the pre-release coverage: it is the only place either script runs
// before a release exercises it for real. It deliberately asserts the FAILURE paths,
// because a gate that cannot fail is what 0.27.1 shipped behind.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/release-bundle-gate/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const VERIFY = join(MONOREPO_ROOT, 'packages', 'node-gi', 'scripts', 'verify-bundle-manifest.mjs');
const GUARD = join(MONOREPO_ROOT, 'scripts', 'check-workflow-inline-scripts.mjs');
const IMAGE_GUARD = join(MONOREPO_ROOT, 'scripts', 'check-ci-image-packages.mjs');
const ORDER_GUARD = join(MONOREPO_ROOT, 'scripts', 'check-build-infra-order.mjs');

/**
 * A passing decode probe, in the shape the builders record it. The dimensions are the
 * ones the #996 investigation measured on a WORKING darwin stack (bundle dylibs forced
 * to win via DYLD_LIBRARY_PATH): SVG 16x16, PNG 16x16, 14 formats.
 *
 * `platform`/`gtkSource`/`bundleIsProbeTarget` are what the probe read off the RUNNING
 * process — the manifest is otherwise all disk facts, and the host GTK decoding a file
 * that merely sits at the bundle's path satisfies every one of them.
 */
function goodProbe(overrides = {}) {
    return {
        ok: true,
        platform: 'darwin',
        gtkSource: 'bundle',
        bundleIsProbeTarget: true,
        addon: 'node_gi.node',
        loaderCache: 'lib/gdk-pixbuf-2.0/2.10.0/loaders.cache',
        loaderDir: 'lib/gdk-pixbuf-2.0/2.10.0/loaders',
        loaderModules: 12,
        svg: { file: 'share/icons/Adwaita/symbolic/actions/open-menu-symbolic.svg', width: 16, height: 16 },
        png: {
            file: 'share/icons/Adwaita/16x16/devices/audio-headphones.png',
            width: 16,
            height: 16,
            source: 'bundled',
        },
        formats: ['png', 'svg', 'jpeg', 'gif'],
        ...overrides,
    };
}

/** The measured shape of a good v0.28.0 darwin-arm64 bundle manifest. */
function goodManifest(overrides = {}) {
    return {
        platform: `${process.platform}-${process.arch}`,
        windowing: true,
        dataBytes: 20247017,
        typelibSymmetry: { backed: 25, dropped: 6 },
        // `binariesCovered` is the count the license gate actually walked. A texts count
        // alone is what the win32 bundles satisfied while shipping GLib and OpenSSL with
        // no terms, so the release gate wants both.
        licenses: { texts: 65, binariesCovered: 121 },
        windowingData: {
            verified: [
                { id: 'schemas', files: 1 },
                { id: 'icons', files: 863 },
                { id: 'gtksource', files: 6 },
            ],
            decodeProbe: goodProbe(),
        },
        ...overrides,
    };
}

/**
 * `GITHUB_ACTIONS` is cleared unless a case sets it: the gate turns its retirement notice
 * into an `::warning::` annotation there, and this suite running under Actions would
 * otherwise decorate every real run with a warning about a fixture.
 */
function runVerify(manifest, extraArgs = [], env = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-bundle-gate-'));
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
    const result = spawnSync(process.execPath, [VERIFY, '--bundle', dir, ...extraArgs], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_ACTIONS: '', ...env },
    });
    return { ...result, output: `${result.stdout}${result.stderr}` };
}

function runGuard(workflowFiles) {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-inline-guard-'));
    const dir = join(root, '.github', 'workflows');
    mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(workflowFiles)) writeFileSync(join(dir, name), body);
    const result = spawnSync(process.execPath, [GUARD, '--root', root], { encoding: 'utf8' });
    return { ...result, output: `${result.stdout}${result.stderr}` };
}

describe('verify-bundle-manifest: the release gate', () => {
    it('accepts a complete windowing bundle', () => {
        const result = runVerify(goodManifest());
        assert.equal(result.status, 0, result.output);
        assert.match(result.stdout, /clean — windowing superset/);
        assert.match(result.stdout, /25 backed typelibs/);
        assert.match(result.stdout, /65 license texts covering 121 binaries/);
        assert.match(result.stdout, /decoded .*open-menu-symbolic\.svg 16x16/);
        assert.match(result.stdout, /through the bundle/);
    });

    it('rejects the v0.27.1 display-free bundle on every count it shipped wrong', () => {
        // Verbatim the shape published as 0.27.1: display-free, so no runtime data, no
        // recorded typelib symmetry (it shipped Adw-1.typelib with no libadwaita) and
        // no license texts beside 37-45 relocated LGPL/MPL/GPL libraries.
        const result = runVerify({ platform: `${process.platform}-${process.arch}`, windowing: false, dataBytes: 0 });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /FAILED 6 check\(s\)/);
        assert.match(result.stderr, /windowing=false dataBytes=0/);
        assert.match(result.stderr, /no verified typelib symmetry/);
        assert.match(result.stderr, /no license texts/);
        assert.match(result.stderr, /no license coverage over the bundled binaries/);
        assert.match(result.stderr, /no verified windowing data sets/);
        assert.match(result.stderr, /no windowingData\.decodeProbe/);
    });

    it('rejects a bundle whose license step never looked at a binary', () => {
        // The published win32 shape: a licence corpus was copied and counted, and no
        // check ever asked whether it covered anything the bundle ships. Measured on the
        // 0.45.0 win32 artifact — 89 binaries, 45 documented projects, 14 binaries whose
        // project the tarball documents nowhere, and every gate green. FAIL CLOSED, as
        // with the decode probe: "the builder is too old to say" is not a pass.
        const manifest = goodManifest();
        delete manifest.licenses.binariesCovered;
        const result = runVerify(manifest);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /no license coverage over the bundled binaries/);
        assert.match(result.stderr, /assertLicenseCoverage over every binary it ships/);
    });

    // THE OTHER ROLE, and the reason the requirement above is not unconditional. The same
    // script gates the tarball a consumer ALREADY has (gtk-os-suites.yml, after
    // stage-published-gtk-runtime.mjs), whose manifest was written before this record
    // existed and can never gain it — only the next release can. Requiring it there turned
    // all three shipped-closure legs red at once over a property no published artifact can
    // acquire. The allowance is narrow and self-retiring; these three cases pin both edges.
    it('lets the PUBLISHED closure through when the record simply predates the field', () => {
        const manifest = goodManifest();
        delete manifest.licenses.binariesCovered;
        const result = runVerify(manifest, ['--allow-legacy-license-record']);
        assert.equal(result.status, 0, result.output);
        assert.match(result.stdout, /LEGACY — .*no license coverage/);
        assert.match(result.stdout, /published-closure role/);
        assert.match(result.stdout, /covering an unrecorded number of binaries/);
    });

    it('still rejects a RECORDED zero, allowance or not', () => {
        // An absent field is a manifest older than the record; a recorded zero is a
        // builder saying it covered nothing. Only the first is a legacy artifact.
        const result = runVerify(goodManifest({ licenses: { texts: 65, binariesCovered: 0 } }), [
            '--allow-legacy-license-record',
        ]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /license coverage over ZERO bundled binaries/);
    });

    it('says the allowance was not needed, so it can be deleted', () => {
        // Self-retiring: the day a published bundle carries the field, the flag reports
        // itself as droppable instead of sitting in the workflow forever.
        const result = runVerify(goodManifest(), ['--allow-legacy-license-record']);
        assert.equal(result.status, 0, result.output);
        assert.match(result.stdout, /--allow-legacy-license-record was not needed/);
        assert.match(result.stdout, /DELETE the flag from the two call sites/);
        assert.doesNotMatch(result.stdout, /::warning::/, 'no annotation outside Actions');
    });

    it('surfaces its own expiry as an Actions annotation, not as a line in a green log', () => {
        // The flag is temporary by construction and the note that retires it is printed by
        // a step that PASSES — which nobody reads. On Actions it is an annotation instead,
        // so the day the published closure carries the record, the deletion is on the run
        // summary and on the PR rather than in scrollback. Still not a failure: this is a
        // deletion to schedule, not a build to break.
        const result = runVerify(goodManifest(), ['--allow-legacy-license-record'], { GITHUB_ACTIONS: 'true' });
        assert.equal(result.status, 0, result.output);
        assert.match(result.stdout, /::warning::verify-bundle-manifest: --allow-legacy-license-record was not needed/);
    });

    it('rejects a declared data set that holds no files', () => {
        // A directory that exists and is empty is the same missing signal as an absent
        // one — and is what 0.27.1's `share/` would have been had it existed at all.
        const result = runVerify(goodManifest({ windowingData: { verified: [{ id: 'icons', files: 0 }] } }));
        assert.equal(result.status, 1);
        assert.match(result.stderr, /verified windowing data sets with no files/);
        assert.match(result.stderr, /"id":"icons"/);
    });

    // #996, the defect this gate was blind to. Everything above is a COUNT — and the
    // published darwin-x64 0.28.0 bundle passed every one of them (860 icon files,
    // `verified icons: 863`) while `Pixbuf.new_from_file()` on its own Adwaita SVG
    // returned −1×−1: the addon kept absolute Homebrew install names, so a Mac with
    // Homebrew glib loaded two GObject registries and type identity failed across the
    // boundary. A file count is not a capability.
    it('rejects a manifest with no decode probe at all, rather than waving it through', () => {
        // FAIL CLOSED. The precedent being avoided is the arch guard that degraded to
        // GREEN instead of to "unverified" — a bundle whose icons nobody decoded must
        // not publish, and "the builder is too old to say" is not a pass.
        const manifest = goodManifest();
        delete manifest.windowingData.decodeProbe;
        const result = runVerify(manifest);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /no windowingData\.decodeProbe/);
        assert.match(result.stderr, /860 icon files of which zero decoded/);
    });

    it('rejects a probe the builder recorded as failed', () => {
        const result = runVerify(
            goodManifest({
                windowingData: {
                    verified: [{ id: 'icons', files: 863 }],
                    decodeProbe: goodProbe({
                        ok: false,
                        error: 'gdk-pixbuf: Unrecognized image file format',
                        svg: { file: 'share/icons/Adwaita/x.svg', width: -1, height: -1 },
                    }),
                },
            }),
        );
        assert.equal(result.status, 1);
        assert.match(result.stderr, /decode probe did not pass: gdk-pixbuf: Unrecognized image file format/);
        assert.match(result.stderr, /decoded svg .* to -1x-1 — a failed load, not an image/);
    });

    it('does not take `ok: true` on trust — the dimensions decide', () => {
        // The exact 0.28.0 measurement wearing a green badge: a builder (or a hand
        // edit) that stamps ok:true over a −1×−1 decode still cannot publish, because
        // the gate re-derives the verdict from the numbers rather than reading a flag.
        const result = runVerify(
            goodManifest({
                windowingData: {
                    verified: [{ id: 'icons', files: 863 }],
                    decodeProbe: goodProbe({
                        svg: {
                            file: 'share/icons/Adwaita/symbolic/actions/open-menu-symbolic.svg',
                            width: -1,
                            height: -1,
                        },
                    }),
                },
            }),
        );
        assert.equal(result.status, 1);
        assert.match(result.stderr, /open-menu-symbolic\.svg to -1x-1/);
    });

    it('rejects a probe the HOST GTK answered, not the bundle', () => {
        // The half a pixel count cannot see. Pointing node-gi at a bundle does not make
        // it load one — index.js wraps the activation in a never-fatal try/catch and
        // `activateBundledGtkRuntime()` returns null whenever the policy did not pick
        // the bundle — so Homebrew (macOS runner) or gvsbuild (Windows runner) decodes
        // the file at the bundle's path and records real, passing dimensions.
        const result = runVerify(
            goodManifest({
                windowingData: {
                    verified: [{ id: 'icons', files: 863 }],
                    decodeProbe: goodProbe({ gtkSource: 'system' }),
                },
            }),
        );
        assert.equal(result.status, 1);
        assert.match(result.stderr, /gtkSource=system on darwin/);
        assert.match(result.stderr, /the bundle itself is unproven/);
    });

    it('rejects a probe that resolved a different bundle than the one it decoded', () => {
        // `resolveGtkRuntimeBundle()` has four candidates and three of them exist on a
        // builder (prebuilds/, the sibling monorepo package, an installed optional dep).
        const result = runVerify(
            goodManifest({
                windowingData: {
                    verified: [{ id: 'icons', files: 863 }],
                    decodeProbe: goodProbe({ bundleIsProbeTarget: false }),
                },
            }),
        );
        assert.equal(result.status, 1);
        assert.match(result.stderr, /activated a DIFFERENT bundle/);
    });

    it('rejects a probe that cannot say which GTK decoded the file', () => {
        // A record from a builder that predates the provenance fields. Fails closed for
        // the same reason the absent record does: nobody checked is not a pass.
        const probe = goodProbe();
        delete probe.platform;
        const result = runVerify(
            goodManifest({ windowingData: { verified: [{ id: 'icons', files: 863 }], decodeProbe: probe } }),
        );
        assert.equal(result.status, 1);
        assert.match(result.stderr, /records no platform/);
    });

    it('rejects a probe that decoded the svg but never the png', () => {
        // win32 ships exactly ONE loader module (the svg one), so "one format works" is
        // a state this bundle family can genuinely be in.
        const probe = goodProbe();
        delete probe.png;
        const result = runVerify(
            goodManifest({ windowingData: { verified: [{ id: 'icons', files: 863 }], decodeProbe: probe } }),
        );
        assert.equal(result.status, 1);
        assert.match(result.stderr, /carries no png result/);
    });

    it('rejects a bundle built for another architecture than the host', () => {
        const result = runVerify(goodManifest({ platform: 'darwin-ppc64' }), [
            '--expect-host-target',
            process.platform,
        ]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /manifest says platform=darwin-ppc64/);
    });

    it('rejects verifying a foreign-OS bundle on this runner', () => {
        const foreign = process.platform === 'win32' ? 'darwin' : 'win32';
        const result = runVerify(goodManifest(), ['--expect-host-target', foreign]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, new RegExp(`--expect-host-target ${foreign} but this runner is`));
    });

    it('fails loudly on a missing manifest instead of passing vacuously', () => {
        const result = spawnSync(process.execPath, [VERIFY, '--bundle', join(tmpdir(), 'gjsify-no-such-bundle')], {
            encoding: 'utf8',
        });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /cannot read/);
    });

    it('requires --bundle', () => {
        const result = spawnSync(process.execPath, [VERIFY], { encoding: 'utf8' });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /--bundle <dir> is required/);
    });
});

describe('check-workflow-inline-scripts: the regrow guard', () => {
    it('rejects the exact body that failed the v0.28.0 release', () => {
        const result = runGuard({
            'broken.yml': [
                'jobs:',
                '  gate:',
                '    steps:',
                '      - run: |',
                "          node -e '",
                '            const m = require("./manifest.json");',
                "            console.log(`sets ${m.verified.map((v) => v.id).join('+')}`);",
                "          '",
                '',
            ].join('\n'),
        });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /1 broken inline script body/);
        assert.match(result.stderr, /broken\.yml:7/);
        assert.match(result.stderr, /the shell closes the string here/);
    });

    it('accepts a multi-line body that keeps the other quote inside', () => {
        // The shape of the CORRECT cli-cross-platform.yml block: a single-quoted body
        // using only double quotes internally, closed by `')"` rather than a bare `'`.
        // A first draft of the guard flagged this — a check with false positives gets
        // switched off, and then it guards nothing.
        const result = runGuard({
            'ok.yml': [
                'jobs:',
                '  probe:',
                '    steps:',
                '      - run: |',
                '          OUT="$(node -e \'',
                '            const parse = (v) => v.split("-")[0].split(".").map(Number);',
                '            process.stdout.write(parse(process.env.V)[0] >= 1 ? "1" : "0");',
                '          \')"',
                '',
            ].join('\n'),
        });
        assert.equal(result.status, 0, result.output);
        assert.match(result.stdout, /1 workflow\(s\) clean/);
    });

    it('leaves single-line invocations alone even when the quote recurs', () => {
        // `echo "… $(node -p "require('./p.json').version")"` is correct: the second
        // double quote closes the node body, the third belongs to the enclosing echo.
        const result = runGuard({
            'inline.yml': [
                'jobs:',
                '  v:',
                '    steps:',
                '      - run: |',
                '          echo "cli: $(node -p "require(\'./package.json\').version")"',
                '',
            ].join('\n'),
        });
        assert.equal(result.status, 0, result.output);
    });

    it('reports an unterminated body rather than scanning to end of file', () => {
        const result = runGuard({
            'open.yml': [
                'jobs:',
                '  x:',
                '    steps:',
                '      - run: |',
                "          node -e '",
                '            1 + 1;',
                '',
            ].join('\n'),
        });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /no line closing it was found/);
    });

    it("holds for this repo's own workflows", () => {
        const result = spawnSync(process.execPath, [GUARD, '--root', MONOREPO_ROOT], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.output);
    });
});

// The third script that only a real release used to exercise. `release.yml`'s
// `napi-prebuild-linux` ran `node scripts/stage-prebuild.mjs` on an image whose
// Dockerfile says, in those words, "no nodejs/npm baked in". On the v0.31.0 publish
// meson built all 16 targets and the step then died on `node: command not found`
// (exit 127); `publish-napi` needs that artifact, so it was skipped and `@gjsify/napi`
// alone stayed at 0.30.0 while the other 60 packages went out. Same suite, same
// reason: this is where its failure path runs before a release finds it.
describe('check-ci-image-packages: the node-availability guard', () => {
    const dockerfileWith = (packages) =>
        ['FROM fedora:44', 'RUN dnf install -y \\', `    ${packages} \\`, '    && dnf clean all', ''].join('\n');
    const BAKED_DOCKERFILE = dockerfileWith('gjs meson vala');

    // `ciFiles` keys are paths UNDER `.github/`, because question (4)'s corpus is
    // that whole directory and not just its `workflows/` subdirectory.
    function runImageGuard(workflowFiles, dockerfile = BAKED_DOCKERFILE, ciFiles = {}) {
        const root = mkdtempSync(join(tmpdir(), 'gjsify-image-guard-'));
        mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
        mkdirSync(join(root, '.docker'), { recursive: true });
        writeFileSync(join(root, '.docker', 'ci-fedora.Dockerfile'), dockerfile);
        writeFileSync(
            join(root, '.github', 'workflows', 'build-ci-image.yml'),
            [
                'jobs:',
                '  image:',
                '    steps:',
                '      - uses: docker/build-push-action@v6',
                '        with:',
                '          platforms: linux/amd64',
                '',
            ].join('\n'),
        );
        for (const [name, body] of Object.entries(workflowFiles)) {
            writeFileSync(join(root, '.github', 'workflows', name), body);
        }
        for (const [rel, body] of Object.entries(ciFiles)) {
            const path = join(root, '.github', rel);
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, body);
        }
        const result = spawnSync(process.execPath, [IMAGE_GUARD, '--root', root], { encoding: 'utf8' });
        return { ...result, output: `${result.stdout}${result.stderr}` };
    }

    it('rejects the exact step that stranded @gjsify/napi at 0.30.0', () => {
        const result = runImageGuard({
            'release.yml': [
                'jobs:',
                '  napi-prebuild-linux:',
                '    runs-on: ubuntu-latest',
                '    container:',
                '      image: ghcr.io/gjsify/ci-fedora:44',
                '    steps:',
                '      - uses: actions/checkout@v4',
                '      - name: Build the shim + stage prebuild',
                '        run: |',
                '          meson setup build .',
                '          node ../../../scripts/stage-prebuild.mjs .',
                '',
            ].join('\n'),
        });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /release\.yml\/napi-prebuild-linux/);
        assert.match(result.stderr, /which ships no node, and invokes it anyway/);
        assert.match(result.stderr, /release\.yml:11/);
    });

    it('accepts the same job once it provides node', () => {
        const result = runImageGuard({
            'release.yml': [
                'jobs:',
                '  napi-prebuild-linux:',
                '    runs-on: ubuntu-latest',
                '    container:',
                '      image: ghcr.io/gjsify/ci-fedora:44',
                '    steps:',
                '      - uses: actions/setup-node@v6',
                '        with:',
                "          node-version: '26.x'",
                '      - run: |',
                '          node ../../../scripts/stage-prebuild.mjs .',
                '',
            ].join('\n'),
        });
        assert.equal(result.status, 0, result.output);
        assert.match(result.stdout, /provided by actions\/setup-node@v6 step/);
    });

    // The false positive a naive rule produces. `prebuilds.yml` installs nodejs
    // itself, in a FOLDED (`run: >`) block whose package list is on the lines after
    // `dnf install -y` — invisible to a scanner that reads block scalars verbatim or
    // only handles `|`. A check that fails here gets switched off, and then it guards
    // nothing.
    it('accepts a job that installs nodejs itself in a folded run block', () => {
        const result = runImageGuard({
            'prebuilds.yml': [
                'jobs:',
                '  build-prebuilds:',
                '    runs-on: ubuntu-24.04-arm',
                '    container:',
                '      image: fedora:43',
                '    steps:',
                '      - run: >',
                '          dnf install -y --disablerepo=fedora-cisco-openh264',
                '          git tar xz',
                '          nodejs',
                '          meson vala',
                '      - run: node ../../../scripts/stage-prebuild.mjs . --scratch',
                '',
            ].join('\n'),
        });
        assert.equal(result.status, 0, result.output);
        assert.match(result.stdout, /provided by its own nodejs install/);
    });

    // Question (4), both halves. openh264 arrives through a HARD Requires chain
    // from gdk-pixbuf2, out of a separately hosted repo whose outage fails the
    // whole transaction — and `--setopt=install_weak_deps=False` cannot drop it,
    // which is why two of the four sites looked handled and were not (#1057).
    //
    // The second half is the corpus. `emulated-build.sh` was never checked at all
    // because the guard read `.github/workflows/*.yml` and nothing else, so a
    // `dnf install` in a SHELL SCRIPT one directory over was invisible. Both a
    // workflow and a script are asserted here for that reason.
    it('fails any dnf install that leaves the cisco openh264 repo enabled', () => {
        const withoutFlag = {
            'prebuilds.yml': [
                'jobs:',
                '  build-prebuilds:',
                '    runs-on: ubuntu-24.04-arm',
                '    container:',
                '      image: fedora:43',
                '    steps:',
                '      - run: >',
                '          dnf install -y --setopt=install_weak_deps=False',
                '          gdk-pixbuf2-devel nodejs',
                '',
            ].join('\n'),
        };
        const result = runImageGuard(withoutFlag);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /prebuilds\.yml:8 runs `dnf install` without --disablerepo=fedora-cisco-openh264/);

        const withFlag = {
            'prebuilds.yml': withoutFlag['prebuilds.yml'].replace(
                '--setopt=install_weak_deps=False',
                '--setopt=install_weak_deps=False --disablerepo=fedora-cisco-openh264',
            ),
        };
        assert.equal(runImageGuard(withFlag).status, 0, runImageGuard(withFlag).output);
    });

    it('checks shell scripts under .github, not only workflows', () => {
        const script = [
            '#!/bin/sh',
            '# dnf install -y something   <- a comment, not a command',
            'dnf install -y \\',
            '    gtk4-devel',
            '',
        ];
        const result = runImageGuard({}, undefined, { 'prebuild-toolchain/emulated-build.sh': script.join('\n') });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /emulated-build\.sh:3 runs `dnf install` without/);
        // The comment on line 2 must NOT be reported — every workflow here carries
        // prose about `dnf install`, and a guard that flags prose gets switched off.
        assert.doesNotMatch(result.stderr, /emulated-build\.sh:2/);

        // A continuation line satisfies the rule: the flag is part of the same
        // logical command even though it is not on the `dnf install` line.
        const continued = ['dnf install -y \\', '    --disablerepo=fedora-cisco-openh264 \\', '    gtk4-devel', ''];
        const ok = runImageGuard({}, undefined, { 'prebuild-toolchain/emulated-build.sh': continued.join('\n') });
        assert.equal(ok.status, 0, ok.output);
    });

    // Both halves of this were untested, and BOTH broke while the suite stayed
    // green at 38/38 — the regression that added the cases below. A predicate
    // anchored to a command position (line start, or after `| & ; (`) stopped
    // seeing `RUN dnf install -y` in the Dockerfile, so `dockerfileUnguarded`
    // silently went from four lines to zero and the report read as compliant;
    // blanket quote-stripping, added at the same time to kill an `echo`, also
    // deleted a real `bash -c "dnf install …"`. Nothing here noticed either,
    // because nothing asserted on the recognition itself.
    it('recognises a dnf install by its COMMAND, in every shape that is one', () => {
        // The Dockerfile is scanned by a different code path and reported rather
        // than failed ("adding the flag rebuilds the base image"), so it needs its
        // own assertion — an unreported Dockerfile is indistinguishable from a
        // clean one on stderr alone.
        const unguarded = ['FROM fedora:44', 'RUN dnf install -y \\', '    gtk4-devel \\', '    && dnf clean all', ''];
        const reported = runImageGuard({}, unguarded.join('\n'));
        assert.match(reported.output, /ci-fedora\.Dockerfile has 1 `dnf install` line\(s\) \(2\)/);

        // Shapes that ARE commands. Each is a real form used in this tree or by
        // Fedora, and each was invisible to the anchored predicate.
        for (const [label, line] of [
            ['a bare RUN', 'RUN dnf install -y gtk4-devel'],
            ['a single-line YAML run:', '      - run: dnf install -y gtk4-devel'],
            ['a conditional', 'if [ -n "$X" ]; then dnf install -y gtk4-devel; fi'],
            ['a command prefix', 'time dnf install -y gtk4-devel'],
            ['an env assignment', 'DNFOPT=1 dnf install -y gtk4-devel'],
            ['a nested shell', 'bash -c "dnf install -y gtk4-devel"'],
            ['dnf5, the Fedora 41+ binary', 'dnf5 -y install gtk4-devel'],
            ['flags before the subcommand', 'sudo dnf -y install gtk4-devel'],
            ['a second command after &&', 'echo starting && dnf install -y gtk4-devel'],
        ]) {
            const result = runImageGuard({}, undefined, {
                'prebuild-toolchain/emulated-build.sh': `#!/bin/sh\n${line}\n`,
            });
            assert.equal(result.status, 1, `${label} was not recognised as a command: ${line}`);
            assert.match(result.stderr, /emulated-build\.sh:2 runs `dnf install` without/);
        }

        // Shapes that MENTION one. A guard that flags prose gets switched off, so
        // these must stay silent even though the words are all present.
        for (const [label, line] of [
            ['an echo', 'echo "== dnf install"'],
            ['a printf', "printf '%s\\n' 'dnf install -y foo'"],
            ['a backticked mention', 'x=1   # see `dnf install -y foo`'],
            ['a different subcommand', 'dnf -y remove gtk4-devel'],
            ['a bare clean', 'dnf clean all'],
        ]) {
            const result = runImageGuard({}, undefined, {
                'prebuild-toolchain/emulated-build.sh': `#!/bin/sh\n${line}\n`,
            });
            assert.equal(result.status, 0, `${label} was wrongly flagged: ${line}\n${result.output}`);
        }

        // A YAML `name:` names a step; it never runs one.
        const named = runImageGuard({
            'main.yml': [
                'jobs:',
                '  build:',
                '    steps:',
                '      - name: Install deps (dnf install gtk4-devel)',
                '',
            ].join('\n'),
        });
        assert.doesNotMatch(named.stderr, /main\.yml:4 runs `dnf install`/);
    });

    it('does not mistake node-shaped words for an invocation', () => {
        const result = runImageGuard({
            'main.yml': [
                'jobs:',
                '  build:',
                '    runs-on: ubuntu-latest',
                '    container:',
                '      image: ghcr.io/gjsify/ci-fedora:44',
                '    steps:',
                '      - run: |',
                '          rm -rf node_modules',
                '          gjsify build --app node',
                '          gjs -m packages/node-gi/dist/test.mjs',
                '',
            ].join('\n'),
        });
        assert.equal(result.status, 0, result.output);
    });

    // The derivation, not a hardcoded fact about the image: bake nodejs in and the
    // check stops asking for setup-node, with nothing to remember to delete.
    it('stands down when the image itself bakes nodejs', () => {
        const withNode = dockerfileWith('gjs meson nodejs');
        const workflow = {
            'release.yml': [
                'jobs:',
                '  napi-prebuild-linux:',
                '    runs-on: ubuntu-latest',
                '    container:',
                '      image: ghcr.io/gjsify/ci-fedora:44',
                '    steps:',
                '      - run: |',
                '          node ../../../scripts/stage-prebuild.mjs .',
                '',
            ].join('\n'),
        };
        assert.equal(runImageGuard(workflow).status, 1);
        assert.equal(runImageGuard(workflow, withNode).status, 0);
    });

    it("holds for this repo's own workflows", () => {
        const result = spawnSync(process.execPath, [IMAGE_GUARD, '--root', MONOREPO_ROOT], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.output);
    });
});

// The fourth script whose failure path only a release used to exercise. `build:infra`
// must be bundler-free up to the clause that BUILDS the bundler; #1031 lost that while
// fixing a real race, and it stayed green because Node loads the npm rolldown engine
// and a warm cache skips `build:infra` entirely. v0.31.0's `publish-napi` runs on a
// cold GJS tree, hit it, and `@gjsify/napi` did not publish.
describe('check-build-infra-order: the bundler-free prefix', () => {
    const FACADE = 'node scripts/bootstrap-native-facades.mjs';

    function runOrderGuard(buildInfra, packages) {
        const root = mkdtempSync(join(tmpdir(), 'gjsify-infra-order-'));
        writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { 'build:infra': buildInfra } }));
        for (const [name, scripts] of Object.entries(packages)) {
            const dir = join(root, 'packages', 'infra', name.replace('@gjsify/', ''));
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, scripts }));
        }
        const result = spawnSync(process.execPath, [ORDER_GUARD, '--root', root], { encoding: 'utf8' });
        return { ...result, output: `${result.stdout}${result.stderr}` };
    }

    // Verbatim the shape that failed: `build` resolves through `build:gjsify` to
    // `gjsify build --library`, which is a bundler call the facade has not produced yet.
    const FOUR = {
        '@gjsify/semver': {
            build: 'gjsify run build:gjsify && gjsify run build:types',
            'build:gjsify': "gjsify build --library 'src/**/*.ts'",
            'build:types': 'gjsify tsc -p tsconfig.build.json',
        },
        '@gjsify/cli': { build: 'tsc' },
    };

    it('rejects the clause order that failed to publish @gjsify/napi', () => {
        const result = runOrderGuard(
            `gjsify workspace @gjsify/semver build && gjsify workspace @gjsify/cli build && ${FACADE}`,
            FOUR,
        );
        assert.equal(result.status, 1);
        assert.match(result.stderr, /clause 1 runs `@gjsify\/semver build`/);
        assert.match(result.stderr, /gjsify build --library/);
        assert.match(result.stderr, /2 clause\(s\) before bootstrap-native-facades\.mjs/);
    });

    it('accepts declarations before the facade and the full build after it', () => {
        const result = runOrderGuard(
            `gjsify workspace @gjsify/semver build:types && gjsify workspace @gjsify/cli build && ` +
                `${FACADE} && gjsify workspace @gjsify/semver build`,
            FOUR,
        );
        assert.equal(result.status, 0, result.output);
        assert.match(result.stdout, /2 pre-facade clause\(s\) are tsc-only/);
    });

    // Indirection is the whole point: the bundler call is two hops down, and a check
    // that only read the named script would have cleared the shape that broke.
    it('follows `gjsify run` into the script that actually calls the bundler', () => {
        const result = runOrderGuard(`gjsify workspace @gjsify/semver build && ${FACADE}`, {
            '@gjsify/semver': {
                build: 'gjsify run inner',
                inner: 'gjsify run deeper',
                deeper: 'gjsify build --library',
            },
        });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /reaches `gjsify build --library`/);
    });

    // `build:gjsify` is not `build`; `--app build` is not a command. A check that
    // counted substrings would flag both, and a flagged-wrongly check gets disabled.
    it('does not mistake a bundler-shaped word for a bundler call', () => {
        const result = runOrderGuard(`gjsify workspace @gjsify/tsc build && ${FACADE}`, {
            '@gjsify/tsc': { build: 'node scripts/build-bundle.mjs --app build && gjsify tsc -p .' },
        });
        assert.equal(result.status, 0, result.output);
    });

    it('fails loudly when it can resolve nothing rather than passing vacuously', () => {
        const result = runOrderGuard(`echo hello && ${FACADE}`, {});
        assert.equal(result.status, 1);
        assert.match(result.stderr, /silently stopped reading it/);
    });

    it('fails when no clause runs the facade bootstrap at all', () => {
        const result = runOrderGuard('gjsify workspace @gjsify/cli build', { '@gjsify/cli': { build: 'tsc' } });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /no `build:infra` clause runs bootstrap-native-facades\.mjs/);
    });

    it("holds for this repo's own build:infra", () => {
        const result = spawnSync(process.execPath, [ORDER_GUARD, '--root', MONOREPO_ROOT], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.output);
        // A rule that read no files would pass this the same way. The count is
        // the only thing separating "checked and clean" from "checked nothing",
        // and a broken include glob is exactly how the second one happens.
        const read = /type-ordering rule read (\d+) compiled file\(s\)/.exec(result.stdout);
        assert.ok(read, `no type-ordering count in output:\n${result.output}`);
        assert.ok(Number(read[1]) > 0, `the type-ordering rule read 0 files:\n${result.output}`);
    });
});

// The SECOND rule in the same script: a clause may not type-check against
// declarations no earlier clause emitted. #1133 (`unit` importing `runtime`,
// TS2307 on a cold tree) and #1237 (the CLI importing a new `utils` export,
// TS2305 against a stale warm cache) are the same defect in two cache states.
describe('check-build-infra-order: the type-dependency order', () => {
    const FACADE = 'node scripts/bootstrap-native-facades.mjs';

    /** A root whose packages carry a real tsconfig and real sources to compile. */
    function runTypeGuard(buildInfra, packages) {
        const root = mkdtempSync(join(tmpdir(), 'gjsify-infra-types-'));
        writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { 'build:infra': buildInfra } }));
        for (const [name, pkg] of Object.entries(packages)) {
            const dir = join(root, 'packages', 'infra', name.replace('@gjsify/', ''));
            mkdirSync(join(dir, 'src'), { recursive: true });
            writeFileSync(
                join(dir, 'package.json'),
                JSON.stringify({
                    name,
                    scripts: { build: 'gjsify tsc', 'build:types': 'gjsify tsc' },
                    exports: { '.': { types: './lib/types/index.d.ts', default: './lib/esm/index.js' } },
                }),
            );
            writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ include: ['src/**/*.ts'] }));
            writeFileSync(join(dir, 'src', 'index.ts'), pkg.source);
        }
        const result = spawnSync(process.execPath, [ORDER_GUARD, '--root', root], { encoding: 'utf8' });
        return { ...result, output: `${result.stdout}${result.stderr}` };
    }

    const IMPORTER = { source: "import { hold } from '@gjsify/utils';\nexport const x = hold;\n" };
    const LIBRARY = { source: 'export const hold = 1;\n' };

    it('rejects a clause compiling against a package built later', () => {
        const result = runTypeGuard(
            `gjsify workspace @gjsify/cli build && ${FACADE} && gjsify workspace @gjsify/utils build`,
            { '@gjsify/cli': IMPORTER, '@gjsify/utils': LIBRARY },
        );
        assert.equal(result.status, 1, result.output);
        assert.match(result.stderr, /it imports '@gjsify\/utils', but @gjsify\/utils is built at clause 3/);
    });

    it('accepts the same pair once a build:types clause runs first', () => {
        const result = runTypeGuard(
            `gjsify workspace @gjsify/utils build:types && gjsify workspace @gjsify/cli build && ${FACADE} && ` +
                'gjsify workspace @gjsify/utils build',
            { '@gjsify/cli': IMPORTER, '@gjsify/utils': LIBRARY },
        );
        assert.equal(result.status, 0, result.output);
    });

    // The two shapes that made the cheaper rules cry wolf, and the reason this
    // one reads the compiled FILES rather than the manifest.
    it('ignores a specifier that is only text', () => {
        const result = runTypeGuard(`gjsify workspace @gjsify/cli build && ${FACADE}`, {
            '@gjsify/cli': {
                source: [
                    '// see @gjsify/utils for the loop helper',
                    'export const generated = `',
                    "import { hold } from '@gjsify/utils';",
                    '`;',
                    'export const hint = "import \'@gjsify/utils\' to register it";',
                ].join('\n'),
            },
            '@gjsify/utils': LIBRARY,
        });
        assert.equal(result.status, 0, result.output);
    });

    it('honours a @ts-ignore on the import', () => {
        const result = runTypeGuard(`gjsify workspace @gjsify/cli build && ${FACADE}`, {
            '@gjsify/cli': {
                source: "// @ts-ignore — resolved by the bundler, not by tsc here.\nimport '@gjsify/utils';\n",
            },
            '@gjsify/utils': LIBRARY,
        });
        assert.equal(result.status, 0, result.output);
    });
});
