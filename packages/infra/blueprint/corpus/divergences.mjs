// Where the in-repo parser and the reference compiler still disagree, one entry per file,
// pinned to the exact lines.
//
// ONE ENTRY, ONE LINE, WAITING ON A FACT
//
// ADR 0053 clause 5 runs the parser in SHADOW until it is silent: `blueprint-compiler` stays
// authoritative for the build, the in-repo parser runs beside it and reports every
// divergence, and it becomes authoritative when it reports none. It is not silent yet, and
// the one thing left is named below — so clause 7's demotion of `blueprint-compiler` to
// oracle-only is still a plan and not a deletion. Its shape is the shape every entry here has
// had: a lookup the `@girs` vocabulary does not carry yet.
//
// WHAT USED TO BE HERE
//
// Twice, the same story with a different table. First one cause over eleven files and
// twenty-three lines: `orientation: vertical` reached the XML as `vertical` where the
// reference compiler writes `1`, because closing it needed two lookups and this repository had
// one. `ENUM_VALUES` — the integer behind a nick — was readable from the installed typelib;
// WHICH enum `GtkBox.orientation` is was not readable at all, and searching the nick lists for
// an enum with a member called `never` finds several. `@girs` 4.8.0 published the first as
// vocabulary data and 4.9.0 added `PROP_ENUMS`, the join.
//
// Then the same thing one table over, for `accessibility { }`: `checked: true` reached the XML
// as `true` where the oracle writes `1`, because that slot is a `GtkAccessibleTristate` and
// nothing in this repository could say so. GTK types its ARIA slots in C
// (`gtk_accessible_property_init_value`) and the GIR carries that function and not its table,
// so the fact had to be read somewhere else — ts-for-gir reads each member's own GIR
// DOCUMENTATION, and `@girs` 5.1.0 publishes `ARIA_VALUE_TYPES` with `ARIA_VALUE_ENUMS` beside
// it. Both entries retired the same way: `src/resolve-ident.mjs` gained the lookup and this
// file lost the entry, not by hand but because the second direction of the self-retirement
// rule below turned the fix into a failure saying "delete me".
//
// AND WHAT AN EMPTY LIST NEARLY HID
//
// The list WAS empty for a while, on a corpus whose `accessibility { }` file held a single
// string. Measured on 0.20.4, that block emits three different elements and resolves its
// values against a table of its own, so the one entry in the fixture was the one case where
// all of that is invisible: `label: "…"` is an ARIA property with a string value. Widening the
// rule file is what put the ARIA entry here to begin with, and it is worth reading twice now
// that the entry is gone: it was never true that the parser handled that block, only that
// nothing asked it a question it could get wrong. An exemption is data, and a corpus that does
// not probe a construct is the other place a tolerated divergence can hide. The entry that is
// left arrived the same way, from asking `03-property-enum` what its OTHER case looked like:
// every enum the corpus resolved sat on a widget, and `Gtk.SizeGroup { mode: horizontal; }`
// was the first that did not.
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
        file: 'rules/29-enum-non-widget.blp',
        kind: 'prop-enums-widgets-only',
        lines: [
            {
                line: 10,
                golden: '<property name="mode">1</property>',
                inRepo: '<property name="mode">horizontal</property>',
            },
        ],
        reason:
            '`GtkSizeGroup` is not a widget, and `PROP_ENUMS` — the `@girs` join from a property to its ' +
            'enum type — is keyed by the widget vocabulary (ADR 0029): measured on @girs 5.0.0, every one of ' +
            'its 71 owners is a widget, a widget base or an interface widgets implement, and `DECLS` has no ' +
            '`GtkSizeGroup` either. ' +
            '`ENUM_VALUES` does hold `GtkSizeGroupMode.horizontal` = 1, so the number is one lookup away, ' +
            'and the lookup that is missing is the one ADR 0053 § Amendment 1 records as missing for widgets ' +
            'before @girs 4.9.0: WHICH enum `GtkSizeGroup.mode` is. Searching the nick lists for an enum ' +
            'with a member `horizontal` finds several, and guessing is the silent-wrong-output clause 3 ' +
            'refuses. Retires when ts-for-gir extends `PROP_ENUMS` past the widget vocabulary.',
    },
];
