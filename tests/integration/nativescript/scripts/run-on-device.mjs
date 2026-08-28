#!/usr/bin/env node
// Local-only NativeScript on-device smoke runner.
//
// Requires: the NS CLI (node_modules/.bin/nativescript), a booted Android
// emulator/device (adb on PATH, enough free /data for a ~100 MB APK), gradle's
// deps (downloaded on first build). NOT run in CI — see README.md.
//
// Why this deterministic prepare → copy → gradle → install flow instead of
// `ns run` / `ns build`:
//   * `ns build` and `ns run --justlaunch` run the bundler in NON-watch mode
//     (`compileWithoutWatch`), which NEVER calls `copyViteBundleToNative` — that
//     copy lives only in the watch-mode IPC handler
//     (nativescript/lib/services/bundler/bundler-compiler-service.js). So a
//     non-watch Vite build leaves the bundle in `.ns-vite-build/` and the APK's
//     `assets/app/` empty → the Static Binding Generator finds no JS and gradle
//     fails. (NS CLI 9.0.6 + @nativescript/vite 2.0.3 bug.)
//   * Watch mode DOES copy, but keeps a file watcher alive and is flaky across
//     repeated runs.
// So we `ns prepare` (which emits the Vite bundle to `.ns-vite-build/`), copy it
// into the APK assets ourselves (replicating copyViteBundleToNative), build the
// APK with gradle directly, then install + launch + read the markers.
import { spawnSync } from 'node:child_process';
import { writeFileSync, readdirSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseLogcat } from './parse-logcat.mjs';

const platform = process.argv[2] ?? 'android';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nsBin = join(root, 'node_modules', '.bin', 'nativescript');
const logFile = join(root, `logcat.${platform}.log`);
const APP_ID = 'org.gjsify.NsTest';

function run(cmd, args, opts = {}) {
    return spawnSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });
}
function adb(args, opts = {}) {
    return spawnSync('adb', args, { encoding: 'utf8', ...opts });
}

if (platform !== 'android') {
    console.error(`[ns-smoke] only the android path is implemented (got "${platform}"). iOS capture is a follow-up.`);
    process.exit(2);
}

const connected = (adb(['devices']).stdout ?? '')
    .split('\n')
    .slice(1)
    .some((l) => /\bdevice\b/.test(l));
if (!connected) {
    console.error('[ns-smoke] no adb device/emulator connected. Boot an AVD first, e.g.:');
    console.error('  "$ANDROID_HOME/emulator/emulator" -avd <name> -gpu host -no-snapshot & adb wait-for-device');
    process.exit(1);
}

// 1. Bundle via the @gjsify/nativescript-vite composer → .ns-vite-build/
console.log('[ns-smoke] nativescript prepare android --no-hmr …');
if (run(nsBin, ['prepare', platform, '--no-hmr']).status !== 0) {
    console.error('[ns-smoke] `ns prepare` failed (Vite build error?).');
    process.exit(1);
}

// 2. Copy the Vite output into the APK assets (NS CLI does this only in watch mode).
const distOut = join(root, '.ns-vite-build');
const assetsApp = join(root, 'platforms', platform, 'app', 'src', 'main', 'assets', 'app');
if (!existsSync(distOut)) {
    console.error(`[ns-smoke] expected Vite output at ${distOut} — prepare did not emit a bundle.`);
    process.exit(1);
}
mkdirSync(assetsApp, { recursive: true });
let copied = 0;
for (const f of readdirSync(distOut)) {
    if (f.endsWith('.mjs') || f.endsWith('.map')) {
        copyFileSync(join(distOut, f), join(assetsApp, f));
        copied++;
    }
}
console.log(`[ns-smoke] copied ${copied} bundle file(s) → assets/app`);

// 3. Build the APK directly with gradle (skips ns's re-prepare, which would re-clear assets).
console.log('[ns-smoke] gradle assembleDebug …');
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
if (run(gradlew, ['assembleDebug', '-q'], { cwd: join(root, 'platforms', platform) }).status !== 0) {
    console.error('[ns-smoke] gradle build failed.');
    process.exit(1);
}
const apk = join(root, 'platforms', platform, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (!existsSync(apk)) {
    console.error(`[ns-smoke] APK not found at ${apk}.`);
    process.exit(1);
}

// 4. Install, (re)launch, capture.
adb(['logcat', '-c'], { stdio: 'ignore' });
const install = adb(['install', '-r', apk], { stdio: 'inherit' });
if (install.status !== 0) {
    console.error('[ns-smoke] adb install failed (out of /data storage on the emulator?).');
    process.exit(1);
}
adb(['shell', 'am', 'force-stop', APP_ID], { stdio: 'ignore' });
adb(['shell', 'monkey', '-p', APP_ID, '-c', 'android.intent.category.LAUNCHER', '1'], { stdio: 'ignore' });

// 5. Poll logcat for a complete marker run (or a hard crash), then assert.
const started = Date.now();
let dump = '';
let res = parseLogcat('');
while (Date.now() - started < 60_000) {
    dump = adb(['logcat', '-d', '-v', 'brief'], { maxBuffer: 64 * 1024 * 1024 }).stdout ?? '';
    res = parseLogcat(dump);
    if (res.complete || /Module evaluation promise rejected|Cannot instantiate module/.test(dump)) break;
    spawnSync('sleep', ['2']);
}
writeFileSync(logFile, dump);

console.log(`[ns-smoke] parsed: passed=${res.passed} failed=${res.failed} total=${res.total} complete=${res.complete}`);
for (const c of res.cases.filter((c) => c.status === 'FAIL')) {
    console.error(`  FAIL ${c.suite} :: ${c.name} -- ${c.message}`);
}
if (!res.begun || !res.complete) {
    console.error(
        `[ns-smoke] no complete __GJSIFY_NS__ run found in logcat — the app crashed at startup (module eval?). See ${logFile}`,
    );
    process.exit(1);
}
if (res.failed > 0 || res.total === 0) {
    console.error(`[ns-smoke] ${res.failed}/${res.total} on-device cases FAILED.`);
    process.exit(1);
}
console.log(`[ns-smoke] ✔ all ${res.total} cases passed on ${platform} V8.`);
process.exit(0);
