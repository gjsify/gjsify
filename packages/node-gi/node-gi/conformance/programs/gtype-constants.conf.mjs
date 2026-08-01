// SPDX-License-Identifier: MIT
// GObject.TYPE_* fundamental constants — the GJS GObject-override contract, L1.
//
// GJS's GObject override defines the fundamental GType constants by looking each
// name up in libgobject at runtime (refs/gjs/modules/core/overrides/GObject.js
// `_init`: `GObject.TYPE_STRING = GObject.type_from_name('gchararray')`, plus the
// `_makeDummyClass` helper for the numeric/char/gtype family). node-gi resolves
// them the SAME way through the introspected `GObject.type_from_name`, so each is
// the real, process-correct GType.
//
// A GType is an OPAQUE handle (NOT a number) on BOTH runtimes — `typeof` is
// 'object', never 'number'; the ABI-stable `GObject.type_name(gt)` is the only
// scalar printed (the handle's own identity is intentionally NOT compared: GJS
// canonicalises GType objects while node-gi hands back a fresh External per read,
// so `type_from_name('gint') === TYPE_INT` differs by design and would not be
// byte-identical — type_name is the stable, meaningful projection).
import GObject from 'gi://GObject?version=2.0';

// The fundamental set (task list + the standard GLib fundamentals). Order fixed.
const NAMES = [
    'TYPE_NONE',
    'TYPE_INTERFACE',
    'TYPE_CHAR',
    'TYPE_UCHAR',
    'TYPE_BOOLEAN',
    'TYPE_INT',
    'TYPE_UINT',
    'TYPE_LONG',
    'TYPE_ULONG',
    'TYPE_INT64',
    'TYPE_UINT64',
    'TYPE_ENUM',
    'TYPE_FLAGS',
    'TYPE_FLOAT',
    'TYPE_DOUBLE',
    'TYPE_STRING',
    'TYPE_POINTER',
    'TYPE_BOXED',
    'TYPE_PARAM',
    'TYPE_OBJECT',
    'TYPE_VARIANT',
    'TYPE_GTYPE',
];

for (const name of NAMES) {
    const gt = GObject[name];
    print(`${name}: ${GObject.type_name(gt)} typeof=${typeof gt} defined=${gt !== undefined}`);
}

// A GType is never a number (the whole point — matches GJS's opaque GType object).
print('none is a number:', typeof GObject.TYPE_INT === 'number');
// The constant round-trips through type_name → the same registered name.
print('type_name(type_from_name("gint")):', GObject.type_name(GObject.type_from_name('gint')));
// A constant is usable as a GType IN arg (GObject.type_name reads it back).
print('type_name(TYPE_STRING):', GObject.type_name(GObject.TYPE_STRING));
