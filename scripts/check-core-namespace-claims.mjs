#!/usr/bin/env node
// A portable core value SAYS which GIR type it is the portable form of — and this holds
// every such claim against the installed GIR.
//
// THE INCIDENT
//
// `@gjsify/adwaita-core` exports `AdwAdjustment`, `AdwListModel` and `AdwMenuItem`. None
// of the three is a libadwaita type: GIR puts them in `Gtk.Adjustment`, `Gio.ListModel`
// and `Gio.MenuItem`. The core KNOWS this — `adjustment.ts` says "the six numbers of
// `Gtk.Adjustment`, under its own field names", `list.ts` says "building a real
// `Gio.ListModel` is the GTK renderer's half" — so the prefix was never a mistake of
// fact. It is a PACKAGE prefix, and it was invisible for as long as the core was the only
// thing that named these shapes.
//
// AND THE PREFIX IS NOT THE DEFECT. ADR 0034 § 1 opens "A widget-bearing surface in this
// repository" and only then says "the namespace is read from the GIR, never chosen per
// surface". `adwaita-core` is the HEADLESS core (ADR 0004), not a widget surface, so
// `AdwAdjustment` breaks no rule — and ADR 0046 and 0047 named these shapes without
// declaring a § 1 clause-3 divergence, which they would have had to do if the rule
// reached them. Renaming them is a decision nobody has taken.
//
// What IS missing is the CORRESPONDENCE. ADR 0053 made a `.blp` a source, and a `.blp`
// authors `Gtk.Adjustment`, `Gio.Menu` and `Gtk.StringList` by those names. The
// projection has to carry such a value to a core that spells it `AdwAdjustment`, and
// today nothing in the tree connects the two: the link lives in prose, in one doc comment
// per module, where no build step can read it. That is not ADR 0051's refused
// markup-vocabulary translator — that refusal is about translating between two RENDERER
// DIALECTS, and this is one direction, declared at the definition site.
//
// The gallery's divergence ledger reaches the same three families from the other side —
// `Adw.SplitButton` "menu is plain array vs Gio.Menu", `Adw.ComboRow` "model is string
// array vs Gtk.StringList", `Adw.SpinRow` "AdwAdjustment vs Gtk.Adjustment" — which is two
// independent measurements naming one gap.
//
// WHAT THIS CHECKS
//
//   1. an `Adw*` core export whose concept another GIR namespace owns declares WHICH
//      type it is the portable form of                                 -> else FAIL
//   2. a declared origin names a type that namespace really has                    -> else FAIL
//   3. an origin declared for a name libadwaita itself has is stale                -> else FAIL
//   4. an origin declared for a name the core no longer exports is stale           -> else FAIL
//
// (3) and (4) are what keep the table from becoming a second truth. Its point is not to
// excuse the prefixes; it is to hold the CORRESPONDENCE at a number a build step can read,
// the way `check-vocabulary-alignment.mjs` holds "distance to one vocabulary".
//
// WHAT IT DOES NOT DECIDE. Whether a borrowed shape should be renamed, aliased or left
// exactly as it is belongs in an ADR. This refuses only the state where the correspondence
// exists in a doc comment and nowhere a program can see it.
//
// Usage: node scripts/check-core-namespace-claims.mjs [--root <dir>] [--list]

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const ROOT = rootIndex === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootIndex + 1];
const LIST = args.includes('--list');

const CORE_SRC = join(ROOT, 'packages', 'web', 'adwaita-core', 'src');

/**
 * The GIR namespaces a core name could belong to, and the installed types to read them
 * from.
 *
 * `@girs/*` rather than the repo's own generated tables, and that is the whole reliability
 * of this check. `gtk-host/src/generated/methods.mts` holds the widgets the HOST covers —
 * 194 GTypes — so `AdwToast` and `AdwBreakpoint`, real libadwaita types that are not
 * `GtkWidget`s, are absent from it and would read as unbacked. Measured while writing
 * this: the widget table alone reports 23 of 99 backed, the widget table plus the enum
 * table 30, and the installed GIR 28 with a completely different membership. A check whose
 * oracle covers less than its subject invents findings.
 */
const NAMESPACES = {
    Adw: 'adw-1/adw-1.d.ts',
    Gtk: 'gtk-4.0/gtk-4.0.d.ts',
    Gio: 'gio-2.0/gio-2.0.d.ts',
    GLib: 'glib-2.0/glib-2.0.d.ts',
    GtkSource: 'gtksource-5/gtksource-5.d.ts',
};

