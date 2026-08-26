// E2E test for `gjsify ship --target flatpak` — ADR 0024 § 8, stage 6.
//
// The suite exists for the sentence the ADR wrote about this whole command:
// "a `ship` that asserted on rendered YAML would be this repo's
// green-CI-that-checked-nothing class on a new surface." A Flatpak makes that
// harder than deb and rpm did, because the artifact is written by
// `flatpak-builder` and read back by `flatpak`, and neither is on this project's
// CI image. So the assertions are TIERED, and the two cheap tiers are not
// decoration — each one can fail on a real defect:
//
//   1. STRUCTURAL (always). The stage carries what a Flatpak needs and nothing
//      that only a Flatpak needs: the licence overlay under `share/licenses/`,
//      `settings.appId` and `settings.flatpak` in the closure, and the format
//      OUT of the default target set. Plus the host gate: with the tools hidden,
//      the command refuses and says which one is missing.
//
//   2. SEMANTIC (always). The module's `build-commands` are run by the real
//      `/bin/sh` against a temp prefix, over a build directory staged the way
//      flatpak-builder stages `dir` sources. What lands must be the staged
//      payload plus the overlay, path for path and mode for mode. Two NEGATIVE
//      controls run beside it, because a comparison that cannot fail proves
//      nothing: dropping `skip` must make the stage's own sidecar appear in
//      `/app`, and `cp -a stage /app/` (no `/.`) must lose the launcher.
//
//   3. REAL (only where `flatpak-builder`, `flatpak` and the GNOME runtime are
//      installed — a workstation, not this project's Fedora CI image, and the
//      skip is PRINTED). Build the app, export a single-file bundle, import it
//      into a FRESH ostree repo and list it with `ostree`. That is the
//      independent reader ADR 0024 § A3 demands of a host-bound format: ostree
//      parses a static delta this tree never wrote. Tier 3 also compares the
//      manifest the COMMAND wrote against the one tier 2 rendered, which is
//      what keeps tier 2's simulation honest about the real thing.
//
// Measured while writing this, so nobody re-runs it: `flatpak-builder
// --show-manifest` is NOT a validator and is deliberately unused here. It
// accepted an unknown source property (`skipp`) and `buildsystem: "nonsense"`
// at exit 0 — it reads and normalises JSON, which is all it proves.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    chmodSync,
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { hasCommand } from '../helpers.mjs';
import { runCliSync } from '../mock-registry.mjs';
// Same fixture as `tests/e2e/ship` and `tests/e2e/ship-from-stage`: a second
// scaffold would be a second definition of "a shippable project", and the
// drifted copy is the one that keeps passing while proving something else.
import {
    APP_ID,
    CLI_ENTRY,
    MONOREPO_ROOT,
    listFiles,
    listPayload,
    scaffold,
    STAGE_MANIFEST_FILE,
} from '../ship/fixture.mjs';

// IMPORTED, never restated. The renderer is the contract; a test carrying its
// own copy of the manifest shape is a test that only agrees with itself.
const { renderShipFlatpakManifest } = await import(
    pathToFileURL(join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'utils', 'ship', 'flatpak.js')).href
);

/** The runtime the fixture's defaults ask for — read off the rendered manifest, not hardcoded. */
function runtimeRef(manifest) {
    return `${manifest.runtime}/${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}/${manifest['runtime-version']}`;
}

/** True when a real build is possible here: both tools plus the runtime AND the SDK. */
function canBuildForReal(manifest) {
    if (!hasCommand('flatpak-builder') || !hasCommand('flatpak') || !hasCommand('ostree')) return false;
    for (const id of [manifest.runtime, manifest.sdk]) {
        try {
            execFileSync('flatpak', ['info', `${id}//${manifest['runtime-version']}`], { stdio: 'ignore' });
        } catch {
            return false;
        }
    }
    return true;
}

