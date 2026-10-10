// SPDX-License-Identifier: MIT
// The `nativescript` condition resolves `#host` to the NativeScript host, and that host
// loads the addon through the runtime's own require — checked without the addon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function probe(conditions, code) {
    const r = spawnSync(process.execPath, [...conditions, '--input-type=module', '-e', code], {
        cwd: root,
        encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
}

test('without the condition #host is the Node host', () => {
    const out = probe([], "import * as h from '#host'; console.log(JSON.stringify({ r: h.RUNTIME }))");
    assert.equal(out.r, 'node');
});

test('--conditions=nativescript selects host.nativescript.js', () => {
    const out = probe(
        ['--conditions=nativescript'],
        `import * as h from '#host';
         const calls = [];
         globalThis.__non_webpack_require__ = (id) => { calls.push(id); return { prependSearchPath: (d) => calls.push(d) }; };
         globalThis.__NODE_GI_TYPELIB_PATH = '/app/typelibs';
         h.loadNativeHost();
         console.log(JSON.stringify({ r: h.RUNTIME, p: h.runtimeProcess.platform, w: h.windowingEnvWrites(), calls }))`,
    );
    assert.equal(out.r, 'nativescript');
    assert.equal(out.p, 'android');
    assert.deepEqual(out.w, []);
    assert.deepEqual(out.calls, ['system_lib://libnode_gi.so', '/app/typelibs']);
});

// GLib's own /usr/share defaults exist on no Android device, and g_set_user_dirs() —
// what GTK's Android runtime uses — is not introspectable, so the system prefix is an
// env write the host owns. It must stay opt-in: a host that bundles no share/ or etc/
// is better off with GLib's defaults than with two paths that do not exist.
test('__NODE_GI_SYSTEM_DIR writes the system XDG dirs, and nothing without it', () => {
    const code = (globals) =>
        `import * as h from '#host';
         globalThis.__non_webpack_require__ = () => ({ prependSearchPath() {} });
         ${globals}
         h.loadNativeHost();
         console.log(JSON.stringify(h.runtimeProcess.env))`;

    const withDir = probe(
        ['--conditions=nativescript'],
        code("globalThis.__NODE_GI_APP_DIR = '/data/app'; globalThis.__NODE_GI_SYSTEM_DIR = '/data/app/app/gtkdata';"),
    );
    assert.equal(withDir.XDG_DATA_DIRS, '/data/app/app/gtkdata/share');
    assert.equal(withDir.XDG_CONFIG_DIRS, '/data/app/app/gtkdata/etc');
    assert.equal(withDir.FONTCONFIG_PATH, '/data/app/app/gtkdata/etc/fonts');
    // The per-user dirs are a separate knob and still answer to __NODE_GI_APP_DIR.
    assert.equal(withDir.XDG_DATA_HOME, '/data/app/.local/share');

    const without = probe(['--conditions=nativescript'], code("globalThis.__NODE_GI_APP_DIR = '/data/app';"));
    assert.deepEqual(
        Object.keys(without).filter((k) => k.endsWith('_DIRS') || k === 'FONTCONFIG_PATH'),
        [],
    );
});

// Nothing else initializes GDK's Android backend: GIRepository's dlopen of libgtk-4.so
// runs no JNI_OnLoad, and the JNI_OnLoad that System.loadLibrary would run hands GDK a
// NULL Context, which gtk_init then calls getSystemService() on. Opt-in, because the
// bring-up dlopens the whole GTK stack.
test('__NODE_GI_ANDROID_GDK asks the addon for the GDK bring-up, and nothing without it', () => {
    const code = (globals) =>
        `import * as h from '#host';
         const calls = [];
         globalThis.__non_webpack_require__ = () => ({
             prependSearchPath() {},
             androidHasJavaVm: () => true,
             androidInitGdk: (...args) => { calls.push(args); return true; },
         });
         globalThis.__NODE_GI_APP_DIR = '/data/app';
         ${globals}
         h.loadNativeHost();
         console.log(JSON.stringify(calls))`;

    assert.deepEqual(probe(['--conditions=nativescript'], code('globalThis.__NODE_GI_ANDROID_GDK = true;')), [
        ['com/tns/NativeScriptApplication', 'getInstance', '()Landroid/app/Application;'],
    ]);
    assert.deepEqual(probe(['--conditions=nativescript'], code('')), []);
});

// The addon's JNI_OnLoad does not run under NativeScript's dlopen, and without it there is
// no JavaVM to reach GDK with — so the host initializes an app class that loads the library
// the way ART wants, after telling the addon which class that is.
test('the JNI bootstrap registers its class, then initializes it — once', () => {
    const code = (hasVm, bootstrap) =>
        `import * as h from '#host';
         const calls = [];
         globalThis.__non_webpack_require__ = () => ({
             prependSearchPath() {},
             androidHasJavaVm: () => ${hasVm},
             androidRegisterJniBootstrap: (n) => calls.push(['register', n]),
             androidInitGdk: () => true,
         });
         globalThis.com = { tns: { NativeScriptApplication: { getInstance: () => ({
             getFilesDir: () => ({ getPath: () => '/data/app' }),
             getClassLoader: () => 'app-loader',
         }) } } };
         globalThis.java = { lang: { Class: { forName: (...a) => calls.push(['forName', ...a]) } } };
         globalThis.__NODE_GI_ANDROID_GDK = true;
         ${bootstrap}
         h.loadNativeHost();
         console.log(JSON.stringify(calls))`;

    const bootstrap = "globalThis.__NODE_GI_ANDROID_JNI_BOOTSTRAP = 'dev.example.JniBootstrap';";
    // The name reaches the addon in JNI form, because that is what its FindClass takes.
    assert.deepEqual(probe(['--conditions=nativescript'], code('false', bootstrap)), [
        ['register', 'dev/example/JniBootstrap'],
        ['forName', 'dev.example.JniBootstrap', true, 'app-loader'],
    ]);
    assert.deepEqual(probe(['--conditions=nativescript'], code('true', bootstrap)), []);
});

test('the GDK bring-up without a bootstrap class is refused, not left to fail in JNI', () => {
    const r = spawnSync(
        process.execPath,
        ['--conditions=nativescript', '--input-type=module', '-e',
         `import * as h from '#host';
          globalThis.__non_webpack_require__ = () => ({
              prependSearchPath() {}, androidHasJavaVm: () => false, androidInitGdk: () => true,
          });
          globalThis.__NODE_GI_APP_DIR = '/data/app';
          globalThis.__NODE_GI_ANDROID_GDK = true;
          h.loadNativeHost();`],
        { cwd: root, encoding: 'utf8' },
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /__NODE_GI_ANDROID_JNI_BOOTSTRAP/);
});

test('nativescript.webpack.js adds the nativescript condition (and require() hands back the hook)', () => {
    const set = [];
    const hook = createRequire(import.meta.url)('../nativescript.webpack.js');
    assert.equal(typeof hook, 'function');
    hook({ chainWebpack: (fn) => fn({ resolve: { set: (k, v) => set.push([k, v]) } }) });
    assert.deepEqual(set, [['conditionNames', ['nativescript', '...']]]);
});