/**
 * Suffixes the core appends to a borrowed concept, peeled before the GIR is asked.
 *
 * `AdwAdjustmentInput` is `Gtk.Adjustment` plus this repo's "…Input" convention for the
 * un-normalised form; asking the GIR for `AdjustmentInput` finds nothing and the name
 * would read as an invention. Peeling is iterative — `AdwMenuSectionInput` needs two —
 * and the shortest candidate is bounded below so a stem cannot shrink into an unrelated
 * type: `AdwDataGridAlign` peeled to `Data` matched `GLib.Data` on the first draft, which
 * is how this bound got its number.
 */
const SUFFIXES = [
    'Handlers',
    'Handler',
    'Options',
    'Option',
    'Values',
    'Value',
    'Input',
    'Props',
    'State',
    'Spec',
    'Kind',
    'Variant',
    'Queue',
    'Refusal',
    'Alias',
    'Info',
    'Notify',
    'Transition',
    'Names',
    'Name',
    'Type',
    'Mode',
    'Role',
    'Policy',
    'Hint',
    'Source',
    'Range',
    'Changed',
    'Change',
    'Entry',
    'Surface',
    'Path',
    'Node',
    'Actions',
    'Action',
    'Section',
    'Submenu',
    'Items',
    'Item',
    'Rows',
    'Row',
    'Column',
    'Align',
    'Cell',
    'Person',
    'Model',
];

/** A stem shorter than this is not asked about — see {@link SUFFIXES}. */
const MIN_STEM = 5;

/**
 * Portable core values, each declaring the GIR type it is the portable form of.
 *
 * Read it as the projection's manifest, not as a list of mistakes: each entry is a shape a
 * `.blp` authors under the GIR name and a renderer consumes under this one, so each is a
 * value the projection can only carry once someone has written the correspondence down.
 * Families share an entry because they are one decision.
 */
const PORTABLE_OF = [
    {
        match: /^AdwAdjustment/,
        namespace: 'Gtk',
        type: 'Adjustment',
        why: 'ADR 0047 made the six numbers of `Gtk.Adjustment` portable. The VALUE moved to the core; the NAME did not follow, so a `.blp` writing `Gtk.Adjustment` and a renderer reading `AdwAdjustment` are two spellings of one concept. The gallery ledger reaches it from the other side on `Adw.SpinRow`.',
    },
    {
        match: /^AdwListModel|^AdwListItemsChanged/,
        namespace: 'Gio',
        type: 'ListModel',
        why: 'ADR 0046 is explicitly narrower than "a portable `Gio.ListModel`" and says so; the name is not. `Gtk.StringList` is the spelling a `.blp` uses for the bare-string case the core calls `AdwComboOptionInput`.',
    },
    {
        match: /^AdwMenu/,
        namespace: 'Gio',
        type: 'MenuModel',
        why: 'ADR 0042 gave the menu a portable value shaped after `Gio.MenuModel` / `Gio.MenuItem`, down to `role`, `hidden-when` and the section/submenu split. Twenty exports carry the borrowed shape under a prefix for a library that has no menu type at all.',
    },
    {
        match: /^AdwLicense/,
        namespace: 'Gtk',
        type: 'License',
        why: '`Gtk.License` is the enum `AdwAboutDialog:license-type` takes. The core models its aliases and transitions; libadwaita contributes the dialog, not the vocabulary.',
    },
    {
        match: /^AdwPackType$/,
        namespace: 'Gtk',
        type: 'PackType',
        why: '`Gtk.PackType` is where `start` / `end` come from — `Adw.HeaderBar` consumes it, it does not define it.',
    },
    {
        match: /^AdwTextDirection$/,
        namespace: 'Gtk',
        type: 'TextDirection',
        why: "`Gtk.TextDirection` is GTK's, and `Adw.MenuTextDirection` beside it is the same borrowing one level down.",
    },
];

function fail(lines) {
    console.error(`check-core-namespace-claims: ${lines.join('\n  ')}`);
    process.exit(1);
}

