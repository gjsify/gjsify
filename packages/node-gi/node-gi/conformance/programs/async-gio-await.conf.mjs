// SPDX-License-Identifier: MIT
// The NON-blocking async case: GLib/Gio async work awaited at top level with NO
// explicit mainloop anywhere. Under gjs the GLib loop is the process loop, so
// the module-evaluation promise settles as sources dispatch; under node the
// uv-driven auto-pump (src/loop.cc) must produce the identical behavior — a
// pending GLib timeout, a GLib idle, and a Gio async completion (a GTask worker
// thread signalling the context's wakeup) each settle a top-level await, in
// order, and the process then exits on its own. The golden is the gjs output.
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';

print('start');

// 1. A GLib timeout resolving a top-level await (no loop.run() anywhere).
const timed = await new Promise((resolve) => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 25, () => {
        resolve('timeout-fired');
        return false;
    });
});
print('await timeout:', timed);

// 2. A GLib idle resolving a top-level await.
const idled = await new Promise((resolve) => {
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        resolve('idle-fired');
        return false;
    });
});
print('await idle:', idled);

// 3. A Gio async op (GTask thread-pool completion) resolving a top-level await.
// /dev/null reads deterministically as zero bytes on every runtime.
const file = Gio.File.new_for_path('/dev/null');
const [ok, contents] = await new Promise((resolve, reject) => {
    file.load_contents_async(null, (_source, res) => {
        try {
            resolve(file.load_contents_finish(res));
        } catch (error) {
            reject(error);
        }
    });
});
print('await gio: ok', ok, 'bytes', contents.length);

print('done');
