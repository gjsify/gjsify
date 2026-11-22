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

// Launch (optionally with the cold-start phase extra) and poll logcat for a complete marker run
// (or a hard crash).
function launchAndCollect(phase) {
    adb(['shell', 'am', 'force-stop', APP_ID], { stdio: 'ignore' });
    adb(['logcat', '-c'], { stdio: 'ignore' });
    if (phase) {
        adb(['shell', 'am', 'start', '-n', `${APP_ID}/com.tns.NativeScriptActivity`, '--es', 'gjsify.phase', phase], {
            stdio: 'ignore',
        });
    } else {
        adb(['shell', 'monkey', '-p', APP_ID, '-c', 'android.intent.category.LAUNCHER', '1'], { stdio: 'ignore' });
    }
    const started = Date.now();
    let text = '';
    let parsed = parseLogcat('');
    while (Date.now() - started < 60_000) {
        text = adb(['logcat', '-d', '-v', 'brief'], { maxBuffer: 64 * 1024 * 1024 }).stdout ?? '';
        parsed = parseLogcat(text);
        if (parsed.complete || /Module evaluation promise rejected|Cannot instantiate module/.test(text)) break;
        spawnSync('sleep', ['2']);
    }
    return { text, parsed };
}

function assertRun(label, parsed, file) {
    console.log(
        `[ns-smoke] ${label}: passed=${parsed.passed} failed=${parsed.failed} total=${parsed.total} complete=${parsed.complete}`,
    );
    for (const c of parsed.cases.filter((c) => c.status === 'FAIL')) {
        console.error(`  FAIL ${c.suite} :: ${c.name} -- ${c.message}`);
    }
    if (!parsed.begun || !parsed.complete) {
        console.error(
            `[ns-smoke] no complete __GJSIFY_NS__ run found in logcat — the app crashed at startup (module eval?). See ${file}`,
        );
        process.exit(1);
    }
    if (parsed.failed > 0 || parsed.total === 0) {
        console.error(`[ns-smoke] ${parsed.failed}/${parsed.total} on-device cases FAILED.`);
        process.exit(1);
    }
}

const main = launchAndCollect(null);
writeFileSync(logFile, main.text);
assertRun('run', main.parsed, logFile);

// 5. Cold start (ADR 0152 §5 step 2): A writes a marker, B reads it after a force-stop and clears,
// C finds the namespace empty after another force-stop. launchAndCollect force-stops before each.
for (const phase of ['A', 'B', 'C']) {
    const file = join(root, `logcat.${platform}.cold-${phase}.log`);
    const r = launchAndCollect(phase);
    writeFileSync(file, r.text);
    assertRun(`cold start phase ${phase}`, r.parsed, file);
    if (!r.parsed.cases.some((c) => c.status === 'PASS' && c.name.startsWith(`phase ${phase} `))) {
        console.error(
            `[ns-smoke] phase ${phase} did not report its case — the gjsify.phase extra did not reach the app.`,
        );
        process.exit(1);
    }
}
// 6. Reinstall (ADR 0152 §5 step 4): A writes the marker, then a REAL uninstall (not `install -r`:
// that keeps the data) and a fresh install; R finds the store empty, get() null, no throw.
{
    const a = launchAndCollect('A');
    const fileA = join(root, `logcat.${platform}.reinstall-A.log`);
    writeFileSync(fileA, a.text);
    assertRun('reinstall phase A', a.parsed, fileA);
    adb(['shell', 'am', 'force-stop', APP_ID], { stdio: 'ignore' });
    const gone = adb(['uninstall', APP_ID], { stdio: 'inherit' });
    if (gone.status !== 0 || (adb(['shell', 'pm', 'path', APP_ID]).stdout ?? '').includes('package:')) {
        console.error('[ns-smoke] adb uninstall did not remove the app.');
        process.exit(1);
    }
    if (adb(['install', apk], { stdio: 'inherit' }).status !== 0) {
        console.error('[ns-smoke] adb install after uninstall failed.');
        process.exit(1);
    }
    const fileR = join(root, `logcat.${platform}.reinstall-R.log`);
    const r = launchAndCollect('R');
    writeFileSync(fileR, r.text);
    assertRun('reinstall phase R', r.parsed, fileR);
    if (!r.parsed.cases.some((c) => c.status === 'PASS' && c.name.startsWith('phase R '))) {
        console.error('[ns-smoke] phase R did not report its case — the gjsify.phase extra did not reach the app.');
        process.exit(1);
    }
}
console.log(
    `[ns-smoke] ✔ all ${main.parsed.total} cases passed on ${platform} V8, cold-start phases A/B/C and reinstall A/R included.`,
);
process.exit(0);
