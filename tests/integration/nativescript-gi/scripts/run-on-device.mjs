#!/usr/bin/env node
// Local-only on-device runner for the GI suite — ADR 0105 stage 4's measurement.
//
// Requires: the NS CLI (node_modules/.bin/nativescript), `npm install` already run in this
// directory (the `@gjsify/*` deps are `file:` paths into this checkout — see ../.npmrc), an adb
// device with ~200 MB free on /data, and the Android SDK gradle deps. NOT run in CI: it needs a
// device, and the payload it measures is built by a script that needs an Android GI prefix.
//
// WHY THE prepare → copy → gradle FLOW and not `ns build`: the polyfill suite's runner says it at
// length (tests/integration/nativescript/scripts/run-on-device.mjs). In short, non-watch bundling
// never calls `copyViteBundleToNative`, so the APK's `assets/app/` would be empty and the Static
// Binding Generator would find no JS. This duplicates the copy and then drives gradle directly.
//
// THE TWO RUNS. `node scripts/run-on-device.mjs` is the subject: the app opts the real-Gio engine
// in. `GJSIFY_GI_OPT_IN=0 node scripts/run-on-device.mjs` is the control: the same sources, the
// same plugin dependency, the same payload in the APK, and only the build-time define flipped —
// so what the two runs compare is the app's DECISION, not the presence of the plugin.
//
// Pick a device with `ANDROID_SERIAL=<serial>` (adb's own variable; required when more than one is
// attached). `--keep` leaves the app installed; by default it is uninstalled again, because a
// device this runs on is usually not only ours.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseLogcat } from './parse-logcat.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const keep = process.argv.includes('--keep');
const optIn = process.env.GJSIFY_GI_OPT_IN !== '0';
const label = optIn ? 'opt-in' : 'control';
const nsBin = join(root, 'node_modules', '.bin', 'nativescript');
const logFile = join(root, `logcat.${optIn ? 'optin' : 'control'}.log`);
const APP_ID = 'org.gjsify.NsGiTest';
const TIMEOUT_MS = 180_000;

const say = (text) => console.log(`[ns-gi:${label}] ${text}`);

function run(cmd, args, opts = {}) {
    return spawnSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });
}
function adb(args, opts = {}) {
    return spawnSync('adb', args, { encoding: 'utf8', ...opts });
}
function die(message) {
    console.error(`[ns-gi:${label}] ${message}`);
    process.exit(1);
}

if (!existsSync(join(root, 'node_modules', '@gjsify', 'gi-runtime-android'))) {
    die('@gjsify/gi-runtime-android is not installed — run `npm install` in this directory first.');
}
// The AAR is gitignored and built by a script; without it gradle fails late and confusingly.
const aar = join(root, 'node_modules', '@gjsify', 'gi-runtime-android', 'platforms', 'android');
if (!readdirSync(aar, { withFileTypes: true }).some((e) => e.isFile() && e.name.endsWith('.aar'))) {
    die(
        `no .aar in ${aar} — build the payload first:\n` +
            '  node ../../packages/node-gi/gi-runtime-android/scripts/build-gi-runtime-android.mjs --help',
    );
}

const devices = (adb(['devices']).stdout ?? '')
    .split('\n')
    .slice(1)
    .filter((l) => /\bdevice\b/.test(l))
    .map((l) => l.split('\t')[0]);
if (devices.length === 0) die('no adb device/emulator connected.');
if (devices.length > 1 && !process.env.ANDROID_SERIAL) {
    die(`${devices.length} devices attached (${devices.join(', ')}) — set ANDROID_SERIAL to pick one.`);
}
say(`device ${process.env.ANDROID_SERIAL ?? devices[0]}`);

// 1. Bundle. The define is read from the environment by ../vite.config.ts, so the flag has to be
//    in scope for THIS step — the APK built afterwards carries the decision.
say('nativescript prepare android --no-hmr --disable-npm-install …');
if (
    run(nsBin, ['prepare', 'android', '--no-hmr', '--disable-npm-install'], {
        env: { ...process.env, GJSIFY_GI_OPT_IN: optIn ? '1' : '0' },
    }).status !== 0
) {
    die('`ns prepare` failed (Vite build error?).');
}

