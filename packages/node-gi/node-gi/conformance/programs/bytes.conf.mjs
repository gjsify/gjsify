// SPDX-License-Identifier: MIT
// GLib.Bytes fast-path (phase 2.7b) via headless GLib (no test typelib needed).
// `GLib.Bytes.new(array | string)` builds a GBytes; `.toArray()` reads it back as
// a byte array (a Node Buffer on node-gi, a Uint8Array on gjs — spread to a plain
// array so the printed form is identical); `.get_size()` / `.get_data()` round
// trip; and a string is UTF-8 encoded. The golden is the gjs output.
import GLib from 'gi://GLib?version=2.0';

const bytes = GLib.Bytes.new([0, 49, 255, 51]);
print('size:', bytes.get_size());
print('toArray:', JSON.stringify([...bytes.toArray()]));
print('get_data:', JSON.stringify([...bytes.get_data()]));

// A GBytes built from a string is UTF-8 encoded (the ♥ is 3 bytes).
const utf8 = GLib.Bytes.new('const ♥ utf8');
print('utf8 size:', utf8.get_size());
print('utf8 bytes:', JSON.stringify([...utf8.toArray()]));

// An empty GBytes.
const empty = GLib.Bytes.new([]);
print('empty size:', empty.get_size());
print('empty toArray:', JSON.stringify([...empty.toArray()]));
