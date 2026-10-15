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
// `--against <other.apk>` adds the OTHER half of the bill: everything the plugin costs that is
// not one of its own named entries — the JavaScript that imports it. Point it at a build made
// with `GJSIFY_GI_PLUGIN=0` (see ../vite.config.ts) and it diffs every non-payload entry between
// the two APKs, so `assets/app/bundle.mjs` growing by the bridge shows up as a number instead of
// an assumption, and any other difference between the two builds shows up beside it rather than
// hiding inside a single total. Compare like with like: same build type, same ABI split.
//
// Usage: node scripts/apk-size.mjs [path/to.apk] [--against path/to/other.apk]
//        → prints a table and writes apk-size.json
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const againstAt = argv.indexOf('--against');
const against = againstAt === -1 ? null : argv[againstAt + 1];
const positional = againstAt === -1 ? argv : argv.filter((_, i) => i !== againstAt && i !== againstAt + 1);
const apk =
    positional[0] ?? join(root, 'platforms', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
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
if (against !== null && !existsSync(against)) die(`no APK at ${against} — --against needs a second build.`);

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// `-rw-r--r--  2.0 unx  230588 b-  230588 stor 80-Jan-01 00:00 assets/app/…` — permissions, zip
// version, OS, UNCOMPRESSED size (3), text/binary flag, COMPRESSED size (5), method (6), then date
// and time as two separate fields, so the name starts at 9.
//
// Entry sizes, never `stat` on the APK: gradle's incremental packaging rewrites a previous APK in
// place, so a file's length can belong to a build that is no longer the one on disk.
function listEntries(path) {
    const listing = spawnSync('zipinfo', ['-l', path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (listing.status !== 0) die(`zipinfo failed on ${path}: ${listing.stderr?.trim()}`);
    const all = new Map();
    for (const line of listing.stdout.split('\n')) {
        const f = line.trim().split(/\s+/);
        if (f.length < 10 || !/^[-d]/.test(f[0])) continue;
        all.set(f.slice(9).join(' '), { uncompressed: Number(f[3]), compressed: Number(f[5]), method: f[6] });
    }
    return all;
}

const all = listEntries(apk);

// WHICH ABIs THIS APK IS FOR, read off the APK rather than assumed from the manifest. A universal
// build carries both; a `splits.abi` build carries one, and then the other ABI's libraries are not
// missing, they are in the other file. Deciding from the entries keeps the MISSING check below
// meaningful for both shapes without a flag to get wrong.
const abis = manifest.abis.filter((abi) => [...all.keys()].some((name) => name.startsWith(`lib/${abi}/`)));
if (abis.length === 0) {
    die(`${apk} carries no lib/<abi>/ entries for any of ${manifest.abis.join(', ')} — abiFilters mismatch?`);
}

/** The APK paths the plugin is responsible for IN THIS APK, as the manifest names them. */
const owned = new Set();
for (const abi of abis) {
    for (const library of manifest.libraries[abi]) owned.add(`lib/${abi}/${library.name}`);
}
for (const typelib of manifest.typelibs) owned.add(`assets/app/girepository-1.0/${typelib.name}`);

const entries = [...all].filter(([name]) => owned.has(name)).map(([name, entry]) => ({ name, ...entry }));

const missing = [...owned].filter((name) => !entries.some((e) => e.name === name));
const sum = (key) => entries.reduce((total, e) => total + e[key], 0);
const apkBytes = statSync(apk).size;
const report = {
    apk,
    apkBytes,
    abis,
    manifestAbis: manifest.abis,
    pluginEntries: entries.length,
    pluginCompressed: sum('compressed'),
    pluginUncompressed: sum('uncompressed'),
    missing,
    entries,
};

const mb = (bytes) => `${(bytes / 1_000_000).toFixed(2)} MB`;
console.log(`[apk-size] ${apk}`);
console.log(`[apk-size] APK total:            ${apkBytes} bytes (${mb(apkBytes)})`);
console.log(`[apk-size] ABIs in this APK:     ${abis.join(', ')} (manifest ships ${manifest.abis.join(', ')})`);
console.log(`[apk-size] plugin entries:       ${entries.length} of ${owned.size} expected`);
console.log(`[apk-size] plugin compressed:    ${report.pluginCompressed} bytes (${mb(report.pluginCompressed)})`);
console.log(`[apk-size] plugin uncompressed:  ${report.pluginUncompressed} bytes (${mb(report.pluginUncompressed)})`);
console.log(
    `[apk-size] APK without the plugin: ${apkBytes - report.pluginCompressed} bytes (${mb(apkBytes - report.pluginCompressed)})`,
);
for (const entry of entries.sort((a, b) => b.compressed - a.compressed)) {
    console.log(`  ${String(entry.compressed).padStart(9)}  ${entry.method}  ${entry.name}`);
}

if (against !== null) {
    // Only the entries the manifest does NOT claim: the payload's own libraries are in both APKs
    // (the AAR is a gradle dependency either way), so counting them here would double them.
    const other = listEntries(against);
    const names = new Set([...all.keys(), ...other.keys()].filter((name) => !owned.has(name)));
    const changed = [];
    for (const name of names) {
        const delta = (all.get(name)?.compressed ?? 0) - (other.get(name)?.compressed ?? 0);
        if (delta !== 0) changed.push({ name, delta, inThis: all.has(name), inOther: other.has(name) });
    }
    changed.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    report.against = against;
    report.nonPayloadCompressedDelta = changed.reduce((total, e) => total + e.delta, 0);
    report.nonPayloadChanged = changed;
    console.log(`[apk-size] --against ${against}`);
    console.log(
        `[apk-size] non-payload delta:    ${report.nonPayloadCompressedDelta} bytes (${mb(report.nonPayloadCompressedDelta)}) over ${changed.length} entries`,
    );
    for (const e of changed.slice(0, 10)) {
        const where = e.inThis && e.inOther ? 'both' : e.inThis ? 'this only' : 'other only';
        console.log(`  ${String(e.delta).padStart(10)}  ${where.padEnd(10)}  ${e.name}`);
    }
    const total = report.pluginCompressed + report.nonPayloadCompressedDelta;
    console.log(`[apk-size] TOTAL plugin cost:   ${total} bytes (${mb(total)})`);
}

writeFileSync(join(root, 'apk-size.json'), `${JSON.stringify(report, null, 4)}\n`);
console.log('[apk-size] → apk-size.json');

if (missing.length > 0) {
    // A missing entry is not a smaller APK, it is a payload the device will not find: an
    // `abiFilters` that dropped an ABI, or a packaging rule that excluded the typelib assets.
    console.error(`[apk-size] MISSING from the APK: ${missing.join(', ')}`);
    process.exit(1);
}
