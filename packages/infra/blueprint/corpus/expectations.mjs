// WHAT EVERY CORPUS FILE SHOULD PROJECT TO, WRITTEN BY HAND
//
// ADR 0053 clause 2: the equivalence between Blueprint and the node shape ADR 0051's
// renderers consume is PROVED, not asserted — "for every `.blp` in the corpus a
// hand-written `SharedNode` tree states what it should parse to, and the parser is
// held to it". This file is that statement. It was written by reading the `.blp` and
// the `SharedNode` contract, never by running anything: an expectation derived from
// an implementation grades the implementation against itself.
//
// THE PROJECTION IS LOSSY BY DECISION, SO EVERY LOSS IS NAMED HERE
//
// ADR 0053 clause 1 makes `SharedNode` a DECLARED projection of the parser's AST,
// "whose losses are … named at the seam rather than discovered downstream". So each
// entry carries `lost`, and an entry with an empty `lost` is a claim that NOTHING in
// that file falls outside `SharedNode` — the strongest claim here, and the one worth
// getting wrong loudly.
//
// Comments are the one loss not listed per entry: no notation in this repo carries
// them into a tree, and repeating that twenty times would bury the losses that are
// specific to a file. `15-comments.blp` is where the rule is under test.
//
// WHAT WRITING THESE OUT FOUND, WHICH THE ADR DID NOT NAME
//
//  1. `slot` CONFLATES TWO GtkBuilder CONSTRUCTS. `[start]` is `<child type="start">`
//     — a placement on the child wrapper — and `content:` is `<property
//     name="content">` — an object as a property value. `SharedNode` has one field
//     for both, so the projection cannot be inverted: from `slot: 'content'` alone
//     nothing says which of the two constructs to emit. ADR 0053 § Context has the two
//     halves of this in adjacent rows of its mapping table — `[start]` and `content:`
//     both land on `slot` — but draws no consequence from it: round-tripping Blueprint
//     through `SharedNode` is not available without a shape change, and no ADR had said
//     so.
//
//  2. `styles [...]` HAS NOWHERE TO GO, AND THAT MOVES A ROW OF THE ADR. ADR 0049
//     decided style classes are a LIST, and `SharedNode['props']` is `Record<string,
//     string | number | boolean>`. A space-joined string would be a lie about the shape
//     0049 chose, so this file records a loss instead. Note precisely what that
//     refutes: ADR 0053 § Context's table maps `styles ["flat"]` to `cssClasses:
//     ['flat']` and calls it GIR-derived — a field `SharedNode` does not have, holding
//     a value its `props` cannot hold. That row is the one 0053 § Consequences said to
//     expect ("the honest expectation is that the first suite moves at least one row of
//     it"), and this is it, moved. `layout { }` and `accessibility { }` are the same
//     shape and were in no row at all. All of it is evidence for, not an answer to, the
//     open question 0053 leaves about whether `SharedNode` grows to hold the portable
//     values of ADRs 0042 / 0046 / 0047.
//
//  3. AN ID REFERENCE SURVIVES AS A PLAIN STRING. `menu-model: mainMenu` projects to
//     `props: { 'menu-model': 'mainMenu' }`, indistinguishable from the literal
//     string `"mainMenu"`. The reference is kept and its REFERENCE-NESS is lost, and
//     the object it names is lost with the id it was declared under.
//
//  4. THE SOURCE SPELLING IS WHAT PROJECTS, NOT THE RESOLVED VALUE. `orientation:
//     vertical` projects as the string `'vertical'` while the XML carries `1`. Both
//     are right — they are two exits from one AST — but it means a `SharedNode` and
//     a `.ui` from the same file are NOT two views of the same values, and no
//     conformance check may treat them as such.
//
// `real-expectations.mjs` adds four more that only the shipped files show, and does not
// repeat these.
//
// TWO CONVENTIONS, WRITTEN DOWN BECAUSE THEY WOULD OTHERWISE BE RE-DERIVED FROM EXAMPLES
//
//   THE LINE A LOSS NAMES is the line of the construct that is dropped, and where that
//   construct spans lines it is the OPENING one: the object line for `object-id`,
//   `breakpoint` and `sibling-object` (never the bracket above it), the property line
//   for `translatable`, `binding` and `value-list`, the `styles [` / `layout {` /
//   `accessibility {` line for those three.
//
//   `children` IS IN SOURCE ORDER, including where bracket-derived and
//   property-derived children interleave. GtkBuilder puts the two in different places,
//   so source order and emitted order need not agree, and this file states the source
//   one because it is the one a reader of the `.blp` can check.
//
// @import {SharedNode} from '../../../../scripts/adwaita-gallery-shared-trees.mjs'

