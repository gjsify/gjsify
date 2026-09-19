// The shape a `.blp` parses INTO, and the contract between the two halves that follow it.
//
// ADR 0053 clause 1: the parser produces a FULL AST, the GtkBuilder XML is emitted from it,
// and `SharedNode` is a second, declared, lossy exit. So this file has to carry every
// construct the corpus found — including the six the projection cannot express — or clause
// 4's byte-equal diff is unreachable for any real file.
//
// WHY A DECLARATION FILE AND NOT A `.ts`
//
// The shadow arm of `scripts/check-blueprint-corpus.mjs` imports the parser through
// `src/index.mjs`, as plain Node, in `tree-checks` — a job that installs the workspace and
// does NOT build it. A parser behind a build step is a parser that gate cannot run, which is
// the one shape ADR 0053 spends its whole § Implementation avoiding. So the implementation is
// `.mjs` and the types live beside it, the arrangement `@gjsify/manifest-conformance` already
// ships. `src/index.d.mts` does the same for the surface: it is what `package.json` points
// `types` at, and this file is reachable through it. When the parser becomes authoritative
// and `@gjsify/vite-plugin-blueprint` consumes it, that is the moment to revisit — not
// before.
//
// WHY EVERY NODE CARRIES A LINE
//
// Clause 3 refuses an unrecognised construct with a hard error "naming its line". A line
// recovered afterwards by re-scanning the source is a second reader of the same text, and
// the two disagree the first time a string contains a newline — which `16-string-escapes`
// already does. So the line travels with the node from the token that produced it.
//
// WHAT IS DELIBERATELY NOT HERE
//
// No `SharedNode`, no XML, no GIR. This is the syntax the file states and nothing about
// what any of it MEANS: `orientation: vertical` is an identifier value here, and only the
// emitter knows GTK writes `1`. Putting the resolution in the AST would make the projection
// a reader of resolved values and the XML a reader of the same, which is exactly the
// conflation `corpus/expectations.mjs` finding 4 warns about — two exits from one AST are
// not two views of one set of values.

/** A `using <Namespace> <version>;` line. */
export interface BlueprintImport {
    readonly namespace: string;
    readonly version: string;
    readonly line: number;
}

/**
 * A type as the source spells it.
 *
 * `namespace` is absent for a bare `Box`. Resolving that is NOT a syntax question — measured
 * on `blueprint-compiler` 0.20.4, an unqualified name resolves against **Gtk alone** and not
 * against the `using` lines, so `Bin { }` under `using Adw 1;` is refused. The parser records
 * the absence; whoever needs a GType applies that rule.
 */
export interface TypeRef {
    readonly namespace?: string;
    readonly name: string;
    /**
     * Set only for an EXTERN type, the `$Name` form — a class this file does not import and
     * the GIR does not describe, because the application registers it at runtime.
     *
     * It is a flag and not a spelling because extern-ness changes two answers that the name
     * alone cannot. The GType NAME is the sigil-free source spelling concatenated
     * (`$Ns.Other` is `NsOther`), never a C prefix, because there is no namespace to have
     * one. And no identifier inside such an object is READ: measured on
     * `blueprint-compiler` 0.20.4, `$GtkBox { orientation: vertical; }` emits `vertical`
     * where `Gtk.Box { orientation: vertical; }` emits `1` — the same GType name, two
     * different bytes, so a reader keyed on the name is wrong on exactly that file.
     *
     * Absent, never `false`, for the reason the `namespace` key is absent above.
     */
    readonly extern?: true;
    readonly line: number;
}

/** A string literal, with the translatable marking the source put on it. */
export interface StringValue {
    readonly kind: 'string';
    /** Decoded: escapes resolved, so `\n` is a newline and `\"` a quote. */
    readonly value: string;
    /** `_()` or `C_()`. Absent means the source marked nothing. */
    readonly translatable?: { readonly context?: string };
    readonly line: number;
}

/**
 * A number, kept as the SOURCE SPELLING.
 *
 * `1.0` and `1` are one value in JavaScript and two in the file, and the golden for
 * `17-numeric-forms.blp` proves the compiler normalises the first to the second. An emitter
 * that has already lost the distinction cannot reproduce that, and a projection that keeps
 * the raw string would be lying about `SharedNode['props']` being `number`. So the raw text
 * lives here and each exit decides.
 */
export interface NumberValue {
    readonly kind: 'number';
    readonly raw: string;
    readonly line: number;
}

export interface BoolValue {
    readonly kind: 'bool';
    readonly value: boolean;
    readonly line: number;
}

