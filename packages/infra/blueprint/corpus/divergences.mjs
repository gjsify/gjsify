// Where the in-repo parser and the reference compiler still disagree, one entry per file.
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
// SELF-RETIRING, IN BOTH DIRECTIONS
//
// `check-blueprint-corpus.mjs` stage C fails on a file that diverges and is NOT listed here,
// and it fails on a file that is listed here and no longer diverges. The second half is the
// one that keeps this file honest: a ledger that only grows describes a parser nobody
// improved, and a fixed divergence still listed is a claim that stopped being true without
// anyone noticing.
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
// Closing it needs TWO lookups and this repository has one. `ENUM_VALUES` in
// `packages/framework/gtk-host/src/generated/enum-values.mts` already holds
// `'GtkOrientation.vertical': 1` and `'GtkPolicyType.never': 2` — both numbers these eleven
// files need. What is missing is the step before: WHICH enum `GtkBox.orientation` is. The
// runtime half of `@girs/<ns>/vocabulary` gives `OWN_PROPS` (names) and `ENUM_NICKS` (keyed
// by enum GType) and nothing that joins them; the `.d.ts` half types the property, and types
// are erased exactly where an emitter needs them.
//
// Deriving the join is not available: searching the nick lists for a member named `never`
// finds several enums, and guessing between them is the silent-wrong-output failure clause 3
// exists to prevent. So the entries below stay until the vocabulary carries the property's
// enum type, or until some other artefact does.

/**
 * @typedef {Object} ShadowDivergence
 * @property {string} file    `rules/<name>.blp`, or the repo-relative path of a reality probe
 * @property {string} kind    a slug shared by every entry with the SAME cause, so the report
 *                            can say "5 files, one cause" instead of five unrelated numbers
 * @property {string} reason  what the in-repo emitter produces instead, and why it cannot yet
 *                            produce the other thing
 */

/**
 * The known disagreements, one entry per corpus file.
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
        reason: '`orientation: vertical` and `halign: center` — the file written to isolate exactly this — the emitter has no enum table and no caller gave it a resolver.',
    },
    {
        file: 'rules/15-comments.blp',
        kind: 'enum-member-unresolved',
        reason: '`orientation: vertical`, incidental here: the rule under test is comments — the emitter has no enum table and no caller gave it a resolver.',
    },
    {
        file: 'showcases/dom/canvas2d-fireworks/src/gjs/fireworks-window.blp',
        kind: 'enum-member-unresolved',
        reason: '`orientation: vertical` on the content box — the emitter has no enum table and no caller gave it a resolver.',
    },
    {
        file: 'showcases/dom/excalibur-jelly-jumper/src/gjs/jelly-jumper-window.blp',
        kind: 'enum-member-unresolved',
        reason: '`orientation: vertical` on the content box — the emitter has no enum table and no caller gave it a resolver.',
    },
    {
        file: 'showcases/dom/three-geometry-teapot/src/gjs/teapot-window.blp',
        kind: 'enum-member-unresolved',
        reason: '`orientation: vertical` on the content box — the emitter has no enum table and no caller gave it a resolver.',
    },
    {
        file: 'showcases/dom/three-loader-ldraw/src/gjs/ldraw-window.blp',
        kind: 'enum-member-unresolved',
        reason: '`orientation: vertical` on the content box — the emitter has no enum table and no caller gave it a resolver.',
    },
    {
        file: 'showcases/dom/three-postprocessing-pixel/src/gjs/pixel-window.blp',
        kind: 'enum-member-unresolved',
        reason: '`orientation: vertical` on the content box — the emitter has no enum table and no caller gave it a resolver.',
    },
    {
        file: 'showcases/gtk/effect-adw-services/src/window.blp',
        kind: 'enum-member-unresolved',
        reason: '`hscrollbar-policy: never` — the only one of the eleven that is not an orientation, and the reason this ledger is keyed by file rather than by member — the emitter has no enum table and no caller gave it a resolver.',
    },
    {
        file: 'templates/adw-canvas2d/src/main-window.blp',
        kind: 'enum-member-unresolved',
        reason: '`orientation: vertical` on the content box — the emitter has no enum table and no caller gave it a resolver.',
    },
    {
        file: 'templates/adw-game/src/main-window.blp',
        kind: 'enum-member-unresolved',
        reason: '`orientation: vertical` on the content box — the emitter has no enum table and no caller gave it a resolver.',
    },
    {
        file: 'templates/adw-webgl/src/main-window.blp',
        kind: 'enum-member-unresolved',
        reason: '`orientation: vertical` on the content box — the emitter has no enum table and no caller gave it a resolver.',
    },
];