// 2. Replicate copyViteBundleToNative. The bundle lands in a PER-PLATFORM subdirectory
//    (`.ns-vite-build/android/`), so copying the top level copies nothing — and nothing is not an
//    error the gradle build reports: it packages the assets/app left over from the previous run and
//    the suite silently measures stale JS. Hence the explicit `copied === 0` death.
const distOut = join(root, '.ns-vite-build', 'android');
const assetsApp = join(root, 'platforms', 'android', 'app', 'src', 'main', 'assets', 'app');
if (!existsSync(distOut)) die(`expected Vite output at ${distOut} — prepare emitted no bundle.`);
mkdirSync(assetsApp, { recursive: true });
let copied = 0;
for (const f of readdirSync(distOut)) {
    // NOT `package.json`: the NS CLI writes the runtime one into `assets/app` itself.
    if (f.endsWith('.mjs') || f.endsWith('.map')) {
        copyFileSync(join(distOut, f), join(assetsApp, f));
        copied++;
    }
}
if (copied === 0) die(`no bundle files in ${distOut} — the Vite build emitted nothing to copy.`);
say(`copied ${copied} bundle file(s) → assets/app`);

// 3. Show that the plugin was discovered as a plugin, not merely installed. The NS CLI writes one
//    entry per dependency whose manifest carries a `nativescript` key; if ours is missing from
//    this file, gradle never sees the AAR and the opt-in fails on the device with a dlopen error.
const depsFile = join(root, 'platforms', 'android', 'dependencies.json');
if (existsSync(depsFile)) {
    const listed = JSON.parse(readFileSync(depsFile, 'utf8'));
    const plugin = listed.find((d) => d.name === '@gjsify/gi-runtime-android');
    say(plugin ? `dependencies.json lists the plugin at ${plugin.directory}` : 'dependencies.json does NOT list it');
    if (!plugin) die('the NS CLI did not recognise @gjsify/gi-runtime-android as a plugin.');
}

// 4. Build the APK with gradle directly (ns would re-prepare and clear the assets again).
say('gradle assembleDebug …');
if (run('./gradlew', ['assembleDebug', '-q'], { cwd: join(root, 'platforms', 'android') }).status !== 0) {
    die('gradle build failed.');
}
const apk = join(root, 'platforms', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (!existsSync(apk)) die(`APK not found at ${apk}.`);

// 5. Install, launch, capture.
adb(['logcat', '-c'], { stdio: 'ignore' });
if (adb(['install', '-r', apk], { stdio: 'inherit' }).status !== 0) {
    die('adb install failed (out of space on /data?).');
}
adb(['shell', 'am', 'force-stop', APP_ID], { stdio: 'ignore' });
adb(['shell', 'monkey', '-p', APP_ID, '-c', 'android.intent.category.LAUNCHER', '1'], { stdio: 'ignore' });

const started = Date.now();
let dump = '';
let res = parseLogcat('');
while (Date.now() - started < TIMEOUT_MS) {
    dump = adb(['logcat', '-d', '-v', 'brief'], { maxBuffer: 64 * 1024 * 1024 }).stdout ?? '';
    res = parseLogcat(dump);
    if (res.complete || /Module evaluation promise rejected|Cannot instantiate module/.test(dump)) break;
    spawnSync('sleep', ['2']);
}
writeFileSync(logFile, dump);
if (!keep) adb(['uninstall', APP_ID], { stdio: 'ignore' });

for (const i of res.infos) console.log(`  INFO ${i.suite} :: ${i.text}`);
for (const c of res.cases.filter((c) => c.status === 'FAIL')) {
    console.error(`  FAIL ${c.suite} :: ${c.name} -- ${c.message}`);
}
say(`passed=${res.passed} failed=${res.failed} total=${res.total} complete=${res.complete}`);
say(`logcat → ${logFile}`);

if (!res.begun || !res.complete) {
    die(`no complete __GJSIFY_NS__ run in logcat — the app crashed at startup (module eval?). See ${logFile}`);
}
if (res.failed > 0 || res.total === 0) die(`${res.failed}/${res.total} on-device cases FAILED.`);
say(`✔ all ${res.total} cases passed on Android V8.`);
process.exit(0);
