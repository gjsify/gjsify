// SPDX-License-Identifier: MIT
// Fast single-process probe for the batteries-included GTK runtime (no Homebrew on
// macOS / no gvsbuild on Windows). Reproduces the two paths that need a leaf-soname
// g_module_open to resolve against the bundled native code — which only works once
// node-gi has made the runtime env-free (the DYLD_FALLBACK re-exec on macOS, the
// gtk/bin PATH-prepend on Windows — both in gtk-runtime.js):
//   1. registerClass subclassing — gi_registered_type_info_get_g_type() must call
//      the parent type's get_type() (e.g. g_simple_action_get_type in libgio), the
//      exact path that failed with "… is not a subclassable GObject type".
//   2. the NON-addon-linked backers Pango / Graphene / Gdk — getGType() forces
//      their get_type() resolution via g_module_open(<leaf>).
// Runs in ONE clean process (no test-runner child pool), so a failure here is an
// unambiguous signal that the env-free wiring is broken, independent of any leg.
import { requireNamespace, registerClass, constructType, getGType, getTypeName } from '../index.js';

requireNamespace('GObject', '2.0');
requireNamespace('Gio', '2.0');

// (1) The failing path: subclass an introspected GObject and construct it.
const T = registerClass('NodeGiBatteriesProbe', 'Gio', 'SimpleAction', {});
const inst = constructType(T, { name: 'probe' });
if (getTypeName(inst) !== 'NodeGiBatteriesProbe') {
    throw new Error(`subclass construct returned unexpected type: ${getTypeName(inst)}`);
}

// (2) The windowing backers whose dylib is NOT in the addon's own link closure.
for (const [ns, type] of [
    ['Pango', 'FontDescription'],
    ['Graphene', 'Rect'],
    ['Gdk', 'RGBA'],
]) {
    requireNamespace(ns);
    const g = getGType(ns, type);
    if (g == null) throw new Error(`${ns}.${type}: getGType returned null — leaf g_module_open failed env-free`);
}

console.log(
    'batteries-included probe OK: registerClass(Gio.SimpleAction) + Pango/Graphene/Gdk get_type resolved with no system/Homebrew/gvsbuild GTK',
);
