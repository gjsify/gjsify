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
//   construct spans lines it is the OPENING one: the object line for `breakpoint` and
//   `sibling-object` (never the bracket above it), the property line
//   for `binding` and `value-list`, the `styles [` / `layout {` /
//   `accessibility {` line for those three.
//
//   `children` IS IN SOURCE ORDER, including where bracket-derived and
//   property-derived children interleave. GtkBuilder puts the two in different places,
//   so source order and emitted order need not agree, and this file states the source
//   one because it is the one a reader of the `.blp` can check.
//
// @import {SharedNode} from '../src/shared-node.d.mts'

/**
 * The constructs that fall outside `SharedNode`. Five of these are the ones ADR 0053
 * clause 3 names from the census of the eleven real files there were then; the rest are
 * what a corpus written per LANGUAGE RULE rather than per real file turns up, which is
 * the point of having one.
 *
 * `extern` is the odd one and worth reading twice: it is the only kind where the projection
 * keeps the TEXT and loses the meaning. `SharedNode.tag` is a GIR class name, which is what a
 * renderer looks up; `$MyWidget` is a class the application registers at runtime and is in no
 * GIR, so the tag is spelled exactly right and resolves to nothing. Declared here rather than
 * discovered as a missing widget.
 *
 * `template` and `object-id` were on this list until ADR 0066 gave each a field on the node.
 * They are the two GtkBuilder ADDRESSING constructs, and dropping them is what kept every
 * shipped `.blp` out of the shared shape: a file declared a widget and could not place one.
 * `translatable` left it the same way under ADR 0067, and for the opposite reason: a dropped
 * marking leaves a tree that looks COMPLETE and whose captions `xgettext` cannot see.
 *
 * `translation-domain` stays, and is the marking's remainder: `translation-domain "app";` is a
 * fact about the FILE, and this shape is a tree — ADR 0067 § 4.
 *
 * @typedef {'signal'|'binding'|'breakpoint'
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
            id: 'rootBox',
            children: [
                { tag: 'GtkLabel', id: 'labelOne', props: { label: 'named' } },
                { tag: 'GtkLabel', id: 'label-two', props: { label: 'hyphenated' } },
            ],
        },
        lost: [],
    },
    {
        file: '08-template.blp',
        node: {
            tag: 'AdwBin',
            template: 'CorpusWindow',
            props: { halign: 'center' },
            children: [{ tag: 'GtkLabel', slot: 'child', props: { label: 'in a template' } }],
        },
        lost: [],
        note: '`halign` sits on the template itself. The XML resolves it against the PARENT type (`3` through `Adw.Bin`, which has no ParamSpecs of its own yet); here it keeps the member name like every enum.',
    },
    {
        file: '09-translatable.blp',
        node: {
            tag: 'GtkBox',
            children: [
                { tag: 'GtkLabel', props: { label: 'translated' }, translatable: { label: {} } },
                {
                    tag: 'GtkLabel',
                    props: { label: 'context-translated' },
                    translatable: { label: { context: 'noun' } },
                },
            ],
        },
        lost: [],
        note: 'The file that isolates the marking, and the ONE place in this corpus where a context reaches the tree: six other `C_()` contexts sit inside a menu, a value list, a `responses` block, a closure and a `marks` list, each lost with the construct around it. `_()` is `{}` and `C_("noun", …)` is `{ context: "noun" }` — the empty object is "marked, nothing more", not "unmarked".',
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
        node: {
            tag: 'GtkBox',
            children: [
                { tag: 'GtkLabel', id: 'labelOne' },
                { tag: 'GtkButton', props: { label: 'press' } },
            ],
        },
        lost: [
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
            children: [
                { tag: 'GtkSwitch', id: 'switchOne' },
                { tag: 'GtkLabel', props: { label: 'bound visibility' } },
            ],
        },
        lost: [
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
        node: {
            tag: 'AdwWindow',
            children: [
                { tag: 'GtkBox', id: 'boxOne', slot: 'content', children: [{ tag: 'GtkLabel', id: 'labelOne' }] },
            ],
        },
        lost: [
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
            children: [
                { tag: 'GtkLabel', id: 'labelA' },
                { tag: 'GtkLabel', id: 'labelB' },
            ],
        },
        lost: [
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
                    children: [{ tag: 'GtkToggleButton', id: 'lonely', props: { label: 'unqualified' } }],
                },
            ],
        },
        lost: [],
        note: 'Three of the twelve real files write a bare `ToggleButton`, so this is not a corner of the grammar. It is the second place the parser needs GIR knowledge and not only syntax, beside the enum resolution recorded as the `surprise` on `03-property-enum.blp`. The lookup is against Gtk ALONE — a bare `Bin` is refused with `using Adw 1;` in the file — so a parser that searches every import accepts what the compiler rejects. A bare name is legal in every position a qualified one is: the root, a property value and a child, with an id and with an enum that resolves through the Gtk type it names.',
    },
    {
        file: '25-bracket-breakpoint.blp',
        node: {
            tag: 'AdwBreakpointBin',
            props: { 'width-request': 200, 'height-request': 200 },
            children: [{ tag: 'GtkLabel', id: 'labelOne' }],
        },
        lost: [
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
            template: 'CorpusSelf',
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
                    id: 'pane',
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
                        { tag: 'GtkBox', id: 'lookalike', props: { orientation: 'vertical' } },
                        { tag: 'GtkBox', id: 'genuine', props: { orientation: 'vertical' } },
                    ],
                },
            ],
        },
        lost: [
            { kind: 'breakpoint', line: 8, detail: 'the whole `Adw.Breakpoint`, including both setters' },
            { kind: 'extern', line: 20, detail: '`$GtkBox`, an extern class that SPELLS a GIR one' },
        ],
        note: 'All three `orientation` props project as the string `vertical`, because an enum member keeps its source spelling on this exit whatever it sits on — so the projection is where this file says NOTHING and the `.ui` golden is where it bites: two of those three lines emit `1` and the extern one emits `vertical`.',
    },
    {
        file: '34-extern-template-parent.blp',
        node: { tag: 'CorpusExternBase', template: 'CorpusExternChild', props: { orientation: 'vertical' } },
        lost: [
            {
                kind: 'extern',
                line: 3,
                detail: 'the parent `$CorpusExternBase`, which becomes the root tag and is no GIR class',
            },
        ],
        note: 'The parent is what survives as the tag — the rule `08-template.blp` already pins — and here the survivor is extern too, so the one node this file projects carries a tag nothing can look up.',
    },
    {
        file: '35-extern-real-class.blp',
        node: {
            tag: 'GtkListView',
            children: [{ tag: 'GtkNoSelection', slot: 'model', children: [{ tag: 'GListStore', slot: 'model' }] }],
        },
        lost: [
            {
                kind: 'extern',
                line: 5,
                detail: '`$GListStore` — a tag that IS resolvable, and still extern, because nothing in it was read',
            },
        ],
        note: 'The other `extern` rules project a tag nothing can look up; this one projects a tag GtkBuilder resolves, and the loss is declared all the same. That is the kind at its widest: `extern` says the projection READ nothing inside the object, never that the tag is unknown — and a consumer that treated the loss as "unresolvable tag" would be wrong on exactly this file.',
    },

    {
        file: '36-setter-null.blp',
        node: {
            tag: 'AdwBreakpointBin',
            props: { 'width-request': 200, 'height-request': 200 },
            children: [{ tag: 'GtkLabel', id: 'labelOne', props: { label: 'text', 'width-request': 40 } }],
        },
        lost: [
            {
                kind: 'breakpoint',
                line: 14,
                detail: 'the whole `[breakpoint]` child, and with it the two `null` setters',
            },
        ],
        note: 'The projection loses this file the same way `25-bracket-breakpoint.blp` does, and that is the point of putting the rule HERE rather than only in `refused/`: the setters never reach `SharedNode` at all, so the projection cannot be the exit that catches a wrong one. Only the XML exit can, and before this rule existed it did not — it wrote the four characters `null` into the body of a live `<setter>`. The golden proves the empty element, on a string property and an int property both.',
    },

    {
        file: '37-layout-untyped-ident.blp',
        node: {
            tag: 'GtkGrid',
            children: [{ tag: 'GtkLabel', props: { label: 'text' } }],
        },
        lost: [
            {
                kind: 'layout',
                line: 7,
                detail: 'the whole `layout { }` block, and with it both untyped identifiers',
            },
        ],
        note: 'The projection drops every block extension unread, so this file is one where the XML exit is the only one that can be wrong — and it was: the reference check on `identText` refused this file in an earlier cut, and the corpus held no `layout { }` value that was not a number, so nothing said so. The two exits are asymmetric here by design and not by omission.',
    },

    {
        file: '38-null-object-id.blp',
        node: {
            tag: 'GtkBox',
            children: [
                { tag: 'GtkMenuButton', props: { 'menu-model': 'null' } },
                { tag: 'GtkLabel', id: 'labelA' },
            ],
        },
        lost: [
            {
                kind: 'menu',
                line: 3,
                detail: 'the whole `menu null { … }` — a sibling of the object and not a widget, the same loss as `12-menu.blp`',
            },
            {
                kind: 'sibling-object',
                line: 18,
                detail: 'the whole `Gtk.SizeGroup`, a second top-level object where `SharedNode` is one tree',
            },
        ],
        note: 'The projection keeps `menu-model` as the four characters `null`, exactly as it keeps an enum member: it reads the identifier and never asks what it points at. That is the same reading the XML exit had before this change, and it is right HERE — the object exists — which is why the fix is a lookup and not a ban on the spelling. The projection cannot make that distinction at all, holding no id index, so it is the XML exit that carries the rule and this expectation records the asymmetry rather than papering over it.',
    },
    {
        file: '39-namespace-vocabulary.blp',
        node: {
            tag: 'GtkBox',
            props: { orientation: 'vertical' },
            children: [
                {
                    tag: 'GtkSourceView',
                    children: [{ tag: 'GtkSourceBuffer', slot: 'buffer', props: { 'highlight-syntax': true } }],
                },
                { tag: 'WebKitWebView', props: { 'zoom-level': 1.5 } },
            ],
        },
        lost: [],
        note: "Nothing is lost, and the tags are the whole point: the projection spells a tag with the same GType name the XML exit writes into `class=`, through the same seam, so a namespace the resolver cannot answer for stops BOTH exits rather than one. `GtkSourceBuffer` is not a widget and sits in a `slot` exactly as `06-property-object-valued.blp`'s label does — a slot is a property position and says nothing about what fills it.",
    },
    {
        file: '40-namespace-vocabulary-enum.blp',
        node: { tag: 'GtkSourceView', props: { 'smart-home-end': 'after', 'background-pattern': 'grid' } },
        lost: [],
        note: "The XML for the same two properties is `2` and `1`. The projection keeps the member NAME, per `03-property-enum.blp` — and it does so without consulting any vocabulary at all, which is why this file cannot tell a namespace the resolver knows from one it does not. Only the XML exit can, and only its golden pins that these two numbers came out of GtkSource's tables.",
    },
    {
        file: '41-template-parent-abstract.blp',
        node: { tag: 'GtkWidget', template: 'CorpusAbstractParent', props: { halign: 'center' } },
        lost: [],
        note: 'The tag is the PARENT, as in `08-template.blp`, and the parent here is abstract — so the projection takes the reference position of the same seam the XML exit does, and a check meant for an instantiated type cannot reach either exit without failing this file and `refused/abstract-instantiation.blp` together.',
    },
    {
        file: '42-expression-binding-shape.blp',
        node: {
            tag: 'GtkBox',
            children: [
                { tag: 'GtkLabel', id: 'labelOne' },
                { tag: 'GtkLabel' },
                { tag: 'GtkLabel' },
                { tag: 'GtkLabel' },
                { tag: 'GtkLabel' },
                { tag: 'GtkLabel' },
                { tag: 'GtkLabel' },
                { tag: 'GtkLabel' },
            ],
        },
        lost: [
            { kind: 'binding', line: 8, detail: 'the collapsed shape — `bind labelOne.label`' },
            { kind: 'binding', line: 12, detail: 'still collapsed under one cast' },
            { kind: 'binding', line: 16, detail: 'still collapsed with a flag beside the cast' },
            { kind: 'binding', line: 20, detail: 'a parenthesis, and the shape changes' },
            { kind: 'binding', line: 24, detail: 'the parenthesis around the IDENT rather than the lookup' },
            { kind: 'binding', line: 28, detail: 'a cast between the identifier and the dot' },
            { kind: 'binding', line: 32, detail: 'two casts, which is one too many to collapse' },
        ],
        note: 'Eight children and not one property between them: the projection drops a binding whole, so all seven shapes this file exists to distinguish project IDENTICALLY. That is the point of writing it out — the `.ui` golden is the only exit where the seven differ, and a reader who trusted the tree would conclude the file says one thing seven times.',
    },
    {
        file: '43-expression-lookup.blp',
        node: {
            tag: 'GtkBox',
            template: 'CorpusExpressionLookup',
            children: [
                { tag: 'GtkOverlay', children: [{ tag: 'GtkLabel', id: 'labelOne' }] },
                { tag: 'CorpusLookupTarget', id: 'externOne' },
                { tag: 'GtkLabel' },
            ],
        },
        lost: [
            { kind: 'extern', line: 9, detail: '`$CorpusLookupTarget`, a class no GIR describes' },
            { kind: 'binding', line: 13, detail: 'a three-step lookup, each step cast' },
            { kind: 'binding', line: 14, detail: 'a lookup on `template`, cast to an extern type' },
            { kind: 'binding', line: 15, detail: 'a lookup on an extern-typed object' },
        ],
        note: 'The tag of the extern child is `CorpusLookupTarget` and the `<lookup type=…>` for line 15 is the same string — one spelling, two exits. What the tree cannot show is that the XML needed a SECOND id index to get there: the emitter keeps `idTypes` at `null` for an extern object so no identifier inside it is resolved, and the lookup position needs the name anyway.',
    },
    {
        file: '44-expression-closure.blp',
        node: {
            tag: 'GtkBox',
            children: [
                { tag: 'GtkLabel', id: 'labelOne' },
                { tag: 'GtkLabel' },
                { tag: 'GtkLabel' },
                { tag: 'GtkLabel' },
            ],
        },
        lost: [
            { kind: 'binding', line: 8, detail: 'a closure with no arguments' },
            { kind: 'binding', line: 9, detail: 'four literal arguments, one of each kind' },
            { kind: 'binding', line: 10, detail: 'a closure as an argument of a closure' },
            { kind: 'binding', line: 14, detail: 'an object id as an argument' },
            { kind: 'binding', line: 15, detail: 'the same id under a cast, which the XML drops' },
            { kind: 'binding', line: 16, detail: '`null`, bare and cast' },
            { kind: 'binding', line: 20, detail: 'a translated argument, with and without a context' },
            { kind: 'binding', line: 21, detail: 'a lookup as an argument' },
            { kind: 'binding', line: 22, detail: 'a lookup ON a closure' },
        ],
        note: 'Nine bindings, nine losses, and the tree says nothing about any of them — including that line 20 carries two translatable strings. `09-translatable.blp` makes the same point about a property; here the marking is on an argument three levels into an expression and reaches the XML unchanged, which is what having ONE `StringValue` for both positions buys.',
    },
    {
        file: '45-expression-property.blp',
        node: { tag: 'GtkBoolFilter', id: 'filterOne' },
        lost: [
            { kind: 'binding', line: 4, detail: '`expr true` — an expression as a property VALUE' },
            { kind: 'sibling-object', line: 7, detail: 'the parenthesised `item` cast' },
            { kind: 'sibling-object', line: 11, detail: 'the same thing without the parentheses' },
            { kind: 'sibling-object', line: 15, detail: '`item` inside a closure argument' },
            { kind: 'sibling-object', line: 19, detail: '`expression: bind filterOne.expression`, which collapses' },
        ],
        note: 'A `Gtk.BoolFilter` is not a widget and the projection keeps it anyway — `SharedNode` has one tree, and the first root is it, whatever it is. So four of the five things this file measures are lost as SIBLINGS before their expressions are looked at, and the surviving root projects to a bare tag. Every `item` in the file is invisible here.',
    },
    {
        file: '46-expression-cast-builtins.blp',
        node: {
            tag: 'GtkBox',
            children: [
                { tag: 'GtkLabel' },
                { tag: 'GtkLabel' },
                { tag: 'GtkLabel' },
                { tag: 'GtkLabel' },
                { tag: 'GtkLabel' },
                { tag: 'GtkLabel' },
            ],
        },
        lost: [
            { kind: 'binding', line: 5, detail: '`as <string>`' },
            { kind: 'binding', line: 6, detail: '`as <bool>`' },
            { kind: 'binding', line: 7, detail: '`as <int>`' },
            { kind: 'binding', line: 11, detail: '`as <uint>`' },
            { kind: 'binding', line: 12, detail: '`as <long>`' },
            { kind: 'binding', line: 13, detail: '`as <ulong>`' },
            { kind: 'binding', line: 17, detail: '`as <int64>`' },
            { kind: 'binding', line: 18, detail: '`as <uint64>`' },
            { kind: 'binding', line: 19, detail: '`as <float>`' },
            { kind: 'binding', line: 23, detail: '`as <double>`, the row that decides the table is hand-written' },
            { kind: 'binding', line: 24, detail: '`as <char>`' },
            { kind: 'binding', line: 25, detail: '`as <uchar>`' },
            { kind: 'binding', line: 29, detail: 'a qualified GIR type' },
            { kind: 'binding', line: 30, detail: 'an unqualified one, which is Gtk and nothing else' },
            { kind: 'binding', line: 31, detail: 'an extern type' },
            { kind: 'binding', line: 35, detail: 'a cast on a string literal' },
            { kind: 'binding', line: 36, detail: 'a cast on a fractional literal' },
            { kind: 'binding', line: 37, detail: 'a cast on an integer literal' },
        ],
        note: 'Eighteen losses and one tag repeated six times. The whole of `src/builtin-types.mjs` is measured by the golden beside this file and by nothing else — which is the shape of every table in this package: the projection cannot see a type it does not carry.',
    },
    {
        file: '47-expression-typeof.blp',
        node: { tag: 'AdwEnumListModel', props: { 'enum-type': 'GtkOrientation' } },
        lost: [
            { kind: 'sibling-object', line: 8, detail: 'the same property holding an EXTERN type' },
            { kind: 'sibling-object', line: 12, detail: 'a `typeof` inside a closure argument' },
        ],
        note: '`typeof<Gtk.Orientation>` is the one expression operand this exit does NOT lose: it is a type name, and a type name is the thing the projection already spells through the same seam the XML does. It takes the REFERENCE position of that seam, not the object one — `Gtk.Orientation` is an enum, and a check written for an instantiated class refuses it, which is the same trap `41-template-parent-abstract.blp` records.',
    },
    {
        file: '48-expression-try.blp',
        node: {
            tag: 'GtkBox',
            children: [{ tag: 'GtkLabel', id: 'labelOne' }, { tag: 'GtkLabel' }, { tag: 'GtkLabel' }],
        },
        lost: [
            { kind: 'binding', line: 8, detail: 'three arms — a lookup, a cast closure and a literal' },
            { kind: 'binding', line: 12, detail: 'one arm and a trailing comma' },
        ],
        note: 'A `try` is a binding to this exit like any other, so the fallback chain — the entire reason the construct exists — is dropped with it. The trailing comma on line 12 is invisible in both exits; it is in the file because a grammar that accepts one and a grammar that does not are two grammars, and only a file says which this is.',
    },
    {
        file: '49-namespace-core-vocabulary.blp',
        node: {
            tag: 'GtkListView',
            children: [
                { tag: 'GdkCursor', slot: 'cursor', props: { name: 'pointer' } },
                { tag: 'GtkNoSelection', slot: 'model', children: [{ tag: 'GListStore', slot: 'model' }] },
            ],
        },
        lost: [
            {
                kind: 'sibling-object',
                line: 17,
                detail: 'the top-level `GObject.Object` and its id `objectOne` with it, whose tag is `GObject`',
            },
        ],
        note: 'The tags are the whole assertion, and two of the three are the reason this file exists: `GListStore` and `GObject` are what the prefix `G` produces, and nothing in the spelling `Gio.ListStore` or `GObject.Object` carries either. The third, `GdkCursor`, is the case concatenation would also get right — it is here so the file cannot be read as being about a rule that only ever fires on `G`. The `GObject` one reaches this exit only as a declared loss, because the projection is one tree and the file writes two objects at top level.',
    },
    {
        file: '50-template-orphan.blp',
        node: {
            tag: 'CorpusOrphan',
            template: 'CorpusOrphan',
            props: { visible: true },
            children: [{ tag: 'GtkLabel', slot: 'child', props: { label: 'no parent, so no vocabulary' } }],
        },
        lost: [
            {
                kind: 'extern',
                line: 3,
                detail: 'the root tag is the template class itself, which no GIR describes — a parentless template IS the extern case',
            },
        ],
        note: 'Where `08-template.blp` keeps the PARENT as the root tag beside its `template`, this file has no parent to keep, so the class it declares is BOTH — `tag` and `template` say the same word, and the tag is extern, which is the one loss left. That equality is the assertion: the two fields are not a duplicate, they coincide exactly when the file names no parent. `visible` reaches this exit as `true` rather than resolved, for the same reason it reaches the XML as the string `true`: there is no owner type to resolve it through.',
    },
    {
        file: '51-inline-template.blp',
        node: {
            tag: 'GtkBox',
            children: [
                {
                    tag: 'GtkListView',
                    children: [{ tag: 'GtkBuilderListItemFactory', id: 'corpusFactory', slot: 'factory' }],
                },
                { tag: 'GtkLabel', id: 'corpusLabel', props: { label: 'the same id, outside the sub-document' } },
            ],
        },
        lost: [
            {
                kind: 'inline-template',
                line: 6,
                detail: 'the whole sub-document — `SharedNode` is one tree and has no nesting form for a second one with its own id scope',
            },
        ],
        note: "The factory survives as a node and its CONTENT does not: the block is declared lost rather than flattened, and ONE loss covers the whole sub-document however deep it goes — this file nests a second block inside the first. Flattening would be worse than dropping it — the ids inside a sub-document are allowed to repeat the outer file's, and this file repeats one on purpose, so a merged tree would carry two different objects under `corpusLabel` and no consumer could tell which it had.",
    },
    {
        file: '52-response-flags.blp',
        node: { tag: 'AdwAlertDialog', props: { heading: 'confirm' } },
        lost: [{ kind: 'responses', line: 7, detail: 'all four responses, flags and all' }],
        note: 'The flags share the fate of the block they sit in: `SharedNode` has no form for a dialog response, so `appearance` and `enabled` are lost with it rather than beside it. One loss for the block, which is what `31-responses.blp` already records — this file adds no new exit, only new attributes on the XML side of the same one.',
    },
    {
        file: '53-extension-lists.blp',
        node: {
            tag: 'GtkBox',
            children: [
                { tag: 'GtkScale' },
                { tag: 'GtkFileFilter' },
                { tag: 'GtkComboBoxText' },
                { tag: 'GtkLevelBar' },
            ],
        },
        lost: [
            { kind: 'marks', line: 5, detail: 'four marks, one of them translated and one with a context' },
            { kind: 'mime-types', line: 14, detail: 'one MIME type' },
            { kind: 'patterns', line: 18, detail: 'one glob' },
            { kind: 'suffixes', line: 22, detail: 'one suffix' },
            { kind: 'items', line: 28, detail: 'three items, one translated and one with an id' },
            { kind: 'offsets', line: 36, detail: 'two offsets' },
        ],
        note: 'Six losses for six lists, each by its own NAME rather than one shared kind. A consumer told `marks` was dropped learns something a consumer told `extension-list` was dropped does not — and the four widgets survive as bare tags, because everything each of them says is in the list that was dropped.',
    },
    {
        file: '54-internal-child-menu-domain.blp',
        node: { tag: 'GtkDialog', children: [{ tag: 'GtkBox', children: [{ tag: 'GtkMenuButton' }] }] },
        lost: [
            {
                kind: 'translation-domain',
                line: 1,
                detail: 'the gettext domain, a fact about the FILE and not about any node',
            },
            {
                kind: 'internal-child',
                line: 6,
                detail: 'the `content_area` annotation; the box survives, its placement does not',
            },
            { kind: 'menu', line: 9, detail: 'the inline menu, the same loss a top-level one takes' },
        ],
        note: 'All three widgets survive and all three ANNOTATIONS are lost, which is the shape of this file: nothing here changes a tag, and everything here changes where or how the tag is used. The internal-child loss is on the BRACKET line and the menu loss on the property line, each where a reader would go looking.',
    },
    {
        file: '55-template-type-name.blp',
        node: { tag: 'GtkListItem', template: 'GtkListItem', children: [{ tag: 'GtkLabel', slot: 'child' }] },
        lost: [{ kind: 'binding', line: 5, detail: 'the lookup through `template`' }],
        note: 'NO extern loss, where `50-template-orphan.blp` takes one. Both are parentless and both have `tag` and `template` saying one word; this one names a real TYPE, so that word is its GType and nothing is extern. The pair is the assertion — a single file could not show that the loss depends on which spelling the file used, and it is also what pins `template` to the `<template class=…>` bytes rather than to the source spelling `ListItem`. The BINDING is here for a different reason: `template` inside resolves to the class, and reading the spelling there while the `<template>` tag reads the GType is what made this exact file silently different — `<template class="GtkListItem">` beside `<lookup … type="ListItem">`, a class GtkBuilder cannot find.',
    },
    {
        file: '56-action-widgets-menu-ids.blp',
        node: {
            tag: 'GtkDialog',
            children: [
                { tag: 'GtkButton', id: 'cancelButton', props: { label: 'Cancel' } },
                { tag: 'GtkButton', id: 'numericButton', props: { label: 'Nine' } },
                { tag: 'GtkButton', id: 'okButton', props: { label: 'OK' } },
            ],
        },
        lost: [
            { kind: 'menu', line: 3, detail: 'the whole menu, its named section and submenu with it' },
            { kind: 'action-widget', line: 14, detail: 'the `cancel` response' },
            { kind: 'action-widget', line: 19, detail: 'the numeric response `9`' },
            { kind: 'action-widget', line: 24, detail: 'the `ok` response, and that it is the default' },
        ],
        note: 'The three buttons survive and their ROLE does not: a renderer handed them without the responses would show a dialog whose buttons answer nothing. The ids are lost beside them and that pairing is the point — the XML names each widget by its id, so the two facts travel together there and are dropped together here. The menu ids take no loss of their own: the menu is one loss and everything inside it goes with it.',
    },
];
