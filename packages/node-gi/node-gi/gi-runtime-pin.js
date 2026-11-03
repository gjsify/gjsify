// SPDX-License-Identifier: MIT
// The mixed-sysroot check of the Android GI runtime packages (ADR 0117 § 5).
//
// Every package that puts native GI libraries into an APK (`@gjsify/gi-runtime-android` and
// its add-ons) ships a small manifest under `assets/app/gi-runtime/<package>.json` naming
// the sysroot it was linked against. Two packages built against different sysroots put two
// glib copies' worth of symbols into one process: it fails at dlopen or, worse, as a struct
// layout mismatch far from the cause. Gradle merges both AARs without a word, so the first
// place anything can notice is the app's own startup.
//
// This file is the PURE half — manifests in, a sentence out — so Node can test it. Reading
// the manifests off the device is `readDeviceManifests`, which needs `java.io`.

/** Where the manifests land, relative to the app's files dir (`assets/app/**` is extracted there). */
export const MANIFEST_SUBDIR = 'app/gi-runtime';

function pinOf(manifest) {
    const s = manifest?.sysroot;
    return { tag: s?.tag, sha256: s?.sha256 ?? {} };
}

/**
 * Compare the installed packages' sysroot pins.
 *
 * @param {Array<{ package: string, sysroot: { tag: string, sha256: Record<string, string> } }>} manifests
 * @returns {string | null} a sentence naming both packages, or `null` when they agree
 */
export function describePinMismatch(manifests) {
    if (manifests.length < 2) return null;
    const [first, ...rest] = [...manifests].sort((a, b) => String(a.package).localeCompare(String(b.package)));
    const a = pinOf(first);
    for (const other of rest) {
        const b = pinOf(other);
        const aWhat = `${first.package} (sysroot ${a.tag})`;
        const bWhat = `${other.package} (sysroot ${b.tag})`;
        if (a.tag !== b.tag) {
            return (
                `@gjsify/node-gi: ${aWhat} and ${bWhat} were built against different Android GI ` +
                'sysroots; two sets of GLib/GTK libraries cannot share one process. Install the ' +
                'same release of both packages.'
            );
        }
        const abis = new Set([...Object.keys(a.sha256), ...Object.keys(b.sha256)]);
        for (const abi of [...abis].sort()) {
            if (a.sha256[abi] !== b.sha256[abi]) {
                return (
                    `@gjsify/node-gi: ${first.package} and ${other.package} both name sysroot ` +
                    `${a.tag} but for ${abi} they disagree on its archive digest ` +
                    `(${a.sha256[abi] ?? 'none'} vs ${b.sha256[abi] ?? 'none'}); one of them was ` +
                    'built from a different archive. Install the same release of both packages.'
                );
            }
        }
    }
    return null;
}

/**
 * Read every manifest in `<filesDir>/app/gi-runtime` through `java.io` — NativeScript's own
 * file API, not `node:fs`, which does not exist on the device.
 *
 * @param {string} filesDir
 * @param {any} java the runtime's `java` global
 * @returns {{ manifests: object[], ran: boolean }} `ran` is false when `java.io` is not exposed
 */
export function readDeviceManifests(filesDir, java) {
    const io = java?.io;
    if (!io?.File || !io?.FileInputStream || !io?.BufferedReader || !io?.InputStreamReader) {
        return { manifests: [], ran: false };
    }
    const dir = new io.File(`${filesDir}/${MANIFEST_SUBDIR}`);
    const files = dir.exists() ? dir.listFiles() : null;
    const manifests = [];
    if (!files) return { manifests, ran: true };
    for (let i = 0; i < files.length; i++) {
        const name = String(files[i].getName());
        if (!name.endsWith('.json')) continue;
        const reader = new io.BufferedReader(new io.InputStreamReader(new io.FileInputStream(files[i]), 'UTF-8'));
        let text = '';
        try {
            for (let line = reader.readLine(); line !== null; line = reader.readLine()) text += `${line}\n`;
        } finally {
            reader.close();
        }
        try {
            manifests.push(JSON.parse(text));
        } catch (e) {
            throw new Error(`@gjsify/node-gi: ${name} in ${MANIFEST_SUBDIR} is not valid JSON (${e.message}).`);
        }
    }
    return { manifests, ran: true };
}

/**
 * Throw when the installed GI runtime packages disagree on the sysroot; warn when the check
 * could not run. Never runs without a `java` global, so Node and iOS are untouched.
 *
 * @param {string | null} filesDir
 * @param {any} java
 */
export function checkSysrootPins(filesDir, java) {
    if (typeof filesDir !== 'string' || filesDir === '' || !java) return;
    const { manifests, ran } = readDeviceManifests(filesDir, java);
    if (!ran) {
        console.warn(
            '@gjsify/node-gi: the mixed-sysroot check of the GI runtime packages was NOT run — ' +
                'java.io is not exposed to this bundle.',
        );
        return;
    }
    const problem = describePinMismatch(manifests);
    if (problem !== null) throw new Error(problem);
}
