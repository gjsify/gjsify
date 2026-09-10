// The shape a `.blp` parses INTO, and the contract between the two halves that follow it.
//
// ADR 0053 clause 1: the parser produces a FULL AST, the GtkBuilder XML is emitted from it,
// and `SharedNode` is a second, declared, lossy exit. So this file has to carry every
// construct the corpus found — including the six the projection cannot express — or clause
// 4's byte-equal diff is unreachable for any real file.
//
// WHY A DECLARATION FILE AND NOT A `.ts`
//
// The shadow arm of `scripts/check-blueprint-corpus.mjs` imports the parser directly, as
// plain Node, in `tree-checks` — a job that installs the workspace and does NOT build it. A
// parser behind a build step is a parser that gate cannot run, which is the one shape ADR
// 0053 spends its whole § Implementation avoiding. So the implementation is `.mjs` and the
// types live beside it, the arrangement `@gjsify/manifest-conformance` already ships. When
// the parser becomes authoritative and `@gjsify/vite-plugin-blueprint` consumes it, that is
// the moment to revisit — not before.
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
 * Three different things wear this shape and the syntax cannot tell them apart: an enum
 * member (`orientation: vertical`), a reference to an object id (`menu-model: mainMenu`) and
 * a flag set (`state-flags: active|focused`). Naming it `ident` rather than guessing is the
 * point — clause 3's "never a silent pass-through" applies to interpretation too.
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

/** `bind <source>.<property> [flags…]`. */
export interface BindingValue {
    readonly kind: 'binding';
    readonly source: string;
    readonly property: string;
    /** As written, in source order. The compiler emits its own order and its own default. */
    readonly flags: readonly string[];
    readonly line: number;
}

/** A bracketed list of values: `styles [...]`, `strings [...]`, `widgets [...]`. */
export interface ListValue {
    readonly kind: 'list';
    readonly items: readonly Value[];
    readonly line: number;
}

export type Value = StringValue | NumberValue | BoolValue | IdentValue | ObjectValue | BindingValue | ListValue;

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
 */
export interface Child {
    readonly slot?: string;
    readonly object: ObjectNode | MenuNode;
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
    readonly entries: readonly Property[];
    readonly line: number;
    readonly order: number;
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

export interface MenuItem {
    readonly kind: 'item' | 'section' | 'submenu';
    readonly attributes: readonly Property[];
    readonly items: readonly MenuItem[];
    readonly line: number;
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
