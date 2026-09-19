// Where the in-repo parser and the reference compiler still disagree, one entry per file,
// pinned to the exact lines.
//
// NO ENTRIES — WHICH IS A PRECONDITION, NOT A PROMOTION
//
// ADR 0053 clause 5 runs the parser in SHADOW until it is silent: `blueprint-compiler` stays
// authoritative for the build, the in-repo parser runs beside it and reports every
// divergence, and it becomes authoritative when it reports none. As of `@girs` 5.2.0 it
// reports none: this list is empty and every corpus file stage C reads is byte-equal. How many
// that is the harness prints; the copy that used to sit in this sentence went stale. That is
// the condition
// clause 5 names and not the change it calls for — clause 5 still reads SHADOW, clause 7's
// demotion of `blueprint-compiler` to oracle-only is still a plan, and both are edits of
// their own rather than a consequence of this file emptying. What an empty list is worth is
// the subject of the third section below, and it is worth reading before acting on it.
//
// WHAT USED TO BE HERE
//
// Three times, the same story with a different table. First one cause over eleven files and
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
// it.
//
// The third needed no lookup that did not already exist, only a WIDER one. `PROP_ENUMS` was
// keyed by the widget vocabulary (ADR 0029), so `Gtk.SizeGroup { mode: horizontal; }` — an
// enum property on a class that is not a widget — had nothing to join against, and `mode`
// reached the XML as `horizontal` where the oracle writes `1`. ts-for-gir extended
// `PROP_ENUMS` past the widget vocabulary in `@girs` 5.2.0, and that entry retired on the
// version bump ALONE: not one line of `src/resolve-ident.mjs` changed, because the two
// lookups it already performed were simply answered for one more owner. A divergence that
// closes with no code change is the cheapest kind and the easiest to mistake for luck, so it
// is worth naming what made it cheap — the emitter never special-cased the case, so there
// was nothing to unwind when the data arrived. All three retired the same way: this file lost
// the entry not by hand but because the second direction of the self-retirement rule below
// turned the fix into a failure saying "delete me".
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
// not probe a construct is the other place a tolerated divergence can hide. The last entry to
// go arrived the same way, from asking `03-property-enum` what its OTHER case looked like:
// every enum the corpus resolved sat on a widget, and `Gtk.SizeGroup { mode: horizontal; }`
// was the first that did not.
//
// So the list is empty again, and it means what it meant last time: every construct this
// corpus probes, the parser emits byte-for-byte. It does not mean every construct Blueprint
// has. The way to find the next entry is the way the last two were found — widen a rule file
// until it asks a question nobody has asked yet — and the way to be misled is to read the
// empty list as coverage.
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
 * The known disagreements. There are none: every corpus file the in-repo parser emits is
 * byte-equal to the reference compiler's golden. See the header — an empty list is a
 * measurement over this corpus, not a guarantee over the language.
 *
 * @type {readonly ShadowDivergence[]}
 */
export const SHADOW_DIVERGENCES = [];