describe('CLI ship --target flatpak E2E', { timeout: 20 * 60 * 1000 }, () => {
    let tmpDir;
    let projectDir;
    let manifest;
    let stageManifest;
    let module;
    let overlayDir;

    before(() => {
        if (!existsSync(CLI_ENTRY)) throw new Error(`CLI entry not built: ${CLI_ENTRY}`);
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ship-flatpak-'));
        projectDir = scaffold(join(tmpDir, 'app'));
        // `--stage` on purpose: the assembling phase needs neither tool, which
        // is the property that lets a Flatpak be staged on a host that cannot
        // build one (ADR 0024 § A1).
        runCliSync(CLI_ENTRY, ['ship', '--skip-build', '--stage', '--target', 'deb,rpm,flatpak'], { cwd: projectDir });
        stageManifest = JSON.parse(readFileSync(join(projectDir, 'ship', 'stage', STAGE_MANIFEST_FILE), 'utf-8'));

        // `--stage` writes no overlay — the packing phase does, out of the
        // closure, which is the whole reason the closure carries rendered TEXT
        // rather than a build-host path. Materialising it here is what
        // `overlayFiles()` + `writeStage` do one job later, and doing it from
        // the manifest is what makes tier 2 a test of the closure too.
        overlayDir = join(projectDir, 'ship', 'overlay', 'flatpak');
        mkdirSync(overlayDir, { recursive: true });
        for (const file of stageManifest.overlay.flatpak) {
            const to = join(overlayDir, file.path);
            mkdirSync(dirname(to), { recursive: true });
            writeFileSync(to, file.text);
            chmodSync(to, file.mode);
        }

        manifest = renderShipFlatpakManifest({
            settings: stageManifest.settings,
            stageDir: join(projectDir, 'ship', 'stage'),
            overlayDir,
            stageManifestFile: STAGE_MANIFEST_FILE,
        });
        module = manifest.modules[0];
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(tmpDir, { recursive: true, force: true });
    });

    // ── tier 1: structural ────────────────────────────────────────────────

    it('is not in the default target set', () => {
        // A bare `gjsify ship` must not start demanding `flatpak-builder` of
        // every project that ever packaged a `.deb`. `release-cut.yml` packs
        // `@gjsify/cli` itself on a bare ubuntu runner with neither tool.
        const bare = scaffold(join(tmpDir, 'default-targets'));
        runCliSync(CLI_ENTRY, ['ship', '--skip-build', '--stage'], { cwd: bare });
        const written = JSON.parse(readFileSync(join(bare, 'ship', 'stage', STAGE_MANIFEST_FILE), 'utf-8'));
        assert.deepEqual(written.formats, ['deb', 'rpm']);
    });

    it('carries the app id and the flatpak settings across the host boundary', () => {
        // Both were on `PackSettings`'s "NOT here" list until this target
        // needed them, and the omission fails at exit 0 in opposite ways: no
        // `appId` and there is no manifest `id` to write; no `flatpak` and the
        // packing host builds against whatever runtime IT defaults to.
        assert.deepEqual(stageManifest.formats, ['deb', 'flatpak', 'rpm']);
        assert.equal(stageManifest.settings.appId, APP_ID);
        assert.equal(stageManifest.settings.flatpak.runtime, 'org.gnome.Platform');
        assert.equal(stageManifest.settings.flatpak.sdk, 'org.gnome.Sdk');
        assert.equal(stageManifest.settings.flatpak.branch, 'stable');
        // The fixture is `kind: 'app'`, so the GUI finish-args are the default.
        assert.ok(stageManifest.settings.flatpak.finishArgs.includes('--socket=wayland'));
        // Nothing in the closure may name the machine that assembled it.
        assert.ok(!JSON.stringify(stageManifest).includes(projectDir));
    });

    it('renders a licence overlay for the flatpak, in the rpm location', () => {
        const overlay = stageManifest.overlay.flatpak;
        assert.equal(overlay.length, 1);
        assert.equal(overlay[0].path, 'share/licenses/ship-demo/LICENSE');
        // `plain`, not Debian's machine-readable copyright: no policy asks for
        // one here, and the same file sits at the same place in the `.rpm`.
        assert.match(overlay[0].text, /^MIT License/);
    });

    it('refuses to pack when the tooling is absent, and names the tool', () => {
        // The gate that makes the two-phase split usable: it fires BEFORE the
        // project's build script, so an absent `flatpak-builder` does not cost
        // a full build to discover.
        const emptyPath = join(tmpDir, 'no-tools');
        mkdirSync(emptyPath, { recursive: true });
        let stderr = '';
        let status = 0;
        try {
            // `runCliSync` execs `process.execPath` by absolute path, so an
            // empty PATH still starts node — it only starves the CLI's probe.
            runCliSync(CLI_ENTRY, ['ship', '--from-stage', 'ship/stage', '--target', 'flatpak'], {
                cwd: projectDir,
                env: { ...process.env, PATH: emptyPath },
            });
        } catch (error) {
            status = error.status ?? 1;
            stderr = `${error.stderr ?? ''}${error.stdout ?? ''}`;
        }
        assert.notEqual(status, 0, 'packing a flatpak with no flatpak-builder must fail');
        assert.match(stderr, /flatpak-builder/);
        // The way across for a host that cannot have the tools at all.
        assert.match(stderr, /--stage/);
        assert.equal(existsSync(join(projectDir, 'ship', 'out')), false, 'a refused pack writes no artifact');
    });

    // ── tier 2: the staging path, executed ────────────────────────────────

    it('renders `buildsystem: simple` and no build system inside the sandbox', () => {
        // The deletion stage 6 is for: `buildsystem: meson` is what made every
        // app carry meson glue whose only job was to call `gjsify build` and
        // copy the result into a prefix.
        assert.equal(module.buildsystem, 'simple');
        assert.deepEqual(module['build-commands'], ['mkdir -p /app', 'cp -a stage/. /app/', 'cp -a overlay/. /app/']);
        assert.equal(manifest.command, 'ship-demo');
        assert.equal(manifest.id, APP_ID);
    });

    it('installs exactly the staged payload plus the overlay', () => {
        const installed = simulate(module);
        assert.deepEqual(installed, expectedInstall());
    });

    it('goes RED when `skip` is dropped — the sidecar reaches /app', () => {
        // The negative control for the assertion above. `cp -a` copies
        // dotfiles, so without `skip` the stage's own closure ships as payload,
        // and no dpkg, rpm or flatpak would ever mention it.
        const broken = structuredClone(module);
        delete broken.sources[0].skip;
        const installed = simulate(broken);
        assert.notDeepEqual(installed, expectedInstall());
        assert.ok(
            installed.some((entry) => entry.path === STAGE_MANIFEST_FILE),
            'without `skip` the stage manifest must appear in the prefix — otherwise this control proves nothing',
        );
    });

    it('goes RED when the trailing `/.` is dropped — the payload lands one level deep', () => {
        const broken = structuredClone(module);
        broken['build-commands'] = broken['build-commands'].map((cmd) => cmd.replace('stage/. /app/', 'stage /app/'));
        const installed = simulate(broken);
        assert.notDeepEqual(installed, expectedInstall());
        assert.ok(
            !installed.some((entry) => entry.path === 'bin/ship-demo'),
            'the launcher must be missing — otherwise this control proves nothing',
        );
        assert.ok(installed.some((entry) => entry.path === 'stage/bin/ship-demo'));
    });

    // ── tier 3: the real thing ────────────────────────────────────────────

    it('builds, exports and reads back a real bundle', () => {
        if (!canBuildForReal(manifest)) {
            // PRINTED, never silent — `tests/e2e/flatpak-sdk-extension` set that
            // rule, and this is the tier the Fedora CI image cannot run: it has
            // no flatpak tooling at all.
            console.log(
                `  skipping tier 3: needs flatpak-builder, flatpak, ostree and ${runtimeRef(manifest)} + its Sdk`,
            );
            return;
        }
        const real = scaffold(join(tmpDir, 'real'));
        runCliSync(CLI_ENTRY, ['ship', '--skip-build', '--target', 'flatpak'], { cwd: real, timeout: 15 * 60 * 1000 });

        const archLabel = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
        const artifact = join(real, 'ship', 'out', `${APP_ID}-1.2.3-1.${archLabel}.flatpak`);
        assert.ok(existsSync(artifact), `expected ${artifact}`);
        assert.ok(statSync(artifact).size > 0);

        // What the COMMAND wrote, against what tier 2 simulated. This is the
        // link that keeps tier 2 from drifting into a test of its own fiction.
        const written = JSON.parse(readFileSync(join(real, 'ship', 'flatpak', `${APP_ID}.json`), 'utf-8'));
        assert.deepEqual(written.modules[0]['build-commands'], module['build-commands']);
        assert.equal(written.id, APP_ID);
        assert.equal(written.command, 'ship-demo');

        // The independent reader: a FRESH repo, so nothing of the build's own
        // state can answer for the artifact.
        const repo = join(tmpDir, 'read-back');
        execFileSync('ostree', [`--repo=${repo}`, 'init', '--mode=archive-z2'], { stdio: 'pipe' });
        execFileSync('flatpak', ['build-import-bundle', repo, artifact], { stdio: 'pipe' });
        const ref = `app/${APP_ID}/${archLabel}/stable`;
        const refs = execFileSync('ostree', [`--repo=${repo}`, 'refs'], { encoding: 'utf-8' });
        assert.match(refs, new RegExp(ref.replace(/\./g, '\\.')));

        const listed = new Map();
        const out = execFileSync('ostree', [`--repo=${repo}`, 'ls', '-R', ref, '/files'], { encoding: 'utf-8' });
        for (const line of out.split('\n')) {
            const m = /^([-l])(\d{5})\s+\d+\s+\d+\s+(\d+)\s+\/files\/(.+)$/.exec(line);
            if (m) listed.set(m[4], Number.parseInt(m[2], 8));
        }

        for (const entry of expectedInstall()) {
            assert.equal(listed.get(entry.path), entry.mode, `${entry.path} mode in the bundle`);
        }
        assert.equal(listed.has(STAGE_MANIFEST_FILE), false, 'the stage closure must not ship inside the app');
        // flatpak-builder's OWN addition, named here so nobody removes it as a
        // leak: it installs the dereferenced manifest at /app/manifest.json.
        assert.ok(listed.has('manifest.json'));
    });

    // ── helpers ───────────────────────────────────────────────────────────

    /** Every payload file the module must install: the stage, minus its closure, plus the overlay. */
    function expectedInstall() {
        const modes = new Map(stageManifest.staged.map((file) => [file.path, file.mode]));
        const entries = listPayload(join(projectDir, 'ship', 'stage')).map((path) => ({ path, mode: modes.get(path) }));
        for (const file of stageManifest.overlay.flatpak) entries.push({ path: file.path, mode: file.mode });
        // An empty expectation makes every loop over it vacuous, and tier 3's
        // per-file mode comparison is a loop over exactly this.
        assert.ok(entries.length >= 8, `the fixture stages ${entries.length} file(s) — too few to prove anything`);
        return entries.sort((a, b) => (a.path < b.path ? -1 : 1));
    }

    /**
     * Run one module's `build-commands` the way flatpak-builder would, against a
     * temp prefix, and report what landed.
     *
     * The `dir`-source staging is reimplemented rather than mocked, and tier 3
     * is what says the reimplementation is faithful — it compares the same
     * expectation against a listing `ostree` produced.
     */
    function simulate(mod) {
        const root = mkdtempSync(join(tmpDir, 'sim-'));
        const buildDir = join(root, 'build');
        const prefix = join(root, 'appdir');
        mkdirSync(buildDir, { recursive: true });
        for (const source of mod.sources) {
            assert.equal(source.type, 'dir', 'only `dir` sources are simulated here');
            const skip = new Set(source.skip ?? []);
            const dest = join(buildDir, source.dest);
            mkdirSync(dest, { recursive: true });
            for (const rel of listFiles(source.path)) {
                if (skip.has(rel)) continue;
                const to = join(dest, rel);
                mkdirSync(dirname(to), { recursive: true });
                cpSync(join(source.path, rel), to, { preserveTimestamps: true });
            }
        }
        for (const command of mod['build-commands']) {
            // `/app` is the only absolute path the commands name, and the
            // prefix deliberately does not contain that substring.
            execFileSync('sh', ['-e', '-c', command.replaceAll('/app', prefix)], { cwd: buildDir, stdio: 'pipe' });
        }
        return listFiles(prefix)
            .map((path) => ({ path, mode: statSync(join(prefix, path)).mode & 0o777 }))
            .sort((a, b) => (a.path < b.path ? -1 : 1));
    }
});
