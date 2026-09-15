// The GtkBuilder XML exit of ADR 0053 clause 1, measured against the goldens in
// `corpus/rules/*.ui` — the bytes `blueprint-compiler` 0.20.4 produces.
//
// WHY THIS IS A WRITER WITH A `needsNewline` FLAG AND NOT A TREE SERIALISER
//
// Almost every whitespace rule in the goldens falls out of ONE piece of state the
// reference emitter keeps, and out of nothing else: whether the last thing written was an
// element (so a closing tag gets its own line) or text (so it does not). Reproduced here
// rather than re-derived, because the re-derivation is a list of special cases and the
// state machine is four methods:
//
//   `<object class="GtkBox"></object>`      01-object-minimal.ui — nothing was written
//                                           between the tags, so no newline is owed and
//                                           the empty object is never self-closed
//   `<property …>plain text</property>`     02-property-scalars.ui — text owes no newline
//   `<property …>\n  <object …/>\n</property>`  06-property-object-valued.ui — an element does
//   `…a newline \n</property>`              16-string-escapes.ui — a `\n` INSIDE the text is
//                                           just text, so `</property>` lands in column 0
//
// A serialiser that decided indentation from depth alone reproduces the third line and
// fails the other three. Depth is still what sets the amount of indent — two spaces per
// open tag, and the closing tag indents at the depth it is closing INTO, which is why the
// stack is popped before the newline is written.
//
// WHAT THIS FILE MAY NOT DECIDE
//
// ADR 0053 clause 6: "a tolerated divergence is a ledger entry, never an `if` inside the
// parser." The same applies here. Where the goldens carry a value that syntax alone cannot
// produce — an enum member resolved against the GIR — this file calls out to
// `options.resolveIdent` and, given no answer, emits the source spelling. It does not carry
// a table of enum members, and adding one for a single stubborn file would be exactly the
// `if` clause 6 refuses. `corpus/divergences.mjs` is where such a case is recorded, and
// `src/resolve-ident.mjs` is the resolver that answers from the `@girs` vocabulary.

/**
 * @import { BlueprintFile, BlueprintImport, Child, Extension, MenuItem, MenuNode, ObjectBody,
 *   ObjectNode, Property, Signal, TemplateNode, TypeRef, Value } from './ast.d.mts'
 */
import { numberLiteral } from './number-literal.mjs';

/**
 * How the emitter is told what a bare identifier means — with `accessibilityElement` below, the
 * only seam through which introspection reaches this file.
 *
 * `03-property-enum.ui` is the file that forces it: `orientation: vertical` leaves the
 * reference compiler as `1` and `halign: center` as `3`, because it resolves the member
 * against the GIR. Nothing in the syntax carries those numbers.
 *
 * `typeName` is the GType name of the object the property sits ON (`GtkBox`), never the name
 * of the enum (`GtkOrientation`): the AST knows the first and the second is a fact about the
 * library. `propertyName` is in the signature BECAUSE the second lookup needs it — the join
 * from `GtkBox.orientation` to `GtkOrientation` is what `@girs` 4.9.0 added, and without it a
 * resolver had to search every enum for a member spelled `never` and guess between the
 * several that have one. Searching was never available; guessing is the silent-wrong-output
 * ADR 0053 clause 3 refuses.
 *
 * The answer is TEXT and not a number because the two kinds of answer differ: an enum member
 * becomes its integer, a flag set stays nicks joined by `|`. `null` means the identifier is
 * not the library's — an object id — and the source spelling stands.
 *
 * A resolver MAY throw, and `src/resolve-ident.mjs` does: a member of a known enum that the
 * enum does not have is a file the oracle refuses too, and passing it through would be
 * output that looks plausible and means something else.
 *
 * The second seam answers a different question about a different identifier: which ELEMENT one
 * `accessibility { }` entry becomes. GTK's ARIA slots are properties, relations and states, they
 * are spelled alike in the block and they emit as three different elements, so the name has to be
 * looked up the same way the value is. Without a resolver every entry stays `<property>`, which is
 * right for the ones that are properties and a knowing divergence for the rest — the same stance
 * `resolveIdent`'s absence takes.
 *
 * The third seam answers the other half of that block: what one entry's VALUE emits. `checked:
 * true` is a `GtkAccessibleTristate` and emits `1`, while `hidden: true` is a boolean and emits
 * `true` — same spelling, different bytes, and nothing but GTK's ARIA table tells them apart,
 * which is why this is a seam and not a rule in here.
 *
 * The fourth seam answers what GType NAME a type reference spells. `Adw.Bin` is `AdwBin`, and
 * every corpus file imports one of two namespaces whose C prefix IS the namespace name — which is
 * the only reason concatenating the two ever produced a golden. `Gio.ListStore` is `GListStore`.
 * Without the seam the emitter concatenates, right for those two and a knowing divergence for
 * any other; with it, a namespace the resolver has no vocabulary for is refused by name. The
 * projection (`project.mjs`) takes the same seam: a tag is the one thing that exit must spell
 * right, and it concatenated too until it did.
 *
 * @typedef {Object} EmitOptions
 * @property {(typeName: string, propertyName: string, member: string, where: string) => string | null} [resolveIdent]
 * @property {(name: string, where: string) => 'property' | 'relation' | 'state'} [accessibilityElement]
 * @property {(name: string, member: string, where: string) => string | null} [accessibilityValue]
 * @property {(type: TypeRef, where: string) => string} [gtypeName]
 */

