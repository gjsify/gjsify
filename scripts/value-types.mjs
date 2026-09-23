// The ledger of namespace members that are VALUES, and the reader both halves of the
// oracle over it share.
//
// WHY THIS EXISTS. ADR 0034 § Amendment 19 let a clause-2 namespace carry a non-widget
// GObject an author CONSTRUCTS — `new Gio.Menu()` — beside the widgets it carries. That
// needs a second list: which members are values, and which GIR type each one is. The
// first version of the list sat in `check-vocabulary-alignment.mjs` and held itself
// against `node_modules/@girs/<pkg>/<pkg>.d.ts`.
//
// IT COULD NOT WORK THERE, AND THE JOB SAID SO IN ITS OWN COMMENT. That gate is a step of
// `.github/workflows/audit-runtimes.yml`, a job that deliberately performs NO install —
// its scripts are pure Node with zero deps, which is what makes it cheap and what nothing
// was going to give up for one lookup. So `@girs` was absent, the lookup answered "not
// installed", and the gate exited 1 on every push of the PR that added it. Measured,
// 2026-09-22.
//
// The repository already stated the answer, in the header of `generated/methods.mts`:
// `check-vocabulary-alignment.mjs` reads that file "with no install to hold a port's
// method names against the GIR, which is the job a committed artifact exists to do".
// This is the same arrangement a third time, after the enum values and the methods:
// `scripts/generate-value-types.mjs` runs under GJS, where the typelib is, and writes
// `generated/value-types.mts`; the gate reads the committed file under plain Node;
// gtk-host's `generated.spec.ts` holds every row against whatever GJS is running.
//
// WHY THE LEDGER LIVES HERE AND NOT IN `adwaita-elements.mjs`, which is the vocabulary
// module and where a reader looks for it first: that module imports `node:fs`, and the
// generator that consumes the ledger runs under `gjs -m`, which answers a bare
// `import 'node:fs'` with `ImportError: Unsupported URI scheme for importing: node` —
// measured. So this module imports nothing but its sibling reader, the GJS half brings
// GLib file reads and the Node half brings `node:fs`, and `adwaita-elements.mjs`
// re-exports the ledger so both Node consumers still read the vocabulary from the
// vocabulary module.

import { readBlock, readStringRecord, residue } from './enum-values.mjs';

/** Where the GIR's answer about each ledger entry is committed — this oracle. */
export const VALUE_TYPES_FILE = 'packages/framework/gtk-host/src/generated/value-types.mts';

/**
 * Namespace members that are NOT widgets, with the GIR type each one is.
 *
 * THE THIRD CASE the vocabulary gate could not express. Its rule — a member with no
 * widget is a member that "outlives the widget it named" — was written when a namespace
 * carried widgets and nothing else, and it is still right for that. `Gio.Menu` is neither
 * a widget nor a stale entry: it is a value an author CONSTRUCTS, and the reason it
 * exists on a port at all is that the reference surface is GJS, where
 * `new Gio.Menu(); menu.append(…)` is simply how a menu is written. ADR 0034 § Amendment
 * 19 is that decision; this table is what keeps it from becoming a hole.
 *
 * Each entry is held against the INSTALLED typelib by `scripts/generate-value-types.mjs`,
 * so a member cannot be excused by naming a type that does not exist, and a member GTK
 * really does ship as a WIDGET cannot hide here — that is the stale-entry direction, and
 * it is the one the whole rule was written for.
 *
 * `member` is the port's spelling, `gir` the type name the namespace declares. They are
 * the same word today and are two fields because only the first is the ports' to choose.
 */
