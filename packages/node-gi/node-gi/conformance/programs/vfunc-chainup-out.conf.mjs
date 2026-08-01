// SPDX-License-Identifier: MIT
// vfunc chain-up with an OUT parameter, via headless Gio (no test typelib needed).
// A registered subclass overrides `Gio.TlsPassword.get_value` and chains up with
// `super.vfunc_get_value()`; the C parent default writes the stored byte count into
// the OUT `length` slot (the return array's length-index) and returns the value
// bytes. The OUT-carried value must flow back as a Uint8Array — the single-value
// return tuple. The golden is the gjs output; node/bun/deno must match it
// byte-for-byte, proving the ffi_call OUT-slot marshalling matches GJS exactly.
import GObject from 'gi://GObject?version=2.0';
import Gio from 'gi://Gio?version=2.0';

const Klass = GObject.registerClass(
    { GTypeName: 'ConfChainOutValue' },
    class extends Gio.TlsPassword {
        vfunc_get_value() {
            // Chain up to the C default; it fills the OUT length + returns the bytes.
            return super.vfunc_get_value();
        }
    },
);

const pw = new Klass({ flags: 0, description: 'secret' });

// First value: the OUT length slot is written by the parent, the byte array read back.
pw.set_value(new Uint8Array([104, 105])); // "hi"
const bytes = pw.vfunc_get_value();
print('is uint8array:', bytes instanceof Uint8Array);
print('bytes:', JSON.stringify(Array.from(bytes)));
print('length:', bytes.length);

// A second, longer value proves the OUT length slot is re-read per call (not cached),
// and that the array is sized from the freshly-written count.
pw.set_value(new Uint8Array([1, 2, 3, 4, 5]));
const bytes2 = pw.vfunc_get_value();
print('bytes2:', JSON.stringify(Array.from(bytes2)));
print('length2:', bytes2.length);