/**
 * Shared state for one emit: the caller's resolvers, plus the two things a value cannot be
 * emitted without and a single node does not carry.
 *
 * @typedef {Object} EmitContext
 * @property {EmitOptions['resolveIdent']} resolveIdent
 * @property {EmitOptions['accessibilityElement']} accessibilityElement
 * @property {EmitOptions['accessibilityValue']} accessibilityValue
 * @property {EmitOptions['gtypeName']} gtypeName
 * @property {Map<string, string | null>} idTypes  object id -> GType name, `null` where the object is extern, for `setters { }`
 * @property {string | undefined} templateClass  what the id `template` refers to
 */

/** Byte-identical in every golden in the corpus, including the `@generated` marker. */
const GENERATED_NOTICE =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!--\n' +
    'DO NOT EDIT!\n' +
    'This file was @generated by blueprint-compiler. Instead, edit the\n' +
    'corresponding .blp file and regenerate this file with blueprint-compiler.\n' +
    '-->';

/**
 * Emit the GtkBuilder XML for a parsed Blueprint file.
 *
 * @param {BlueprintFile} file
 * @param {EmitOptions} [options]
 * @returns {string}  the GtkBuilder XML, including the trailing newline
 */
export function emitGtkBuilderXml(file, options) {
    const seams = {
        resolveIdent: options?.resolveIdent,
        accessibilityElement: options?.accessibilityElement,
        accessibilityValue: options?.accessibilityValue,
        gtypeName: options?.gtypeName,
    };
    /** @type {EmitContext} */
    const context = { ...seams, idTypes: indexObjectIds(file, seams), templateClass: findTemplateClass(file) };

    const xml = new XmlWriter();
    xml.startTag('interface', {});
    // One `<requires>` and only ever `gtk`, in every golden — 18-multiple-imports.ui pins
    // that: `using Adw 1;` is used by the file and reaches the XML nowhere.
    xml.selfClosing('requires', { lib: 'gtk', version: gtkVersion(file.imports) });

    for (const root of file.roots) {
        if (root.kind === 'template') emitTemplate(xml, root, context);
        else if (root.kind === 'menu') emitMenu(xml, root, context);
        else emitObject(xml, root, context);
    }

    xml.endTag();
    return `${xml.result}\n`;
}

// ------------------------------------------------------------------ the writer

/** The reference emitter's state machine; see the file header for what each line of it buys. */
class XmlWriter {
    constructor() {
        this.result = GENERATED_NOTICE;
        /** @type {string[]} */
        this.stack = [];
        /** Whether the last thing written was an element rather than text. */
        this.needsNewline = false;
    }

    /** @param {string} tag @param {Record<string, unknown>} attrs */
    startTag(tag, attrs) {
        this.break();
        this.result += `<${tag}${formatAttributes(attrs)}>`;
        this.stack.push(tag);
        this.needsNewline = false;
    }

    /** @param {string} tag @param {Record<string, unknown>} attrs */
    selfClosing(tag, attrs) {
        this.break();
        this.result += `<${tag}${formatAttributes(attrs)}/>`;
        this.needsNewline = true;
    }

    endTag() {
        const tag = this.stack.pop();
        if (this.needsNewline) this.break();
        this.result += `</${tag}>`;
        this.needsNewline = true;
    }

    /** @param {string} value */
    text(value) {
        this.result += escapeXml(value);
        this.needsNewline = false;
    }

    break() {
        this.result += `\n${'  '.repeat(this.stack.length)}`;
    }
}

/**
 * `&`, `<` and `>` — and NOT `"`, in attribute values as much as in text.
 *
 * 16-string-escapes.ui pins the first half (`a "quoted" word` survives verbatim while `&`
 * and `<` do not); `>` is not in any golden and was measured on 0.20.4, which reaches for
 * Python's `xml.sax.saxutils.escape` and applies it to attributes too. The consequence is
 * upstream's and is reproduced deliberately: a `"` inside an attribute value produces XML
 * that does not parse. Diverging here would cost a byte-equal diff on the file that finally
 * contains one.
 *
 * @param {unknown} value
 */
