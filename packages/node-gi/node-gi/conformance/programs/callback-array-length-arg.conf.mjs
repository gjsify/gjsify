// SPDX-License-Identifier: MIT
// A C-invoked JS function (vfunc or callback) receiving a length-annotated C
// array: gjs reads the companion length arg to size the array and does NOT hand
// that length to JS, so later args keep their positions. node-gi's trampoline
// first threw on any container IN arg (#1810: Soup.ServerCallback's GHashTable),
// then read this array as EMPTY — Gio.OutputStream.write returned 0 for 3 bytes,
// the short write write_all() spins on — and passed `count` as an extra arg.
import GObject from 'gi://GObject?version=2.0';
import Gio from 'gi://Gio?version=2.0';

const Sink = GObject.registerClass(
    { GTypeName: 'ConfArrayLengthSink' },
    class extends Gio.OutputStream {
        vfunc_write_fn(buffer, cancellable) {
            print('write_fn argc:', arguments.length);
            print('buffer:', JSON.stringify(Array.from(buffer)));
            print('cancellable is 2nd arg:', cancellable instanceof Gio.Cancellable);
            return buffer.length;
        }
        vfunc_close_fn() {
            return true;
        }
    },
);

const sink = new Sink();
print('write returned:', sink.write(new Uint8Array([7, 8, 9]), new Gio.Cancellable()));
sink.close(null);
