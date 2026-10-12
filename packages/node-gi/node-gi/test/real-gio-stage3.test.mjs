// SPDX-License-Identifier: MIT
// Core fixes found by running the ADR 0099/0100 conformance vectors on real Gio (ADR 0105 stage 3):
//   (A) Gio.Settings throws where the C API aborts the process (GJS's override, ported);
//   (B) Gio._promisify wraps an override already on the prototype, like GJS;
//   (C) Gio._promisify refuses a missing async or finish method at the call;
//   (D) a registration on a base class reaches the thunks a subclass prototype materialised;
//   (E) an async call keeps its IN array alive until the operation completes.
//
// Reference: refs/gjs/modules/core/overrides/Gio.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { requireGi } from '../gi.js';

const GLib = requireGi('GLib', '2.0');
const Gio = requireGi('Gio', '2.0');

const dir = mkdtempSync(join(tmpdir(), 'node-gi-stage3-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const SCHEMA = `<schemalist><schema id="test.stage3" path="/test/stage3/">
  <key name="count" type="u"><default>1</default></key>
  <key name="size" type="i"><default>3</default></key>
</schema></schemalist>`;

let compiled = false;
function compileSchema() {
    if (compiled) return true;
    writeFileSync(join(dir, 'test.stage3.gschema.xml'), SCHEMA);
    const out = spawnSync('glib-compile-schemas', [dir]);
    if (out.status !== 0) return false;
    GLib.setenv('GSETTINGS_SCHEMA_DIR', dir, true);
    GLib.setenv('GSETTINGS_BACKEND', 'memory', true);
    return (compiled = true);
}

test('Gio.Settings throws instead of aborting on an unknown key or schema', (t) => {
    if (!compileSchema()) return t.skip('glib-compile-schemas is not installed');
    const settings = new Gio.Settings({ schema_id: 'test.stage3' });
    assert.ok(settings instanceof Gio.Settings);
    assert.equal(settings.get_uint('count'), 1);
    assert.throws(() => settings.get_int('nope'), /GSettings key nope not found in schema test\.stage3/);
    assert.throws(() => new Gio.Settings({ schema_id: 'no.such' }), /GSettings schema no\.such not found/);
    assert.throws(() => settings.set_uint('count', -1), /out of range for uint32/);
    assert.throws(() => settings.set_int('size', 2 ** 31), /out of range for int32/);
    settings.set_uint('count', 5);
    assert.equal(settings.get_uint('count'), 5);
});

test('Gio._promisify drives a function already on the prototype', async () => {
    class Fake {}
    const calls = [];
    Fake.prototype.work_async = function (value, callback) {
        calls.push(value);
        callback(this, { value });
    };
    Fake.prototype.work_finish = (result) => [true, result.value * 2];
    Gio._promisify(Fake.prototype, 'work_async', 'work_finish');
    assert.deepEqual(await new Fake().work_async(21), [42]);
    assert.deepEqual(calls, [21]);
});

test('Gio._promisify throws at the call for a missing async or finish method', () => {
    assert.throws(() => Gio._promisify(Gio.File.prototype, 'nope_async', 'nope_finish'));
    assert.throws(() => Gio._promisify(Gio.File.prototype, 'load_contents_async', 'nope_finish'));
});

test('a base-class _promisify reaches the subclass instances, and the contents of an async write survive', async () => {
    Gio._promisify(Gio.File.prototype, 'replace_async', 'replace_finish');
    Gio._promisify(Gio.OutputStream.prototype, 'close_async', 'close_finish');
    const path = join(dir, 'out.txt');
    const file = Gio.File.new_for_path(path);
    const done = new Promise((resolve, reject) => {
        file.replace_contents_async(new TextEncoder().encode('first version'), null, false, 0, null, (_s, r) => {
            try {
                resolve(file.replace_contents_finish(r));
            } catch (error) {
                reject(error);
            }
        });
    });
    for (let i = 0; i < 200 && !(existsSync(path) && readFileSync(path, 'utf8') === 'first version'); i++) {
        GLib.MainContext.default().iteration(false);
        await new Promise((r) => setImmediate(r));
    }
    await done;
    assert.equal(readFileSync(path, 'utf8'), 'first version');

    const stream = file.replace(null, false, 0, null);
    const closing = stream.close_async(GLib.PRIORITY_DEFAULT, null);
    assert.ok(closing instanceof Promise, 'a FileOutputStream sees the OutputStream registration');
    for (let i = 0; i < 200 && !stream.is_closed(); i++) {
        GLib.MainContext.default().iteration(false);
        await new Promise((r) => setImmediate(r));
    }
    assert.equal(await closing, true);
});

test('Gio.Settings accepts a settings_schema looked up in an explicit source', (t) => {
    if (!compileSchema()) return t.skip('glib-compile-schemas is not installed');
    const source = Gio.SettingsSchemaSource.new_from_directory(dir, null, false);
    const schema = source.lookup('test.stage3', false);
    const settings = new Gio.Settings({ settings_schema: schema });
    assert.equal(settings.schema_id, 'test.stage3');
    assert.equal(settings.get_int('size'), 3);
    assert.throws(() => new Gio.Settings({ settings_schema: {} }), /is not of type Gio\.SettingsSchema/);
});
