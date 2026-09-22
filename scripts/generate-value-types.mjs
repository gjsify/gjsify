#!/usr/bin/env -S gjs -m
// What the installed typelib says about every member the vocabulary excuses as a VALUE
// rather than a widget.
//
// WHY THIS EXISTS. ADR 0034 § Amendment 19 let a clause-2 namespace carry a constructible
// non-widget GObject — `new Gio.Menu()` — so `check-vocabulary-alignment.mjs` needed a
// second answer about two questions it cannot ask itself: does the GIR declare this type
// at all, and is it REALLY not a widget. That gate runs in a job with no install and no
// GNOME runtime (`.github/workflows/audit-runtimes.yml`), so the answers are read here,
// where the typelib is, and committed — the arrangement `generate-enum-values.mjs` and
// `generate-widget-methods.mjs` already set, and the reasoning for it is written out in
// `scripts/value-types.mjs`.
//
// THE DIRECTION THAT MATTERS is `widget`. A ledger of exemptions is only safe while
// nothing a port ships as a widget can hide in it, and "is it a widget" is a fact of the
// GIR, not of the ports: `GtkButton`'s parent chain reaches `GtkWidget` and `GMenu`'s
// does not. Reading it from the ports instead would make the exemption table the second
// place a widget is declared, which is what the rule it excuses exists to prevent.
//
// The parent chain is walked through the typelib's own `ObjectInfo.get_parent()` rather
// than through `GObject.type_is_a`, so the question is answered about the DECLARATION —
// the same source the gate's ledger is about — and no type has to be instantiated or
// registered for it.
//
// Usage: gjs -m scripts/generate-value-types.mjs [--check] [--root DIR]
//        --check writes nothing and exits 1 if the committed file is not what this run
//        would write. It needs a GNOME runtime, so it is a maintainer step and not a CI
//        gate; the CI gate is `check-vocabulary-alignment.mjs` over the committed file,
//        and gtk-host's `generated.spec.ts` is the runtime half.

import GIRepository from 'gi://GIRepository?version=3.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import system from 'system';

import { CONSTRUCTIBLE_VALUES, splitMember, VALUE_TYPES_FILE } from './value-types.mjs';

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

// The two roots the vocabulary is generated for, required for their whole typelib
// dependency CLOSURE — `Gio` arrives with them and needs no `require` of its own
// (measured: `repo.get_loaded_namespaces()` lists it). A ledger namespace outside that
// closure fails below by name rather than silently reading as undeclared.
const repo = new GIRepository.Repository();
repo.require('Gtk', '4.0', 0);
repo.require('Adw', '1', 0);
const loaded = new Set(repo.get_loaded_namespaces());

/** The GType names of one class's ancestors, nearest first. */
function ancestryOf(info) {
    const out = [];
    for (let parent = info.get_parent(); parent !== null; parent = parent.get_parent()) {
        out.push(parent.get_type_name());
    }
    return out;
}

const declared = [];
const undeclared = [];
const namespaces = new Set(['Gtk']);

for (const entry of CONSTRUCTIBLE_VALUES) {
    const { namespace } = splitMember(entry.member);
    if (!loaded.has(namespace)) {
        throw new Error(
            `${entry.member} names the \`${namespace}\` namespace, which requiring Gtk and Adw does not load. ` +
                'Require it here, or the row would read as "the GIR declares no such type" about a typelib ' +
                'nobody asked for.',
        );
    }
    namespaces.add(namespace);
    const info = repo.find_by_name(namespace, entry.gir);
    if (info === null || !(info instanceof GIRepository.ObjectInfo)) {
        // DECLARED, not skipped, and one row for both shapes: a name the namespace does not
        // carry and a name that is not a GObject are the same finding for a ledger whose
        // entries are all "a GObject you construct", and the gate asks one question of it.
        undeclared.push([entry.member, `${namespace}-${repo.get_version(namespace)}`]);
        continue;
    }
    declared.push([entry.member, info.get_type_name(), ancestryOf(info).includes('GtkWidget')]);
}

declared.sort((a, b) => (a[0] < b[0] ? -1 : 1));
undeclared.sort((a, b) => (a[0] < b[0] ? -1 : 1));

