#!/usr/bin/env node
// RELEASE, PER-ABI APKs for one rung of the ADR 0110 gate-2 ladder.
//
// `scripts/run-on-device.mjs` builds a debug, universal APK: right for running the suite, wrong
// for the size and cold-start question, because nobody downloads a universal debug build. This
// script builds the same app as a signed release with `splits.abi` on, and copies the results
// aside under `release-apks/<rung>/` — gradle writes `app-<abi>-release.apk` to one fixed path, so
// a second rung would otherwise overwrite the first.
//
// THE RUNGS (stage 4's ladder; see docs/reports/2026-10-11-node-gi-nativescript-plugin.md):
//   b0  the plugin is not imported at all   — GJSIFY_GI_PLUGIN=0, `@gjsify/node-gi/gi` aliased away
//   b   the plugin is imported, opt-in off  — GJSIFY_GI_OPT_IN=0
//   c   the plugin is imported, opt-in on   — the default, the shipping subject
//
// A0 of stage 4 (the payload not even PACKAGED) is deliberately absent: removing the AAR's
// libraries from the APK needs a packaging exclusion that changes the build in ways the delta
// cannot account for, and stage 4 measured carrying-but-not-loading at noise size anyway.
//
// SIGNING is NativeScript's own gated `signingConfigs.release`, with the Android SDK's debug
// keystore — the APK must be signed to install, and which key signs it cannot change its size or
// its start-up time. MINIFICATION IS NOT ENABLED: this app's `platforms/android/app/build.gradle`
// leaves its R8 hooks commented out, and R8 works on the Java DEX, not on `.so` files or
// typelibs — so it could move the baseline total but not the payload delta these rungs measure.
//
// Usage: node scripts/build-release-splits.mjs <b0|b|c>
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nsBin = join(root, 'node_modules', '.bin', 'nativescript');
const ABIS = ['arm64-v8a', 'x86_64'];

/** Each rung is the same sources and the same gradle invocation — only these defines differ. */
const RUNGS = {
    b0: { GJSIFY_GI_PLUGIN: '0' },
    b: { GJSIFY_GI_OPT_IN: '0' },
    c: {},
};

const rung = process.argv[2];
const say = (text) => console.log(`[release:${rung}] ${text}`);
function die(message) {
    console.error(`[release:${rung ?? '?'}] ${message}`);
    process.exit(1);
}

if (!Object.hasOwn(RUNGS, rung ?? ''))
    die(`usage: node scripts/build-release-splits.mjs <${Object.keys(RUNGS).join('|')}>`);

const keystore = process.env.GJSIFY_KEYSTORE ?? join(process.env.HOME ?? '', '.android', 'debug.keystore');
if (!existsSync(keystore)) die(`no keystore at ${keystore} — set GJSIFY_KEYSTORE, or create the SDK debug one.`);

function run(cmd, args, opts = {}) {
    return spawnSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });
}

// 0. The compiled Gio.Settings fixture schema the bundle carries as base64.
if (run('node', [join(root, 'scripts', 'compile-schemas.mjs')]).status !== 0) die('schema compile failed.');

// 1. Bundle with this rung's defines in scope — ../vite.config.ts reads them from the environment.
//
//    `--release` is not cosmetic and not only about minification: without it Vite emits a DEBUG
//    bundle, whose `@nativescript/core` inspector modules call `__registerDomainDispatcher`, a
//    global only the debug Android runtime injects. Packaged into a release APK it crashes at the
//    end of module evaluation with "__registerDomainDispatcher is not defined" — after the suite
//    has run and logged, which makes it look like a late failure rather than a build mismatch.
//    Measured here on 2026-10-15. It also means the JS in these APKs IS minified.
say(`nativescript prepare android --release (${JSON.stringify(RUNGS[rung])}) …`);
if (
    run(nsBin, ['prepare', 'android', '--release', '--no-hmr', '--disable-npm-install'], {
        env: { ...process.env, ...RUNGS[rung] },
    }).status !== 0
) {
    die('`ns prepare` failed (Vite build error?).');
}

// 2. Replicate copyViteBundleToNative, as run-on-device.mjs does and for the same reason. The
//    DELETE first is this script's own: rungs emit different file sets, and a leftover chunk from
//    the previous rung would be packaged and counted as if this rung had produced it.
const distOut = join(root, '.ns-vite-build', 'android');
const assetsApp = join(root, 'platforms', 'android', 'app', 'src', 'main', 'assets', 'app');
if (!existsSync(distOut)) die(`expected Vite output at ${distOut} — prepare emitted no bundle.`);
mkdirSync(assetsApp, { recursive: true });
for (const f of readdirSync(assetsApp)) {
    if (f.endsWith('.mjs') || f.endsWith('.map')) rmSync(join(assetsApp, f));
}
let copied = 0;
for (const f of readdirSync(distOut)) {
    if (f.endsWith('.mjs') || f.endsWith('.map')) {
        copyFileSync(join(distOut, f), join(assetsApp, f));
        copied++;
    }
}
if (copied === 0) die(`no bundle files in ${distOut} — the Vite build emitted nothing to copy.`);
say(`copied ${copied} bundle file(s) → assets/app`);

// 3. Signed release, split per ABI.
say('gradle assembleRelease -PgjsifyAbiSplits -Prelease …');
const gradle = run(
    './gradlew',
    [
        'assembleRelease',
        '-q',
        '-PgjsifyAbiSplits',
        '-Prelease',
        `-PksPath=${keystore}`,
        `-PksPassword=${process.env.GJSIFY_KEYSTORE_PASSWORD ?? 'android'}`,
        `-Palias=${process.env.GJSIFY_KEYSTORE_ALIAS ?? 'androiddebugkey'}`,
        `-Ppassword=${process.env.GJSIFY_KEY_PASSWORD ?? 'android'}`,
    ],
    { cwd: join(root, 'platforms', 'android') },
);
if (gradle.status !== 0) die('gradle build failed.');

// 4. Copy the splits aside under this rung's name, before the next rung overwrites them.
const outDir = join(root, 'release-apks', rung);
mkdirSync(outDir, { recursive: true });
const built = join(root, 'platforms', 'android', 'app', 'build', 'outputs', 'apk', 'release');
for (const abi of ABIS) {
    const apk = join(built, `app-${abi}-release.apk`);
    if (!existsSync(apk)) die(`no ${abi} split at ${apk} — did -PgjsifyAbiSplits reach app.gradle?`);
    copyFileSync(apk, join(outDir, `app-${abi}-release.apk`));
}
say(`→ ${outDir}`);