function escapeXml(value) {
    return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Attribute order is insertion order, and an attribute whose value is absent is omitted
 * rather than emitted empty — 13-binding.ui's `no-sync-create` sibling has no `bind-flags`
 * at all, and 04-children-implicit.ui's `<child>` has no `type`.
 *
 * @param {Record<string, unknown>} attrs
 */
function formatAttributes(attrs) {
    let out = '';
    for (const [name, value] of Object.entries(attrs)) {
        if (value === null || value === undefined) continue;
        out += ` ${name}="${escapeXml(value)}"`;
    }
    return out;
}

// ------------------------------------------------------------------ objects and bodies

/** @param {XmlWriter} xml @param {ObjectNode} object @param {EmitContext} context */
function emitObject(xml, object, context) {
    const className = gtypeName(object.type, context);
    xml.startTag('object', { class: className, id: object.id });
    emitBody(xml, object.body, ownerOf(object.type, className), context);
    xml.endTag();
}

/**
 * What a body's values are resolved AGAINST, or `null` for an extern type.
 *
 * `null` is the answer `identText` already had for "no owner" and it is the right one here:
 * an extern class is in no GIR, so no property of it can be joined to an enum and every
 * identifier keeps the spelling the source gave it. Keying that on the GType NAME instead
 * would be wrong on one file and green on every other — `$GtkBox { orientation: vertical; }`
 * is `vertical` to the oracle and `1` to a reader that trusts the name
 * (`33-extern-unresolved.blp`).
 *
 * @param {TypeRef} type @param {string} gtype @returns {string | null}
 */
function ownerOf(type, gtype) {
    return type.extern === true ? null : gtype;
}

/** @param {XmlWriter} xml @param {TemplateNode} template @param {EmitContext} context */
function emitTemplate(xml, template, context) {
    // 08-template.ui: `class` is the `$Name` without its sigil, `parent` the GType of the
    // type after the colon. The owner type for value resolution is the PARENT — the
    // template class is the one being defined and has no ParamSpecs of its own yet.
    const parent = gtypeName(template.parent, context);
    xml.startTag('template', { class: template.className, parent });
    emitBody(xml, template.body, ownerOf(template.parent, parent), context);
    xml.endTag();
}

/**
 * The one ordering rule in the file: an object's members are emitted in SOURCE order, with
 * properties, children, signals and extensions interleaved.
 *
 * The AST hands them over in four separate arrays, so the order has to be recovered from
 * the `line` every node carries. It is not cosmetic: `showcases/gtk/adw-blueprint-layout/
 * src/toolbar-view.blp` writes `[top]`, then `content:`, then `[bottom]`, and its golden
 * emits `<child type="top">`, `<property name="content">`, `<child type="bottom">` in
 * exactly that sequence. Grouping by kind would move the property past the second child.
 *
 * Two members on ONE line are not in any golden. The sort is stable, so they keep the
 * group order below.
 *
 * @param {XmlWriter} xml @param {ObjectBody} body @param {string | null} ownerType @param {EmitContext} context
 */
function emitBody(xml, body, ownerType, context) {
    const members = inSourceOrder([
        ['property', body.properties],
        ['child', body.children],
        ['signal', body.signals],
        ['extension', body.extensions],
    ]);

    for (const [kind, member] of members) {
        if (kind === 'property') emitProperty(xml, /** @type {Property} */ (member), ownerType, context);
        else if (kind === 'child') emitChild(xml, /** @type {Child} */ (member), context);
        else if (kind === 'signal') emitSignal(xml, /** @type {Signal} */ (member), context);
        else emitExtension(xml, /** @type {Extension} */ (member), context);
    }
}

/**
 * @param {readonly [string, readonly { readonly line: number }[]][]} groups
 * @returns {[string, { readonly line: number }][]}
 */
/**
 * Merge the arrays of one body back into the order the source wrote them.
 *
 * `line` first and `order` to break the tie. The tie is not hypothetical: two members on one
 * line is legal — `Gtk.Label { } spacing: 4;` — and before `order` existed the tie fell to
 * whichever array a member had landed in, which put the property first where the oracle puts
 * the child first. `26-one-line-members.blp` is that case, pinned.
 *
 * Menu attributes and items carry the same counter, and they did not always: without it the
 * stable sort kept the group order below, attributes before items, and `submenu { item (…)
 * label: "…"; }` on one line emitted the attribute first where the oracle emits the item.
 * `26-one-line-members.blp` holds that case since it was found.
 */
function inSourceOrder(groups) {
    /** @type {[string, { readonly line: number, readonly order?: number }][]} */
    const merged = [];
    for (const [kind, nodes] of groups) {
        for (const node of nodes) merged.push([kind, node]);
    }
    return merged.sort((a, b) => a[1].line - b[1].line || (a[1].order ?? 0) - (b[1].order ?? 0));
}

/** @param {XmlWriter} xml @param {Child} child @param {EmitContext} context */
function emitChild(xml, child, context) {
    // 05-child-slot-named.ui: the `[start]` bracket is an attribute on the CHILD WRAPPER,
    // and 25-bracket-breakpoint.ui says `[breakpoint]` is nothing more than another one of
    // those. An object-valued PROPERTY is a different construct and lives in emitProperty.
    xml.startTag('child', { type: child.slot });
    if (child.object.kind === 'menu') emitMenu(xml, child.object, context);
    else emitObject(xml, child.object, context);
    xml.endTag();
}

// ------------------------------------------------------------------ properties

/** @param {XmlWriter} xml @param {Property} property @param {string | null} ownerType @param {EmitContext} context */
function emitProperty(xml, property, ownerType, context) {
    const value = property.value;

    if (value.kind === 'binding') {
        // 13-binding.ui: a simple binding is a SELF-CLOSING property, and the compiler adds
        // a `sync-create` the source never wrote.
        xml.selfClosing('property', {
            name: property.name,
            'bind-source': objectId(value.source, context),
            'bind-property': value.property,
            'bind-flags': bindFlags(value.flags),
        });
        return;
    }

    if (value.kind === 'object') {
        // 06-property-object-valued.ui, and 08/18 for the `child:` spelling of it.
        xml.startTag('property', { name: property.name });
        emitObject(xml, value.object, context);
        xml.endTag();
        return;
    }

    if (value.kind === 'list') {
        emitListProperty(xml, property, value);
        return;
    }

    xml.startTag('property', { name: property.name, ...translatedAttributes(value) });
    xml.text(scalarText(value, ownerType, property.name, context));
    xml.endTag();
}

/**
 * The compiler's own flag set, in the compiler's own order, and absent entirely when empty.
 *
 * 13-binding.ui shows only the added `sync-create`; the other three answers were measured on
 * 0.20.4 and the manifest's note on that file says a parser that hardcodes `sync-create`
 * passes the corpus and is wrong: `no-sync-create` drops the attribute, and `inverted` /
 * `bidirectional` join with `|` in THIS order regardless of how the source spelled them.
 *
 * @param {readonly string[]} flags
 */
function bindFlags(flags) {
    const emitted = [];
    if (!flags.includes('no-sync-create')) emitted.push('sync-create');
    if (flags.includes('inverted')) emitted.push('invert-boolean');
    if (flags.includes('bidirectional')) emitted.push('bidirectional');
    return emitted.length === 0 ? null : emitted.join('|');
}

/**
 * `styles`, `strings` and `widgets` are three different XML shapes, told apart by the
 * property NAME because that is the only thing left of them in the AST.
 *
 * In Blueprint's own grammar these are three distinct block extensions; the AST this
 * emitter consumes flattens all bracketed lists into one `ListValue`, so the name is what
 * has to carry the difference — 10-styles.ui (`<style><class name="…"/></style>`, not a
 * property), 21-value-array.ui (`<items><item>…</item></items>`) and
 * 23-widget-reference-list.ui (`<widgets><widget name="…"/></widgets>`, so the ids they
 * point at are load-bearing) are three files that would otherwise collapse into one rule.
 *
 * Any other `name: [ … ]` is an ArrayValue on a string-array PROPERTY and not an extension at
 * all — the `:` is what tells them apart in the source, and the shape is different again:
 * `css-classes: ["flat", "narrow"]` is ONE `<property>` whose text is the items joined by a
 * newline, the spelling GtkBuilder's GStrv parser splits on (21-value-array.ui).
 *
 * @param {XmlWriter} xml @param {Property} property @param {Extract<Value, { kind: 'list' }>} value
 */
function emitListProperty(xml, property, value) {
    if (property.name === 'styles') {
        xml.startTag('style', {});
        for (const item of value.items) xml.selfClosing('class', { name: listItemText(item) });
        xml.endTag();
        return;
    }

    if (property.name === 'widgets') {
        xml.startTag('widgets', {});
        for (const item of value.items) xml.selfClosing('widget', { name: listItemText(item) });
        xml.endTag();
        return;
    }

    if (property.name === 'strings') {
        xml.startTag('items', {});
        for (const item of value.items) {
            xml.startTag('item', translatedAttributes(item));
            xml.text(listItemText(item));
            xml.endTag();
        }
        xml.endTag();
        return;
    }

    xml.startTag('property', { name: property.name });
    xml.text(value.items.map((item) => arrayItemText(item)).join('\n'));
    xml.endTag();
}

/**
 * An ArrayValue item is a plain string. The oracle's `_emit_value` has no arm for a translated
 * one and dies with a CompilerBugError, so `_()` inside `css-classes: [ … ]` is refused here by
 * name rather than emitted as something the reference never produces.
 *
 * @param {Value} item
 */
function arrayItemText(item) {
    if (item.kind === 'string' && item.translatable === undefined) return item.value;
    throw new Error(
        `blueprint: line ${item.line}: a property array holds plain strings only — ` +
            `${item.kind === 'string' ? 'a translated string' : `a ${item.kind}`} is not one the reference compiler emits`,
    );
}

/** @param {Value} item */
function listItemText(item) {
    if (item.kind === 'string') return item.value;
    if (item.kind === 'ident') return item.name;
    throw new Error(`blueprint: line ${item.line}: a list item that is neither a string nor an identifier`);
}

/**
 * 09-translatable.ui: `_()` is `translatable="yes"` alone, `C_()` is that PLUS `context`,
 * in that order. The marking travels with the value, so a menu attribute, a `<setter>` and
 * a `<item>` inside a string list all take the same two attributes.
 *
 * @param {Value} value
 * @returns {Record<string, unknown>}
 */
function translatedAttributes(value) {
    if (value.kind !== 'string' || value.translatable === undefined) return {};
    return { translatable: 'yes', context: value.translatable.context };
}

// ------------------------------------------------------------------ scalar values

/**
 * @param {Value} value @param {string | null} ownerType @param {string | null} propertyName
 * @param {EmitContext} context
 */
function scalarText(value, ownerType, propertyName, context) {
    if (value.kind === 'string') return value.value;
    if (value.kind === 'bool') return value.value ? 'true' : 'false';
    if (value.kind === 'number') return numberText(value.raw);
    if (value.kind === 'ident') return identText(value, ownerType, propertyName, context);
    throw new Error(`blueprint: line ${value.line}: a ${value.kind} value where a scalar was expected`);
}

/**
 * The introspection seam. See `EmitOptions.resolveIdent` for what each argument is and is not.
 *
 * With no resolver the identifier is emitted AS WRITTEN, which is a knowing divergence from
 * 03-property-enum.ui rather than a guess at its `1`: an emitter that shipped a table of
 * enum members would be the `if` ADR 0053 clause 6 refuses, and the first member it got
 * wrong would be wrong silently. An identifier that is an object reference rather than an
 * enum member takes the same path and is right without a resolver — 12-menu.ui's
 * `menu-model: mainMenu` emits the id as plain text.
 *
 * Both the owner type and the property name have to be known: a menu attribute has neither
 * owner nor ParamSpec, and a `layout { }` entry belongs to a layout CHILD and not to the
 * widget, so passing the widget there would ask about the wrong type. Both call sites pass
 * `null` and take the source spelling, which is what their goldens hold.
 *
 * @param {import('./ast.d.mts').IdentValue} value @param {string | null} ownerType
 * @param {string | null} propertyName @param {EmitContext} context
 */
function identText(value, ownerType, propertyName, context) {
    if (ownerType !== null && propertyName !== null && context.resolveIdent !== undefined) {
        const resolved = context.resolveIdent(ownerType, propertyName, value.name, `line ${value.line}`);
        if (resolved !== null && resolved !== undefined) return resolved;
    }
    return objectId(value.name, context);
}

/**
 * 17-numeric-forms.ui: `1.0` is normalised to `1` while `0.25` and `0.5` are not, and `-1`
 * and `0` survive. The rule behind those four lines is that a value the source spelled with
 * a `.` but which lands on a whole number is emitted as an integer — which is why the AST
 * keeps the raw spelling and this is the only place that reads it.
 *
 * BigInt and not Number on the WHOLE path: the reference goes through Python's
 * arbitrary-precision `int`, so a 17-digit literal with no `.` is exact where `Number` would
 * round it. On the dotted path that precision is already gone — `123456789012345678.0` emits
 * `123456789012345680` from both, because both round through an IEEE-754 double before the
 * integer conversion — so the BigInt there buys formatting, not digits.
 *
 * The fractional path is Python's `repr`, and it is NOT `String(x)`. Measured on 0.20.4:
 *
 *     0.00005     ->  5e-05      String(x) gives "0.00005"
 *     0.0000015   ->  1.5e-06    String(x) gives "0.0000015"
 *     0.0000001   ->  1e-07      String(x) gives "1e-7"
 *
 * Two independent rules differ. Python switches to exponent notation below `1e-4` and
 * JavaScript below `1e-6`, so everything in that band comes out fixed here and scientific
 * there; and Python pads the exponent to two digits where JavaScript pads to none. The high
 * end needs no rule: Python also switches at `1e16`, and every double at or above `2**53` is
 * an integer, so a value with a fraction can never reach it and the branch above has already
 * taken it. Underscore separators and the `0x` form are Blueprint's own number grammar; an
 * exponent is not, which is a fact about INPUT and says nothing about the output above.
 *
 * @param {string} raw
 */
function numberText(raw) {
    const { negative, digits } = numberLiteral(raw);

    if (!digits.includes('.')) {
        const whole = BigInt(digits);
        return (negative ? -whole : whole).toString();
    }

    const asFloat = negative ? -Number(digits) : Number(digits);
    if (Number.isInteger(asFloat)) return BigInt(asFloat).toString();

    // `toExponential()` with no argument is the shortest round-trip form, which is the same
    // set of digits Python's `repr` picks — only the notation and the exponent width differ.
    const [mantissa, exponent] = asFloat.toExponential().split('e');
    const power = Number(exponent);
    if (power >= -4) return String(asFloat);
    return `${mantissa}e${power < 0 ? '-' : '+'}${String(Math.abs(power)).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ signals

/** @param {XmlWriter} xml @param {Signal} signal @param {EmitContext} context */
function emitSignal(xml, signal, context) {
    // 11-signal.ui has the bare shape. The rest was measured on 0.20.4 and is stranger than
    // it looks: the flags are emitted as PYTHON booleans, so `swapped` becomes
    // `swapped="True"` — capital T, and `not-swapped` becomes `swapped="False"` rather than
    // dropping the attribute, while `after` drops it when absent. The detail of
    // `notify::sensitive` is folded back into `name`.
    xml.selfClosing('signal', {
        name: signal.detail === undefined ? signal.name : `${signal.name}::${signal.detail}`,
        handler: signal.handler,
        swapped: swappedAttribute(signal.flags),
        after: signal.flags.includes('after') ? 'True' : null,
        object: signal.object === undefined ? null : objectId(signal.object, context),
    });
}

/** @param {readonly string[]} flags */
function swappedAttribute(flags) {
    if (flags.includes('swapped')) return 'True';
    if (flags.includes('not-swapped')) return 'False';
    return null;
}

// ------------------------------------------------------------------ extension blocks

/** @param {XmlWriter} xml @param {Extension} extension @param {EmitContext} context */
function emitExtension(xml, extension, context) {
    if (extension.name === 'condition') {
        // 14-breakpoint.ui: the condition is element TEXT, not an attribute and not a property.
        xml.startTag('condition', {});
        xml.text(conditionText(extension));
        xml.endTag();
        return;
    }

    if (extension.name === 'setters') {
        // …and the `setters { }` BLOCK has no element of its own: each setter is a sibling
        // of the `<condition>`, which is why this arm writes no wrapper.
        for (const setter of extension.entries) emitSetter(xml, setter, context);
        return;
    }

    if (extension.name === 'layout' || extension.name === 'accessibility') {
        // 19-layout.ui and 20-accessibility.ui: one wrapper element named after the block,
        // holding one element per entry. The two blocks agree on the wrapper and on nothing
        // else, and each half of that was MEASURED on 0.20.4 rather than assumed.
        //
        // NEITHER resolves anything through the widget, because the widget is the table lying
        // nearest to hand and it is the wrong one in both. `Gtk.Grid { Gtk.Label { layout {
        // halign: center; } } }` emits `center` and not `3` — a layout entry belongs to the
        // layout CHILD (`GtkGridLayoutChild`), which has no `halign`, and the compiler does not
        // check it against anything, so a layout value is written as the source spelled it.
        //
        // The a11y block resolves BOTH halves, and neither against the widget either. `Gtk.Label
        // { accessibility { orientation: vertical; } }` emits `1` although `GtkLabel` is not
        // orientable at all, because GTK's ARIA table answers there and not the ParamSpecs —
        // passing the widget would be right by accident inside `Gtk.Box` and wrong here. The
        // ELEMENT is the half this file wrote as `<property>` for every entry until a corpus file
        // held anything but a property: `row-index` is a `<relation>` and `checked` a `<state>`,
        // and GtkBuilder rejects either spelled as the other. The VALUE is the half that waited
        // on `@girs` to publish the ARIA types. Both are vocabulary data, both are asked per
        // entry, and `src/resolve-ident.mjs` says what each can answer.
        const elementOf =
            extension.name === 'accessibility' && context.accessibilityElement !== undefined
                ? context.accessibilityElement
                : () => 'property';
        const ariaValue = extension.name === 'accessibility' ? context.accessibilityValue : undefined;
        xml.startTag(extension.name, {});
        for (const entry of extension.entries) {
            // `labelled-by: [labelA, labelB]` is one ELEMENT PER VALUE under the same name, not a
            // list inside one element (20-accessibility.ui). Only the a11y block takes the form.
            const values = entry.value.kind === 'list' ? entry.value.items : [entry.value];
            for (const value of values) {
                xml.startTag(elementOf(entry.name, `line ${entry.line}`), {
                    name: entry.name,
                    ...translatedAttributes(value),
                });
                xml.text(extensionText(value, entry.name, ariaValue, context));
                xml.endTag();
            }
        }
        xml.endTag();
        return;
    }

    if (extension.name === 'responses') {
        // 31-responses.ui: `<responses>` of `<response id="…">`, translatable attributes after
        // the id. The response FLAGS would add `enabled="false"` and `appearance="…"`, and the
        // parser refuses them by name, so neither attribute is ever owed here.
        xml.startTag('responses', {});
        for (const response of extension.entries) {
            xml.startTag('response', { id: response.name, ...translatedAttributes(response.value) });
            xml.text(scalarText(response.value, null, null, context));
            xml.endTag();
        }
        xml.endTag();
        return;
    }

    throw new Error(`blueprint: line ${extension.line}: no emitter rule for the "${extension.name}" block`);
}

/**
 * One entry of an extension block, through the ARIA value seam where the block has one.
 *
 * Only an IDENTIFIER or a BOOLEAN can spell an enum member, and the oracle says so by name rather
 * than by silence: `checked: 1` is "Cannot convert number to Gtk.AccessibleTristate" and
 * `checked: _("x")` the same sentence for a translated string. So those two kinds reach the seam,
 * and a boolean reaches it as the text `true` — a member of `GtkAccessibleTristate`, not a
 * boolean, on a slot the table types as an enum. Everything else keeps the source spelling, which
 * is what a `layout { }` entry always takes.
 *
 * @param {Value} value @param {string} name @param {EmitOptions['accessibilityValue']} ariaValue
 * @param {EmitContext} context
 */
function extensionText(value, name, ariaValue, context) {
    if (ariaValue !== undefined && (value.kind === 'ident' || value.kind === 'bool')) {
        const member = value.kind === 'bool' ? String(value.value) : value.name;
        const resolved = ariaValue(name, member, `line ${value.line}`);
        if (resolved !== null && resolved !== undefined) return resolved;
    }
    return scalarText(value, null, null, context);
}

/** @param {XmlWriter} xml @param {Property} setter @param {EmitContext} context */
function emitSetter(xml, setter, context) {
    const dot = setter.name.indexOf('.');
    if (dot < 1) {
        throw new Error(`blueprint: line ${setter.line}: a setter needs an "<object>.<property>" target`);
    }
    const target = setter.name.slice(0, dot);
    const property = setter.name.slice(dot + 1);

    xml.startTag('setter', {
        object: objectId(target, context),
        property,
        ...translatedAttributes(setter.value),
    });
    // The owner type here is the type of the object the setter POINTS AT, not the
    // breakpoint it sits in, so an enum-valued setter resolves against the right widget.
    // Measured: `boxOne.halign: baseline_fill` inside an `Adw.Breakpoint` is `4`.
    xml.text(scalarText(setter.value, context.idTypes.get(target) ?? null, property, context));
    xml.endTag();
}

/**
 * `Extension.argument` is documented as the parenthesised text UNDECODED, so unlike every
 * `StringValue` in the AST it still carries its quotes and its escapes. Decoded here and
 * nowhere else. A value that arrives without quotes is passed through, so a parser that
 * decodes it after all produces the same bytes.
 *
 * @param {Extension} extension
 */
function conditionText(extension) {
    const argument = extension.argument ?? '';
    const quote = argument.charAt(0);
    if (argument.length < 2 || (quote !== '"' && quote !== "'") || !argument.endsWith(quote)) return argument;
    return unescapeQuoted(argument.slice(1, -1));
}

/** Blueprint's escape set, and it is closed: an unknown escape is an error upstream, not a literal. */
const STRING_ESCAPES = new Map([
    ['n', '\n'],
    ['t', '\t'],
    ['\\', '\\'],
    ['"', '"'],
    ["'", "'"],
    ['\n', '\n'],
]);

/** @param {string} body */
function unescapeQuoted(body) {
    let out = '';
    for (let i = 0; i < body.length; i += 1) {
        if (body[i] !== '\\') {
            out += body[i];
            continue;
        }
        i += 1;
        const replacement = STRING_ESCAPES.get(body[i]);
        if (replacement === undefined) {
            throw new Error(`blueprint: invalid escape sequence "\\${body[i]}" in a condition`);
        }
        out += replacement;
    }
    return out;
}

// ------------------------------------------------------------------ menus

/** @param {XmlWriter} xml @param {MenuNode | MenuItem} menu @param {EmitContext} context */
function emitMenu(xml, menu, context) {
    // 12-menu.ui: a top-level `menu` is a SIBLING of the objects and carries the id; the
    // `section` / `item` / `submenu` inside it are elements named after their keyword and
    // carry none. 22-menu-nested.ui adds that an attribute and a nested item interleave in
    // source order, so the merge is the same one `emitBody` does.
    const isRoot = menu.kind === 'menu';
    xml.startTag(isRoot ? 'menu' : menu.kind, { id: isRoot ? menu.id : undefined });

    const members = inSourceOrder([
        ['attribute', isRoot ? [] : menu.attributes],
        ['item', menu.items],
    ]);
    for (const [kind, member] of members) {
        if (kind === 'item') {
            emitMenu(xml, /** @type {MenuItem} */ (member), context);
            continue;
        }
        const attribute = /** @type {Property} */ (member);
        xml.startTag('attribute', { name: attribute.name, ...translatedAttributes(attribute.value) });
        // No owner type: a menu attribute belongs to a GMenuModel, which has no ParamSpecs
        // for a resolver to search, and 22-menu-nested.ui's `item ("Deep", "app.deep")`
        // shorthand carries plain strings either way.
        xml.text(scalarText(attribute.value, null, null, context));
        xml.endTag();
    }

    xml.endTag();
}

// ------------------------------------------------------------------ names and ids

/**
 * The GType name, which is what every `class=` and `parent=` in the goldens holds.
 *
 * An unqualified type is a Gtk type and nothing else — 24-unqualified-type.ui's `Box` is
 * `GtkBox` under `using Gtk 4.0;`, and the manifest records that `using Adw 1;` does not
 * make a bare `Bin` legal. For a qualified one the answer is the seam's, because the C prefix
 * is a fact about the namespace and not its spelling; the fallback concatenates, which is what
 * the prefix happens to be for the two namespaces every corpus file uses and wrong for `Gio`.
 *
 * @param {TypeRef} type @param {Pick<EmitContext, 'gtypeName'>} context
 */
function gtypeName(type, context) {
    if (context.gtypeName !== undefined) return context.gtypeName(type, `line ${type.line}`);
    // An extern type never defaults to Gtk: there is no import behind it, so the sigil-free
    // spelling IS the GType name. Getting this wrong in the fallback would be a `GtkMyWidget`
    // no GtkBuilder can find, which is the shape of wrong output ADR 0053 clause 3 refuses.
    if (type.extern === true) return `${type.namespace ?? ''}${type.name}`;
    return `${type.namespace ?? 'Gtk'}${type.name}`;
}

/**
 * `template` used as an object id means the template's own class — measured on 0.20.4,
 * which rewrites it in `bind-source`, in a signal's `object` and in a setter's `object`.
 * No golden carries it; the rewrite is one line and its absence would be a wrong id rather
 * than a missing one.
 *
 * @param {string} id @param {EmitContext} context
 */
function objectId(id, context) {
    return id === 'template' && context.templateClass !== undefined ? context.templateClass : id;
}

/** @param {readonly BlueprintImport[]} imports */
function gtkVersion(imports) {
    // 0.20.4 refuses anything but `using Gtk 4.0;` ("Expected the GIR version, not an exact
    // version number"), so this reads the import rather than hardcoding a constant it would
    // then have to keep in sync, and the fallback is for a file that names no Gtk import at
    // all — which the reference compiler rejects outright.
    return imports.find((entry) => entry.namespace === 'Gtk')?.version ?? '4.0';
}

/** @param {BlueprintFile} file */
function findTemplateClass(file) {
    for (const root of file.roots) {
        if (root.kind === 'template') return root.className;
    }
    return undefined;
}

/**
 * Every object id in the file with the GType it was declared as, so a `<setter>` can resolve
 * an enum against the object it targets rather than against the breakpoint it is written in.
 *
 * @param {BlueprintFile} file @param {Pick<EmitContext, 'gtypeName'>} seams
 */
function indexObjectIds(file, seams) {
    /** @type {Map<string, string | null>} */
    const byId = new Map();
    for (const root of file.roots) {
        if (root.kind === 'object') indexObject(root, byId, seams);
        else if (root.kind === 'template') indexBody(root.body, byId, seams);
    }
    return byId;
}

/** @param {ObjectNode} object @param {Map<string, string | null>} byId @param {Pick<EmitContext, 'gtypeName'>} seams */
function indexObject(object, byId, seams) {
    // An extern target is indexed as `null` and not left out: absent and extern are the same
    // to `Map.get`, and they must be, because `lookalike.orientation: vertical` on an extern
    // target keeps its spelling while the same setter on a `Gtk.Box` is `1`. The setter path
    // is a SECOND call site of the resolver, so an implementation that fixes only the object
    // body above is byte-equal on every golden that has no `setters { }` in it.
    if (object.id !== undefined) byId.set(object.id, ownerOf(object.type, gtypeName(object.type, seams)));
    indexBody(object.body, byId, seams);
}

/** @param {ObjectBody} body @param {Map<string, string | null>} byId @param {Pick<EmitContext, 'gtypeName'>} seams */
function indexBody(body, byId, seams) {
    for (const property of body.properties) indexValue(property.value, byId, seams);
    for (const child of body.children) {
        if (child.object.kind === 'object') indexObject(child.object, byId, seams);
    }
}

/** @param {Value} value @param {Map<string, string | null>} byId @param {Pick<EmitContext, 'gtypeName'>} seams */
function indexValue(value, byId, seams) {
    if (value.kind === 'object') indexObject(value.object, byId, seams);
    else if (value.kind === 'list') {
        for (const item of value.items) indexValue(item, byId, seams);
    }
}