/**
 * The constructs that fall outside `SharedNode`. Five of these are the ones ADR 0053
 * clause 3 names from the census of the eleven real files; the rest are what a corpus
 * written per LANGUAGE RULE rather than per real file turns up, which is the point of
 * having one.
 *
 * @typedef {'template'|'object-id'|'translatable'|'signal'|'binding'|'breakpoint'
 *          |'menu'|'styles'|'layout'|'accessibility'|'comment'|'value-list'
 *          |'sibling-object'} LossKind
 */

/**
 * @typedef {Object} ProjectionLoss
 * @property {LossKind} kind
 * @property {number} line    1-based line in the `.blp`, so a divergence names a place
 * @property {string} detail  what is dropped, in the source's own words
 */

/**
 * @typedef {Object} CorpusExpectation
 * @property {string} file  file name under `rules/`
 * @property {SharedNode} node  what the projection must produce
 * @property {readonly ProjectionLoss[]} lost
 * @property {string} [note]  something true of this file that the tree cannot say
 */

/** @type {readonly CorpusExpectation[]} */
export const RULE_EXPECTATIONS = [
    {
        file: '01-object-minimal.blp',
        node: { tag: 'GtkBox' },
        lost: [],
    },
    {
        file: '02-property-scalars.blp',
        node: {
            tag: 'GtkLabel',
            props: { label: 'plain text', 'width-chars': 12, xalign: 0.25, wrap: true, selectable: false },
        },
        lost: [],
        note: 'The three value kinds `SharedNode` admits, and the only file here that needs no loss and no caveat.',
    },
    {
        file: '03-property-enum.blp',
        node: { tag: 'GtkBox', props: { orientation: 'vertical', halign: 'center' } },
        lost: [],
        note: 'The XML for the same two properties is `1` and `3`. The projection keeps the member NAME, which is the only spelling a renderer without a typelib can act on.',
    },
    {
        file: '04-children-implicit.blp',
        node: {
            tag: 'GtkBox',
            children: [
                { tag: 'GtkLabel', props: { label: 'first' } },
                { tag: 'GtkLabel', props: { label: 'second' } },
            ],
        },
        lost: [],
    },
    {
        file: '05-child-slot-named.blp',
        node: {
            tag: 'AdwHeaderBar',
            children: [
                { tag: 'GtkButton', slot: 'start', props: { label: 'back' } },
                { tag: 'GtkButton', slot: 'end', props: { label: 'menu' } },
            ],
        },
        lost: [],
        note: 'No tree in `ADWAITA_GALLERY_SHARED_TREES` uses `slot` yet — its header says the two renderers spell slots differently — so these are the BLUEPRINT spellings and what a renderer does with them is not decided here.',
    },
    {
        file: '06-property-object-valued.blp',
        node: { tag: 'AdwToolbarView', children: [{ tag: 'GtkLabel', slot: 'content', props: { label: 'body' } }] },
        lost: [],
        note: 'Same `slot` field as `05`, different GtkBuilder construct — see finding 1 in the header of this file.',
    },
    {
        file: '07-object-id.blp',
        node: { tag: 'GtkBox', children: [{ tag: 'GtkLabel', props: { label: 'named' } }] },
        lost: [{ kind: 'object-id', line: 4, detail: 'the id `labelOne`' }],
    },
    {
        file: '08-template.blp',
        node: { tag: 'AdwBin', children: [{ tag: 'GtkLabel', slot: 'child', props: { label: 'in a template' } }] },
        lost: [
            {
                kind: 'template',
                line: 4,
                detail: 'the template class `$CorpusWindow`; only its parent type `Adw.Bin` survives, as the root tag',
            },
        ],
    },
    {
        file: '09-translatable.blp',
        node: {
            tag: 'GtkBox',
            children: [
                { tag: 'GtkLabel', props: { label: 'translated' } },
                { tag: 'GtkLabel', props: { label: 'context-translated' } },
            ],
        },
        lost: [
            {
                kind: 'translatable',
                line: 5,
                detail: 'the `_()` marking; the string survives, its translatability does not',
            },
            { kind: 'translatable', line: 9, detail: 'the `C_()` marking AND the message context `noun`' },
        ],
        note: 'The costly loss: ADR 0033 prefers declarative templates partly BECAUSE `.blp` marks translatable strings, and this is the exit where that marking stops.',
    },
    {
        file: '10-styles.blp',
        node: { tag: 'GtkButton', props: { label: 'styled' } },
        lost: [
            {
                kind: 'styles',
                line: 6,
                detail: 'the style classes `flat` and `circular` — a list, and `props` holds no lists (ADR 0049)',
            },
        ],
    },
    {
        file: '11-signal.blp',
        node: { tag: 'GtkButton', props: { label: 'press' } },
        lost: [{ kind: 'signal', line: 5, detail: 'the handler binding `clicked => $onClicked()`' }],
    },
    {
        file: '12-menu.blp',
        node: { tag: 'GtkMenuButton', props: { 'menu-model': 'mainMenu' } },
        lost: [
            {
                kind: 'menu',
                line: 3,
                detail: 'the whole `menu mainMenu { … }`, which is a sibling of the object and not a widget at all',
            },
        ],
        note: 'The file has TWO top-level things and `SharedNode` is one tree, so the projection has to pick; it keeps the widget. ADR 0042 already made menus a portable value, so this is the loss most likely to be closed by a shape change rather than by a refusal.',
    },
    {
        file: '13-binding.blp',
        node: {
            tag: 'GtkBox',
            children: [{ tag: 'GtkSwitch' }, { tag: 'GtkLabel', props: { label: 'bound visibility' } }],
        },
        lost: [
            { kind: 'object-id', line: 4, detail: 'the id `switchOne`, which the binding on line 8 needs' },
            {
                kind: 'binding',
                line: 8,
                detail: '`visible: bind switchOne.active` — the property is dropped entirely, not defaulted',
            },
        ],
        note: 'Dropping the property rather than guessing a value is the point: a projected `visible: true` would be a fact the source never stated.',
    },
    {
        file: '14-breakpoint.blp',
        node: { tag: 'AdwWindow', children: [{ tag: 'AdwBin', slot: 'content' }] },
        lost: [
            { kind: 'object-id', line: 5, detail: 'the id `binOne`, which both setters (lines 12-13) need' },
            {
                kind: 'breakpoint',
                line: 8,
                detail: 'the whole `Adw.Breakpoint` child: its `condition ("max-width: 400px")` and both of its setters',
            },
        ],
    },
    {
        file: '15-comments.blp',
        node: {
            tag: 'GtkBox',
            props: { orientation: 'vertical' },
            children: [{ tag: 'GtkLabel', props: { label: 'commented' } }],
        },
        lost: [{ kind: 'comment', line: 3, detail: 'five comments in four positions; none reaches either exit' }],
        note: 'Listed here and nowhere else. The rule under test is that a comment changes neither exit, in the four positions this file reaches: before the object, before a property, trailing after one, and before a child. Three further positions are legal and NOT here — between a `[slot]` bracket and the object it labels, between a property `:` and its value, and inside a `styles [ … ]` list — so "any legal position" is not what this file proves.',
    },
    {
        file: '16-string-escapes.blp',
        node: {
            tag: 'GtkBox',
            children: [
                { tag: 'GtkLabel', props: { label: 'a "quoted" word' } },
                { tag: 'GtkLabel', props: { label: 'an ampersand & a less-than <' } },
                { tag: 'GtkLabel', props: { label: 'a backslash \\ and a newline \n' } },
            ],
        },
        lost: [],
        note: 'The projection holds the DECODED string. The XML holds an escaped one — `&amp;`, `&lt;`, and a literal newline — so the two exits differ character by character here on purpose.',
    },
    {
        file: '17-numeric-forms.blp',
        node: {
            tag: 'GtkBox',
            props: { spacing: 0 },
            children: [
                { tag: 'GtkLabel', props: { xalign: 1, 'margin-top': 12 } },
                { tag: 'GtkLabel', props: { xalign: 0.5, 'width-chars': -1 } },
                { tag: 'GtkLabel', props: { xalign: 0.25 } },
            ],
        },
        lost: [],
        note: 'The source writes `1.0` and this says `1`, because JavaScript has one number type and cannot hold the difference. That is not a projection loss — it is a limit of the language the expectation is written in, and it is why the `.ui` golden and not this file is the oracle for number FORMATTING.',
    },
    {
        file: '18-multiple-imports.blp',
        node: {
            tag: 'AdwBin',
            children: [{ tag: 'GtkLabel', slot: 'child', props: { label: 'from two namespaces' } }],
        },
        lost: [],
        note: 'The `using` lines project to nothing, and they do not reach the XML symmetrically either: the golden carries `<requires lib="gtk" version="4.0"/>` and nothing for `Adw`. What they ARE consumed for is qualified-name lookup; the UNqualified case is narrower than it looks and `24-unqualified-type.blp` states it.',
    },
    {
        file: '19-layout.blp',
        node: { tag: 'GtkGrid', children: [{ tag: 'GtkLabel', props: { label: 'cell' } }] },
        lost: [
            {
                kind: 'layout',
                line: 7,
                detail: 'the `layout { column: 0; row: 1; }` block — properties of the PLACEMENT of the child, which `SharedNode` has no field for',
            },
        ],
    },
    {
        file: '20-accessibility.blp',
        node: { tag: 'GtkButton', props: { label: 'described' } },
        lost: [
            {
                kind: 'accessibility',
                line: 6,
                detail: 'the `accessibility { label: … }` block; note it collides by NAME with the `label` property of the widget itself, which is why it cannot simply be folded into `props`',
            },
        ],
    },
    {
        file: '21-value-array.blp',
        node: { tag: 'GtkDropDown', children: [{ tag: 'GtkStringList', slot: 'model' }] },
        lost: [
            {
                kind: 'value-list',
                line: 5,
                detail: 'the two strings of the model, because `props` holds no lists — so what projects is a StringList with nothing in it',
            },
        ],
        note: 'The one projection here that is worse than lossy: an empty model reads as a legitimate tree and renders an empty dropdown, where every other loss at least leaves the node visibly incomplete.',
    },
    {
        file: '22-menu-nested.blp',
        node: { tag: 'GtkMenuButton', props: { 'menu-model': 'nestedMenu' } },
        lost: [
            {
                kind: 'menu',
                line: 3,
                detail: 'the whole menu, one level deeper than in `12` and with two items written in the `item (label, action)` shorthand',
            },
        ],
        note: 'The two shorthand items differ only in `_()`, and the golden marks exactly the marked one. So the shorthand IS sugar for the long form, and `translatable="yes"` follows the marking and never the form — a parser that ties the attribute to the form is wrong in both directions.',
    },
    {
        file: '23-widget-reference-list.blp',
        node: {
            tag: 'GtkBox',
            children: [{ tag: 'GtkLabel' }, { tag: 'GtkLabel' }],
        },
        lost: [
            { kind: 'object-id', line: 4, detail: 'the id `labelA`, which the list on line 12 points at from line 13' },
            { kind: 'object-id', line: 7, detail: 'the id `labelB`, which the same list points at from line 14' },
            {
                kind: 'sibling-object',
                line: 11,
                detail: 'the whole `Gtk.SizeGroup` — a second top-level object, and `SharedNode` is one tree, so the projection keeps the widget one',
            },
        ],
        note: 'Two losses that only matter together: dropping the ids is survivable until something else references them, and here the reference is what carries the meaning.',
    },
    {
        file: '24-unqualified-type.blp',
        node: { tag: 'GtkBox', children: [{ tag: 'GtkToggleButton', props: { label: 'unqualified' } }] },
        lost: [],
        note: 'Three of the eleven real files write a bare `ToggleButton`, so this is not a corner of the grammar. It is the second place the parser needs GIR knowledge and not only syntax, beside the enum resolution recorded as the `surprise` on `03-property-enum.blp`. The lookup is against Gtk ALONE — a bare `Bin` is refused with `using Adw 1;` in the file — so a parser that searches every import accepts what the compiler rejects.',
    },
    {
        file: '25-bracket-breakpoint.blp',
        node: {
            tag: 'AdwBreakpointBin',
            props: { 'width-request': 200, 'height-request': 200 },
            children: [{ tag: 'GtkLabel' }],
        },
        lost: [
            { kind: 'object-id', line: 8, detail: 'the id `labelOne`, which the setter on line 16 needs' },
            {
                kind: 'breakpoint',
                line: 12,
                detail: 'the whole `[breakpoint]` child, named on its object line and not on the bracket above it',
            },
        ],
        note: 'Written to settle a case `14-breakpoint.blp` leaves open: a bracket and a refused construct on the same child. The bracket wins nothing — the child goes, and its slot goes with it.',
    },
    {
        file: '26-one-line-members.blp',
        node: {
            tag: 'GtkButton',
            props: { label: 'on one line', 'margin-top': 4 },
            children: [{ tag: 'GtkLabel' }],
        },
        lost: [
            {
                kind: 'signal',
                line: 6,
                detail: 'the handler binding `clicked => $onClicked()`, which shares its line with the property beside it',
            },
        ],
        note: 'Written for the ORDER, which no tree here can show: the golden puts the child before the property on line 4 and the signal before the property on line 6, and sorting by line alone cannot produce that. `SharedNode` has no signal, so the projection sees only half of what this file pins.',
    },
];