/**
 * Every class/enum/interface a `@girs` declaration file declares.
 *
 * `type X = …` ALIASES ARE DELIBERATELY LEFT OUT, and that is a measured gap rather than
 * an oversight left unstated: the five files carry 494 of them (92 adw-1, 212 gtk-4.0,
 * 126 gio-2.0, 16 glib-2.0, 48 gtksource-5) this oracle never sees. Widening the regex to
 * `class|enum|interface|type` and re-running the sweep on this tree moves `backed` and
 * `foreign` not at all and `own` from 37 to 37 — every alias a name here could have hit is
 * already reachable through its `class` (`XClass = typeof X` and equivalent restatements),
 * so the wider oracle changes nothing it classifies. If a future `own` count moves after
 * touching this file or the `@girs` tree, re-run that widened regex before trusting the
 * number — the gap is real, just empty on the names that exist today.
 */
function girTypes(file) {
    const text = readFileSync(file, 'utf8');
    const names = new Set();
    for (const m of text.matchAll(
        /^\s*(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:class|enum|interface)\s+([A-Z][A-Za-z0-9_]*)/gm,
    )) {
        names.add(m[1]);
    }
    return names;
}

/** The stems to ask the GIR about, longest first. */
function stems(name) {
    const out = [name.slice(3)];
    for (;;) {
        const last = out[out.length - 1];
        const suffix = SUFFIXES.find((s) => last.endsWith(s) && last.length - s.length >= MIN_STEM);
        if (suffix === undefined) return out.filter((s) => s.length >= MIN_STEM);
        out.push(last.slice(0, -suffix.length));
    }
}

/** Every `Adw*` name the core exports. */
function coreExports(dir) {
    const names = new Map();
    const walk = (d) => {
        for (const entry of readdirSync(d)) {
            const p = join(d, entry);
            if (statSync(p).isDirectory()) walk(p);
            else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) {
                for (const m of readFileSync(p, 'utf8').matchAll(
                    /^export (?:declare )?(?:interface|type|const|function|class|enum) (Adw[A-Za-z0-9]*)/gm,
                )) {
                    if (!names.has(m[1])) names.set(m[1], p.slice(ROOT.length + 1));
                }
            }
        }
    };
    walk(dir);
    return names;
}

/** The partition, over one oracle and one subject — the whole check in one function. */
export function classify(names, types, claims) {
    const backed = [];
    const foreign = [];
    const own = [];
    const problems = [];
    for (const name of [...names.keys()].sort()) {
        const claim = claims.find((c) => c.match.test(name));
        const adwHit = stems(name).find((s) => types.Adw?.has(s));
        if (adwHit !== undefined) {
            // (3) a ledger entry for a name libadwaita really has.
            if (claim) {
                problems.push(
                    `${name} is ledgered to ${claim.namespace}, but libadwaita really has ` +
                        `\`Adw.${adwHit}\`. Delete the entry — the prefix is correct.`,
                );
            } else backed.push(`${name} <- Adw.${adwHit}`);
            continue;
        }
        if (claim) {
            // (2) the claimed namespace really has the type it names.
            if (!types[claim.namespace]?.has(claim.type)) {
                problems.push(
                    `${name} is ledgered to \`${claim.namespace}.${claim.type}\`, which the installed ` +
                        `@girs/${claim.namespace.toLowerCase()} does not declare.`,
                );
            } else foreign.push(`${name} -> ${claim.namespace}.${claim.type}`);
            continue;
        }
        const elsewhere = ['Gtk', 'Gio', 'GLib', 'GtkSource'].find((ns) => stems(name).some((s) => types[ns]?.has(s)));
        if (elsewhere) {
            problems.push(
                `${name} is prefixed \`Adw\`, libadwaita has no such type, and ${elsewhere} does. ` +
                    'Add it to PORTABLE_OF with the GIR type it is the portable form of, and why — or ' +
                    'say in that entry why the resemblance is a coincidence.',
            );
        } else own.push(name);
    }
    return { backed, foreign, own, problems };
}

