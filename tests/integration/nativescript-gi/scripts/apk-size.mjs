#!/usr/bin/env node
// WHAT THE PLUGIN COSTS AN APK — measured from the APK, not estimated from the AAR.
//
// ADR 0105 recorded the stage-3 probe APK at 57 MB and never measured the DELTA, because there
// was nothing to subtract: the payload was hand-copied into App_Resources and a build without it
// was a different app. With the payload behind a dependency, the cost is a set of named entries
// in one zip, so it is measurable from a SINGLE build — no second APK, no "same tree, one
// dependency removed" run whose other differences nobody can account for.
//
// The entries are keyed off `platforms/android/gi-runtime.json`, the manifest the payload build
// writes: every `lib/<abi>/<soname>` it lists plus every `assets/app/girepository-1.0/<typelib>`.
// COMPRESSED sizes, because that is what a download costs; uncompressed is reported beside it
// because that is what the device stores (and `.so` entries in a modern APK are stored, not
// deflated, so the two differ a lot for the libraries and not at all for the typelibs).
//
// Usage: node scripts/apk-size.mjs [path/to.apk]   → prints a table and writes apk-size.json
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const apk =
    process.argv[2] ?? join(root, 'platforms', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const manifestPath = join(
    root,
    'node_modules',
    '@gjsify',
    'gi-runtime-android',
    'platforms',
    'android',
    'gi-runtime.json',
);

function die(message) {
    console.error(`[apk-size] ${message}`);
    process.exit(1);
}

if (!existsSync(apk)) die(`no APK at ${apk} — run scripts/run-on-device.mjs (or ns build) first.`);
if (!existsSync(manifestPath)) die(`no payload manifest at ${manifestPath} — is the plugin installed and built?`);

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

/** The APK paths the plugin is responsible for, as the manifest names them. */
const owned = new Set();
for (const [abi, libraries] of Object.entries(manifest.libraries)) {
    for (const library of libraries) owned.add(`lib/${abi}/${library.name}`);
}
for (const typelib of manifest.typelibs) owned.add(`assets/app/girepository-1.0/${typelib.name}`);

const listing = spawnSync('zipinfo', ['-l', apk], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (listing.status !== 0) die(`zipinfo failed on ${apk}: ${listing.stderr?.trim()}`);

// `-rw-r--r--  2.0 unx  230588 b-  230588 stor 80-Jan-01 00:00 assets/app/…` — permissions, zip
// version, OS, UNCOMPRESSED size (3), text/binary flag, COMPRESSED size (5), method (6), then date
// and time as two separate fields, so the name starts at 9.
const entries = [];
for (const line of listing.stdout.split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f.length < 10 || !/^[-d]/.test(f[0])) continue;
    const name = f.slice(9).join(' ');
    if (owned.has(name)) entries.push({ name, uncompressed: Number(f[3]), compressed: Number(f[5]), method: f[6] });
}

const missing = [...owned].filter((name) => !entries.some((e) => e.name === name));
const sum = (key) => entries.reduce((total, e) => total + e[key], 0);
const apkBytes = statSync(apk).size;
const report = {
    apk,
    apkBytes,
    abis: manifest.abis,
    pluginEntries: entries.length,
    pluginCompressed: sum('compressed'),
    pluginUncompressed: sum('uncompressed'),
    missing,
    entries,
};

const mb = (bytes) => `${(bytes / 1_000_000).toFixed(2)} MB`;
console.log(`[apk-size] ${apk}`);
console.log(`[apk-size] APK total:            ${apkBytes} bytes (${mb(apkBytes)})`);
console.log(`[apk-size] plugin entries:       ${entries.length} of ${owned.size} expected`);
console.log(`[apk-size] plugin compressed:    ${report.pluginCompressed} bytes (${mb(report.pluginCompressed)})`);
console.log(`[apk-size] plugin uncompressed:  ${report.pluginUncompressed} bytes (${mb(report.pluginUncompressed)})`);
console.log(
    `[apk-size] APK without the plugin: ${apkBytes - report.pluginCompressed} bytes (${mb(apkBytes - report.pluginCompressed)})`,
);
for (const entry of entries.sort((a, b) => b.compressed - a.compressed)) {
    console.log(`  ${String(entry.compressed).padStart(9)}  ${entry.method}  ${entry.name}`);
}

writeFileSync(join(root, 'apk-size.json'), `${JSON.stringify(report, null, 4)}\n`);
console.log('[apk-size] → apk-size.json');

if (missing.length > 0) {
    // A missing entry is not a smaller APK, it is a payload the device will not find: an
    // `abiFilters` that dropped an ABI, or a packaging rule that excluded the typelib assets.
    console.error(`[apk-size] MISSING from the APK: ${missing.join(', ')}`);
    process.exit(1);
}
