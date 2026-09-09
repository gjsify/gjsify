#!/usr/bin/env -S gjs -m
// The instance methods behind every widget the vocabulary offers, read from the
// installed typelib — plus the ones GJS installs on every GObject that no typelib has.
//
// WHY THIS EXISTS. ADR 0034 converged widget NAMES across the surfaces and is counting
// down PROPERTY names; the ledger that does the counting holds the port's setters against
// `generated/props.ts`. Methods had no such side. Nothing in this repository said which
// verbs a GJS caller can write on `Adw.ToolbarView` — `add_top_bar`, `set_content`,
// `remove` — so a port could name the same operation `addTopBar` for its whole life with
// every gate green, which `@gjsify/adwaita-nativescript` did (ADR 0034 § Amendment 14).
//
// AND THE SPELLING IS NOT FREE. Measured on this machine (`gjs -m`, Gtk 4.22, Adw 1.9):
//
//     Gtk.Button.prototype.add_css_class     function
//     Gtk.Button.prototype.addCssClass       undefined
//     Adw.ToolbarView.prototype.add_top_bar  function
//     Adw.ToolbarView.prototype.addTopBar    undefined
//
// GJS installs the snake_case name and nothing else — properties get a camelCase twin,
// methods do not. So the spelling a port converges TO is the typelib's own, and this
// artifact spells it that way.
//
// WHERE THE NAMES COME FROM, AND WHY NOT THE OTHER TWO PLACES
//
//   · `@girs/<ns>/vocabulary` is where they BELONG, and it does not have them. Measured
//     on the published `@girs/gtk-4.0@4.6.0`: its `gtk-4.0-vocabulary.js` exports
//     PROVENANCE, OWN_PROPS, OWN_SIGNALS, DECLS, CHILD_HOLDERS, ENUM_NICKS,
//     SLOT_CANDIDATES and SINCE — eight names, not one of them a method table.
//     `SLOT_CANDIDATES` is DERIVED from methods (ADR 0029 § 4's one-widget-argument
//     rule) and carries the slot it derived, not the verb. Adding `OWN_METHODS` there is
//     an upstream ts-for-gir change plus a release (`status/open-todos.md`), and when it
//     lands this generator's INPUT changes and its output does not; that is why the
//     artifact's shape is the durable half — the same reason `generate-enum-values.mjs`
//     gives for enum values.
//   · The `.gir` XML has them and is not in this repository, nor reachable from the
//     no-install gate — ADR 0029 § Amendment and ADR 0019 § 2 refuse it, with the
//     measurements.
//   · The installed typelib is the genuinely independent oracle (ADR 0034 § 7.3) and the
//     file GJS itself loads. It costs a GNOME runtime, which this generator has and the
//     `checkout` + `setup-node` gate does not — hence a COMMITTED artifact, read by the
//     gate. The two directions are checked the way the enum values are:
//     `check-vocabulary-alignment.mjs` holds the shape with no install, and gtk-host's
//     `generated.spec.ts` holds every name against whatever GJS is running.
//
// WHY THAT IS SAFE TO COMMIT. A method is API. GTK 4 and libadwaita 1 do not remove one
// inside a major, so a version gap between the machine that generated this and the
// machine that reads it can only ADD names. The runtime spec excuses an absence where
// the host predates the artifact and fails one where it does not.
//
// THE FOURTH TABLE IS NOT FROM THE TYPELIB. `connect`, `disconnect`, `emit` and their
// siblings are installed by GJS on `GObject.Object.prototype` (gi/object.cpp) and appear
// in no `.gir`. They are measured here by SUBTRACTION — every own name of that prototype
// that is not a typelib method, not a JS builtin and not GJS-private — so a GJS release
// that adds one shows up as a diff of this file rather than as a snippet that runs on
// one host and not the other.
//
// Usage: gjs -m scripts/generate-widget-methods.mjs [--check] [--root DIR]
//        --check writes nothing and exits 1 if the committed file is not what this run
//        would write. It needs a GNOME runtime, so it is a maintainer step and not a CI
//        gate; the CI gates are the two named above.

import GIRepository from 'gi://GIRepository?version=3.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import system from 'system';

import { METHODS_FILE, readRuntimeGTypes, WIDGETS_FILE } from './widget-methods.mjs';