export const CONSTRUCTIBLE_VALUES = [
    {
        member: 'Gio.Menu',
        gir: 'Menu',
        why: "GJS writes `new Gio.Menu(); menu.append('Save as…', 'app.save-as')`, and ADR 0042 already made the VALUE behind it portable. The ports carry the constructor so the two dialects are one text rather than two — the gallery's `Adw.SplitButton` pair went 9 lines to 2 on it.",
    },
    {
        member: 'Gio.MenuItem',
        gir: 'MenuItem',
        why: "`Gio.Menu`'s item half — `set_label` / `set_detailed_action` — for the same reason, and unreachable without it the moment a pane writes anything past a bare `append`.",
    },
    {
        member: 'Gtk.Adjustment',
        gir: 'Adjustment',
        why: 'GJS writes `adjustment: new Gtk.Adjustment({ lower: 0, upper: 100, value: 16, stepIncrement: 1 })`, and ADR 0047 already made the VALUE behind it portable — the class IS `AdwAdjustment` wearing the GIR spelling. It closed the `Adw.SpinRow` pane divergence down to the one property the port has no counterpart for.',
    },
    {
        member: 'Adw.ViewStackPage',
        gir: 'ViewStackPage',
        why: 'Blueprint writes a titled stack as `Adw.ViewStack { Adw.ViewStackPage { name: …; title: …; child: … } }`, and GtkBuilder constructs each record as the GObject it is — not a widget. The NativeScript builder needs a class to construct for the same node, so the record is a value the port carries (`view-stack-page.ts`), read by the stack when it adopts it. The web spells the same record as the `<adw-view-stack-page>` element.',
    },
    {
        member: 'Gtk.StringList',
        gir: 'StringList',
        why: 'GJS writes `model: new Gtk.StringList({ strings: [...] })`, and ADR 0046 already made the VALUE behind it portable. An `Array` subclass like `Gio.Menu`, so the array spelling and this one are the same write — it closed the `Adw.ComboRow` pane divergence outright.',
    },
];

/** `Gio.Menu` -> `{ namespace: 'Gio', member: 'Menu' }`. A GIR namespace carries no dot. */
export function splitMember(member) {
    const at = member.indexOf('.');
    if (at === -1) throw new Error(`${member} is not a \`<Namespace>.<Member>\` name`);
    return { namespace: member.slice(0, at), member: member.slice(at + 1) };
}

/**
 * The `'Ns.Member': { gtype: '…', widget: <bool> }` rows of `VALUE_TYPES`.
 *
 * Residue-checked like every other reader of a generated literal here: anything in the
 * body this matcher did not consume is an error naming it, never a shorter answer. A row
 * shape that moves has to be noticed by the reader, because the only other way to notice
 * it is a gate that reports a ledger entry as unheld while the artifact holds it.
 */
function readValueRows(text) {
    const body = readBlock(text, 'VALUE_TYPES');
    const out = new Map();
    const spans = [];
    for (const match of body.matchAll(/'([^']+)':\s*\{\s*gtype:\s*'([^']*)',\s*widget:\s*(true|false),?\s*\}/g)) {
        if (out.has(match[1])) throw new Error(`VALUE_TYPES declares ${match[1]} twice`);
        out.set(match[1], { gtype: match[2], widget: match[3] === 'true' });
        spans.push([match.index, match.index + match[0].length]);
    }
    const left = residue(body, spans);
    if (left !== '') throw new Error(`VALUE_TYPES has entries this reader did not match: ${left.slice(0, 120)}`);
    return out;
}

/**
 * The whole artifact, as data.
 *
 * @param {string} text the generated file
 * @returns {{
 *   provenance: string,
 *   declared: Map<string, { gtype: string, widget: boolean }>,
 *   undeclared: Map<string, string>,
 * }}
 */
export function readValueTypes(text) {
    const provenance = /^export const VALUE_TYPES_PROVENANCE = '([^']*)';$/m.exec(text)?.[1];
    if (provenance === undefined) throw new Error('VALUE_TYPES_PROVENANCE is not declared as a plain string');
    const declared = readValueRows(text);
    const undeclared = readStringRecord(text, 'VALUE_TYPES_UNDECLARED');
    for (const member of undeclared.keys()) {
        if (declared.has(member)) throw new Error(`${member} is both declared and undeclared in the artifact`);
    }
    return { provenance, declared, undeclared };
}
