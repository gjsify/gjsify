#!/usr/bin/env node
// Local-only runner for the Adwaita gallery XML probe.
//
// Requires: the NS CLI (node_modules/.bin/nativescript), a booted Android
// emulator/device (adb on PATH), gradle's deps. NOT run in CI — no CI container has
// an Android device, which is the same reason `tests/integration/nativescript` and
// the storybook showcase beside this one are local-only.
//
// The deterministic prepare → copy → gradle → install flow (rather than `ns run`)
// is inherited from `tests/integration/nativescript/scripts/run-on-device.mjs`,
// whose header records why: `ns build` and `ns run --justlaunch` run the bundler in
// NON-watch mode, and the copy of the Vite output into the APK assets lives only in
// the watch-mode IPC handler. A non-watch build therefore leaves `assets/app/` empty
// and the Static Binding Generator finds no JS.
//
// Usage: node scripts/run-on-device.mjs [android]
// Exit 0 = every template inflated and every assertion held.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseLogcat } from './parse-logcat.mjs';

const platform = process.argv[2] ?? 'android';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nsBin = join(root, 'node_modules', '.bin', 'nativescript');
const logFile = join(root, `logcat.${platform}.log`);
const APP_ID = 'org.gjsify.AdwaitaGalleryXml';

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });
const adb = (args, opts = {}) => spawnSync('adb', args, { encoding: 'utf8', ...opts });

if (platform !== 'android') {
    console.error(`[gallery-xml] only the android path is implemented (got "${platform}").`);
    process.exit(2);
}

const connected = (adb(['devices']).stdout ?? '')
    .split('\n')
    .slice(1)
    .some((line) => /\bdevice\b/.test(line));
if (!connected) {
    console.error('[gallery-xml] no adb device/emulator connected. Boot an AVD first, e.g.:');
    console.error('  "$ANDROID_HOME/emulator/emulator" -avd <name> -gpu host -no-snapshot & adb wait-for-device');
    process.exit(1);
}

console.log('[gallery-xml] nativescript prepare android --no-hmr --disable-npm-install …');
if (run(nsBin, ['prepare', platform, '--no-hmr', '--disable-npm-install']).status !== 0) {
    console.error('[gallery-xml] `ns prepare` failed (Vite build error?).');
    process.exit(1);
}

const distOut = join(root, '.ns-vite-build');
const assetsApp = join(root, 'platforms', platform, 'app', 'src', 'main', 'assets', 'app');
if (!existsSync(distOut)) {
    console.error(`[gallery-xml] expected Vite output at ${distOut} — prepare did not emit a bundle.`);
    process.exit(1);
}
mkdirSync(assetsApp, { recursive: true });
let copied = 0;
for (const file of readdirSync(distOut)) {
    if (file.endsWith('.mjs') || file.endsWith('.map')) {
        copyFileSync(join(distOut, file), join(assetsApp, file));
        copied++;
    }
}
console.log(`[gallery-xml] copied ${copied} bundle file(s) → assets/app`);

console.log('[gallery-xml] gradle assembleDebug …');
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
if (run(gradlew, ['assembleDebug', '-q'], { cwd: join(root, 'platforms', platform) }).status !== 0) {
    console.error('[gallery-xml] gradle build failed.');
    process.exit(1);
}
const apk = join(root, 'platforms', platform, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (!existsSync(apk)) {
    console.error(`[gallery-xml] APK not found at ${apk}.`);
    process.exit(1);
}

adb(['logcat', '-c'], { stdio: 'ignore' });
if (adb(['install', '-r', apk], { stdio: 'inherit' }).status !== 0) {
    console.error('[gallery-xml] adb install failed (out of /data storage on the emulator?).');
    process.exit(1);
}
adb(['shell', 'am', 'force-stop', APP_ID], { stdio: 'ignore' });
adb(['shell', 'monkey', '-p', APP_ID, '-c', 'android.intent.category.LAUNCHER', '1'], { stdio: 'ignore' });

const started = Date.now();
let dump = '';
let res = parseLogcat('');
while (Date.now() - started < 120_000) {
    dump = adb(['logcat', '-d', '-v', 'brief'], { maxBuffer: 128 * 1024 * 1024 }).stdout ?? '';
    res = parseLogcat(dump);
    if (res.complete || /Module evaluation promise rejected|Cannot instantiate module/.test(dump)) break;
    spawnSync('sleep', ['2']);
}
writeFileSync(logFile, dump);

console.log(
    `[gallery-xml] parsed: passed=${res.passed} failed=${res.failed} total=${res.total} complete=${res.complete}`,
);
for (const c of res.cases.filter((c) => c.status === 'FAIL')) {
    console.error(`  FAIL ${c.suite} :: ${c.name} -- ${c.message}`);
}
if (!res.begun || !res.complete) {
    console.error(`[gallery-xml] no complete __GJSIFY_NS__ run in logcat — the app crashed at startup. See ${logFile}`);
    process.exit(1);
}
if (res.failed > 0 || res.total === 0) {
    console.error(`[gallery-xml] ${res.failed}/${res.total} assertions FAILED.`);
    process.exit(1);
}
console.log(`[gallery-xml] ✔ all ${res.total} assertions held on ${platform}.`);
process.exit(0);