/**
 * A bare identifier on the right of a property.
 *
 * FOUR different things wear this shape and the syntax cannot tell them apart: an enum member
 * (`orientation: vertical`), a reference to an object id (`menu-model: mainMenu`), a flag set
 * (`state-flags: active|focused`) and the `null` literal (`extra-menu: null`). Naming it
 * `ident` rather than guessing is the point — clause 3's "never a silent pass-through"
 * applies to interpretation too.
 *
 * There is deliberately no `NullValue` kind, and the fourth reading is why: `null` is a legal
 * object id, so `label: null` in a file holding `Gtk.Label null { }` is a REFERENCE that
 * resolves — measured on the oracle, which answers with a type error and not an unknown id.
 * The literal is only what is left when no object in the file claims the name, which is a
 * question about the whole file that the token cannot answer where it is read. The emitter
 * asks it against the ids it has collected (`emit-xml.mjs` § `objectRef`); a parser that
 * decided it at the token would have to un-decide it one object later.
 */
export interface IdentValue {
    readonly kind: 'ident';
    readonly name: string;
    readonly line: number;
}

/** A property whose value is an object written inline: `content: Gtk.Box { … }`. */
export interface ObjectValue {
    readonly kind: 'object';
    readonly object: ObjectNode;
    readonly line: number;
}

/**
 * `bind <expression> [flags…]` and `expr <expression>`.
 *
 * ONE node for two keywords, because they are one construct with two exits. `bind` makes the
 * property track the expression, `expr` makes the expression BE the value — measured on
 * 0.20.4, `expression: expr true` is `<property name="expression"><constant …>` while
 * `label: bind true` is `<binding name="label"><constant …>`. Nothing else about them
 * differs, so `form` carries the keyword and the emitter reads it.
 *
 * `flags` is what the SOURCE wrote, in source order. The compiler emits its own order and
 * its own default, and 0.20.4 refuses flags on anything but a single lookup ("Only bindings
 * with a single lookup can have flags") — the same predicate that decides the collapsed
 * shape, which is why the emitter and not the parser holds it.
 */
export interface BindingValue {
    readonly kind: 'binding';
    readonly form: 'bind' | 'expr';
    readonly expression: Expression;
    /** As written, in source order. The compiler emits its own order and its own default. */
    readonly flags: readonly string[];
    readonly line: number;
}

/**
 * `typeof<Type>` as a property value: `item-type: typeof<Gtk.Label>;`.
 *
 * A Value and not an Expression, because it is legal where no `bind` or `expr` is —
 * `<property name="item-type">GtkLabel</property>`, plain text. Inside an expression it is
 * an operand too, which `TypeExpression` carries; the two positions emit differently
 * (`<constant type="GType">GtkLabel</constant>` there) and that is why they are two nodes
 * rather than one used twice.
 */
export interface TypeValue {
    readonly kind: 'type';
    readonly type: TypeRef;
    readonly line: number;
}

/** A bracketed list of values: `styles [...]`, `strings [...]`, `widgets [...]`. */
export interface ListValue {
    readonly kind: 'list';
    /**
     * Scalars only. A list member is parsed with `allowObject: false, allowList: false` and
     * each refusal names itself, so neither an `ObjectValue` nor a nested `ListValue` can
     * land here — declaring the full `Value` promised two arms no file can reach.
     */
    readonly items: readonly Exclude<Value, ObjectValue | ListValue>[];
    readonly line: number;
}

export type Value =
    | StringValue
    | NumberValue
    | BoolValue
    | IdentValue
    | ObjectValue
    | BindingValue
    | TypeValue
    | ListValue;

// ------------------------------------------------------------------ expressions

/**
 * What `bind` and `expr` take: a tree of lookups, closure calls, casts and constants.
 *
 * WHY EVERY WRAPPER IS ITS OWN NODE, INCLUDING THE PARENTHESES
 *
 * A parenthesis is not punctuation here, it is a fact the output depends on. Measured on
 * 0.20.4: `bind l.name` is `<property … bind-source="l" bind-property="name"/>` and
 * `bind (l.name)` is `<binding><lookup name="name" type="GtkLabel">l</lookup></binding>` —
 * the same lookup, two shapes, told apart by nothing but the brackets. And
 * `bind (l.name) bidirectional` is refused where `bind l.name bidirectional` compiles. A
 * parser that dropped the parens as noise would emit the first shape for the second file
 * and be silently wrong, which is the one outcome ADR 0053 clause 3 exists to prevent. The
 * same holds for a cast around an identifier: `(l).name` and `l as <Widget>.name` both put
 * the id in a `<constant>` element where the bare `l.name` puts it in the lookup's text.
 *
 * So the tree records the SOURCE, wrapper for wrapper, and the emitter reads the shape.
 */
