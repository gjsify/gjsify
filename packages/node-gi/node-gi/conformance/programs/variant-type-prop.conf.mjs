// SPDX-License-Identifier: MIT
// GVariantType-typed GObject property reads — the GJS boxed-property contract.
//
// Gio.SimpleAction:parameter-type is a GVariantType-typed property (a boxed
// `G_TYPE_VARIANT_TYPE`). GJS surfaces it as:
//   • null                        when unset (the default);
//   • a GLib.VariantType instance when set — `.dup_string()` is the type string.
// node-gi's GValueToJs now marshals a boxed GValue the same way (null on a NULL
// pointer, else a wrapped boxed handle whose L1 wrapper routes the introspected
// GLib.VariantType methods) instead of throwing "Unsupported property GType".
//
// GLib/Gio only (no GIMarshallingTests typelib) so it runs UNCHANGED on all four
// runtimes and its STDOUT must be byte-identical to the gjs golden.
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

// Unset → null, not a throw.
const unset = new Gio.SimpleAction({ name: 'demo' });
print('unset parameterType is null:', unset.parameterType === null);
print('unset parameterType typeof:', typeof unset.parameterType);

// Set via the static ctor taking a GVariantType → reads back a GLib.VariantType.
const single = Gio.SimpleAction.new('single', GLib.VariantType.new('s'));
print('single set typeof:', typeof single.parameterType);
print('single dup_string:', single.parameterType.dup_string());

const tuple = Gio.SimpleAction.new('tuple', GLib.VariantType.new('(si)'));
print('tuple dup_string:', tuple.parameterType.dup_string());

const array = Gio.SimpleAction.new('array', GLib.VariantType.new('ai'));
print('array dup_string:', array.parameterType.dup_string());
// The wrapped handle answers other introspected VariantType methods too.
print('array is_array:', array.parameterType.is_array());
print('single is_array:', single.parameterType.is_array());