const args = system.programArgs;
const rootFlag = args.indexOf('--root');
const CHECK = args.includes('--check');
const ROOT = GLib.canonicalize_filename(
    rootFlag === -1 ? `${GLib.path_get_dirname(import.meta.url.replace('file://', ''))}/..` : args[rootFlag + 1],
    null,
);

function read(path) {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok) throw new Error(`cannot read ${path}`);
    return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------------------
// the typelib side
// ---------------------------------------------------------------------------

// Requiring the two roots the vocabulary is generated for pulls their whole typelib
// dependency closure, and every type is then found by its own GType NAME — the same
// arrangement `generate-enum-values.mjs` explains, and for the same reason: a prefix
// table is a second copy of a list that already drifted once.
const repo = new GIRepository.Repository();
repo.require('Gtk', '4.0', 0);
repo.require('Adw', '1', 0);

/** GType name -> `{ ns, info }` for every class and interface in every loaded typelib. */
const infos = new Map();
for (const ns of repo.get_loaded_namespaces()) {
    for (let i = 0; i < repo.get_n_infos(ns); i++) {
        const info = repo.get_info(ns, i);
        if (!(info instanceof GIRepository.ObjectInfo) && !(info instanceof GIRepository.InterfaceInfo)) continue;
        const gtype = info.get_type_name();
        if (gtype && !infos.has(gtype)) infos.set(gtype, { ns, info });
    }
}

/**
 * The instance methods one type declares itself, in typelib order.
 *
 * `IS_METHOD` only: constructors and static functions are reached as `Gtk.Button.new()`
 * and `Gtk.Widget.get_default_direction()`, never on an instance, and a port has no
 * instance spelling to converge for them. Virtual functions are a separate table in the
 * typelib and are not here either — `vfunc_snapshot` is a subclass author's word, not a
 * caller's.
 */
function ownMethods(info) {
    const out = [];
    for (let i = 0; i < info.get_n_methods(); i++) {
        const method = info.get_method(i);
        if (method.get_flags() & GIRepository.FunctionInfoFlags.IS_METHOD) out.push(method.get_name());
    }
    return out;
}

/**
 * Every ancestor and interface of one class, transitively, nearest first: the parent
 * chain up to `GObject`, then the interfaces each link in it implements, then the
 * prerequisites of those interfaces. De-duplicated in order of first sight, so the
 * union a reader takes over it is the same whichever way it iterates.
 */
function ancestryOf(info) {
    const seen = new Set();
    const out = [];
    const visitInterfaces = (owner) => {
        const n = owner instanceof GIRepository.ObjectInfo ? owner.get_n_interfaces() : owner.get_n_prerequisites();
        for (let i = 0; i < n; i++) {
            const iface = owner instanceof GIRepository.ObjectInfo ? owner.get_interface(i) : owner.get_prerequisite(i);
            const name = iface.get_type_name();
            if (!name || seen.has(name)) continue;
            seen.add(name);
            out.push(name);
            if (iface instanceof GIRepository.InterfaceInfo) visitInterfaces(iface);
        }
    };
    const chain = [];
    for (let parent = info.get_parent(); parent !== null; parent = parent.get_parent()) chain.push(parent);
    for (const parent of chain) {
        const name = parent.get_type_name();
        if (seen.has(name)) continue;
        seen.add(name);
        out.push(name);
    }
    visitInterfaces(info);
    for (const parent of chain) visitInterfaces(parent);
    return out;
}

// ---------------------------------------------------------------------------
// the host side
// ---------------------------------------------------------------------------

/**
 * What GJS installs on every GObject beyond the typelib, by subtraction.
 *
 * The own names of `GObject.Object.prototype` minus the typelib's own methods of
 * `GObject`, minus the two JS builtins every class prototype carries, minus GJS's private
 * members (`_init`, `_construct`, `__metaclass__`). Measured on GJS 1.86 that leaves
 * `connect`, `connect_after`, `connect_object`, `disconnect`, `emit`,
 * `stop_emission_by_name`, `block_signal_handler`, `unblock_signal_handler` and `set` —
 * the multi-property setter, which is here because it IS installed, and which
 * `check-vocabulary-alignment.mjs` names as the false friend it is against NativeScript's
 * `Observable.set(name, value)`.
 */
