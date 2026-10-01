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
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireNamespace, registerClass, constructType, getGType, getTypeName } from '../index.js';
import { resolveGtkRuntimeBundle } from '../gtk-runtime.js';

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

// (3) libgda, when the bundle carries it (darwin): a real SQLite round trip, because loading the
// `Gda` typelib proves nothing about the PROVIDER — libgda finds that one as a GModule in a
// directory compiled in as the build prefix, and `new_from_string('SQLite', …)` is where a
// bundle without it (or with the keg's, beside the bundle's own libgda) dies.
let gda = 'skipped (bundle carries no libgda)';
const bundle = resolveGtkRuntimeBundle();
if (bundle && existsSync(join(bundle.dir, 'lib', 'libgda-6.0', 'providers'))) {
    const { default: requireGi } = await import('../gi.js');
    const Gda = requireGi('Gda', '6.0');
    const dir = mkdtempSync(join(tmpdir(), 'node-gi-gda-'));
    try {
        const cnc = Gda.Connection.new_from_string(
            'SQLite',
            `DB_DIR=${dir};DB_NAME=probe`,
            null,
            Gda.ConnectionOptions.NONE,
        );
        cnc.open();
        cnc.execute_non_select_command('CREATE TABLE t(id INTEGER, name TEXT)');
        cnc.execute_non_select_command("INSERT INTO t VALUES (1, 'ada')");
        const [stmt] = cnc.create_parser().parse_string('SELECT id, name FROM t', null);
        const model = cnc.statement_execute_select(stmt, null);
        const row = [model.get_value_at(0, 0), model.get_value_at(1, 0)];
        cnc.close();
        if (row[0] !== 1 || row[1] !== 'ada') throw new Error(`Gda SQLite round trip read back ${JSON.stringify(row)}`);
        gda = 'SQLite round trip through the bundled libgda provider';
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

console.log(
    `batteries-included probe OK: registerClass(Gio.SimpleAction) + Pango/Graphene/Gdk get_type resolved with no system/Homebrew/gvsbuild GTK; Gda: ${gda}`,
);