const quoted = (s) => `'${s.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

const libraryVersion = {
    Gtk: `${Gtk.get_major_version()}.${Gtk.get_minor_version()}.${Gtk.get_micro_version()}`,
    Adw: `${Adw.get_major_version()}.${Adw.get_minor_version()}.${Adw.get_micro_version()}`,
};

// The SAME grammar `generated/methods.mts` and the vocabulary's own provenance line use —
// `Gtk-4.0/4.22.4` — so one parser reads all three. A namespace with no version call of
// its own (`Gio`) carries the typelib version alone.
const provenance = [...namespaces]
    .sort()
    .map((ns) => {
        const typelib = `${ns}-${repo.get_version(ns)}`;
        return libraryVersion[ns] ? `${typelib}/${libraryVersion[ns]}` : typelib;
    })
    .join(' ');

const record = (rows) => (rows.length === 0 ? '{}' : `{\n${rows.join('\n')}\n}`);

const text = `// GENERATED by scripts/generate-value-types.mjs — do not edit.
//
// Read from the installed typelib — ${provenance}
//
// Test-only (a \`.mts\` file is outside the library build glob), like \`enum-values.mts\`
// and \`methods.mts\` beside it. \`generated.spec.ts\` holds every row here against whatever
// GJS is running; \`scripts/check-vocabulary-alignment.mjs\` reads it with no install to
// decide whether a namespace member that is not a widget may be excused as a value, which
// is the job a committed artifact exists to do.

/**
 * The libraries these rows were read from, in the same provenance grammar
 * \`methods.mts\` uses so one parser reads both lines.
 */
export const VALUE_TYPES_PROVENANCE = '${provenance}';

/**
 * \`<Namespace>.<Member>\` -> what the typelib says that type is.
 *
 * One row per entry of \`CONSTRUCTIBLE_VALUES\` in \`scripts/value-types.mjs\`: the ledger is
 * the INPUT, this is the answer. \`gtype\` is the GType the class registers; \`widget\` is
 * whether its declared parent chain reaches \`GtkWidget\`, and a \`true\` here is the
 * finding the whole ledger is guarded for — a widget excused as a value would be the
 * second place a widget is declared.
 */
export const VALUE_TYPES: Readonly<Record<string, { gtype: string; widget: boolean }>> = ${record(
    declared.map(([member, gtype, widget]) => `    ${quoted(member)}: { gtype: ${quoted(gtype)}, widget: ${widget} },`),
)};

/**
 * \`<Namespace>.<Member>\` -> the loaded typelib that declares no such GObject.
 *
 * The declared remainder, so "every ledger entry has an answer" can be a rule rather than
 * a hope: a member in NEITHER table is a ledger the artifact predates, and the gate says
 * so instead of passing over it. An entry here is a ledger entry that is simply wrong —
 * unlike the sibling artifacts' remainders, it cannot be a version gap, because nothing
 * in this repository may excuse a member whose type the installed GIR has never heard of.
 */
export const VALUE_TYPES_UNDECLARED: Readonly<Record<string, string>> = ${record(
    undeclared.map(([member, where]) => `    ${quoted(member)}: ${quoted(where)},`),
)};
`;

const target = `${ROOT}/${VALUE_TYPES_FILE}`;
if (CHECK) {
    let current = null;
    try {
        current = read(target);
    } catch {
        // No file is the same finding as a stale one, reported below.
    }
    if (current === text) {
        console.log(`generate-value-types: ${VALUE_TYPES_FILE} is up to date`);
        system.exit(0);
    }
    console.error(`generate-value-types: ${VALUE_TYPES_FILE} is not what this host would write — regenerate it`);
    system.exit(1);
}

if (!GLib.file_set_contents(target, new TextEncoder().encode(text))) throw new Error(`cannot write ${target}`);
console.log(
    `generate-value-types: wrote ${VALUE_TYPES_FILE} — ${declared.length} declared value type(s), ` +
        `${declared.filter(([, , widget]) => widget).length} of them a widget, ` +
        `${undeclared.length} the GIR declares no GObject for; read from ${provenance}`,
);
