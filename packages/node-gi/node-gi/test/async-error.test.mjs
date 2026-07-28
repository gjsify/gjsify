// SPDX-License-Identifier: MIT
// GError-as-GLib.Error + Gio._promisify for @gjsify/node-gi.
//
// (A) A failing SYNC GI invoke throws a real `GLib.Error` (instanceof, carrying
//     `.domain`/`.code`/`.message` + a working `.matches(domain, code)`), mirroring
//     GJS's GError surfacing — not the old plain Error.
// (B) `Gio._promisify(proto, asyncName, finishName)` turns an async method into one
//     that returns a Promise when called without a trailing callback: it resolves
//     with the finish method's OUT-param tuple, or rejects with a GLib.Error. The
//     async completion fires on the GLib main loop (the libuv↔GLib bridge), so the
//     tests drive an explicit GLib.MainLoop.
//
// Reference: refs/gjs/modules/core/overrides/Gio.js (_promisify) +
// refs/gjs/gi/gerror.cpp (the GLib.Error surface).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { requireGi } from '../gi.js';

// Drive the GLib main loop until `promise` settles. The GAsyncReadyCallback fires
// synchronously during loop dispatch (resolving/rejecting the promise), but a
// promise reaction queued inside a blocking nested run() does not drain until
// run() returns (node-gtk #442). So pump the loop in short bursts and `await`
// between them: each burst lets the GLib op complete, and the await drains the
// `.then` that flips `settled`. Exits as soon as the promise has settled; the
// iteration cap is a backstop, not the normal exit.
async function settleViaLoop(GLib, promise) {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  for (let i = 0; i < 200 && !settled; i++) {
    const loop = GLib.MainLoop.new(null, false);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 25, () => {
      loop.quit();
      return false; // G_SOURCE_REMOVE
    });
    loop.run();
    await Promise.resolve(); // drain the deferred `.then` (flips `settled`)
  }
}

test('a failing sync GI call throws a real GLib.Error (not a plain Error)', () => {
  const Gio = requireGi('Gio', '2.0');
  const GLib = requireGi('GLib', '2.0');

  const missing = `/nonexistent-node-gi-${process.pid}-${Date.now()}`;
  const file = Gio.File.new_for_path(missing);

  let caught = null;
  try {
    // g_file_load_contents() fails with G_IO_ERROR_NOT_FOUND for a missing path.
    file.load_contents(null);
  } catch (error) {
    caught = error;
  }

  assert.ok(caught !== null, 'load_contents on a missing path should throw');
  assert.ok(caught instanceof GLib.Error, 'thrown value is a GLib.Error');
  assert.ok(caught instanceof Error, 'GLib.Error is a real Error subclass');
  // .domain / .code / .message read off the GError before it was freed.
  assert.equal(caught.domain, 'g-io-error-quark');
  assert.equal(caught.code, Gio.IOErrorEnum.NOT_FOUND);
  assert.equal(typeof caught.message, 'string');
  assert.ok(caught.message.length > 0);

  // matches(): true for the right domain + code; false for a wrong code or an
  // unrelated domain.
  assert.equal(caught.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND), true);
  assert.equal(caught.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS), false);
  assert.equal(caught.matches(GLib.FileError, GLib.FileError.NOENT), false);
  // matches() also accepts the domain as a name string / numeric quark.
  assert.equal(caught.matches('g-io-error-quark', Gio.IOErrorEnum.NOT_FOUND), true);
  assert.equal(caught.matches(caught.domainQuark, Gio.IOErrorEnum.NOT_FOUND), true);
});

test('Gio._promisify: load_contents_async resolves with the GJS-shaped result', async () => {
  const Gio = requireGi('Gio', '2.0');
  const GLib = requireGi('GLib', '2.0');

  // Replaces Gio.File.prototype.load_contents_async (introspected-class proto).
  Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

  const dir = mkdtempSync(join(tmpdir(), 'node-gi-async-'));
  const path = join(dir, 'data.txt');
  const content = 'hello node-gi async\n';
  writeFileSync(path, content);

  try {
    const file = Gio.File.new_for_path(path);
    // No trailing callback → a Promise. Real signature is (cancellable[, cb]).
    const promise = file.load_contents_async(null);
    assert.ok(promise instanceof Promise, 'returns a Promise without a callback');

    await settleViaLoop(GLib, promise);

    // load_contents_finish returns [true, contents, etag]; like GJS, _promisify
    // drops the leading `true`, so the resolved value is [contents, etag] and the
    // first element is the file bytes (identical to GJS `const [contents] = …`).
    const [contents] = await promise;
    assert.equal(Buffer.from(contents).toString('utf8'), content);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Gio._promisify: rejects with a GLib.Error for a missing file', async () => {
  const Gio = requireGi('Gio', '2.0');
  const GLib = requireGi('GLib', '2.0');

  Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

  const missing = `/nonexistent-node-gi-${process.pid}-${Date.now()}`;
  const file = Gio.File.new_for_path(missing);
  const promise = file.load_contents_async(null);
  // Don't leave the rejection unhandled while the loop runs.
  promise.catch(() => {});

  await settleViaLoop(GLib, promise);

  let caught = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof GLib.Error, 'rejection is a GLib.Error');
  assert.equal(caught.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND), true);
});

test('Gio._promisify: a trailing callback keeps the plain (non-Promise) behavior', () => {
  const Gio = requireGi('Gio', '2.0');
  const GLib = requireGi('GLib', '2.0');

  Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

  const dir = mkdtempSync(join(tmpdir(), 'node-gi-async-cb-'));
  const path = join(dir, 'data.txt');
  const content = 'callback path\n';
  writeFileSync(path, content);

  try {
    const file = Gio.File.new_for_path(path);
    const loop = GLib.MainLoop.new(null, false);
    let bytes = null;
    // WITH a trailing GAsyncReadyCallback → no Promise; the caller finishes it.
    const ret = file.load_contents_async(null, (source, result) => {
      const [ok, data] = source.load_contents_finish(result);
      assert.equal(ok, true);
      bytes = data;
      loop.quit();
    });
    assert.equal(ret, undefined, 'no Promise is returned when a callback is given');
    const deadline = Date.now() + 5000;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
      if (bytes !== null || Date.now() >= deadline) {
        loop.quit();
        return false;
      }
      return true;
    });
    loop.run();
    assert.ok(bytes !== null, 'the supplied callback ran');
    assert.equal(Buffer.from(bytes).toString('utf8'), content);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Gio._promisify: same method name on two classes resolves per-class', async () => {
  const Gio = requireGi('Gio', '2.0');
  const GLib = requireGi('GLib', '2.0');

  // Register load_contents_async on Gio.File FIRST (its real finish), then on an
  // UNRELATED class with a BOGUS finish. The File registration is no longer last,
  // so a correct read proves the instance resolved its OWN class's registration
  // (native.isInstanceOf), not a naive fallback-to-last (which would pick the
  // bogus finish and throw).
  Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
  Gio._promisify(Gio.Cancellable.prototype, 'load_contents_async', 'nonexistent_finish');

  const dir = mkdtempSync(join(tmpdir(), 'node-gi-async-multi-'));
  const path = join(dir, 'data.txt');
  const content = 'per-class routing\n';
  writeFileSync(path, content);

  try {
    const file = Gio.File.new_for_path(path);
    const promise = file.load_contents_async(null);
    await settleViaLoop(GLib, promise);
    const [contents] = await promise;
    assert.equal(Buffer.from(contents).toString('utf8'), content);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
