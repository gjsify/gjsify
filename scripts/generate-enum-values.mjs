#!/usr/bin/env -S gjs -m
// The integer behind every enum nick the widget vocabulary offers, read from the
// installed typelib.
//
// WHY THIS EXISTS. `@girs/<ns>/vocabulary` gives the repository `ENUM_NICKS` — the
// NAMES a GIR enum registers, in declaration order — and gtk-host emits them into
// `generated/surface-data.mts` and as nick unions in `generated/props.ts`. Neither
// carries a NUMBER. A surface with no GI has to hand GTK an integer anyway (a snippet
// ported off GJS writes `Gtk.Align.CENTER`, and on NativeScript there is no typelib to
// resolve it), and the obvious derivation — count the position in the nick list — is
// WRONG on 6 of the 129 enums in the vocabulary. Measured 2026-09-05, gtk 4.22.4:
//
//   GtkAlign               baseline=4 and baseline-center=5 sit at positions 5 and 6,
//                          because GTK 4.12 deprecated GTK_ALIGN_BASELINE into an ALIAS
//                          of GTK_ALIGN_BASELINE_FILL and the two share one value
//   GtkConstraintRelation  le=-1 eq=0 ge=1
//   GtkOrdering            smaller=-1 equal=0 larger=1
//   GtkResponseType        none=-1 down to help=-11
//   GtkTextWindowType      widget=1 … bottom=6 — position 0 is not a member
//   GtkConstraintStrength  required=1001001000 strong=1000000000 medium=1000 weak=1
//
// The last one is the reason "off by one" is the wrong mental model: counting answers
// 0 where the library means 1001001000.
//
// A SEVENTH enum disagrees with counting on this host and says nothing about GTK:
// GtkEditableProperties.num-properties is 8 against position 10, because the vocabulary
// describes a GTK newer than the installed one and its two unvalued nicks shift every
// position after them. `check-enum-values.mjs` prints that apart from the six and
// guards on the six alone — an enum that disagrees whether the numbers were read or
// invented cannot witness that they were read.
//
// WHERE THE NUMBERS COME FROM, AND WHY NOT THE OTHER TWO PLACES
//
//   · `@girs/<ns>/vocabulary` is where they BELONG, and it does not have them.
//     Measured on the published `@girs/gtk-4.0@4.6.0` tarball: its
//     `gtk-4.0-vocabulary.js` exports PROVENANCE, OWN_PROPS, OWN_SIGNALS, DECLS,
//     CHILD_HOLDERS, ENUM_NICKS, SLOT_CANDIDATES and SINCE — eight names, not one of
//     them a number. Adding ENUM_VALUES there is an upstream ts-for-gir change plus a
//     release, and when it lands this generator's INPUT changes and its output does
//     not; that is why the artifact's shape is the durable half.
//   · The `.gir` XML has them (`<member value="4" glib:nick="baseline">`) and is not
//     in this repository, nor reachable from it. It is a build artefact of the GTK
//     BUILD rather than a file in GTK's source tree, so none of the 95 `refs/`
//     submodules carries one; ADR 0029 § Amendment already states it as a distro
//     artefact "that is not in this repository and should not be", and ADR 0019 § 2
//     refuses to ship it inside `@girs/*`. The measurement behind that refusal: 8.4 MB
//     for the `Gtk-4.0.gir` in org.gnome.Sdk/50 on this machine, 379 MB across a full
//     pool (ADR 0034 § 7). And no `refs/` submodule is checked out in the gate job
//     either — one is, by name, and realizing them all costs ~150 GB.
//   · The installed typelib is the genuinely independent oracle (ADR 0034 § 7.3), it
//     is the file GJS itself loads, and it is already what `generated.spec.ts` holds
//     the nicks against. It costs a GNOME runtime, which this generator has and the
//     no-install gate does not — hence a COMMITTED artifact, read by the gate.
//
// WHY THAT IS SAFE TO COMMIT. An enum value is ABI. GTK 4 cannot renumber `GtkAlign`
// without breaking every compiled caller, so a version gap between the machine that
// generated this and the machine that reads it can only ADD members, never move one.
// That is what makes a machine-read number a fact about the library rather than about
// the machine — and the two directions are checked: `check-enum-values.mjs` holds the
// shape with no install, `generated.spec.ts` holds every number against whatever
// typelib is running.
//
// The nick lists are READ from `surface-data.mts` rather than re-derived from the
// typelib. The nick spelling is the vocabulary's (`baseline_fill` -> `baseline-fill`),
// and deriving it a second time here would be a second copy of a transform ADR 0029
// moved out of this repository on purpose.
//
// Usage: gjs -m scripts/generate-enum-values.mjs [--check] [--root DIR]
//        --check writes nothing and exits 1 if the committed file is not what this
//        run would write. It needs a GNOME runtime, so it is a maintainer step and
//        not a CI gate; the CI gates are the two named above.

import GIRepository from 'gi://GIRepository?version=3.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import Pango from 'gi://Pango?version=1.0';
import system from 'system';

