// SPDX-License-Identifier: MIT
// Gio TLS on NativeScript Android (ADR 0117 stage 2, ADR 0134 § 3).
//
// Two jobs, both run once, at the first requireGi, and only when an installed GI runtime
// package declares a GIO module (today: @gjsify/gi-runtime-android-tls):
//
// 1. LOAD THE MODULE BY SONAME. GIO normally finds modules by scanning GIO_MODULE_DIR, and
//    ADR 0117 § 3 first pointed that at ApplicationInfo.nativeLibraryDir. Measured on API 36
//    that directory is EMPTY: AGP's default for minSdk >= 23 is extractNativeLibs=false, so
//    the libraries stay inside the APK and the linker maps them from there. A directory scan
//    finds nothing; dlopen("libgioopenssl.so") does find it, in either packaging. And when
//    libraries ARE extracted, a scan of nativeLibraryDir would dlopen every lib*.so in the
//    app (libgtk-4 included) to look for a module entry point. So host.nativescript.js points
//    GIO_MODULE_DIR at an empty app-private directory, and the module is loaded here by name.
//
// 2. INSTALL ANDROID'S TRUST STORE as Gio's default database. OpenSSL's compiled-in
//    OPENSSLDIR does not exist on a device, so without this every verification fails with
//    an unknown issuer. `system` = /system/etc/security/cacerts minus the user's disabled
//    set; the user-added store is NOT part of it (ADR 0134 § 3).
//
// Everything that decides is pure and takes its inputs as arguments (test/android-tls.test.mjs).

/** The OS root store, one PEM per file named `<subject-hash>.<n>`. */
export const ANDROID_SYSTEM_CA_DIR = '/system/etc/security/cacerts';

/** Roots the user disabled in Settings → Security → Trusted credentials, same file names. */
export const ANDROID_REMOVED_CA_DIR = '/data/misc/user/0/cacerts-removed';

/**
 * The GIO modules the installed runtime packages declare, from their device manifests.
 * @param {Array<{ gioModules?: unknown }>} manifests
 * @returns {string[]} sonames, de-duplicated and sorted
 */
export function gioModulesOf(manifests) {
    const out = new Set();
    for (const manifest of manifests) {
        const list = manifest?.gioModules;
        if (!Array.isArray(list)) continue;
        for (const soname of list) if (typeof soname === 'string' && /^lib[^/]+\.so$/.test(soname)) out.add(soname);
    }
    return [...out].sort();
}

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+?-----END CERTIFICATE-----/g;

/**
 * The PEM certificate blocks in a text. Android's cacerts files carry the `openssl x509 -text`
 * dump BEFORE the PEM; only the block is kept, so the merged file is plain PEM.
 * @param {string} text
 * @returns {string[]}
 */
export function extractPemCertificates(text) {
    return (text.match(PEM_BLOCK) ?? []).map((block) => block.replace(/\r\n/g, '\n'));
}

/**
 * ADR 0134's Android `system` set: every file of the system store whose name is not in the
 * user's removed set, as one PEM text. A file name is the identity Android itself uses
 * (TrustedCertificateStore matches cacerts-removed by name).
 *
 * @param {object} spec
 * @param {Array<{ name: string, text: string }>} spec.system files of ANDROID_SYSTEM_CA_DIR
 * @param {Iterable<string>} [spec.removed] file names in ANDROID_REMOVED_CA_DIR
 * @returns {{ pem: string, count: number, removed: number }}
 */
export function mergeSystemCAs({ system, removed = [] }) {
    const drop = new Set(removed);
    const blocks = [];
    let skipped = 0;
    for (const { name, text } of [...system].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        if (drop.has(name)) {
            skipped++;
            continue;
        }
        blocks.push(...extractPemCertificates(text));
    }
    return { pem: blocks.length === 0 ? '' : `${blocks.join('\n')}\n`, count: blocks.length, removed: skipped };
}

// ---------------------------------------------------------------------------------------
// The device half: everything above decides, everything below reads and writes through Gio.
// ---------------------------------------------------------------------------------------

function asciiOf(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return out;
}

function bytesOf(text) {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
    return out;
}

function listDir(Gio, path) {
    const names = [];
    let enumerator;
    try {
        enumerator = Gio.File.new_for_path(path).enumerate_children('standard::name', 0, null);
    } catch {
        // Missing or unreadable: the removed set usually does not exist at all.
        return null;
    }
    for (let info = enumerator.next_file(null); info !== null; info = enumerator.next_file(null)) {
        names.push(info.get_name());
    }
    enumerator.close(null);
    return names;
}