function hostMethods() {
    const typelib = new Set(ownMethods(infos.get('GObject').info));
    return Object.getOwnPropertyNames(GObject.Object.prototype)
        .filter((name) => typeof GObject.Object.prototype[name] === 'function')
        .filter((name) => !typelib.has(name) && name !== 'constructor' && name !== 'toString' && !name.startsWith('_'))
        .sort();
}

// ---------------------------------------------------------------------------
// collect
// ---------------------------------------------------------------------------

const libraryVersion = {
    Gtk: `${Gtk.get_major_version()}.${Gtk.get_minor_version()}.${Gtk.get_micro_version()}`,
    Adw: `${Adw.get_major_version()}.${Adw.get_minor_version()}.${Adw.get_micro_version()}`,
};

const widgets = readRuntimeGTypes(read(`${ROOT}/${WIDGETS_FILE}`));
const provenanceLine = /^\/\/ Provenance: (.+)$/m.exec(read(`${ROOT}/${WIDGETS_FILE}`))?.[1] ?? '';

const own = new Map();
const ancestry = new Map();
const unavailable = [];
const namespaces = new Set();

for (const gtype of widgets) {
    const found = infos.get(gtype);
    if (!found) {
        // DECLARED, not skipped: the vocabulary can describe a library NEWER than the one
        // installed (ADR 0029 § Amendment), so a widget it names can have no typelib entry
        // on this host. An empty row would read as "no methods"; a missing row would make
        // the gate's "every widget has a chain" rule fail on every host but the newest.
        // So the gap is a row of its own, naming the host that produced it.
        unavailable.push([gtype, `${libraryVersion[gtype.startsWith('Adw') ? 'Adw' : 'Gtk']}`]);
        continue;
    }
    namespaces.add(found.ns);
    const chain = ancestryOf(found.info);
    ancestry.set(gtype, chain);
    for (const name of [gtype, ...chain]) {
        if (own.has(name)) continue;
        const link = infos.get(name);
        if (!link) throw new Error(`${gtype}'s ancestry names ${name}, which no loaded typelib declares`);
        own.set(name, ownMethods(link.info));
    }
}

// ---------------------------------------------------------------------------
// emit
// ---------------------------------------------------------------------------

const quoted = (s) => `'${s.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

/**
 * The repository's formatter width (`.oxfmtrc.json`, `printWidth`), so this file emits the
 * bytes `gjsify format --check` accepts and the two checks over the artifact — the
 * formatter's and this generator's `--check` — agree. Measured both ways before this rule:
 * a packed layout was reflowed one item per line, and one item per line was collapsed back
 * onto one line wherever it fit. oxfmt's rule is the width, so the width is emitted.
 */
const PRINT_WIDTH = 120;

/** An array literal as oxfmt lays it out: one line when the whole line fits, one item per line when not. */
function arrayLiteral(items, prefix, indent) {
    const oneLine = `${prefix}[${items.map(quoted).join(', ')}]`;
    if (oneLine.length + 1 <= PRINT_WIDTH) return oneLine;
    return `${prefix}[\n${items.map((item) => `${indent}    ${quoted(item)},`).join('\n')}\n${indent}]`;
}

/** One `Key: [...]` entry per line, each laid out by {@link arrayLiteral}; the trailing comma counts. */
function arrayRecord(map) {
    const rows = [];
    for (const [key, items] of [...map].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        rows.push(`${arrayLiteral(items, `    ${key}: `, '    ')},`);
    }
    return rows.length === 0 ? '{}' : `{\n${rows.join('\n')}\n}`;
}

// The SAME grammar the vocabulary's provenance line uses — `Gtk-4.0/4.22.4` — so one
// parser reads both, in `generated.spec.ts` and in this file's own header.
const methodsProvenance = [...namespaces]
    .sort()
    .map((ns) => {
        const typelib = `${ns}-${repo.get_version(ns)}`;
        return libraryVersion[ns] ? `${typelib}/${libraryVersion[ns]}` : typelib;
    })
    .join(' ');

const host = hostMethods();

/** `18801` -> `1.88.1`: `system.version` is major * 10000 + minor * 100 + micro. */
const gjsVersion = `${Math.floor(system.version / 10000)}.${Math.floor(system.version / 100) % 100}.${system.version % 100}`;

/** The host list under its own declaration, by the same width rule. */
const hostList = arrayLiteral(host, 'export const GJS_OBJECT_METHODS: readonly string[] = ', '');

const text = `// GENERATED by scripts/generate-widget-methods.mjs — do not edit.
//
// Widgets: ${provenanceLine || WIDGETS_FILE}
// Methods: read from the installed typelib — ${methodsProvenance}
// Host: GJS ${gjsVersion}
//
// Test-only (a \`.mts\` file is outside the library build glob), like
// \`enum-values.mts\` beside it. \`generated.spec.ts\` holds every name here against
// whatever GJS is running; \`scripts/check-vocabulary-alignment.mjs\` reads it with no
// install to hold a port's method names against the GIR, which is the job a committed
// artifact exists to do.
//
// snake_case throughout, because that is the only spelling GJS installs for a method
// (\`Gtk.Button.prototype.addCssClass\` is undefined) — see the generator's header.

