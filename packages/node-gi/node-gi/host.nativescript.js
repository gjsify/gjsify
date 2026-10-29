// SPDX-License-Identifier: MIT
// @gjsify/node-gi — the NativeScript (Android) host, selected by the `nativescript`
// condition on `#host` (see nativescript.webpack.js, which adds the condition to
// @nativescript/webpack's resolver). NativeScript's V8 is a Node-API host WITHOUT Node's
// module system: no node:fs/module/path/process/timers, no prebuild tree, no re-exec.
// This file is the whole difference — gi.js and index.js import the same names from
// `#host` on every runtime.
//
// Configuration (globals, set before the first import — this package must not hard-import
// @nativescript/core):
//   __NODE_GI_APP_DIR       app-private writable dir (default: the files dir, derived from
//                           com.tns.NativeScriptApplication). HOME / XDG_{DATA,CONFIG,CACHE}_HOME and
//                           XDG_RUNTIME_DIR are pointed below it, via android.system.Os.setenv
//                           (a libc setenv) before the addon — and so GLib — is loaded: GLib caches
//                           these dirs on first use, a later GLib.setenv would be too late.
//   __NODE_GI_TYPELIB_PATH  directory holding the *.typelib files (the app bundles them, e.g.
//                           `knownFolders.currentApp().path + '/girepository-1.0'`); prepended to
//                           the GIRepository search path. Default: `<app dir>/app/girepository-1.0`.
//   __NODE_GI_SYSTEM_DIR    root of the bundled GNOME system prefix, holding `share/` and `etc/`
//                           as GTK's own Android runtime lays them out (XDG_DATA_DIRS=<root>/share,
//                           XDG_CONFIG_DIRS=<root>/etc, plus FONTCONFIG_PATH=<root>/etc/fonts since
//                           fontconfig's compiled-in /etc/fonts is Android's own and holds no
//                           fonts.conf). Unset ⇒ nothing is written and GLib keeps its /usr/…
//                           defaults, which exist on no Android device: a host that bundles its
//                           own GSettings schemas, icon themes or GTK resources must set it.
//                           GTK does the same from startRuntime() via g_set_user_dirs(), which is
//                           not introspectable — see refs/gtk/gdk/android/gdkandroidruntime.c.
//   __NODE_GI_ANDROID_GDK   truthy ⇒ bring GDK's Android backend up while loading the addon:
//                           gdk_android_initialize(env, app classloader, Application), the pair
//                           GTK's RuntimeApplication.startRuntime() passes. Needed before the
//                           first Gtk call and NOT done by anything else — GIRepository dlopens
//                           libgtk-4.so, which (unlike System.loadLibrary) never runs its
//                           JNI_OnLoad, and that JNI_OnLoad passes a NULL context anyway, on
//                           which gtk_init's Context.getSystemService() aborts the process.
//                           Unset ⇒ libgtk-4.so is not loaded here at all, which is what a
//                           GLib-only host wants (src/android-gdk.cc).
//   __NODE_GI_ANDROID_JNI_BOOTSTRAP
//                           required by the above: the fully-qualified name of a class in
//                           the APK whose static initializer calls
//                           System.loadLibrary("node_gi"). Nothing else runs this addon's
//                           JNI_OnLoad, and without that there is no JavaVM to reach GDK
//                           with — see ensureJavaVm().

/** @type {'nativescript'} */
export const RUNTIME = 'nativescript';

/**
 * Whether the addon may be loaded on first use instead of at import — see index.js.
 * @type {boolean}
 */
export const LAZY_NATIVE = true;

/**
 * Whether `GObject.registerClass` may register a class whose JS parent is NOT a node-gi
 * GObject class — `class MyLabel extends Label {}`, where `Label` is a
 * `@nativescript/core` widget. GJS rejects that outright and so does node-gi on every
 * other host; this is the ONE deliberate divergence, and it is deliberate because on
 * NativeScript there is no GJS to be compatible with: node-gi is the only GI runtime that
 * ever executes here, so a program written against this cannot be a program that behaves
 * differently under GJS. See the FOREIGN-PARENT section in gi.js, ADR 0105 § 2 and
 * docs/node-gi-gjs-surface.md.
 * @type {boolean}
 */