function readText(Gio, path) {
    const [, contents] = Gio.File.new_for_path(path).load_contents(null);
    return asciiOf(contents);
}

/**
 * Load each module by soname. GIO_MODULE_DIR points at an empty directory
 * (host.nativescript.js), so nothing else loads them and none is loaded twice.
 *
 * GIO registers its extension points only inside its one-time module scan, and a module's
 * load function can only implement a REGISTERED point, so the scan is triggered first with
 * the cheapest call that runs it and does not freeze the TLS backend choice:
 * Gio.Vfs.get_default().
 *
 * `use()` resolves to GTypePlugin's void `use`, not GTypeModule's gboolean one (IOModule
 * implements both), so its result says nothing: whether the module took effect is read off
 * the backend afterwards, in installAndroidSystemTrust.
 *
 * The module objects are held for the life of the process: a GTypeModule must never be
 * finalized (its types stay registered), and once the JS wrapper is collected its last ref
 * goes with it — measured on the host as GObject's "unsolicitated invocation of
 * g_object_run_dispose() on GTypeModule" CRITICAL.
 *
 * @returns {string[]} the modules asked for
 */
export function loadGioModules(Gio, modules) {
    if (modules.length === 0) return [];
    Gio.Vfs.get_default();
    for (const soname of modules) {
        const module = Gio.IOModule.new(soname);
        module.use();
        loadedModules.push(module);
    }
    return [...modules];
}

const loadedModules = [];

/**
 * Resolve ADR 0134's `system` set, write it to `<cacheDir>/gjsify-tls/system-ca.pem` and
 * install it as the default database. Returns null when the backend has no TLS (no module).
 *
 * An empty set (no readable store) leaves the backend's own database in place: GTlsFileDatabase
 * refuses a file without a certificate, and an empty database would reject every host anyway.
 *
 * @param {{ systemDir?: string, removedDir?: string }} [dirs] the device paths; a host test
 *   points them at a fixture
 * @returns {{ file: string | null, count: number, removed: number, ms: number } | null}
 */
export function installAndroidSystemTrust(Gio, GLib, cacheDir, dirs = {}) {
    const { systemDir = ANDROID_SYSTEM_CA_DIR, removedDir = ANDROID_REMOVED_CA_DIR } = dirs;
    const started = Date.now();
    const backend = Gio.TlsBackend.get_default();
    if (!backend.supports_tls()) return null;
    const names = listDir(Gio, systemDir) ?? [];
    const system = names.map((name) => ({ name, text: readText(Gio, `${systemDir}/${name}`) }));
    const merged = mergeSystemCAs({ system, removed: listDir(Gio, removedDir) ?? [] });
    if (merged.count === 0) return { file: null, count: 0, removed: merged.removed, ms: Date.now() - started };
    const dir = `${cacheDir}/gjsify-tls`;
    GLib.mkdir_with_parents(dir, 0o700);
    const file = `${dir}/system-ca.pem`;
    GLib.file_set_contents(file, bytesOf(merged.pem));
    backend.set_default_database(Gio.TlsFileDatabase.new(file));
    return { file, count: merged.count, removed: merged.removed, ms: Date.now() - started };
}

let modulesFromManifests = [];

/** Recorded by host.nativescript.js from the manifests it already reads for the pin check. */
export function setAndroidGioModules(modules) {
    modulesFromManifests = modules;
}

/**
 * Run both jobs, once. `requireGi` is passed in so this file does not import gi.js.
 * The result is kept on `globalThis.__NODE_GI_ANDROID_TLS` for device harnesses.
 */
export function setUpAndroidTls(requireGi) {
    if (modulesFromManifests.length === 0) return null;
    const Gio = requireGi('Gio', '2.0');
    const GLib = requireGi('GLib', '2.0');
    const modules = loadGioModules(Gio, modulesFromManifests);
    const trust = installAndroidSystemTrust(Gio, GLib, GLib.get_user_cache_dir());
    if (trust === null) {
        console.warn(
            `@gjsify/node-gi: GIO module(s) ${modules.join(', ')} gave Gio no TLS backend; https stays unavailable.`,
        );
    }
    const result = { modules, trust };
    globalThis.__NODE_GI_ANDROID_TLS = result;
    return result;
}