import { ENUM_VALUES_FILE, entryKey, readNickLists, SURFACE_DATA } from './enum-values.mjs';

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
// dependency closure, and every enum is then found by its own GType NAME. No
// prefix-to-namespace table: `props.ts` needs one because it reaches enums through
// imported JS namespace objects, and its own comment records that a second copy of
// that list is how Pango came to be missing once already. Here the typelib answers
// the question directly, so there is no list to keep in step.
const repo = new GIRepository.Repository();
repo.require('Gtk', '4.0', 0);
repo.require('Adw', '1', 0);

const enumInfos = new Map();
for (const ns of repo.get_loaded_namespaces()) {
    for (let i = 0; i < repo.get_n_infos(ns); i++) {
        const info = repo.get_info(ns, i);
        if (!(info instanceof GIRepository.EnumInfo)) continue;
        const gtype = info.get_type_name();
        if (gtype && !enumInfos.has(gtype)) enumInfos.set(gtype, { ns, info });
    }
}

/**
 * The running library version per namespace, for the provenance line and for naming
 * the library in a skew entry.
 *
 * Three entries because three namespaces declare the enums the vocabulary carries
 * (102 Gtk, 25 Adw, 2 Pango) — a namespace this does not know still emits its values
 * and prints bare in the provenance, because a version is documentation here and the
 * numbers are the artifact. `generated.spec.ts` keeps the same two-entry map for the
 * same reason one directory over.
 */
const libraryVersion = {
    Gtk: `${Gtk.get_major_version()}.${Gtk.get_minor_version()}.${Gtk.get_micro_version()}`,
    Adw: `${Adw.get_major_version()}.${Adw.get_minor_version()}.${Adw.get_micro_version()}`,
    Pango: Pango.version_string(),
};

/**
 * Every member of one enum, by its MEMBER spelling, with its value and deprecation.
 *
 * Declaration order is not carried here: the nick list this annotates is already in
 * it, so the loops below iterate that and a second ordering would be a second answer.
 */
function membersOf(info) {
    const out = new Map();
    for (let i = 0; i < info.get_n_values(); i++) {
        const value = info.get_value(i);
        out.set(value.get_name().toUpperCase(), { value: value.get_value(), deprecated: value.is_deprecated() });
    }
    return out;
}

/** The vocabulary's own nick-to-member spelling, and the only one this file assumes. */
const memberOf = (nick) => nick.toUpperCase().replaceAll('-', '_');

// ---------------------------------------------------------------------------
// collect
// ---------------------------------------------------------------------------

const nickLists = readNickLists(read(`${ROOT}/${SURFACE_DATA}`));
const provenanceLine = /^\/\/ Provenance: (.+)$/m.exec(read(`${ROOT}/${SURFACE_DATA}`))?.[1] ?? '';

const values = [];
const aliases = [];
const deprecated = [];
const unavailable = [];
const namespaces = new Set();
const missingEnums = [];

for (const [gtype, nicks] of [...nickLists].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const found = enumInfos.get(gtype);
    if (!found) {
        // LOUD, not skipped. An enum the vocabulary names and the typelib does not
        // have is either a namespace this generator never loaded — the failure a
        // prefix table would have hidden — or a type this host predates wholesale,
        // and the two want different repairs.
        missingEnums.push(gtype);
        continue;
    }
    namespaces.add(found.ns);
    const members = membersOf(found.info);
    const valueOf = new Map();
    for (const nick of nicks) {
        const member = members.get(memberOf(nick));
        if (!member) {
            const version = libraryVersion[found.ns];
            unavailable.push([entryKey(gtype, nick), version ? `${found.ns} ${version}` : found.ns]);
            continue;
        }
        valueOf.set(nick, member);
        values.push([entryKey(gtype, nick), member.value]);
        if (member.deprecated) deprecated.push(entryKey(gtype, nick));
    }
    // An ALIAS is a nick sharing its value with another nick of the same enum. The
    // CANONICAL one is the first non-deprecated member in declaration order — both
    // halves read from the typelib, never assumed: on this corpus exactly one member
    // is deprecated (`GtkAlign.baseline`) and it is exactly the alias, so the two
    // rules agree here and the deprecation is the one that decided it.
    const groups = new Map();
    for (const [nick, member] of valueOf) {
        const group = groups.get(member.value);
        if (group) group.push(nick);
        else groups.set(member.value, [nick]);
    }
    for (const group of groups.values()) {
        if (group.length === 1) continue;
        const live = group.filter((nick) => !valueOf.get(nick).deprecated);
        const canonical = (live.length > 0 ? live : group)[0];
        for (const nick of group) if (nick !== canonical) aliases.push([entryKey(gtype, nick), canonical]);
    }
}

if (missingEnums.length > 0) {
    console.error(
        `error: ${missingEnums.length} enum type(s) the vocabulary names have no EnumInfo in any loaded ` +
            `typelib: ${missingEnums.join(', ')}`,
    );
    system.exit(1);
}

// ---------------------------------------------------------------------------
// emit
// ---------------------------------------------------------------------------