export const FOREIGN_PARENT_CLASSES = true;

// Timers from the global scope: NativeScript has no node:timers, and there is no
// GLib-backed replacement to avoid here. setImmediate is not a V8 builtin.
export const setImmediate =
    typeof globalThis.setImmediate === 'function'
        ? globalThis.setImmediate.bind(globalThis)
        : (fn, ...args) => globalThis.setTimeout(fn, 0, ...args);
export const setInterval = globalThis.setInterval.bind(globalThis);
export const clearInterval = globalThis.clearInterval.bind(globalThis);

// The only `process` surface gi.js reads is on('beforeExit'), and NativeScript has no such
// event: its loop is the Android main Looper, which never "runs empty". The stand-in
// swallows registrations (nothing needs re-arming — the native ALooper pump owns GLib
// dispatch). exit() is the honest Android answer: end this process.
const env = {};
export const runtimeProcess = {
    env,
    platform: 'android',
    argv: [],
    on() {
        return runtimeProcess;
    },
    once() {
        return runtimeProcess;
    },
    exit(code = 0) {
        const proc = globalThis.android?.os?.Process;
        if (proc) proc.killProcess(proc.myPid());
        throw new Error(`@gjsify/node-gi: process.exit(${code}) is unavailable outside Android`);
    },
};

// No bundled-GTK windowing loader on Android: nothing was written, nothing to replay.
export function windowingEnvWrites() {
    return [];
}

export function bundledLocaleDir() {
    return undefined;
}

// NativeScript's runtime class hands out the Application without @nativescript/core
// (android.app.ActivityThread is a hidden API and absent from the metadata).
function deriveAppDir() {
    try {
        return globalThis.com?.tns?.NativeScriptApplication?.getInstance()?.getFilesDir()?.getPath() ?? null;
    } catch {
        // NativeScript surfaces a Java exception as a JS one, and getFilesDir() raises
        // before the Application is fully constructed. No dir is not a failure here: it
        // means the host sets __NODE_GI_APP_DIR itself, or keeps GLib's defaults.
        return null;
    }
}

function setNativeEnv(name, value) {
    env[name] = value;
    globalThis.android?.system?.Os?.setenv(name, value, true);
}

/**
 * The LANGUAGE value for a list of BCP-47 tags: `de-DE` → `de_DE:de`, `zh-Hans-CN` → `zh_CN:zh`,
 * de-duplicated, with `C` last as GLib orders it. Bionic's setlocale accepts only C/C.UTF-8
 * and Android sets no LANG, so GLib's language list (and the libintl in gi-runtime-android,
 * which reads LANGUAGE on every lookup) has nothing else to go on. Pure — no device needed.
 * @param {string[]} tags
 * @returns {string}
 */
export function languageFromBcp47(tags) {
    const out = [];
    const add = (name) => {
        if (!out.includes(name)) out.push(name);
    };
    for (const tag of tags) {
        const parts = String(tag).split(/[-_]/).filter(Boolean);
        if (parts.length === 0 || !/^[A-Za-z]{2,3}$/.test(parts[0])) continue;
        const lang = parts[0].toLowerCase();
        const region = parts.slice(1).find((p) => /^([A-Za-z]{2}|\d{3})$/.test(p));
        if (region) add(`${lang}_${region.toUpperCase()}`);
        add(lang);
    }
    add('C');
    return out.join(':');
}

function platformLanguageTags() {
    const locales = globalThis.android?.content?.res?.Resources?.getSystem?.()?.getConfiguration?.()?.getLocales?.();
    const tags = [];
    if (locales) {
        for (let i = 0; i < locales.size(); i++) tags.push(String(locales.get(i).toLanguageTag()));
    }
    if (tags.length === 0) {
        const one = globalThis.java?.util?.Locale?.getDefault?.();
        if (one) tags.push(String(one.toLanguageTag()));
    }
    return tags;
}

/**
 * Point LANGUAGE at the platform's current locale list. Call it again when the user
 * switches the app's language: libintl and GLib re-read the variable, nothing is cached.
 * The explicit __NODE_GI_LANGUAGE global wins, for a host that manages its own.
 * @returns {string | null} the value set, or null when the platform gave nothing
 */