export type Expression =
    | IdentExpression
    | ItemExpression
    | LookupExpression
    | ClosureExpression
    | CastExpression
    | ParenExpression
    | TryExpression
    | LiteralExpression
    | TypeExpression;

/**
 * A bare identifier: an object id, the keyword `template`, or the null literal.
 *
 * The three are not told apart here, for the reason `IdentValue` gives one screen up and
 * `emit-xml.mjs`'s `isNullLiteral` states exactly: blueprint has no `null` keyword, so
 * `null` is a reference wherever an object answers to the name and the literal only where
 * nothing does. That is a question about the FILE, which the parser does not have.
 */
export interface IdentExpression {
    readonly kind: 'ident';
    readonly name: string;
    readonly line: number;
}

/**
 * The keyword `item` — the object a list-item expression is evaluated against.
 *
 * It has no id and no type of its own: the oracle refuses it uncast (`"item" must be cast
 * to its object type`) and emits NOTHING for it, so `expr item as <Entry>.visible` is
 * `<lookup name="visible" type="GtkEntry"></lookup>` with an empty body.
 */
export interface ItemExpression {
    readonly kind: 'item';
    readonly line: number;
}

/** `<of>.<name>` — a property read on the expression to its left. */
export interface LookupExpression {
    readonly kind: 'lookup';
    readonly name: string;
    readonly of: Expression;
    readonly line: number;
}

/** `$name(arg, …)` — a call into the application's own code. */
export interface ClosureExpression {
    readonly kind: 'closure';
    readonly name: string;
    readonly args: readonly Expression[];
    readonly line: number;
}

/**
 * `<of> as <type>`.
 *
 * `builtin` is set for Blueprint's own type keywords (`string`, `bool`, `int`, …), which
 * name no GIR type and are listed in `src/builtin-types.mjs`; `type` is set for everything
 * else. Exactly one of the two.
 */
export interface CastExpression {
    readonly kind: 'cast';
    readonly of: Expression;
    readonly builtin?: string;
    readonly type?: TypeRef;
    readonly line: number;
}

/** `( <of> )` — see the note on `Expression` for why this survives the parse. */
export interface ParenExpression {
    readonly kind: 'paren';
    readonly of: Expression;
    readonly line: number;
}

/** `try { a, b, c }` — the first arm that does not fail. */
export interface TryExpression {
    readonly kind: 'try';
    readonly arms: readonly Expression[];
    readonly line: number;
}

/**
 * A constant: a string (translated or not), a number, or `true`/`false`.
 *
 * `value` is the ordinary `Value` the rest of the AST already uses, so a translated string
 * inside a closure argument is the same node as one on a property and takes the same
 * `translatable="yes"` — one spelling of `_()`, read once. `null` is NOT here; it is an
 * `IdentExpression`, for the reason stated there.
 */
export interface LiteralExpression {
    readonly kind: 'literal';
    readonly value: StringValue | NumberValue | BoolValue;
    readonly line: number;
}

/** `typeof<Type>` as an operand inside an expression. */
export interface TypeExpression {
    readonly kind: 'type';
    readonly type: TypeRef;
    readonly line: number;
}

export interface Property {
    readonly name: string;
    readonly value: Value;
    readonly line: number;
    /**
     * Position among ALL members of one object body, in source order, counting from 0.
     *
     * `ObjectBody` keeps four arrays and GtkBuilder interleaves them: `toolbar-view.blp` emits
     * `<child type="top">`, `<property name="content">`, `<child type="bottom">` in that order.
     * Sorting the concatenation by `line` recovers it for every file in the corpus and is WRONG
     * the moment two members share a line — `Gtk.Label { } spacing: 4;` is legal, and a tie
     * broken by which array a member landed in is not source order. This counter cannot tie.
     *
     * It is not a source position and does not pretend to be one: nothing outside the body it
     * was assigned in may compare two of them.
     */
    readonly order: number;
}

/** `clicked => $onClicked(obj) swapped after;` */
export interface Signal {
    readonly name: string;
    /** `notify::sensitive` keeps its detail here; the compiler emits the whole string. */
    readonly detail?: string;
    readonly handler: string;
    readonly object?: string;
    readonly flags: readonly string[];
    readonly line: number;
    readonly order: number;
}

