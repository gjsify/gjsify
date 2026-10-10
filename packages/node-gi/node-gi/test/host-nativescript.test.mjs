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

test('nativescript.webpack.js adds the nativescript condition (and require() hands back the hook)', () => {
    const set = [];
    const hook = createRequire(import.meta.url)('../nativescript.webpack.js');
    assert.equal(typeof hook, 'function');
    hook({ chainWebpack: (fn) => fn({ resolve: { set: (k, v) => set.push([k, v]) } }) });
    assert.deepEqual(set, [['conditionNames', ['nativescript', '...']]]);
});