export function refreshLocale() {
    let value = globalThis.__NODE_GI_LANGUAGE;
    if (typeof value !== 'string' || value === '') {
        try {
            const tags = platformLanguageTags();
            value = tags.length > 0 ? languageFromBcp47(tags) : null;
        } catch {
            value = null;
        }
    }
    if (value === null || value === undefined) return null;
    setNativeEnv('LANGUAGE', value);
    return value;
}

function appDirectory() {
    const set = globalThis.__NODE_GI_APP_DIR;
    if (typeof set === 'string' && set !== '') return set;
    return deriveAppDir();
}

// The addon needs a JavaVM to hand GDK a JNIEnv, and a native library gets one only from
// its own JNI_OnLoad — which ART runs when it loads the library on behalf of a class.
// NativeScript's `system_lib://` is a plain dlopen: the library is mapped and its
// Node-API exports work, but ART never saw it, so JNI_OnLoad did not run.
//
// Loading it a second time from Java does run it, and costs nothing — same soname in the
// same linker namespace is the same handle, not a second copy. The catch is where the
// load is issued from, because ART resolves the library against the *calling class's*
// classloader:
//
//   java.lang.System.loadLibrary('node_gi') straight from JS fails with "library
//   libnode_gi.so not found": the call arrives through JNI with no Java frame below it,
//   so the caller is the system classloader, whose search path is /system/lib* only.
//   System.load() with the absolute path from ApplicationInfo.nativeLibraryDir does not
//   throw but leaves the VM unset — measured on API 36.
//
// So the load has to come from a class in the APK: __NODE_GI_ANDROID_JNI_BOOTSTRAP names
// one whose static initializer calls System.loadLibrary("node_gi"), and initializing it
// through Class.forName runs that block under the app's own classloader. Registering the
// name with the addon first is what lets its JNI_OnLoad cache that classloader, the only
// moment app classes are visible to it.
function ensureJavaVm(native) {
    if (typeof native.androidHasJavaVm !== 'function' || native.androidHasJavaVm()) return;
    const bootstrap = globalThis.__NODE_GI_ANDROID_JNI_BOOTSTRAP;
    if (typeof bootstrap !== 'string' || bootstrap === '') {
        throw new Error(
            '@gjsify/node-gi: __NODE_GI_ANDROID_GDK needs __NODE_GI_ANDROID_JNI_BOOTSTRAP — ' +
                'the name of an app class whose static initializer calls ' +
                'System.loadLibrary("node_gi"). Only such a class can run this addon\'s ' +
                'JNI_OnLoad, and without it there is no JavaVM to initialize GDK with.',
        );
    }
    native.androidRegisterJniBootstrap(bootstrap.replace(/\./g, '/'));
    const loader = globalThis.com?.tns?.NativeScriptApplication?.getInstance()?.getClassLoader();
    globalThis.java?.lang?.Class?.forName(bootstrap, true, loader);
}

function configureEnvironment() {
    refreshLocale();
    const systemDir = globalThis.__NODE_GI_SYSTEM_DIR;
    if (typeof systemDir === 'string' && systemDir !== '') {
        setNativeEnv('XDG_DATA_DIRS', `${systemDir}/share`);
        setNativeEnv('XDG_CONFIG_DIRS', `${systemDir}/etc`);
        setNativeEnv('FONTCONFIG_PATH', `${systemDir}/etc/fonts`);
    }
    const appDir = appDirectory();
    if (appDir === null) return;
    setNativeEnv('HOME', appDir);
    setNativeEnv('XDG_DATA_HOME', `${appDir}/.local/share`);
    setNativeEnv('XDG_CONFIG_HOME', `${appDir}/.config`);
    setNativeEnv('XDG_CACHE_HOME', `${appDir}/.cache`);
    setNativeEnv('XDG_RUNTIME_DIR', `${appDir}/.run`);
}

