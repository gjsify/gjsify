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

function configureEnvironment() {
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
    return native;
}