// ---------------------------------------------------------------------------
// Self-test. The partition runs on hand-built input with a KNOWN answer before it
// touches the tree, because every number below is otherwise unfalsifiable: a classifier
// with an empty oracle reports every name as an invention and exits 0.
// ---------------------------------------------------------------------------
{
    const types = {
        Adw: new Set(['Toast', 'Breakpoint']),
        Gtk: new Set(['Adjustment', 'License']),
        Gio: new Set(['MenuModel']),
        GLib: new Set(),
        GtkSource: new Set(),
    };
    // ITS OWN TABLE, not `PORTABLE_OF`. Sharing them made the self-test shadow the sweep:
    // every deliberate break of the real table was caught here, one line before the tree was
    // ever read, so the sweep's three directions were never shown to fire at all. Measured
    // while writing this — all three A/B runs went red on the self-test and told me nothing.
    const fixture = [
        { match: /^AdwAdjustment/, namespace: 'Gtk', type: 'Adjustment', why: 'fixture' },
        { match: /^AdwMenu/, namespace: 'Gio', type: 'MenuModel', why: 'fixture' },
    ];
    const vectors = [
        ['AdwToast', 'backed'],
        ['AdwToastOptions', 'backed'],
        ['AdwBreakpointHandlers', 'backed'],
        ['AdwAdjustment', 'foreign'],
        ['AdwAdjustmentInput', 'foreign'],
        ['AdwMenuSectionInput', 'foreign'],
        ['AdwDataGridAlign', 'own'],
    ];
    for (const [name, want] of vectors) {
        const got = classify(new Map([[name, 'x']]), types, fixture);
        const where = got.backed.length
            ? 'backed'
            : got.foreign.length
              ? 'foreign'
              : got.own.length
                ? 'own'
                : 'problem';
        if (where !== want) {
            fail([`self-test: ${name} landed in ${where}, expected ${want}. The classifier is wrong, not the tree.`]);
        }
    }
    // A name libadwaita has, wrongly ledgered, must be caught — (3).
    const stale = classify(new Map([['AdwToast', 'x']]), { ...types, Adw: new Set(['Toast']) }, fixture);
    if (stale.problems.length !== 0) fail(['self-test: a correctly-prefixed name produced a problem.']);
    // AN EMPTY ORACLE MUST GO RED, not quiet. This vector was written expecting the name to
    // fall through to `own` — that expectation was wrong and the self-test caught it, which
    // is the whole reason it runs before the tree: a declared origin whose namespace has no
    // such type is a PROBLEM, and that is exactly what an unreadable @girs looks like. The
    // silent reading ("everything is an invention") is the failure this row now forbids.
    const blind = classify(new Map([['AdwAdjustment', 'x']]), { Adw: new Set(), Gtk: new Set() }, fixture);
    if (blind.problems.length !== 1 || blind.own.length !== 0) {
        fail(['self-test: an unreadable oracle did not go red on a declared origin.']);
    }
}

const GIRS = join(ROOT, 'node_modules', '@girs');
if (!existsSync(GIRS)) {
    fail([
        `no @girs under ${GIRS}, so there is no oracle and this check would report every name as an ` +
            'invention. Install the tree first — this refuses rather than passing over nothing.',
    ]);
}
const types = {};
for (const [ns, rel] of Object.entries(NAMESPACES)) {
    const file = join(GIRS, rel);
    if (!existsSync(file)) fail([`@girs/${rel} is missing; the ${ns} half of the oracle cannot be read.`]);
    types[ns] = girTypes(file);
}

const names = coreExports(CORE_SRC);
if (names.size === 0) fail([`no Adw* exports under ${CORE_SRC} — the subject is empty, so this measures nothing.`]);

const { backed, foreign, own, problems } = classify(names, types, PORTABLE_OF);

// (4) a ledger entry for a name that no longer exists.
for (const claim of PORTABLE_OF) {
    if (![...names.keys()].some((n) => claim.match.test(n))) {
        problems.push(`PORTABLE_OF carries ${claim.match} and the core exports no such name any more.`);
    }
}

if (LIST) {
    // `backed` included, not just `foreign`/`own`: the matched type is a STEM MATCH, not
    // a declared one, and printing it is what makes a coincidental hit to the wrong Adw
    // type readable instead of silent — e.g. `AdwToastQueue <- Adw.Toast`, where
    // `toast.ts`'s own header says it mirrors `Adw.ToastOverlay`. The verdict ("backed")
    // is still right; only the reader who wants to check the MATCH needs this line, which
    // is why it stayed out of the printed prose below and lives only behind `--list`.
    for (const line of backed) console.log(`  backed   ${line}`);
    for (const line of foreign) console.log(`  foreign  ${line}`);
    for (const line of own) console.log(`  own      ${line}`);
}

if (problems.length > 0) fail(problems);

const oracle = Object.entries(types)
    .map(([ns, set]) => `${ns} ${set.size}`)
    .join(', ');
console.log(
    `check-core-namespace-claims: ${names.size} Adw*-prefixed export(s) in @gjsify/adwaita-core, held ` +
        `against the installed GIR (${oracle}). ${backed.length} backed by a real libadwaita type, ` +
        `${foreign.length} declaring the GIR type they are the portable form of, ${own.length} this ` +
        "repository's own invention. Every borrowed shape says where it was borrowed from.",
);