/**
 * The names under which NativeScript's own module loader can be reached from the GLOBAL scope,
 * in the order a bundle may offer them. `system_lib://` is the runtime's scheme, so whichever
 * of these answers, it is the same loader underneath.
 *
 *   * `require` — the loader the runtime installs globally. A CommonJS bundle also has a
 *     module-scoped `require`, but that one is the BUNDLER's; reading the global by name is
 *     what keeps the two apart, and it is why this list is read off a scope object rather
 *     than written as bare identifiers.
 *   * `__nativeRequire` — the same loader under the name the runtime uses internally
 *     (measured in @nativescript/android 9.1's libNativeScript.so, beside `ns:module`'s
 *     `createRequire`). It is the fallback for a runtime that stops exposing `require`
 *     globally, which an ESM-only bundle would otherwise have no way to reach.
 */
const RUNTIME_REQUIRE_GLOBALS = ['require', '__nativeRequire'];

/**
 * Pick the function that can load `system_lib://libnode_gi.so`.
 *
 * WHY THIS IS A CHAIN AND NOT webpack's ONE NAME. `__non_webpack_require__` only exists
 * because webpack REWRITES that free identifier to the runtime's require; under
 * @nativescript/vite (Rolldown, ESM output) nothing rewrites it, so the old single check made
 * every non-webpack NativeScript bundle fail at the first `requireGi` with a message telling
 * the app to switch bundlers — which is not a fix available to a vite app.
 *
 * ORDER MATTERS. webpack's rewrite wins first: in a webpack bundle the module-scoped `require`
 * is webpack's own and would resolve `system_lib://…` against the bundle graph instead of the
 * runtime. Only after that do the runtime's global names get a turn.
 *
 * Pure on purpose — `scope` is an argument so the chain is testable without a device
 * (`test/host-nativescript.test.mjs`).
 *
 * @param {Record<string, unknown>} scope the global object to read the runtime names off
 * @param {unknown} webpackRequire webpack's rewritten `__non_webpack_require__`, if any
 * @returns {{ load: ((id: string) => any) | null, via: string | null }}
 */
export function resolveNativeRequire(scope, webpackRequire) {
    if (typeof webpackRequire === 'function') {
        return { load: /** @type {(id: string) => any} */ (webpackRequire), via: '__non_webpack_require__' };
    }
    for (const name of RUNTIME_REQUIRE_GLOBALS) {
        const candidate = scope?.[name];
        if (typeof candidate === 'function') {
            return { load: /** @type {(id: string) => any} */ (candidate), via: name };
        }
    }
    return { load: null, via: null };
}

/**
 * Load the addon from the APK's native libs and point GI at the app's typelibs.
 * @returns {Record<string, any>} the native engine
 */
export function loadNativeHost() {
    configureEnvironment();
    // The bare identifier is what webpack rewrites; everything else is read off the global
    // scope inside resolveNativeRequire.
    const { load } = resolveNativeRequire(
        globalThis,
        typeof __non_webpack_require__ === 'function' ? __non_webpack_require__ : undefined,
    );
    if (load === null) {
        throw new Error(
            '@gjsify/node-gi: the NativeScript host found no module loader to pass ' +
                "'system_lib://libnode_gi.so' to. It looked for __non_webpack_require__ (webpack " +
                `rewrites it) and then for ${RUNTIME_REQUIRE_GLOBALS.map((n) => `globalThis.${n}`).join(' and ')}` +
                " — the names NativeScript's own loader answers to. None of them is a function, which " +
                'means this is not a NativeScript runtime, or its loader moved.',
        );
    }
    const native = load('system_lib://libnode_gi.so');
    const appDir = appDirectory();
    // `app/` is where NativeScript extracts the bundled assets under the files dir.
    const typelibs = globalThis.__NODE_GI_TYPELIB_PATH ?? (appDir === null ? null : `${appDir}/app/girepository-1.0`);
    if (typeof typelibs === 'string' && typelibs !== '') native.prependSearchPath(typelibs);
    // The addon names the Context provider rather than guessing: on NativeScript that is
    // the runtime's own Application holder, the same one deriveAppDir() reads.
    if (globalThis.__NODE_GI_ANDROID_GDK && typeof native.androidInitGdk === 'function') {
        ensureJavaVm(native);
        native.androidInitGdk('com/tns/NativeScriptApplication', 'getInstance', '()Landroid/app/Application;');
    }
    return native;
}
