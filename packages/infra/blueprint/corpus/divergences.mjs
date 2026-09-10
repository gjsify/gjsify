// Where the in-repo parser and the reference compiler still disagree, one entry per file,
// pinned to the exact lines.
//
// ADR 0053 clause 5 runs the parser in SHADOW until it is silent: `blueprint-compiler` stays
// authoritative for the build, the in-repo parser runs beside it and reports every
// divergence, and it becomes authoritative when it reports none. This file is what "reports"
// means — the shadow run is a GATE, not a log line, and a gate needs to know which
// disagreements are known.
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
// cause(s)". So each entry now names the lines it excuses and what stands on them, and any
// other difference in the same file is a failure. The eleven files below hold 23 lines
// between them; those 23 are excused and every other line is held to the golden.
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

// THE ONE CAUSE LISTED TODAY, AND WHAT IT WOULD TAKE TO RETIRE IT
//
// `enum-member-unresolved`. `orientation: vertical` reaches the XML as
// `<property name="orientation">1</property>`: the reference compiler resolves the member
// against the installed typelib. The in-repo emitter takes a `resolveEnum` from its caller
// and, with none, emits the identifier as written — it invents no number and carries no enum
// table, because a special case in an emitter is invisible to every reader of the output.
//
// Three members across three enums account for all 23 lines: `GtkOrientation.vertical` (17),
// `GtkPolicyType.never` (5) and `GtkAlign.center` (1). `hscrollbar-policy` is NOT confined to
// one file — it stands in five of the eleven — which is why this ledger is keyed by file and
// line rather than by member.
//
// Closing it needs TWO lookups and this repository has one. `ENUM_VALUES` in
// `packages/framework/gtk-host/src/generated/enum-values.mts` already holds
// `'GtkOrientation.vertical': 1`, `'GtkPolicyType.never': 2` and `'GtkAlign.center': 3` —
// all three numbers these eleven files need. What is missing is the step before: WHICH enum
// `GtkBox.orientation` is. Its neighbour `surface-data.mts` gives `OWN_PROPS`, which is
// property NAMES per GType and carries no types; `props.ts` beside them does hold the join,
// as a TypeScript type (`orientation?: GtkOrientationNick | Gtk.Orientation`), and a type is
// erased exactly where an emitter needs a value. Both `.mts` files also say of themselves
// that they are test-only and outside the library build glob, so importing them from a
// package would be a second problem stacked on the first.
//
// Deriving the join instead of reading it is not available: searching the nick lists for a
// member named `never` finds several enums, and guessing between them is the silent-wrong-
// output failure clause 3 exists to prevent. So the entries below stay until some generated
// artefact carries the property's enum type as a VALUE — the generator behind `props.ts`
// already knows it, which is what makes this a small piece of work rather than an open
// question.

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

const NO_RESOLVER = 'the emitter has no enum table and no caller gave it a resolver';

/** `orientation: vertical`, the member behind 17 of the 23 lines. @param {number} line */
const vertical = (line) => ({
    line,
    golden: '<property name="orientation">1</property>',
    inRepo: '<property name="orientation">vertical</property>',
});

/** `orientation: horizontal`. @param {number} line */
const horizontal = (line) => ({
    line,
    golden: '<property name="orientation">0</property>',
    inRepo: '<property name="orientation">horizontal</property>',
});

/** `hscrollbar-policy: never`. @param {number} line */
const never = (line) => ({
    line,
    golden: '<property name="hscrollbar-policy">2</property>',
    inRepo: '<property name="hscrollbar-policy">never</property>',
});

/** `halign: center`, the only `GtkAlign` in the corpus. @param {number} line */
const center = (line) => ({
    line,
    golden: '<property name="halign">3</property>',
    inRepo: '<property name="halign">center</property>',
});

/**
 * The known disagreements, one entry per corpus file and one row per excused line.
 *
 * Eleven of the thirty-six, all one cause. That the count is eleven and the causes one is
 * the useful shape: a parser with eleven unrelated problems is unfinished, and a parser with
 * one problem eleven times is waiting on a fact it is not allowed to invent.
 *
 * @type {readonly ShadowDivergence[]}
 */
export const SHADOW_DIVERGENCES = [
    {
        file: 'rules/03-property-enum.blp',
        kind: 'enum-member-unresolved',
        lines: [vertical(10), center(11)],
        reason: `\`orientation: vertical\` and \`halign: center\` — the file written to isolate exactly this, and the only \`GtkAlign\` in the corpus — ${NO_RESOLVER}.`,
    },
    {
        file: 'rules/15-comments.blp',
        kind: 'enum-member-unresolved',
        lines: [vertical(10)],
        reason: `\`orientation: vertical\`, incidental here: the rule under test is comments — ${NO_RESOLVER}.`,
    },
    {
        file: 'showcases/dom/canvas2d-fireworks/src/gjs/fireworks-window.blp',
        kind: 'enum-member-unresolved',
        lines: [vertical(29), never(55), vertical(58)],
        reason: `two \`orientation: vertical\` and one \`hscrollbar-policy: never\` — ${NO_RESOLVER}.`,
    },
    {
        file: 'showcases/dom/excalibur-jelly-jumper/src/gjs/jelly-jumper-window.blp',
        kind: 'enum-member-unresolved',
        lines: [vertical(15)],
        reason: `\`orientation: vertical\` on the content box, the only enum in the file — ${NO_RESOLVER}.`,
    },
    {
        file: 'showcases/dom/three-geometry-teapot/src/gjs/teapot-window.blp',
        kind: 'enum-member-unresolved',
        lines: [vertical(29), never(55), vertical(58)],
        reason: `two \`orientation: vertical\` and one \`hscrollbar-policy: never\` — ${NO_RESOLVER}.`,
    },
    {
        file: 'showcases/dom/three-loader-ldraw/src/gjs/ldraw-window.blp',
        kind: 'enum-member-unresolved',
        lines: [vertical(15), horizontal(21), never(28), vertical(31), vertical(96)],
        reason: `the widest of the eleven: four \`orientation\` members across both nicks and one \`hscrollbar-policy: never\` — ${NO_RESOLVER}.`,
    },
    {
        file: 'showcases/dom/three-postprocessing-pixel/src/gjs/pixel-window.blp',
        kind: 'enum-member-unresolved',
        lines: [vertical(29), never(55), vertical(58)],
        reason: `two \`orientation: vertical\` and one \`hscrollbar-policy: never\` — ${NO_RESOLVER}.`,
    },
    {
        file: 'showcases/gtk/effect-adw-services/src/window.blp',
        kind: 'enum-member-unresolved',
        lines: [never(27), vertical(33)],
        reason: `one \`hscrollbar-policy: never\` and one \`orientation: vertical\` — ${NO_RESOLVER}.`,
    },
    {
        file: 'templates/adw-canvas2d/src/main-window.blp',
        kind: 'enum-member-unresolved',
        lines: [vertical(15)],
        reason: `\`orientation: vertical\` on the content box, the only enum in the file — ${NO_RESOLVER}.`,
    },
    {
        file: 'templates/adw-game/src/main-window.blp',
        kind: 'enum-member-unresolved',
        lines: [vertical(15)],
        reason: `\`orientation: vertical\` on the content box, the only enum in the file — ${NO_RESOLVER}.`,
    },
    {
        file: 'templates/adw-webgl/src/main-window.blp',
        kind: 'enum-member-unresolved',
        lines: [vertical(15)],
        reason: `\`orientation: vertical\` on the content box, the only enum in the file — ${NO_RESOLVER}.`,
    },
];
