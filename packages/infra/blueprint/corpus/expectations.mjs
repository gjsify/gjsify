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
 * `extern` is the odd one and worth reading twice: it is the only kind where the projection
 * keeps the TEXT and loses the meaning. `SharedNode.tag` is a GIR class name, which is what a
 * renderer looks up; `$MyWidget` is a class the application registers at runtime and is in no
 * GIR, so the tag is spelled exactly right and resolves to nothing. Declared here rather than
 * discovered as a missing widget.
 *
 * @typedef {'template'|'object-id'|'translatable'|'signal'|'binding'|'breakpoint'
 *          |'menu'|'styles'|'layout'|'accessibility'|'comment'|'value-list'
 *          |'sibling-object'|'responses'|'extern'} LossKind
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
            props: {
                label: 'plain text',
                'tooltip-text': 'single-quoted',
                name: '',
                'width-chars': 12,
                xalign: 0.25,
                wrap: true,
                selectable: false,
            },
        },
        lost: [],
        note: 'The three value kinds `SharedNode` admits, and the only file here that needs no loss and no caveat. A string arrives in either quote and may be empty; the projection holds the decoded value, so the quotes are gone and the empty one is `""`.',
    },
    {
        file: '03-property-enum.blp',
        node: { tag: 'GtkBox', props: { orientation: 'vertical', halign: 'center', valign: 'baseline_fill' } },
        lost: [],
        note: 'The XML for the same three properties is `1`, `3` and `4`. The projection keeps the member NAME, which is the only spelling a renderer without a typelib can act on — and keeps it AS WRITTEN, underscores and all, because the `_`-to-`-` normalisation belongs to the GIR lookup the XML exit performs and a renderer that never does that lookup would be handed a spelling from nowhere.',
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
        node: {
            tag: 'GtkBox',
            children: [
                { tag: 'GtkLabel', props: { label: 'named' } },
                { tag: 'GtkLabel', props: { label: 'hyphenated' } },
            ],
        },
        lost: [
            { kind: 'object-id', line: 3, detail: 'the id `rootBox` on the ROOT object' },
            { kind: 'object-id', line: 4, detail: 'the id `labelOne`' },
            {
                kind: 'object-id',
                line: 8,
                detail: 'the id `label-two` — an id may carry a hyphen, and the loss is the same',
            },
        ],
    },
    {
        file: '08-template.blp',
        node: {
            tag: 'AdwBin',
            props: { halign: 'center' },
            children: [{ tag: 'GtkLabel', slot: 'child', props: { label: 'in a template' } }],
        },
        lost: [
            {
                kind: 'template',
                line: 4,
                detail: 'the template class `$CorpusWindow`; only its parent type `Adw.Bin` survives, as the root tag',
            },
        ],
        note: '`halign` sits on the template itself. The XML resolves it against the PARENT type (`3` through `Adw.Bin`, which has no ParamSpecs of its own yet); here it keeps the member name like every enum.',
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
        node: { tag: 'GtkBox', children: [{ tag: 'GtkLabel' }, { tag: 'GtkButton', props: { label: 'press' } }] },
        lost: [
            {
                kind: 'object-id',
                line: 4,
                detail: 'the id `labelOne`, which two of the handlers below name as their object',
            },
            { kind: 'signal', line: 9, detail: 'the bare handler binding `clicked => $onClicked()`' },
            { kind: 'signal', line: 10, detail: '`swapped`' },
            { kind: 'signal', line: 11, detail: '`after`' },
            { kind: 'signal', line: 12, detail: 'a handler with an object, `$onRealize(labelOne)`' },
            { kind: 'signal', line: 13, detail: 'an object and `not-swapped`' },
            { kind: 'signal', line: 14, detail: 'a detailed signal, `notify::sensitive`' },
        ],
        note: 'Six spellings of one construct and one loss kind: `SharedNode` has no signal, so the flags, the object and the detail are dropped with the handler. The XML tells them apart — the flags are Python booleans, `swapped="True"` and `swapped="False"`, and `after` appears only when set — which is what `11-signal.ui` pins.',
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
            { kind: 'object-id', line: 4, detail: 'the id `switchOne`, which all five bindings below need' },
            {
                kind: 'binding',
                line: 8,
                detail: '`visible: bind switchOne.active` — the property is dropped entirely, not defaulted',
            },
            { kind: 'binding', line: 9, detail: '`inverted`' },
            { kind: 'binding', line: 10, detail: '`bidirectional`' },
            { kind: 'binding', line: 11, detail: '`no-sync-create`' },
            { kind: 'binding', line: 12, detail: 'all three flags, written in an order the XML does not keep' },
        ],
        note: 'Dropping the property rather than guessing a value is the point: a projected `visible: true` would be a fact the source never stated. The flags go with it; the XML is where they show, and `13-binding.ui` pins that the compiler writes its own order and its own default.',
    },
    {
        file: '14-breakpoint.blp',
        node: { tag: 'AdwWindow', children: [{ tag: 'GtkBox', slot: 'content', children: [{ tag: 'GtkLabel' }] }] },
        lost: [
            { kind: 'object-id', line: 5, detail: 'the id `boxOne`, which three setters (lines 14-16) need' },
            { kind: 'object-id', line: 6, detail: 'the id `labelOne`, which the setter on line 17 needs' },
            {
                kind: 'breakpoint',
                line: 10,
                detail: 'the whole `Adw.Breakpoint` child: its `condition ("max-width: 400px")` and four setters — a bool, a number, an enum member and a translatable string',
            },
        ],
        note: 'The enum setter is the one worth having: it resolves against the object the setter POINTS AT (`boxOne`, a GtkBox) and not the breakpoint it is written in, and the XML carries `1`. The `_()` setter carries `translatable="yes"` on the `<setter>` element itself. Neither is visible from here — the whole breakpoint is one loss.',
    },
    {
        file: '15-comments.blp',
        node: {
            tag: 'GtkCenterBox',
            props: { orientation: 'vertical' },
            children: [{ tag: 'GtkLabel', slot: 'start', props: { label: 'commented' } }],
        },
        lost: [
            { kind: 'comment', line: 1, detail: 'ten comments in nine positions; none reaches either exit' },
            { kind: 'styles', line: 14, detail: 'the style classes `a` and `b`, with two comments between them' },
        ],
        note: 'Listed here and nowhere else. The rule under test is that a comment changes neither exit, and this file reaches every position an earlier version of it listed as unexercised: before the `using` directive, before the object, before a property, between a property `:` and its value, trailing after a property, between a `[slot]` bracket and the object it labels, inside a `styles [ … ]` list (after an item and before one), before the closing brace, and after the last one.',
    },
    {
        file: '16-string-escapes.blp',
        node: {
            tag: 'GtkBox',
            children: [
                { tag: 'GtkLabel', props: { label: 'a "quoted" word' } },
                { tag: 'GtkLabel', props: { label: 'an ampersand & a less-than < a greater-than >' } },
                { tag: 'GtkLabel', props: { label: 'a backslash \\ a tab \t and a newline \n' } },
                { tag: 'GtkLabel', props: { label: 'single quotes, a "double" inside, and it\'s escaped' } },
                { tag: 'GtkLabel', props: { label: 'continued \non the next line' } },
                { tag: 'GtkLabel', props: { label: 'Ünïcödé — ✓' } },
            ],
        },
        lost: [],
        note: 'The projection holds the DECODED string. The XML holds an escaped one — `&amp;`, `&lt;`, `&gt;`, a literal tab and literal newlines — so the two exits differ character by character here on purpose. A backslash before a real line break is a newline in the value and not a continuation that vanishes: the fifth label holds one.',
    },
    {
        file: '17-numeric-forms.blp',
        node: {
            tag: 'GtkBox',
            props: { spacing: 0 },
            children: [
                {
                    tag: 'GtkLabel',
                    props: { xalign: 1, 'margin-top': 12, 'margin-bottom': 16, 'margin-start': 1000, 'margin-end': 5 },
                },
                { tag: 'GtkLabel', props: { xalign: 0.5, 'width-chars': -1, yalign: 0.75 } },
                { tag: 'GtkLabel', props: { xalign: 0.25, 'width-chars': -16, 'max-width-chars': 16 } },
                {
                    tag: 'GtkSpinButton',
                    children: [
                        {
                            tag: 'GtkAdjustment',
                            slot: 'adjustment',
                            props: {
                                lower: 0,
                                upper: 12345678901234568,
                                'step-increment': 0.00005,
                                'page-increment': 100,
                            },
                        },
                    ],
                },
            ],
        },
        lost: [],
        note: 'The source writes `1.0` and this says `1`, `0x10` and this says `16`, `1_000` and `+5` and this says `1000` and `5`, because JavaScript has one number type and cannot hold the spelling. Twice it cannot hold the VALUE either: `-0.0` is `-0` here and `0` in the golden, and `12345678901234567` is one digit off here because a double has 53 bits where the oracle has Python integers, so the golden keeps every digit and this file cannot. None of that is a projection loss — it is a limit of the language the expectation is written in, and it is why the `.ui` golden and not this file is the oracle for number FORMATTING. What this file IS the oracle for is the reading: `1_000` projected as `null` once, and `-0x10` after that was patched, because `Number()` reads neither an underscore nor a sign on a hex string, and the XML exit had handled both all along.',
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
                detail: 'the whole `layout { }` block — properties of the PLACEMENT of the child, which `SharedNode` has no field for. `halign` is in there to pin that the compiler does NOT type these against the widget, and it is lost with the rest',
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
                detail: 'the whole `accessibility { }` block — properties, relations, three states, a translatable property and a list-valued relation; note `label` collides by NAME with the `label` property of the widget itself, which is why the block cannot simply be folded into `props`, and that three XML element kinds would have to fold into one field even if it could',
            },
            {
                kind: 'sibling-object',
                line: 20,
                detail: 'the whole `Gtk.Label labelA`, which `labelled-by` on line 16 points at — its id goes with it and is not counted twice',
            },
            {
                kind: 'sibling-object',
                line: 23,
                detail: 'the whole `Gtk.Label labelB`, the other target of the same relation',
            },
        ],
        note: 'The block is dropped whole, so the projection is the one exit this file cannot measure the ARIA table through — every value type in it, and the three `<state>` lines that turn `true`, `true` and `mixed` into `1`, `true` and `2`, are held by the golden alone.',
    },
    {
        file: '21-value-array.blp',
        node: { tag: 'GtkDropDown', children: [{ tag: 'GtkStringList', slot: 'model' }] },
        lost: [
            {
                kind: 'value-list',
                line: 4,
                detail: '`css-classes: ["flat", "narrow"]` — the property behind `styles [ ]`, written as a VALUE; it is the `value-list` kind and not `styles` because the projection names a loss after the spelling the file used, and the XML differs too',
            },
            {
                kind: 'value-list',
                line: 7,
                detail: 'the three strings of the model, two of them marked translatable, because `props` holds no lists — so what projects is a StringList with nothing in it',
            },
        ],
        note: 'The one projection here that is worse than lossy: an empty model reads as a legitimate tree and renders an empty dropdown, where every other loss at least leaves the node visibly incomplete. The `_()` on two of the items is inside the dropped list, so it is not a separate `translatable` loss.',
    },
    {
        file: '22-menu-nested.blp',
        node: { tag: 'GtkMenuButton', props: { 'menu-model': 'nestedMenu' } },
        lost: [
            {
                kind: 'menu',
                line: 3,
                detail: 'the whole menu, one level deeper than in `12` and with four items written in the `item (…)` shorthand — one, two and three arguments, and a `C_()` label',
            },
        ],
        note: 'The first two shorthand items differ only in `_()`, and the golden marks exactly the marked one. So the shorthand IS sugar for the long form, and `translatable="yes"` follows the marking and never the form — a parser that ties the attribute to the form is wrong in both directions. The third argument is the `icon` attribute, and the second is as optional as it: `item ("Alone")` is a label and nothing else.',
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
        node: {
            tag: 'GtkFrame',
            children: [
                {
                    tag: 'GtkBox',
                    slot: 'child',
                    props: { orientation: 'vertical' },
                    children: [{ tag: 'GtkToggleButton', props: { label: 'unqualified' } }],
                },
            ],
        },
        lost: [{ kind: 'object-id', line: 7, detail: 'the id `lonely`, on an unqualified type' }],
        note: 'Three of the eleven real files write a bare `ToggleButton`, so this is not a corner of the grammar. It is the second place the parser needs GIR knowledge and not only syntax, beside the enum resolution recorded as the `surprise` on `03-property-enum.blp`. The lookup is against Gtk ALONE — a bare `Bin` is refused with `using Adw 1;` in the file — so a parser that searches every import accepts what the compiler rejects. A bare name is legal in every position a qualified one is: the root, a property value and a child, with an id and with an enum that resolves through the Gtk type it names.',
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
            props: { label: 'on one line', 'margin-top': 4, 'margin-bottom': 4 },
            children: [{ tag: 'GtkLabel' }],
        },
        lost: [
            {
                kind: 'menu',
                line: 3,
                detail: 'the whole `menu oneLineMenu { }`, whose submenu writes an item and an attribute on one line',
            },
            {
                kind: 'signal',
                line: 10,
                detail: 'the handler binding `clicked => $onClicked()`, which shares its line with the property beside it',
            },
            {
                kind: 'styles',
                line: 12,
                detail: '`styles ["flat"]`, which shares its line with the property beside it',
            },
        ],
        note: 'Written for the ORDER, which no tree here can show: the golden puts the child before the property on line 8, the signal before the property on line 10, the style block before the property on line 12 and the menu item before the attribute on line 4, and sorting by line alone cannot produce any of them. `SharedNode` has no signal, no styles and no menu, so the projection sees only a fraction of what this file pins.',
    },
    {
        file: '27-property-flags.blp',
        node: {
            tag: 'GtkBox',
            children: [
                { tag: 'GtkEntry', props: { 'input-hints': 'word_completion|lowercase', 'input-purpose': 'email' } },
                { tag: 'GtkEntry', props: { 'input-hints': 'lowercase' } },
            ],
        },
        lost: [],
        note: 'Three identifiers leave the compiler as three KINDS of answer — `word-completion|lowercase`, `6` and `8` — from one lookup, so a resolver that only ever returns a number is wrong on the first and one that returns a nick for every flag member is wrong on the third. The projection keeps all of them as the source wrote them, `|` and underscores included, for the reason on `03-property-enum.blp`.',
    },
    {
        file: '28-property-enum-foreign.blp',
        node: {
            tag: 'AdwToolbarView',
            props: { 'top-bar-style': 'raised' },
            children: [{ tag: 'GtkLabel', slot: 'content', props: { ellipsize: 'end', 'wrap-mode': 'word_char' } }],
        },
        lost: [],
        note: "Three enums, none of them Gtk's own: `AdwToolbarStyle` from the other imported namespace, and `PangoEllipsizeMode` / `PangoWrapMode` from a namespace the file never names, reached through `Gtk.Label`. The projection keeps the member names as always; the XML carries `1`, `3` and `2`.",
    },
    {
        file: '29-enum-non-widget.blp',
        node: { tag: 'GtkSizeGroup', props: { mode: 'horizontal' } },
        lost: [],
        note: 'An enum on an object that is not a widget. The projection is the same as for any enum; the XML is where this file bites — `corpus/divergences.mjs` has it, because the `@girs` join from a property to its enum covers widgets only.',
    },
    {
        file: '30-template-self-reference.blp',
        node: {
            tag: 'AdwBreakpointBin',
            props: { 'width-request': 200, 'height-request': 200 },
            children: [
                {
                    tag: 'GtkBox',
                    slot: 'child',
                    children: [{ tag: 'GtkLabel', props: { 'mnemonic-widget': 'template' } }, { tag: 'GtkButton' }],
                },
            ],
        },
        lost: [
            {
                kind: 'template',
                line: 4,
                detail: 'the template class `$CorpusSelf`, which four places below address as `template`',
            },
            { kind: 'binding', line: 11, detail: '`bind template.sensitive`' },
            { kind: 'signal', line: 15, detail: '`$onClicked(template)`' },
            { kind: 'breakpoint', line: 20, detail: 'the whole `[breakpoint]` child, whose setter targets `template`' },
        ],
        note: '`mnemonic-widget: template` projects as the literal word `template`: it is an id reference (finding 3 in the header), and the id it refers to is the first thing this file loses, so the XML resolves it to `CorpusSelf` and the projection cannot. The other three references go with the constructs that carry them.',
    },
    {
        file: '31-responses.blp',
        node: { tag: 'AdwAlertDialog', props: { heading: 'confirm' } },
        lost: [
            {
                kind: 'responses',
                line: 7,
                detail: "the whole `responses [ ]` block — three responses, two of them translatable; `SharedNode` has no field for a dialog's responses",
            },
        ],
    },
    {
        file: '32-extern-nested.blp',
        node: {
            tag: 'AdwToolbarView',
            children: [
                { tag: 'GalleryHeaderBar', slot: 'top' },
                {
                    tag: 'GalleryToolbarView',
                    slot: 'content',
                    children: [
                        { tag: 'GtkLabel', props: { label: 'a real child of an extern parent' } },
                        { tag: 'NsInner' },
                    ],
                },
            ],
        },
        lost: [
            {
                kind: 'extern',
                line: 6,
                detail: '`$GalleryHeaderBar` is not a GIR class, so the tag resolves to nothing',
            },
            { kind: 'extern', line: 9, detail: '`$GalleryToolbarView` likewise, in the property-valued position' },
            { kind: 'object-id', line: 9, detail: 'the id `pane`' },
            {
                kind: 'extern',
                line: 14,
                detail: '`$Ns.Inner`, whose tag `NsInner` is a concatenation and not a C prefix',
            },
        ],
        note: 'The three extern tags are spelled exactly as the XML spells them and none of them is resolvable — which is the whole content of the `extern` loss. The `GtkLabel` between them shows that a real subtree under an extern parent projects normally.',
    },
    {
        file: '33-extern-unresolved.blp',
        node: {
            tag: 'AdwBreakpointBin',
            props: { 'width-request': 100, 'height-request': 100 },
            children: [
                {
                    tag: 'GtkBox',
                    props: { orientation: 'vertical' },
                    children: [
                        { tag: 'GtkBox', props: { orientation: 'vertical' } },
                        { tag: 'GtkBox', props: { orientation: 'vertical' } },
                    ],
                },
            ],
        },
        lost: [
            { kind: 'breakpoint', line: 8, detail: 'the whole `Adw.Breakpoint`, including both setters' },
            { kind: 'extern', line: 20, detail: '`$GtkBox`, an extern class that SPELLS a GIR one' },
            { kind: 'object-id', line: 20, detail: 'the id `lookalike`, which the first setter targets' },
            { kind: 'object-id', line: 24, detail: 'the id `genuine`, which the second setter targets' },
        ],
        note: 'All three `orientation` props project as the string `vertical`, because an enum member keeps its source spelling on this exit whatever it sits on — so the projection is where this file says NOTHING and the `.ui` golden is where it bites: two of those three lines emit `1` and the extern one emits `vertical`.',
    },
    {
        file: '34-extern-template-parent.blp',
        node: { tag: 'CorpusExternBase', props: { orientation: 'vertical' } },
        lost: [
            { kind: 'template', line: 3, detail: 'the template class `$CorpusExternChild`' },
            {
                kind: 'extern',
                line: 3,
                detail: 'the parent `$CorpusExternBase`, which becomes the root tag and is no GIR class',
            },
        ],
        note: 'The parent is what survives as the tag — the rule `08-template.blp` already pins — and here the survivor is extern too, so the one node this file projects carries a tag nothing can look up.',
    },
];
