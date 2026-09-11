// Where the in-repo parser and the reference compiler still disagree, one entry per file,
// pinned to the exact lines.
//
// ONE ENTRY, TWO LINES, AND IT IS WAITING ON A FACT
//
// ADR 0053 clause 5 runs the parser in SHADOW until it is silent: `blueprint-compiler` stays
// authoritative for the build, the in-repo parser runs beside it and reports every
// divergence, and it becomes authoritative when it reports none. It is not silent yet, and
// the one thing left is named below — so clause 7's demotion of `blueprint-compiler` to
// oracle-only is still a plan and not a deletion.
//
// WHAT USED TO BE HERE
//
// One cause over eleven files and twenty-three lines: `orientation: vertical` reached the XML
// as `vertical` where the reference compiler writes `1`, because closing it needed two
// lookups and this repository had one. `ENUM_VALUES` — the integer behind a nick — was
// readable from the installed typelib; WHICH enum `GtkBox.orientation` is was not readable at
// all, and searching the nick lists for an enum with a member called `never` finds several.
// `@girs` 4.8.0 published the first as vocabulary data and 4.9.0 added `PROP_ENUMS`, the join.
// `src/resolve-ident.mjs` performs both, and the twenty-three lines went with one change and
// no entry here edited by hand — the second direction of the self-retirement rule below is
// what turned the fix into eleven failures saying "delete me".
//
// AND WHAT AN EMPTY LIST NEARLY HID
//
// The list WAS empty for a while, on a corpus whose `accessibility { }` file held a single
// string. Measured on 0.20.4, that block emits three different elements and resolves its
// values against a table of its own, so the one entry in the fixture was the one case where
// all of that is invisible: `label: "…"` is an ARIA property with a string value. The rule
// file now carries a relation, a state and an enum too, which is what a rule file is for —
// and what came back is the entry below. An exemption is data, and a corpus that does not
// probe a construct is the other place a tolerated divergence can hide.
//
// AN EXEMPTION IS DATA, NEVER A CODE PATH
//
// ADR 0053 clause 6, from ADR 0030 § 5. A tolerated divergence is an entry here; it is never
// an `if` inside the parser or the emitter, and it is never a golden edited to match. The
// difference is not stylistic: a special case in the emitter is invisible to every reader of
// the output and survives the thing that caused it, while an entry in a list is counted,
// printed every run, and has to be deleted by hand.
//
// AN EXEMPTION IS ALSO NOT A BLANKET
//
// `lines` is the half that makes the sentence above true, and it was missing. An entry that
// only named a FILE tolerated everything that file emitted: measured on this corpus, an
// emitter taught to write `<property name="THIS-IS-NOT-A-PROPERTY">SABOTAGE</property>` for
// every `hscrollbar-policy` — five of the eleven files, none of the twenty-five byte-equal
// ones — passed the gate with the headline unchanged at "25 byte-equal, 11 ledgered across 1
// cause(s)". So each entry names the lines it excuses and what stands on them, and any other
// difference in the same file is a failure.
//
// The text is stored WITHOUT leading whitespace, and the indentation is compared separately:
// a difference confined to indentation is a real divergence and must not hide behind a
// trimmed comparison.
//
// SELF-RETIRING, IN BOTH DIRECTIONS
//
// `check-blueprint-corpus.mjs` stage C fails on a file that diverges and is NOT listed here,
// on a file that is listed here and no longer diverges, and on a listed file that diverges
// somewhere `lines` does not name. The second half is the one that keeps this file honest: a
// ledger that only grows describes a parser nobody improved, and a fixed divergence still
// listed is a claim that stopped being true without anyone noticing.
//
// A PARSE ERROR IS NEVER TOLERATED
//
// This ledger is about EMITTED BYTES. A file the parser cannot read at all fails stage C
// outright, with no way to list it — clause 3 makes an unrecognised construct a hard error
// naming its line, and a corpus file the parser refuses is either a gap in the parser or a
// file that does not belong in the corpus. Neither is a divergence to tolerate.

/**
 * @typedef {Object} DivergentLine
 * @property {number} line    1-based line number in the golden `.ui`
 * @property {string} golden  the line the reference compiler wrote, without leading whitespace
 * @property {string} inRepo  the line the in-repo emitter writes, without leading whitespace
 */

/**
 * @typedef {Object} ShadowDivergence
 * @property {string} file    `rules/<name>.blp`, or the repo-relative path of a reality probe
 * @property {string} kind    a slug shared by every entry with the SAME cause, so the report
 *                            can say "11 files, one cause" instead of eleven unrelated numbers
 * @property {readonly DivergentLine[]} lines  every line this entry excuses, and nothing else
 * @property {string} reason  what the in-repo emitter produces instead, and why it cannot yet
 *                            produce the other thing
 */

/**
 * The known disagreements. There is one.
 *
 * @type {readonly ShadowDivergence[]}
 */
export const SHADOW_DIVERGENCES = [
    {
        file: 'rules/20-accessibility.blp',
        kind: 'aria-value-types',
        lines: [
            {
                line: 14,
                golden: '<state name="checked">1</state>',
                inRepo: '<state name="checked">true</state>',
            },
            {
                line: 15,
                golden: '<property name="orientation">1</property>',
                inRepo: '<property name="orientation">vertical</property>',
            },
        ],
        reason:
            "An `accessibility { }` entry is typed by GTK's ARIA table and not by the widget: `checked` " +
            'is a GtkAccessibleTristate, so `true` is `1`, and `orientation` is a GtkOrientation there ' +
            'even on a widget that is not orientable. The table is built in C by ' +
            '`gtk_accessible_property_init_value`, and the GIR carries that function and not what it ' +
            'writes — so `@girs` answers which ELEMENT each name becomes (the three nick lists, which is ' +
            'why the two lines above are the only ones left) and cannot answer what value it takes. ' +
            'Resolving it through the widget instead would be right by accident inside `Gtk.Box` and ' +
            'wrong inside `Gtk.Label`. Retires when ts-for-gir emits the ARIA value types the way it now ' +
            'emits `PROP_ENUMS`; tracked in `status/open-todos.md`.',
    },
];
