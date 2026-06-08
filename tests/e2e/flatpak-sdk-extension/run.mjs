#!/usr/bin/env node
// e2e: org.freedesktop.Sdk.Extension.gjsify
//
// Two tiers:
//   1. STRUCTURAL (always) — the committed manifest is a well-formed
//      build-extension whose every file source exists on disk.
//   2. FUNCTIONAL (only when `flatpak-builder` + `org.freedesktop.Sdk//24.08`
//      are available, e.g. a dev machine) — actually build the extension and
//      prove the resulting payload runs: `gjsify --version` is the workspace
//      version, and `gjsify build` bundles a trivial app using the native
//      Rolldown bridge loaded from the extension's own typelib.
//
// CI containers without flatpak tooling run tier 1 only and LOG the skip — no
// silent pass.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const FLATPAK_DIR = join(ROOT, 'flatpak');
const MANIFEST = join(FLATPAK_DIR, 'org.freedesktop.Sdk.Extension.gjsify.json');
const ID = 'org.freedesktop.Sdk.Extension.gjsify';
const PREFIX = '/usr/lib/sdk/gjsify';

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => {
    console.error(`  ✗ ${m}`);
    failures++;
};
const assert = (cond, m) => (cond ? ok(m) : fail(m));

function has(cmd) {
    try {
        execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

// ── Tier 1: structural ──────────────────────────────────────────────────────
console.log('Tier 1 — manifest structure');
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
assert(manifest.id === ID, `id is ${ID}`);
assert(manifest['build-extension'] === true, 'build-extension: true');
assert(manifest['build-options']?.prefix === PREFIX, `prefix is ${PREFIX}`);
assert(manifest.runtime === 'org.freedesktop.Sdk', 'runtime org.freedesktop.Sdk');
assert(manifest.sdk === 'org.freedesktop.Sdk', 'sdk org.freedesktop.Sdk');

const sources = manifest.modules?.[0]?.sources ?? [];
const fileSources = sources.filter((s) => s.type === 'file' || s.type === 'dir');
for (const s of fileSources) {
    assert(existsSync(resolve(FLATPAK_DIR, s.path)), `${s.type} source exists: ${s.path}`);
}
// Both prebuild arches must be present as only-arches sources (x86_64 + aarch64).
for (const arch of ['x86_64', 'aarch64']) {
    const tagged = sources.filter((s) => Array.isArray(s['only-arches']) && s['only-arches'].includes(arch));
    assert(tagged.length > 0, `has only-arches sources for ${arch}`);
}
const scriptNames = sources.filter((s) => s.type === 'script').map((s) => s['dest-filename']);
assert(scriptNames.includes('gjsify'), 'gjsify wrapper script source present');
assert(scriptNames.includes('enable.sh'), 'enable.sh script source present');
assert(existsSync(join(FLATPAK_DIR, `${ID}.metainfo.xml`)), 'metainfo.xml present');

// ── Tier 2: functional (conditional) ────────────────────────────────────────
const canBuild = has('flatpak-builder');
let sdkInstalled = false;
if (canBuild) {
    try {
        execFileSync('flatpak', ['info', 'org.freedesktop.Sdk//24.08'], { stdio: 'ignore' });
        sdkInstalled = true;
    } catch {
        sdkInstalled = false;
    }
}

if (!canBuild || !sdkInstalled) {
    console.log(
        `\nTier 2 — SKIPPED (flatpak-builder=${canBuild}, org.freedesktop.Sdk//24.08=${sdkInstalled}). ` +
            `Structural validation only on this host.`,
    );
} else {
    console.log('\nTier 2 — build + run the extension payload');
    const work = mkdtempSync(join(tmpdir(), 'gjsify-sdk-ext-'));
    const buildDir = join(work, 'build');
    // State dir must share a filesystem with the build dir, so keep both inside
    // the temp work dir (a /tmp tmpfs differs from the repo's filesystem).
    try {
        execFileSync(
            'flatpak-builder',
            ['--force-clean', '--disable-rofiles-fuse', `--state-dir=${join(work, 'state')}`, buildDir, MANIFEST],
            { cwd: FLATPAK_DIR, stdio: 'ignore' },
        );
        const files = join(buildDir, 'files');
        const bundle = join(files, 'lib/gjsify/dist/cli.gjs.mjs');
        for (const rel of [
            'bin/gjsify',
            'bin/gjsify-tsc',
            'enable.sh',
            'lib/gjsify/dist/cli.gjs.mjs',
            'lib/gjsify/package.json',
            'lib/gjsify/shims/console-gjs.js',
            'lib/gjsify/shims/unicorn-magic.js',
            'lib/gjsify/node_modules/@gjsify/rolldown-native/lib/esm/index.js',
            'lib/gjsify/node_modules/@gjsify/tsc/dist/tsc.gjs.mjs',
            'lib/gjsify/node_modules/@gjsify/tsc/lib/lib.esnext.d.ts',
            'lib/girepository-1.0/GjsifyRolldown-1.0.typelib',
            'lib/girepository-1.0/GjsifyLightningcss-1.0.typelib',
        ]) {
            assert(existsSync(join(files, rel)), `built tree has ${rel}`);
        }

        const giEnv = {
            ...process.env,
            GI_TYPELIB_PATH: join(files, 'lib/girepository-1.0'),
            LD_LIBRARY_PATH: join(files, 'lib'),
        };
        const wsVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

        if (has('gjs')) {
            const reported = execFileSync('gjs', ['-m', bundle, '--version'], { env: giEnv })
                .toString()
                .trim();
            assert(reported === wsVersion, `gjsify --version is ${wsVersion} (got "${reported}")`);

            // A realistic consumer dir: gjsify build walks up for a package.json.
            const app = join(work, 'app');
            execFileSync('mkdir', ['-p', app]);
            writeFileSync(join(app, 'package.json'), '{"name":"e2e-app","version":"0.0.0","type":"module"}\n');
            const entry = join(app, 'entry.ts');
            const out = join(app, 'out.js');
            writeFileSync(entry, 'console.log("gjsify sdk extension e2e");\n');
            execFileSync('gjs', ['-m', bundle, 'build', entry, '--app', 'gjs', '--outfile', out, '--globals', 'none'], {
                env: giEnv,
                cwd: app,
                stdio: 'ignore',
            });
            assert(existsSync(out) && readFileSync(out, 'utf8').length > 0, 'gjsify build produced a bundle');

            // `gjsify tsc` must resolve @gjsify/tsc from the extension's own
            // node_modules (the bundle-location anchor) — the consumer `app`
            // dir has no @gjsify/tsc — and the bundled tsc must find its libs.
            const tscVersion = execFileSync('gjs', ['-m', bundle, 'tsc', '--version'], { env: giEnv, cwd: app })
                .toString()
                .trim();
            assert(/Version \d+\.\d+\.\d+/.test(tscVersion), `gjsify tsc resolves + runs (got "${tscVersion}")`);
        } else {
            console.log('  (gjs not on PATH — payload-run sub-steps skipped)');
        }
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

console.log('');
if (failures > 0) {
    console.error(`FAILED — ${failures} assertion(s)`);
    process.exit(1);
}
console.log('flatpak-sdk-extension e2e: all good');
