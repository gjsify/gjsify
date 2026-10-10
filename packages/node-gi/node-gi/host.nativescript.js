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
 * Load the addon from the APK's native libs and point GI at the app's typelibs.
 * @returns {Record<string, any>} the native engine
 */
export function loadNativeHost() {
    configureEnvironment();
    // webpack rewrites __non_webpack_require__ to the runtime's own `require`.
    const load = typeof __non_webpack_require__ === 'function' ? __non_webpack_require__ : null;
    if (load === null) {
        throw new Error(
            '@gjsify/node-gi: the NativeScript host needs __non_webpack_require__ ' +
                '(bundle with @nativescript/webpack, which adds the `nativescript` resolve condition).',
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