/**
 * The libraries these names were read from, in the vocabulary's own provenance grammar
 * so one parser reads both lines.
 *
 * A value, not only a header comment: \`generated.spec.ts\` compares it with the running
 * library to decide whether a missing method is a defect or a version gap.
 */
export const METHODS_PROVENANCE = '${methodsProvenance}';

/**
 * GType -> the instance methods that type declares ITSELF, in typelib order.
 *
 * Every widget of the runtime table has a row, and so does every ancestor and interface
 * \`ANCESTRY\` names, so a union over a chain never stops short. Inherited methods are not
 * repeated: \`AdwActionRow\` lists \`add_prefix\` and not \`add_css_class\`.
 */
export const OWN_METHODS: Readonly<Record<string, readonly string[]>> = ${arrayRecord(own)};

/**
 * Widget GType -> every ancestor and interface a GJS instance of it carries methods
 * from, transitively, nearest first — the parent chain to \`GObject\`, then the
 * interfaces of each link and their prerequisites.
 *
 * Only the runtime table's widgets have a row; a base or an interface has methods in
 * \`OWN_METHODS\` and no chain of its own here.
 */
export const ANCESTRY: Readonly<Record<string, readonly string[]>> = ${arrayRecord(ancestry)};

/**
 * What GJS installs on \`GObject.Object.prototype\` beyond the typelib — measured by
 * subtraction on the generating host, never authored.
 *
 * These are the verbs every GJS snippet writes and no \`.gir\` declares: \`connect\`,
 * \`disconnect\`, \`emit\`. A ledger holding a port against the typelib alone would call
 * them divergences, so they are the fourth table. \`set\` is here because it IS installed
 * (the multi-property setter, \`widget.set({ label })\`), and is the one name in this list
 * that collides with a different contract on NativeScript's \`Observable\`.
 */
${hostList};

/**
 * Widget GType -> the installed library that has no such type.
 *
 * The declared remainder, and the only reason one exists: the vocabulary can describe a
 * library NEWER than the one this file was generated on, so a widget can be real and
 * have no chain here yet. Every widget of the runtime table is in \`ANCESTRY\` or in this
 * table — one in neither is a silent drop, and the gate fails on it. Regenerating on a
 * newer host empties it.
 */
export const METHODS_UNAVAILABLE: Readonly<Record<string, string>> = ${
    unavailable.length === 0
        ? '{}'
        : `{\n${unavailable.map(([gtype, version]) => `    ${gtype}: ${quoted(version)},`).join('\n')}\n}`
};
`;

const target = `${ROOT}/${METHODS_FILE}`;
if (CHECK) {
    let current = null;
    try {
        current = read(target);
    } catch {
        // No file is the same finding as a stale one, reported below.
    }
    if (current === text) {
        console.log(`generate-widget-methods: ${METHODS_FILE} is up to date`);
        system.exit(0);
    }
    console.error(`generate-widget-methods: ${METHODS_FILE} is not what this host would write — regenerate it`);
    system.exit(1);
}

GLib.file_set_contents(target, new TextEncoder().encode(text));
console.log(
    `generate-widget-methods: wrote ${METHODS_FILE} — ${ancestry.size} widget(s), ${own.size} type(s) with ` +
        `${[...own.values()].reduce((n, list) => n + list.length, 0)} own method(s), ${host.length} GJS-installed, ` +
        `${unavailable.length} widget(s) this host predates`,
);
