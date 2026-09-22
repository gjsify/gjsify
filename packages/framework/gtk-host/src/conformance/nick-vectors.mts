// The nick vocabulary, one row per edge, read off the REAL widget.
//
// ENUMS AND BITFIELDS IN ONE TABLE, because they are one resolver: `coerce` hands
// both to `gtk_builder_value_from_string_type`, the parser every enum and flags
// attribute of a `.ui` file already goes through. Splitting the table would let the
// two drift into two vocabularies, which is the thing the shared parser removed.
//
// WHAT THE ROWS ARE FOR. GTK's failure mode is exit 0, and on the flags side it is
// worse than silence: measured on GTK 4.22.4, `""` and `" "` parse to `[true, 0]`, so
// an empty nick set is a widget with every flag cleared, no diagnostic and a green
// test. Two rows exist for that one value, and the outcome is the ERROR CODE rather
// than a message substring — a message can be reworded, a code is the contract.
//
// `.mts` ON PURPOSE, the same hard constraint as `vectors.mts` beside it: the library
// build globs `src/**/*.{ts,js}`, so a table here never reaches `lib/esm/` and can
// never be pulled into a published subpath.

/** What GObject must end up holding, or the refusal that must reach the caller. */
export type NickOutcome = { readonly holds: number } | { readonly refuses: string };

export interface NickVector {
    /** What this row is about — a failing row prints it. */
    readonly what: string;
    readonly tag: string;
    /** Kebab, as GObject knows the property. */
    readonly prop: string;
    /** What a template, a JSX file or a renderer writes. */
    readonly authored: string | number;
    readonly outcome: NickOutcome;
}

/**
 * Every edge of nick resolution, against four bitfields and three enums.
 *
 * MORE THAN ONE BITFIELD TYPE ON PURPOSE. `GtkInputHints` alone would prove the
 * parser and nothing about the JOIN that finds it: the type surface reaches a
 * bitfield through `PROP_ENUMS`, keyed by the DECLARING type, so a property inherited
 * from an interface (`GtkEditable`) and one declared on the class itself take
 * different routes to the same answer.
 */
