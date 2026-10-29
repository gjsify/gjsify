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
        [
            '--conditions=nativescript',
            '--input-type=module',
            '-e',
            `import * as h from '#host';
          globalThis.__non_webpack_require__ = () => ({
              prependSearchPath() {}, androidHasJavaVm: () => false, androidInitGdk: () => true,
          });
          globalThis.__NODE_GI_APP_DIR = '/data/app';
          globalThis.__NODE_GI_ANDROID_GDK = true;
          h.loadNativeHost();`,
        ],
        { cwd: root, encoding: 'utf8' },
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /__NODE_GI_ANDROID_JNI_BOOTSTRAP/);
});

// The loader chain, as a function — the device half of this is a gradle build and an APK, so
// the ORDER and the fallbacks are pinned here instead.
test('resolveNativeRequire prefers webpack rewrite, then the runtime globals', async () => {
    const { resolveNativeRequire } = await import('../host.nativescript.js');
    const webpack = () => 'webpack';
    const runtime = () => 'runtime';
    const internal = () => 'internal';

    // webpack's rewritten name wins even when the globals are there: in a webpack bundle the
    // module-scoped `require` is webpack's own and would resolve against the bundle graph.
    assert.deepEqual(resolveNativeRequire({ require: runtime, __nativeRequire: internal }, webpack), {
        load: webpack,
        via: '__non_webpack_require__',
    });
    assert.deepEqual(resolveNativeRequire({ require: runtime, __nativeRequire: internal }, undefined), {
        load: runtime,
        via: 'require',
    });
    // An ESM bundle on a runtime that exposes only its internal name — the case webpack's
    // single check could not reach at all.
    assert.deepEqual(resolveNativeRequire({ __nativeRequire: internal }, undefined), {
        load: internal,
        via: '__nativeRequire',
    });
    assert.deepEqual(resolveNativeRequire({}, undefined), { load: null, via: null });
    // Not a function is not a loader: a bundler may leave `require` defined as something else.
    assert.deepEqual(resolveNativeRequire({ require: 'not a function' }, undefined), { load: null, via: null });
    assert.deepEqual(resolveNativeRequire(undefined, undefined), { load: null, via: null });
});

// What @nativescript/vite produces: ESM, no `__non_webpack_require__` anywhere. Before the
// chain this threw and told the app to switch to webpack.
test('a bundle with only the runtime global still loads the addon', () => {
    const out = probe(
        ['--conditions=nativescript'],
        `import * as h from '#host';
         const calls = [];
         globalThis.require = (id) => { calls.push(id); return { prependSearchPath: (d) => calls.push(d) }; };
         globalThis.__NODE_GI_TYPELIB_PATH = '/app/typelibs';
         h.loadNativeHost();
         console.log(JSON.stringify({ calls }))`,
    );
    assert.deepEqual(out.calls, ['system_lib://libnode_gi.so', '/app/typelibs']);
});

test('no loader at all names every name it looked for', () => {
    const r = spawnSync(
        process.execPath,
        [
            '--conditions=nativescript',
            '--input-type=module',
            '-e',
            `import * as h from '#host';
             delete globalThis.require;
             h.loadNativeHost();`,
        ],
        { cwd: root, encoding: 'utf8' },
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /__non_webpack_require__/);
    assert.match(r.stderr, /globalThis\.require and globalThis\.__nativeRequire/);
});

test('nativescript.webpack.js adds the nativescript condition (and require() hands back the hook)', () => {
    const set = [];
    const hook = createRequire(import.meta.url)('../nativescript.webpack.js');
    assert.equal(typeof hook, 'function');
    hook({ chainWebpack: (fn) => fn({ resolve: { set: (k, v) => set.push([k, v]) } }) });
    assert.deepEqual(set, [['conditionNames', ['nativescript', '...']]]);
});

test('languageFromBcp47 turns platform tags into a LANGUAGE list, C last', () => {
    const out = probe(
        ['--conditions=nativescript'],
        `import * as h from '#host';
         console.log(JSON.stringify([
             h.languageFromBcp47(['de-DE']),
             h.languageFromBcp47(['de-DE', 'en-US', 'de-AT']),
             h.languageFromBcp47(['zh-Hans-CN']),
             h.languageFromBcp47(['es-419']),
             h.languageFromBcp47([]),
         ]))`,
    );
    assert.deepEqual(out, ['de_DE:de:C', 'de_DE:de:en_US:en:de_AT:C', 'zh_CN:zh:C', 'es_419:es:C', 'C']);
});

test('refreshLocale sets LANGUAGE through the platform Os.setenv and honours the override', () => {
    const out = probe(
        ['--conditions=nativescript'],
        `import * as h from '#host';
         const set = {};
         globalThis.android = { system: { Os: { setenv: (k, v) => { set[k] = v; } } } };
         globalThis.java = { util: { Locale: { getDefault: () => ({ toLanguageTag: () => 'de-DE' }) } } };
         const a = h.refreshLocale();
         globalThis.__NODE_GI_LANGUAGE = 'fr';
         const b = h.refreshLocale();
         console.log(JSON.stringify({ a, b, set }))`,
    );
    assert.equal(out.a, 'de_DE:de:C');
    assert.equal(out.b, 'fr');
    assert.equal(out.set.LANGUAGE, 'fr');
});

test('refreshLocale reaches android.system.Os by reflection when the bundle never touched that package', () => {
    const out = probe(
        ['--conditions=nativescript'],
        `import * as h from '#host';
         const set = {};
         const arrays = [];
         const klass = (name) => ({ name });
         globalThis.java = {
             lang: {
                 String: { class: klass('String') },
                 Object: { class: klass('Object') },
                 Class: {
                     class: klass('Class'),
                     forName: (n) => ({ getMethod: (m, types) => ({ invoke: (_o, args) => { set[args[0]] = args[1]; set.__call = [n, m, types.length]; } }) }),
                 },
                 Boolean: { TYPE: klass('boolean'), TRUE: true },
                 reflect: { Array: { newInstance: (_c, n) => { const a = new Array(n); arrays.push(a); return a; }, set: (a, i, v) => { a[i] = v; } } },
             },
             util: { Locale: { getDefault: () => ({ toLanguageTag: () => 'de-DE' }) } },
         };
         h.refreshLocale();
         console.log(JSON.stringify({ set }))`,
    );
    assert.equal(out.set.LANGUAGE, 'de_DE:de:C');
    assert.deepEqual(out.set.__call, ['android.system.Os', 'setenv', 3]);
});
