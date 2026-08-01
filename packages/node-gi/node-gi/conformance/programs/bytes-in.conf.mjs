// SPDX-License-Identifier: MIT
// Uint8Array → GLib.Bytes IN marshalling: a JS typed array passed where a GI
// function expects a GBytes is copied into a fresh GBytes, exactly as gjs
// (gi/arg-cache.cpp GBytesIn::in → gjs_byte_array_get_bytes → g_bytes_new).
// Exercises a pure borrow (g_compute_checksum_for_bytes), an OFFSET subarray
// view (only the view's slice marshals), and a callee that KEEPS the bytes
// (GdkPixbuf.Pixbuf.new_from_bytes) — the pixels read back identically after
// the engine drops its own transfer-none ref. The golden is the gjs output.
import GLib from 'gi://GLib?version=2.0';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';

const data = new Uint8Array([1, 2, 3, 4, 255, 0, 128, 64]);
print('sha256:', GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, data));

// A subarray view with a byte offset marshals ONLY its slice.
const tail = data.subarray(4);
print('sha256 tail:', GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, tail));

// An explicit GLib.Bytes handle keeps working alongside the typed-array path.
const boxed = GLib.Bytes.new([1, 2, 3, 4, 255, 0, 128, 64]);
print(
    'sha256 boxed equal:',
    GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, boxed) ===
        GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, data),
);

// A callee that keeps the GBytes: 2×1 RGBA pixbuf round-trips byte-for-byte.
const px = new Uint8Array([10, 20, 30, 255, 200, 100, 50, 128]);
const pixbuf = GdkPixbuf.Pixbuf.new_from_bytes(px, GdkPixbuf.Colorspace.RGB, true, 8, 2, 1, 8);
print('pixbuf:', pixbuf.get_width(), pixbuf.get_height(), pixbuf.get_n_channels());
print('pixels:', Array.from(pixbuf.read_pixel_bytes().toArray()).join(','));