const record = (rows) => (rows.length === 0 ? '{}' : `{\n${rows.join('\n')}\n}`);
const quoted = (s) => `'${s.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

// The SAME grammar the vocabulary's provenance line uses — `Gtk-4.0/4.22.4` — so the
// two lines are read by one parser. `generated.spec.ts` already has that parser for
// the nick side, and a second spelling here would give it a second one to maintain.
const valuesProvenance = [...namespaces]
    .sort()
    .map((ns) => {
        const typelib = `${ns}-${repo.get_version(ns)}`;
        return libraryVersion[ns] ? `${typelib}/${libraryVersion[ns]}` : typelib;
    })
    .join(' ');

const text = `// GENERATED by scripts/generate-enum-values.mjs — do not edit.
//
// Nicks: ${provenanceLine || 'src/generated/surface-data.mts'}
// Values: read from the installed typelib — ${valuesProvenance}
//
// Test-only (a \`.mts\` file is outside the library build glob), like
// \`surface-data.mts\` beside it. \`generated.spec.ts\` holds every number here against
// whatever typelib is running; \`scripts/check-enum-values.mjs\` holds the shape with
// no install, which is the job a committed artifact exists to do.
//
// The nick lists this annotates are in \`surface-data.mts\`. Position in that list is
// NOT the value — see the generator's header for the enums where counting is wrong,
// and \`ENUM_ALIASES\` below for the case that makes it wrong for GtkAlign.

/**
 * The libraries these numbers were read from, in the vocabulary's own provenance
 * grammar so one parser reads both lines.
 *
 * A value, not only a header comment: \`generated.spec.ts\` compares it with the
 * running library to decide whether a disagreement is a defect or a version gap.
 */
export const VALUES_PROVENANCE = '${valuesProvenance}';

/** \`<enum GType>.<nick>\` -> the integer the library registers for it. */
export const ENUM_VALUES: Readonly<Record<string, number>> = ${record(
    values.map(([key, value]) => `    ${quoted(key)}: ${value},`),
)};

/**
 * \`<enum GType>.<alias nick>\` -> the nick of the same enum it shares a value with.
 *
 * Two names, one member. Both names keep an entry in \`ENUM_VALUES\` carrying the same
 * number — nothing is lost — and this table says which of them a number should be
 * spelled back as. \`GTK_ALIGN_BASELINE\` is here because GTK 4.12 deprecated it in
 * favour of \`GTK_ALIGN_BASELINE_FILL\` and gave the new name the same value instead of
 * adding a member; the typelib's own deprecation flag is what picks the direction.
 */
export const ENUM_ALIASES: Readonly<Record<string, string>> = ${record(
    aliases.map(([key, target]) => `    ${quoted(key)}: ${quoted(target)},`),
)};

/**
 * Every enum nick the installed typelib marks deprecated.
 *
 * The input to \`ENUM_ALIASES\`' direction, kept as its own fact so the choice is
 * checkable rather than a convention about ordering.
 */
export const ENUM_DEPRECATED: readonly string[] = [${deprecated.map((key) => quoted(key)).join(', ')}];

/**
 * \`<enum GType>.<nick>\` -> the installed library that has no such member.
 *
 * The declared remainder, and the only reason one exists: the vocabulary can describe
 * a library NEWER than the one installed (ADR 0029 § Amendment), so a nick can be real
 * and have no number here yet. Every nick in \`ENUM_NICKS\` is in \`ENUM_VALUES\` or in
 * this table — a nick in neither is a silent drop and the gate fails on it. The value
 * is the library and version that was asked, so the entry says WHICH host produced the
 * gap rather than only that there is one; regenerating on a newer one empties it.
 */
export const ENUM_VALUES_UNAVAILABLE: Readonly<Record<string, string>> = ${record(
    unavailable.map(([key, why]) => `    ${quoted(key)}: ${quoted(why)},`),
)};
`;

const target = `${ROOT}/${ENUM_VALUES_FILE}`;
if (CHECK) {
    let current = '';
    try {
        current = read(target);
    } catch {
        // Absent is a difference like any other, and the message below names it.
        current = '';
    }
    if (current === text) {
        console.log(`${ENUM_VALUES_FILE} is what this run would write (${values.length} value(s))`);
        system.exit(0);
    }
    console.error(
        `error: ${ENUM_VALUES_FILE} is not what this run would write. Regenerate it — and if the diff is ` +
            'only in the provenance line, your GNOME runtime differs from the one the artifact was ' +
            'generated on, which is a fact worth committing rather than reverting.',
    );
    system.exit(1);
}

if (!GLib.file_set_contents(target, new TextEncoder().encode(text))) throw new Error(`cannot write ${target}`);
console.log(
    `wrote ${ENUM_VALUES_FILE} — ${values.length} value(s) over ${nickLists.size} enum type(s), ` +
        `${aliases.length} alias(es), ${deprecated.length} deprecated member(s), ` +
        `${unavailable.length} unavailable on this host`,
);
console.log(`values read from ${valuesProvenance}; nicks from ${provenanceLine}`);