/**
 * A child, and the bracket that placed it.
 *
 * `slot` is the `[start]` bracket and NOTHING else. An object-valued property is a
 * `Property` with an `ObjectValue`, because that is what the file says and what the XML
 * distinguishes — `<child type="start">` against `<property name="content">`. The
 * projection is where the two are conflated, declared, in one place.
 *
 * An object and never a `MenuNode`, which this once also admitted. The oracle compiles
 * `menu-model: menu { … }` to a nested `<menu>` and the parser refuses it by name, so no menu
 * can reach a child: `parseMenu` has one call site and it pushes into `roots`. The arm cost
 * three readers a branch that cannot be taken — the emitter, the projection, and the first
 * consumer written against this file.
 */
export interface Child {
    readonly slot?: string;
    readonly object: ObjectNode;
    readonly line: number;
    readonly order: number;
}

/**
 * A block the grammar allows inside an object and whose contents are its own vocabulary:
 * `layout { }`, `accessibility { }`, `setters { }`, `responses [ ]`, `condition ( )`.
 *
 * One node kind rather than one per block, because the parser's job is to record that the
 * block was there and what was in it. A block that needs its own shape earns one when an
 * exit needs to read it — inventing five shapes nothing reads is how an AST grows fields
 * that are never checked against anything.
 */
export interface Extension {
    readonly name: string;
    /** For `condition ("max-width: 400px")`: the parenthesised text, undecoded. */
    readonly argument?: string;
    readonly entries: readonly ExtensionEntry[];
    readonly line: number;
    readonly order: number;
}

/**
 * One `name: value;` inside such a block — a `Property` in every respect but two.
 *
 * It carries no `order`. That counter exists to interleave the four sibling arrays of an
 * `ObjectBody`; a block keeps ONE array, so there is nothing to interleave and the parser
 * stamps none. Measured over every `.blp` this repository tracks: not one entry carries one,
 * while every object-body and menu-body member does. Declaring these as `Property` promised a
 * field none of them has.
 */
export interface ExtensionEntry {
    readonly name: string;
    /**
     * Never an object: every block entry is parsed with `allowObject: false`, and the refusal
     * names itself. A list is reachable, but only inside `accessibility { }`.
     */
    readonly value: Exclude<Value, ObjectValue>;
    readonly line: number;
}

export interface ObjectBody {
    readonly properties: readonly Property[];
    readonly children: readonly Child[];
    readonly signals: readonly Signal[];
    readonly extensions: readonly Extension[];
}

export interface ObjectNode {
    readonly kind: 'object';
    readonly type: TypeRef;
    readonly id?: string;
    readonly body: ObjectBody;
    readonly line: number;
}

/** `template $Name: Parent { … }` — a root, never a child. */
export interface TemplateNode {
    readonly kind: 'template';
    /** Without the `$`. */
    readonly className: string;
    readonly parent: TypeRef;
    readonly body: ObjectBody;
    readonly line: number;
}

/**
 * One `name: "value";` line inside a menu item.
 *
 * A `Property` whose value is always a `StringValue`: a menu attribute is parsed with
 * `allowObject: false, allowList: false` AND refused by name if it is not a string, in both
 * the long form and the `item ("Label", "app.act")` shorthand. GMenu attributes are text.
 */
export interface MenuAttribute {
    readonly name: string;
    readonly value: StringValue;
    readonly line: number;
    readonly order: number;
}

export interface MenuItem {
    readonly kind: 'item' | 'section' | 'submenu';
    readonly attributes: readonly MenuAttribute[];
    readonly items: readonly MenuItem[];
    readonly line: number;
    /** Position among the members of ONE menu body, as `Property.order` is for an object body. */
    readonly order: number;
}

/** `menu <id> { … }` — a `GMenuModel`, a sibling of the objects and not a widget. */
export interface MenuNode {
    readonly kind: 'menu';
    readonly id?: string;
    readonly items: readonly MenuItem[];
    readonly line: number;
}

export type TopLevel = ObjectNode | TemplateNode | MenuNode;

export interface BlueprintFile {
    readonly imports: readonly BlueprintImport[];
    /** In source order. A file may hold more than one, and `12-menu.blp` does. */
    readonly roots: readonly TopLevel[];
}

/**
 * What the parser throws, and the only thing it throws.
 *
 * ADR 0053 clause 3: an unrecognised construct is a hard error naming its line, never a
 * silent pass-through, because output that looks plausible and means something else is the
 * defect a hand-written parser most easily introduces. Implemented in `parser.mjs`.
 */
export declare class BlueprintSyntaxError extends Error {
    readonly file: string;
    readonly line: number;
    readonly column: number;
    constructor(message: string, file: string, line: number, column: number);
}