export const NICK_VECTORS: readonly NickVector[] = [
    // ── One member.
    {
        what: 'a single nick, the spelling GObject registers',
        tag: 'GtkEntry',
        prop: 'input-hints',
        authored: 'spellcheck',
        outcome: { holds: 1 },
    },
    {
        what: 'the zero member is a member, not an absence',
        tag: 'GtkEntry',
        prop: 'input-hints',
        authored: 'none',
        outcome: { holds: 0 },
    },
    // ── The SET, which is the whole point: GObject resolves no nick set, GTK does.
    {
        what: 'two nicks joined with "|" — 1 | 8',
        tag: 'GtkEntry',
        prop: 'input-hints',
        authored: 'spellcheck|lowercase',
        outcome: { holds: 9 },
    },
    {
        what: 'three nicks joined — 1 | 8 | 4',
        tag: 'GtkEntry',
        prop: 'input-hints',
        authored: 'spellcheck|lowercase|word-completion',
        outcome: { holds: 13 },
    },
    {
        what: 'whitespace around the separator, as a hand-written template carries it',
        tag: 'GtkEntry',
        prop: 'input-hints',
        authored: 'spellcheck | lowercase',
        outcome: { holds: 9 },
    },
    {
        what: 'a second bitfield type, on a property the class declares itself',
        tag: 'AdwTabView',
        prop: 'shortcuts',
        authored: 'control-tab|control-shift-tab',
        outcome: { holds: 3 },
    },
    {
        what: 'a third bitfield type, reached through a Gdk enum',
        tag: 'GtkGLArea',
        prop: 'allowed-apis',
        authored: 'gl|gles',
        outcome: { holds: 3 },
    },
    {
        what: 'the same property inherited from GtkEditable rather than declared',
        tag: 'AdwEntryRow',
        prop: 'input-hints',
        authored: 'uppercase-words|emoji',
        outcome: { holds: 544 },
    },
    // ── Spellings GTK's own parser accepts. Measured, not assumed: this host takes
    // exactly what a `.ui` file takes, so the vocabulary has one definition.
    {
        what: 'mixed case — the source accepts it, so the surface does',
        tag: 'GtkEntry',
        prop: 'input-hints',
        authored: 'SpellCheck',
        outcome: { holds: 1 },
    },
    {
        what: 'the C member name, which a ported example carries',
        tag: 'GtkEntry',
        prop: 'input-hints',
        authored: 'GTK_INPUT_HINT_LOWERCASE',
        outcome: { holds: 8 },
    },
    // ── The number still works. This is the row that would go quiet if the string
    // path ever started swallowing what it cannot read.
    {
        what: 'the numeric value, which every renderer could already write',
        tag: 'GtkEntry',
        prop: 'input-hints',
        authored: 9,
        outcome: { holds: 9 },
    },
    {
        what: 'a numeric STRING, which a DOM-shaped renderer hands over',
        tag: 'GtkEntry',
        prop: 'input-hints',
        authored: '9',
        outcome: { holds: 9 },
    },
    // ── Refusals. An unknown member must be LOUD: GObject's own answer is to keep
    // the old value and say nothing.
    {
        what: 'an unknown nick on its own',
        tag: 'GtkEntry',
        prop: 'input-hints',
        authored: 'spellchek',
        outcome: { refuses: 'bad-flags' },
    },
    {
        what: 'an unknown nick INSIDE a set that otherwise reads fine',
        tag: 'GtkEntry',
        prop: 'input-hints',
        authored: 'spellcheck|lowecase',
        outcome: { refuses: 'bad-flags' },
    },
    // ── The silent zero. GTK answers every one of these without a diagnostic or
    // with none that names the property, so the host refuses them by name.
    {
        what: 'the empty string, which GTK reads as every flag cleared',
        tag: 'GtkEntry',
        prop: 'input-hints',
        authored: '',
        outcome: { refuses: 'blank-flags' },
    },
    {
        what: 'whitespace only, the same zero one space further along',
        tag: 'GtkEntry',
        prop: 'input-hints',
        authored: ' ',
        outcome: { refuses: 'blank-flags' },
    },
    {
        what: 'a trailing separator',
        tag: 'GtkEntry',
        prop: 'input-hints',
        authored: 'spellcheck|',
        outcome: { refuses: 'blank-flags' },
    },
    {
        what: 'a LEADING separator, which GTK drops without a word',
        tag: 'GtkEntry',
        prop: 'input-hints',
        authored: '|spellcheck',
        outcome: { refuses: 'blank-flags' },
    },
    // ── Enums, through the same parser. The rows that would notice the flags work
    // widening what an enum property accepts.
    {
        what: 'an enum nick still resolves',
        tag: 'GtkBox',
        prop: 'orientation',
        authored: 'vertical',
        outcome: { holds: 1 },
    },
    {
        what: 'an enum nick in mixed case',
        tag: 'GtkBox',
        prop: 'orientation',
        authored: 'VERTICAL',
        outcome: { holds: 1 },
    },
    {
        what: 'a Pango enum — GtkLabel is in the shipped table',
        tag: 'GtkLabel',
        prop: 'ellipsize',
        authored: 'end',
        outcome: { holds: 3 },
    },
    {
        what: 'an unknown enum nick is refused by name',
        tag: 'GtkBox',
        prop: 'orientation',
        authored: 'sideways',
        outcome: { refuses: 'bad-enum' },
    },
    {
        what: 'a nick SET on an ENUM property, which is not a thing GObject has',
        tag: 'GtkBox',
        prop: 'orientation',
        authored: 'horizontal|vertical',
        outcome: { refuses: 'bad-enum' },
    },
    {
        what: 'the empty string on an enum property',
        tag: 'GtkBox',
        prop: 'orientation',
        authored: '',
        outcome: { refuses: 'bad-enum' },
    },
];
