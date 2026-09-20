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
 * @import { BlueprintFile, BlueprintImport, Child, Expression, Extension, ExtensionEntry,
 *   MenuAttribute, MenuItem, MenuNode, ObjectBody, ObjectNode, Property, Signal, TemplateNode,
 *   TypeRef, Value } from './ast.d.mts'
 */
import { BUILTIN_GTYPES, BUILTIN_INTEGERS, BUILTIN_LITERAL_CLASS } from './builtin-types.mjs';
import { BlueprintEmitError, SUBSET_NOTE } from './errors.mjs';
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
 * @property {(type: TypeRef, where: string, position?: 'object' | 'reference') => string} [gtypeName]
 * @property {(typeName: string | null, propertyName: string) => string | null} [enumOrFlagsTypeOf]
 * @property {(typeName: string, propertyName: string) => string | null} [propertyGType]
 *   The GType of a property's own type, whatever that type is (`PROP_TYPES`, ts-for-gir #478).
 *   Absent, or answering `null`, leaves an uncast closure refused exactly as before — this seam
 *   turns a refusal into an answer and never the other way round.
 */

/**
 * Shared state for one emit: the caller's resolvers, plus the two things a value cannot be
 * emitted without and a single node does not carry.
 *
 * @typedef {Object} EmitContext
 * @property {string} file  the path the AST was parsed from, so a refusal names it
 * @property {EmitOptions['resolveIdent']} resolveIdent
 * @property {EmitOptions['accessibilityElement']} accessibilityElement
 * @property {EmitOptions['accessibilityValue']} accessibilityValue
 * @property {EmitOptions['gtypeName']} gtypeName
 * @property {EmitOptions['enumOrFlagsTypeOf']} enumOrFlagsTypeOf
 * @property {EmitOptions['propertyGType']} propertyGType
 * @property {Map<string, string | null>} idTypes  object id -> GType name, `null` where the object is extern, for `setters { }`
 * @property {Map<string, string>} idClasses  object id -> GType name, extern ones INCLUDED, for `<lookup type=…>`
 * @property {string | undefined} templateClass  what the id `template` refers to
 */

/**
 * The location a refusal names, from the context every emit path already carries.
 *
 * @param {Pick<EmitContext, 'file'>} context @param {number} line
 * @returns {import('./ast.d.mts').SourceLocation}
 */
const at = (context, line) => ({ file: context.file, line });

/** Byte-identical in every golden in the corpus, including the `@generated` marker. */
/** The one line a nested sub-document opens with; the notice below is the outer document's. */
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

const GENERATED_NOTICE =
    `${XML_DECLARATION}\n` +
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
        // Off the AST and not off a second argument: the two cannot then disagree, and a
        // refusal naming a file the bytes did not come from is the costliest kind to read.
        file: file.file,
        resolveIdent: options?.resolveIdent,
        accessibilityElement: options?.accessibilityElement,
        accessibilityValue: options?.accessibilityValue,
        gtypeName: options?.gtypeName,
        enumOrFlagsTypeOf: options?.enumOrFlagsTypeOf,
        propertyGType: options?.propertyGType,
    };
    const ids = indexObjectIds(file, seams);
    /** @type {EmitContext} */
    const context = {
        ...seams,
        idTypes: ids.byId,
        idClasses: ids.classes,
        templateClass: findTemplateClass(file, seams),
    };

    const xml = new XmlWriter();
    xml.startTag('interface', file.translationDomain === undefined ? {} : { domain: file.translationDomain });
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
    /**
     * @param {string} [header] what the document opens with. The nested document of an inline
     *   `template` opens with the XML declaration ALONE — the oracle builds it with
     *   `generated_notice=False`, and its indentation restarts at column 0, independent of the
     *   document it is embedded in.
     */
    constructor(header = GENERATED_NOTICE) {
        this.result = header;
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

    /**
     * A CDATA section, for text that is itself XML and must not be entity-escaped.
     *
     * The one escape a CDATA section still needs is its own terminator: `]]>` inside the text
     * would end the section early, so the oracle splits it across two sections
     * (`xml_emitter.py`: `text.replace("]]>", "]]]]><![CDATA[>")`). That is not hypothetical
     * here — an inline `template` nested inside another one produces exactly that sequence,
     * and `list_factory_nested.ui` is where the reference implementation shows it.
     *
     * @param {string} value
     */
    cdata(value) {
        this.result += `<![CDATA[${value.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
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
    const className = gtypeName(object.type, context, 'object');
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

/**
 * The four types a `Gtk.BuilderListItemFactory` sub-document may define, and the default.
 *
 * A closed list because the oracle keeps one (`gtk_list_item_factory.py`): anything else is
 * refused there, and emitting it here would write a `bytes` document GtkBuilder cannot bind.
 */
const LIST_ITEM_TYPES = new Set(['ListItem', 'ListHeader', 'ColumnViewRow', 'ColumnViewCell']);

/**
 * `template Gtk.ListItem { … }` — a SECOND, complete document, CDATA-escaped into
 * `<property name="bytes">`.
 *
 * Three things make it unlike every other member. It has its own XML declaration and no
 * generated notice. Its indentation restarts at column 0, so it cannot be written into the
 * enclosing writer. And it has its own ID SCOPE: `indexBody` never descends into it, so an id
 * declared inside may repeat one from the outer file, which the oracle states outright — the
 * two documents may not reference each other at all.
 *
 * @param {XmlWriter} xml @param {InlineTemplateNode} node @param {string | null} ownerType
 * @param {EmitContext} context
 */
function emitInlineTemplate(xml, node, ownerType, context) {
    // The enclosing type is known HERE and nowhere in the parser, which is why the check is
    // here. A `null` owner is an extern type: it validates nothing, by the same rule that lets
    // an extern parent carry any property name.
    if (ownerType !== null && ownerType !== 'GtkBuilderListItemFactory') {
        throw new BlueprintEmitError(
            `a \`template { … }\` block belongs to a Gtk.BuilderListItemFactory and this one is inside \`${ownerType}\`, where the oracle refuses it`,
            at(context, node.line),
        );
    }
    if (node.type !== undefined && (node.type.extern === true || !LIST_ITEM_TYPES.has(node.type.name))) {
        throw new BlueprintEmitError(
            `\`template ${node.type.namespace ?? ''}${node.type.name} { … }\` names a type a Gtk.BuilderListItemFactory cannot define — the oracle allows ${[...LIST_ITEM_TYPES].join(', ')} and nothing else`,
            at(context, node.line),
        );
    }
    // Absent type: the oracle warns and compiles `Gtk.ListItem`. The default is applied here
    // rather than at parse so the tree keeps saying what the file said.
    const type = node.type ?? /** @type {TypeRef} */ ({ name: 'ListItem', line: node.line });
    const className = gtypeName(type, context, 'reference');

    const nested = new XmlWriter(XML_DECLARATION);
    const ids = indexBodyIds(node.body, context);
    /** @type {EmitContext} */
    const nestedContext = { ...context, idTypes: ids.byId, idClasses: ids.classes, templateClass: className };
    nested.startTag('interface', {});
    // No `<requires>`: the sub-document carries none in any golden of the reference
    // implementation, and the outer document already states the version once.
    nested.startTag('template', { class: className });
    emitBody(nested, node.body, className, nestedContext);
    nested.endTag();
    nested.endTag();

    xml.startTag('property', { name: 'bytes' });
    xml.cdata(nested.result);
    xml.endTag();
}

/**
 * The six bracketed lists: wrapper tag, child tag, and the GType that may hold them.
 *
 * One table because they are one construct with six names — the oracle's own file-filter trio
 * is already a single implementation parameterised exactly this way, and `marks`, `items` and
 * `offsets` differ from it only in what one item carries.
 */
const EXTENSION_LIST_TAGS = new Map([
    ['marks', { child: 'mark', owner: 'GtkScale' }],
    ['items', { child: 'item', owner: 'GtkComboBoxText' }],
    ['offsets', { child: 'offset', owner: 'GtkLevelBar' }],
    ['mime-types', { child: 'mime-type', owner: 'GtkFileFilter' }],
    ['patterns', { child: 'pattern', owner: 'GtkFileFilter' }],
    ['suffixes', { child: 'suffix', owner: 'GtkFileFilter' }],
]);

/**
 * `marks [ … ]` and its five siblings.
 *
 * The OWNER check is here and not in the parser because the enclosing object's type is known
 * here and nowhere there. It compares the GType by NAME, so a subclass of `Gtk.Scale` carrying
 * marks is refused where the oracle would accept it — a refusal that names itself, not wrong
 * output, and the direction to be wrong in. A `null` owner is an extern type and validates
 * nothing, by the same rule an extern parent carries any property name.
 *
 * @param {XmlWriter} xml @param {ExtensionList} list @param {string | null} ownerType
 * @param {EmitContext} context
 */
function emitExtensionList(xml, list, ownerType, context) {
    const spec = /** @type {{ child: string, owner: string }} */ (EXTENSION_LIST_TAGS.get(list.name));
    if (ownerType !== null && ownerType !== spec.owner) {
        throw new BlueprintEmitError(
            `a \`${list.name} [ … ]\` block belongs to a ${spec.owner} and this one is inside \`${ownerType}\`, where the oracle refuses it`,
            at(context, list.line),
        );
    }
    xml.startTag(list.name, {});
    for (const item of list.items) {
        if (item.kind === 'offset') {
            // The one self-closing child of the six.
            xml.selfClosing(spec.child, {
                name: scalarText(item.name, null, null, context),
                value: numberText(item.value.raw),
            });
            continue;
        }
        if (item.kind === 'mark') {
            // Never self-closing, even with no label: the oracle writes `<mark value="2"></mark>`.
            xml.startTag(spec.child, {
                value: numberText(item.value.raw),
                ...(item.position === undefined ? {} : { position: item.position }),
                ...(item.label === undefined ? {} : translatedAttributes(item.label)),
            });
            if (item.label !== undefined) xml.text(scalarText(item.label, null, null, context));
            xml.endTag();
            continue;
        }
        xml.startTag(spec.child, {
            ...(item.kind === 'item' && item.id !== undefined ? { id: item.id } : {}),
            ...translatedAttributes(item.value),
        });
        xml.text(scalarText(item.value, null, null, context));
        xml.endTag();
    }
    xml.endTag();
}

/** @param {XmlWriter} xml @param {TemplateNode} template @param {EmitContext} context */
function emitTemplate(xml, template, context) {
    // 08-template.ui: `class` is the `$Name` without its sigil, `parent` the GType of the
    // type after the colon. The owner type for value resolution is the PARENT — the
    // template class is the one being defined and has no ParamSpecs of its own yet.
    //
    // 50-template-orphan.ui: with no parent the attribute is OMITTED, not defaulted — the
    // oracle passes `parent=None` and its writer drops null-valued attributes. The owner is
    // `null` for the same reason an extern parent gives `null`: the type is unknown, so
    // nothing inside resolves against a vocabulary.
    // A `$Name` reaches the XML verbatim; a TYPE reaches it as its GType, so `template ListItem`
    // is `class="GtkListItem"`. Same attribute, two sources, and only the file says which.
    const className =
        template.classType === undefined ? template.className : gtypeName(template.classType, context, 'reference');
    const parent = template.parent === undefined ? undefined : gtypeName(template.parent, context, 'reference');
    xml.startTag('template', { class: className, ...(parent === undefined ? {} : { parent }) });
    emitBody(xml, template.body, template.parent === undefined ? null : ownerOf(template.parent, parent), context);
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
        ['inline-template', body.inlineTemplate === undefined ? [] : [body.inlineTemplate]],
        ['extension-list', body.extensionLists],
    ]);

    for (const [kind, member] of members) {
        if (kind === 'property') emitProperty(xml, /** @type {Property} */ (member), ownerType, context);
        else if (kind === 'child') emitChild(xml, /** @type {Child} */ (member), context);
        else if (kind === 'signal') emitSignal(xml, /** @type {Signal} */ (member), context);
        else if (kind === 'inline-template') {
            emitInlineTemplate(xml, /** @type {InlineTemplateNode} */ (member), ownerType, context);
        } else if (kind === 'extension-list') {
            emitExtensionList(xml, /** @type {ExtensionList} */ (member), ownerType, context);
        } else emitExtension(xml, /** @type {Extension} */ (member), context);
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
    // Two attributes GtkBuilder reads differently, and the bracket held exactly one of them.
    xml.startTag(
        'child',
        child.internalChild === undefined ? { type: child.slot } : { 'internal-child': child.internalChild },
    );
    emitObject(xml, child.object, context);
    xml.endTag();
}

// ------------------------------------------------------------------ properties

/** @param {XmlWriter} xml @param {Property} property @param {string | null} ownerType @param {EmitContext} context */
function emitProperty(xml, property, ownerType, context) {
    const value = property.value;

    if (value.kind === 'binding') {
        const simple = value.form === 'bind' ? simpleLookup(value.expression) : null;
        if (simple !== null) {
            // 13-binding.ui: a simple binding is a SELF-CLOSING property, and the compiler
            // adds a `sync-create` the source never wrote.
            xml.selfClosing('property', {
                name: property.name,
                // A binding SOURCE is a reference too, and takes the same check: the oracle
                // answers `bind doesNotExist.label` with "Could not find object with ID".
                'bind-source': objectRef(simple.source, value.line, 'the source of a binding', context),
                'bind-property': simple.property,
                'bind-flags': bindFlags(value.flags),
            });
            return;
        }
        if (value.flags.length > 0) {
            throw new BlueprintEmitError(
                `\`${value.flags.join(' ')}\` is a binding flag on an ` +
                    'expression that is not a single lookup — the reference compiler refuses the same ' +
                    'file with "Only bindings with a single lookup can have flags"',
                at(context, value.line),
            );
        }
        checkItemPlacement(value.expression, value.form, false, context);
        // `bind` makes the property TRACK the expression and `expr` makes the expression BE
        // the value, and the difference is the element name and nothing else — measured:
        // `label: bind true` is `<binding name="label">` and `expression: expr true` is
        // `<property name="expression">`, with the same `<constant>` inside.
        xml.startTag(value.form === 'bind' ? 'binding' : 'property', { name: property.name });
        // An uncast closure's return type is the TARGET PROPERTY's — the oracle infers it the
        // same way, from the ParamSpec. Supplied only to a closure with no cast of its own:
        // handing it to every expression would also reach `emitConstant`, where the literal's
        // own spelling decides the type and an imposed one would change what a `bind "x"`
        // emits. The narrow shape is what keeps this a refusal-to-answer change and not a
        // rewrite of the value rules.
        const inferred = inferredClosureType(value.expression, ownerType, property.name, context);
        emitExpression(xml, value.expression, inferred, context);
        xml.endTag();
        return;
    }

    if (value.kind === 'object') {
        // 06-property-object-valued.ui, and 08/18 for the `child:` spelling of it.
        xml.startTag('property', { name: property.name });
        emitObject(xml, value.object, context);
        xml.endTag();
        return;
    }

    if (value.kind === 'menu') {
        // `<property><menu id="…">…</menu></property>` — a `<menu>`, NOT an
        // `<object class="GMenu">`, which is the difference that makes this a value kind of its
        // own rather than an object-valued property.
        xml.startTag('property', { name: property.name });
        emitMenu(xml, value.menu, context);
        xml.endTag();
        return;
    }

    if (value.kind === 'list') {
        emitListProperty(xml, property, value, context);
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

// ------------------------------------------------------------------ expressions

/**
 * Whether a `bind` collapses into `bind-source`/`bind-property` attributes, and on what.
 *
 * The rule is measured and is finer than it looks. The collapse happens for a lookup on a
 * BARE identifier, and for such a lookup under EXACTLY ONE cast — `bind l.name as <string>
 * bidirectional` is `<property … bind-source="l" …/>` and `bind l.name as <string> as
 * <string>` is a `<binding>` element, on 0.20.4. Anything else — a parenthesis anywhere, a
 * cast between the identifier and the dot, a second lookup, a closure — is the general
 * shape, and the oracle refuses flags on all of it ("Only bindings with a single lookup can
 * have flags"), which is how the two halves of this function are known to be one predicate.
 *
 * @param {Expression} expression
 * @returns {{ source: string, property: string } | null}
 */
function simpleLookup(expression) {
    const unwrapped = expression.kind === 'cast' ? expression.of : expression;
    if (unwrapped.kind !== 'lookup' || unwrapped.of.kind !== 'ident') return null;
    return { source: unwrapped.of.name, property: unwrapped.name };
}

/** An expression with its parentheses and casts peeled off — neither emits anything of its own. */
function coreOf(/** @type {Expression} */ expression) {
    let node = expression;
    while (node.kind === 'paren' || node.kind === 'cast') node = node.of;
    return node;
}

/**
 * Where the keyword `item` is allowed, checked BEFORE anything is emitted.
 *
 * This is the only constraint in the expression grammar whose absence produced OUTPUT rather
 * than a refusal, which is why it is a pass of its own rather than a line inside the emitter.
 * `item` contributes no element — it is the implicit subject a `<lookup>` is evaluated
 * against, so an emitter that just skipped it wrote a perfectly well-formed
 * `<binding><lookup name="name" type="GtkLabel"></lookup></binding>` for
 * `label: bind (item as <Label>).name`, a file 0.20.4 refuses outright (`"item" can only be
 * used in an expression literal`). Accepting what the language does not have is the bucket
 * the wild sweep calls `accepted-past-oracle`, and it had never been seen before this.
 *
 * Both constraints below are the oracle's own, and each is quoted in the message it raises:
 *   - `item` belongs to `expr` and not to `bind`;
 *   - `item` is only ever what a lookup reads FROM, never a value on its own.
 *
 * @param {Expression} node @param {'bind' | 'expr'} form
 * @param {boolean} asLookupBase  whether this position is the thing a `.property` reads from
 * @param {Pick<EmitContext, 'file'>} context
 */
function checkItemPlacement(node, form, asLookupBase, context) {
    if (node.kind === 'item') {
        if (!asLookupBase) {
            throw new BlueprintEmitError(
                `\`item\` is used as a value — the reference compiler ` +
                    `refuses the same file with '"item" can only be used for looking up properties'`,
                at(context, node.line),
            );
        }
        if (form !== 'expr') {
            throw new BlueprintEmitError(
                `\`item\` is used inside a \`bind\` — the reference compiler ` +
                    `refuses the same file with '"item" can only be used in an expression literal'`,
                at(context, node.line),
            );
        }
        return;
    }
    if (node.kind === 'paren' || node.kind === 'cast') {
        checkItemPlacement(node.of, form, asLookupBase, context);
        return;
    }
    if (node.kind === 'lookup') {
        checkItemPlacement(node.of, form, true, context);
        return;
    }
    if (node.kind === 'closure') {
        for (const argument of node.args) checkItemPlacement(argument, form, false, context);
        return;
    }
    if (node.kind === 'try') {
        for (const arm of node.arms) checkItemPlacement(arm, form, false, context);
    }
}

/**
 * The GType name a cast imposes, from Blueprint's own keyword table or from the resolver.
 *
 * @param {Extract<Expression, { kind: 'cast' }>} cast @param {EmitContext} context
 * @returns {{ gtype: string, builtin: string | undefined, line: number }}
 */
function castType(cast, context) {
    if (cast.builtin !== undefined) {
        return {
            gtype: /** @type {string} */ (BUILTIN_GTYPES.get(cast.builtin)),
            builtin: cast.builtin,
            line: cast.line,
        };
    }
    return {
        gtype: gtypeName(/** @type {TypeRef} */ (cast.type), context, 'reference'),
        builtin: undefined,
        line: cast.line,
    };
}

/**
 * What TYPE an expression has, which is what the `<lookup>` around it writes.
 *
 * `<lookup name="x" type="T">` names the type the property `x` is read ON, never the type
 * `x` has — `bind label.parent as <Overlay>.child` is `<lookup name="child"
 * type="GtkOverlay">` around `<lookup name="parent" type="GtkLabel">label</lookup>`. So
 * only four things answer: a declared id, the template, an explicit cast, and a
 * parenthesis around one of those.
 *
 * EVERYTHING ELSE IS REFUSED, AND THE REASON IS ONE MISSING TABLE. The oracle answers
 * `bind l.parent.name` with `<lookup name="name" type="GtkWidget">` — it read the TYPE of
 * `GtkLabel.parent` out of the typelib. `@girs`'s vocabulary carries no property-to-GType
 * table: `OWN_PROPS` is a list of property NAMES, and `PROP_ENUMS` joins a property to an
 * enum only where the property is one. So the answer cannot be derived, and ADR 0053
 * clause 6 forbids writing it out by hand — it is exactly the table that COULD come from
 * `@girs` if ts-for-gir emitted it, which is where it belongs. Until it does, the file is
 * refused by name and by line, per clause 3.
 *
 * @param {Expression} expression @param {EmitContext} context
 * @returns {string}
 */
function expressionType(expression, context) {
    if (expression.kind === 'paren') return expressionType(expression.of, context);
    if (expression.kind === 'cast') return castType(expression, context).gtype;
    if (expression.kind === 'ident') {
        if (expression.name === 'template' && context.templateClass !== undefined) return context.templateClass;
        objectRef(expression.name, expression.line, 'the object a lookup reads a property on', context);
        const declared = context.idClasses.get(expression.name);
        if (declared !== undefined) return declared;
    }
    throw new BlueprintEmitError(
        `${describeExpression(expression)} is read for a property and its ` +
            'own type is not written in this file — deriving it needs the GType of a property, a table ' +
            '`@girs` does not ship (`OWN_PROPS` holds property NAMES, `PROP_ENUMS` only the enum-typed ' +
            'ones), so the `type` of the lookup around it cannot be spelled. Write the cast out — ' +
            '`a.b as <Type>.c` rather than `a.b.c` — which names the same type `blueprint-compiler` ' +
            `would have inferred. ${SUBSET_NOTE}`,
        at(context, expression.line),
    );
}

/** What to call an expression in an error message. @param {Expression} expression */
function describeExpression(expression) {
    if (expression.kind === 'lookup') return `\`.${expression.name}\` is a multi-step lookup, which`;
    if (expression.kind === 'closure') return `the closure \`$${expression.name}(…)\``;
    if (expression.kind === 'item') return 'the keyword `item`';
    if (expression.kind === 'try') return 'a `try { … }`';
    if (expression.kind === 'type') return 'a `typeof<…>`';
    if (expression.kind === 'ident') return `\`${expression.name}\``;
    return 'a constant';
}

/**
 * One expression node as XML, given the type an enclosing cast imposes on it.
 *
 * `imposed` travels DOWN because a cast writes nothing of its own: it sets the `type` of the
 * closure inside it (`bind $f() as <string>` is `<closure function="f" type="gchararray">`)
 * or of the constant (`null as <string>`), and is otherwise read upwards by the lookup that
 * encloses it. A parenthesis passes it through — `bind ($f(x)) as <string>` types the
 * closure, measured.
 *
 * @param {XmlWriter} xml @param {Expression} node
 * @param {{ gtype: string, builtin: string | undefined, line: number } | undefined} imposed
 * @param {EmitContext} context
 */
/**
 * The type to impose on a bare `bind $closure(…)`, from the property it is assigned to.
 *
 * `null` for everything else, deliberately. A cast already carries its own type, a lookup gets
 * its type from its left-hand side, and a literal's type is its spelling — only the closure has
 * nowhere else to read one, which is why the oracle infers for it and refuses when it cannot.
 *
 * @param {Expression} node @param {string | null} ownerType @param {string} propertyName
 * @param {EmitContext} context
 * @returns {{ gtype: string, builtin: string | undefined, line: number } | undefined}
 */
function inferredClosureType(node, ownerType, propertyName, context) {
    // A `try` is transparent here: it carries the type to whichever of its arms is a bare
    // closure and to none of the others. Anything else that is not itself a closure keeps its
    // own type and must not be handed one.
    const reaches =
        node.kind === 'closure' ||
        (node.kind === 'try' && node.arms.some((a) => a.kind === 'closure' || isNullLiteral(a, context)));
    if (!reaches || ownerType === null) return undefined;
    const gtype = context.propertyGType?.(ownerType, propertyName) ?? null;
    if (gtype === null) return undefined;
    return { gtype, builtin: BUILTIN_LITERAL_CLASS.has(gtype) ? gtype : undefined, line: node.line };
}

function emitExpression(xml, node, imposed, context) {
    if (node.kind === 'paren') {
        emitExpression(xml, node.of, imposed, context);
        return;
    }
    if (node.kind === 'cast') {
        emitExpression(xml, node.of, castType(node, context), context);
        return;
    }
    if (node.kind === 'item') {
        // Unreachable: `checkItemPlacement` ran first and the lookup branch below consumes
        // the one position `item` is legal in. Stated rather than left to fall through into
        // `emitConstant`, where an unhandled kind would become a confusing message about a
        // constant it is not.
        throw new BlueprintEmitError('`item` reached the emitter outside a lookup base', at(context, node.line));
    }

    if (node.kind === 'lookup') {
        const type = expressionType(node.of, context);
        xml.startTag('lookup', { name: node.name, type });
        // Three shapes for the base, and the source decides which. A BARE identifier is the
        // lookup's TEXT; `item` is NOTHING, because it is the implicit subject and the cast
        // beside it already carried the type; anything else is a nested element — which
        // includes an identifier under a parenthesis or a cast. Measured: `bind (l.name)` is
        // `<lookup …>l</lookup>` and `bind ((l).name)` is
        // `<lookup …><constant>l</constant></lookup>`. Same id, same lookup, two shapes.
        if (node.of.kind === 'ident') xml.text(identConstantText(node.of, context));
        else if (coreOf(node.of).kind !== 'item') emitExpression(xml, node.of, undefined, context);
        xml.endTag();
        return;
    }

    if (node.kind === 'closure') {
        if (imposed === undefined) {
            throw new BlueprintEmitError(
                `the closure \`$${node.name}(…)\` has no \`as <Type>\` and its ` +
                    'return type would have to be inferred from the GType of the property it is assigned to — ' +
                    'a table `@girs` does not ship. Write the cast: `bind $' +
                    `${node.name}(…) as <Type>\`. \`blueprint-compiler\` asks for the same cast wherever ` +
                    'it cannot infer one ("Closure expression must be cast to the closure\'s return ' +
                    `type"). ${SUBSET_NOTE}`,
                at(context, node.line),
            );
        }
        xml.startTag('closure', { function: node.name, type: imposed.gtype });
        for (const argument of node.args) emitExpression(xml, argument, undefined, context);
        xml.endTag();
        return;
    }

    if (node.kind === 'try') {
        if (node.arms.length === 0) {
            throw new BlueprintEmitError(
                '`try { }` has no branches — the reference compiler ' +
                    'refuses the same file with "A try expression must have at least one branch"',
                at(context, node.line),
            );
        }
        xml.startTag('try', {});
        // An imposed type reaches an arm only where the arm has NO TYPE OF ITS OWN: a bare
        // closure, and `null`. A `try` is a fallback chain of independent expressions — a
        // lookup reads its type from its left-hand side and a literal from its spelling, so
        // handing either a type from outside would change what it emits. `expr_try.blp` shows
        // the limit, with `button.label` and `"Hello, world!"` in the same `try` and neither
        // taking it; `expr_null_infer_type.blp` shows why `null` is not like them — measured,
        // the oracle writes `<constant initial="True" type="gchararray"/>` there, and leaving
        // `null` out of this list produced the corpus's first silently-wrong file.
        for (const arm of node.arms) {
            const takesType = arm.kind === 'closure' || isNullLiteral(arm, context);
            emitExpression(xml, arm, takesType ? imposed : undefined, context);
        }
        xml.endTag();
        return;
    }

    if (node.kind === 'type') {
        // `typeof<Gtk.Label>` inside an expression is a GType-valued constant; as a plain
        // property value it is bare text. Two positions, two shapes, measured.
        xml.startTag('constant', { type: 'GType' });
        xml.text(gtypeName(node.type, context, 'reference'));
        xml.endTag();
        return;
    }

    if (node.kind === 'ident') {
        if (isNullLiteral({ kind: 'ident', name: node.name, line: node.line }, context)) {
            // `<constant initial="True" type="…"/>`, self-closing, `initial` first, and the
            // `type` present only where a cast supplied one: `$f(null)` is
            // `<constant initial="True"/>` and `$f(null as <string>)` adds `type="gchararray"`.
            xml.selfClosing('constant', { initial: 'True', type: imposed?.gtype });
            return;
        }
        xml.startTag('constant', {});
        xml.text(identConstantText(node, context));
        xml.endTag();
        return;
    }

    emitConstant(xml, node, imposed, context);
}

/**
 * The id an identifier expression writes, checked against the file the way every other
 * reference is. `template` becomes the template's class — measured in `bind-source`, and
 * the same rewrite reaches a `<lookup>`'s text and its `type`.
 *
 * @param {Extract<Expression, { kind: 'ident' }>} node @param {EmitContext} context
 */
function identConstantText(node, context) {
    return objectRef(node.name, node.line, 'an object referred to by an expression', context);
}

/**
 * A literal inside an expression: `<constant type="…">text</constant>`.
 *
 * The TYPE comes from the literal's own spelling and never from the cast — `bind 5 as
 * <uint>` is still `<constant type="gint">5</constant>` on 0.20.4, and `bind 1.0 as
 * <double>` is `<constant type="gfloat">1</constant>`. So a cast here is only ever a
 * validity question, and the oracle refuses the mismatches (`Cannot convert string to
 * number`, `Cannot convert number to bool`, `Cannot convert 1.0 to integer`); refusing them
 * here keeps this emitter from accepting a file the language does not have.
 *
 * @param {XmlWriter} xml @param {Extract<Expression, { kind: 'literal' }>} node
 * @param {{ gtype: string, builtin: string | undefined, line: number } | undefined} imposed
 * @param {EmitContext} context
 */
function emitConstant(xml, node, imposed, context) {
    const value = node.value;
    const fractional = value.kind === 'number' && numberLiteral(value.raw).digits.includes('.');
    const literalClass = value.kind === 'number' ? 'number' : value.kind === 'bool' ? 'bool' : 'string';

    if (imposed !== undefined) {
        if (imposed.builtin === undefined || BUILTIN_LITERAL_CLASS.get(imposed.builtin) !== literalClass) {
            throw new BlueprintEmitError(
                `a ${literalClass} constant is cast to \`${imposed.gtype}\`, ` +
                    'and the reference compiler refuses that conversion',
                at(context, node.line),
            );
        }
        if (fractional && BUILTIN_INTEGERS.has(imposed.builtin)) {
            throw new BlueprintEmitError(
                `\`${/** @type {{ raw: string }} */ (value).raw}\` is cast to ` +
                    `\`${imposed.builtin}\`, and the reference compiler refuses it — ` +
                    `"Cannot convert ${/** @type {{ raw: string }} */ (value).raw} to integer"`,
                at(context, node.line),
            );
        }
    }

    const type =
        value.kind === 'string' ? 'gchararray' : value.kind === 'bool' ? 'gboolean' : fractional ? 'gfloat' : 'gint';
    xml.startTag('constant', { type, ...translatedAttributes(value) });
    xml.text(scalarText(value, null, null, context));
    xml.endTag();
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
 * @param {Pick<EmitContext, 'file'>} context
 */
function emitListProperty(xml, property, value, context) {
    if (property.name === 'styles') {
        xml.startTag('style', {});
        for (const item of value.items) xml.selfClosing('class', { name: listItemText(item, context) });
        xml.endTag();
        return;
    }

    if (property.name === 'widgets') {
        xml.startTag('widgets', {});
        for (const item of value.items) xml.selfClosing('widget', { name: listItemText(item, context) });
        xml.endTag();
        return;
    }

    if (property.name === 'strings') {
        xml.startTag('items', {});
        for (const item of value.items) {
            xml.startTag('item', translatedAttributes(item));
            xml.text(listItemText(item, context));
            xml.endTag();
        }
        xml.endTag();
        return;
    }

    xml.startTag('property', { name: property.name });
    xml.text(value.items.map((item) => arrayItemText(item, context)).join('\n'));
    xml.endTag();
}

/**
 * An ArrayValue item is a plain string. The oracle's `_emit_value` has no arm for a translated
 * one and dies with a CompilerBugError, so `_()` inside `css-classes: [ … ]` is refused here by
 * name rather than emitted as something the reference never produces.
 *
 * @param {Value} item @param {Pick<EmitContext, 'file'>} context
 */
function arrayItemText(item, context) {
    if (item.kind === 'string' && item.translatable === undefined) return item.value;
    throw new BlueprintEmitError(
        'a property array holds plain strings only — ' +
            `${item.kind === 'string' ? 'a translated string' : `a ${item.kind}`} is not one the reference compiler emits`,
        at(context, item.line),
    );
}

/** @param {Value} item @param {Pick<EmitContext, 'file'>} context */
function listItemText(item, context) {
    if (item.kind === 'string') return item.value;
    if (item.kind === 'ident') return item.name;
    throw new BlueprintEmitError('a list item that is neither a string nor an identifier', at(context, item.line));
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
    // `item-type: typeof<Gtk.Label>;` is `<property name="item-type">GtkLabel</property>` —
    // the GType name as plain text, with none of the `<constant type="GType">` wrapper the
    // same syntax takes inside an expression.
    if (value.kind === 'type') return gtypeName(value.type, context, 'reference');
    throw new BlueprintEmitError(`a ${value.kind} value where a scalar was expected`, at(context, value.line));
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
        const resolved = context.resolveIdent(ownerType, propertyName, value.name, at(context, value.line));
        if (resolved !== null && resolved !== undefined) return resolved;
        // Not a member of an enum or flags type this resolver knows, so what is left is an
        // object reference — and a reference is checked. ONLY this branch checks, and the two
        // ways out of it above are the documented pass-throughs, not oversights: with no
        // resolver the spelling stands (see the note above), and with no owner and property to
        // ask about it stands too. That second one is what keeps `layout { }` working, where
        // the oracle passes the spelling through as well: `layout { column: null; }` emits
        // `<property name="column">null</property>` with no object named `null` anywhere.
        return objectRef(value.name, value.line, `the value of \`${propertyName}\``, context);
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
        // The fourth reference site. The `object` of `clicked => $onClicked(someId)` is an id
        // GtkBuilder resolves like any other, and the oracle answers an unknown one with
        // `Could not find object with ID 'doesNotExist'`. It shipped unchecked in the first cut
        // of this rule because that cut enumerated the sites it remembered; the enumeration
        // that found it is mechanical and is written down in this package's README — every
        // attribute or text node in this file built from a parsed identifier is a candidate.
        object:
            signal.object === undefined
                ? null
                : objectRef(signal.object, signal.line, 'the object of a signal handler', context),
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
        xml.text(conditionText(extension, context));
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
                xml.startTag(elementOf(entry.name, at(context, entry.line)), {
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
        // the id, then the FLAGS.
        //
        // The flag order here is FIXED and is not the source order: the oracle writes `enabled`
        // before `appearance` whatever the file says, so `suggested disabled` and
        // `disabled suggested` are one XML. An absent flag omits its attribute entirely rather
        // than writing a default — there is no `enabled="true"` and no empty `appearance`.
        xml.startTag('responses', {});
        for (const response of extension.entries) {
            const flags = response.flags ?? [];
            const appearance = flags.find((flag) => flag === 'destructive' || flag === 'suggested');
            xml.startTag('response', {
                id: response.name,
                ...translatedAttributes(response.value),
                ...(flags.includes('disabled') ? { enabled: 'false' } : {}),
                ...(appearance === undefined ? {} : { appearance }),
            });
            xml.text(scalarText(response.value, null, null, context));
            xml.endTag();
        }
        xml.endTag();
        return;
    }

    throw new BlueprintEmitError(`no emitter rule for the "${extension.name}" block`, at(context, extension.line));
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
        const resolved = ariaValue(name, member, at(context, value.line));
        if (resolved !== null && resolved !== undefined) return resolved;
    }
    return scalarText(value, null, null, context);
}

/** @param {XmlWriter} xml @param {ExtensionEntry} setter @param {EmitContext} context */
function emitSetter(xml, setter, context) {
    const dot = setter.name.indexOf('.');
    if (dot < 1) {
        throw new BlueprintEmitError('a setter needs an "<object>.<property>" target', at(context, setter.line));
    }
    const target = setter.name.slice(0, dot);
    const property = setter.name.slice(dot + 1);

    // The owner type here is the type of the object the setter POINTS AT, not the
    // breakpoint it sits in, so an enum-valued setter resolves against the right widget.
    // Measured: `boxOne.halign: baseline_fill` inside an `Adw.Breakpoint` is `4`.
    const ownerType = context.idTypes.get(target) ?? null;

    xml.startTag('setter', {
        object: objectRef(target, setter.line, 'the target of a setter', context),
        property,
        ...translatedAttributes(setter.value),
    });
    if (isNullLiteral(setter.value, context)) {
        // The null literal, and the ONE position the oracle admits it: `<setter …></setter>`
        // with an empty body, which GtkBuilder reads as "unset". It is the literal only
        // because no object claims the name — with a `Gtk.Label null` in the file the
        // identifier wins even here, and the oracle answers `Cannot assign Gtk.Label to
        // string`, which `objectRef` above has already let through as the reference it is.
        //
        // Not for every property type, though. Measured on 0.20.4: string, int, double and
        // object-typed properties come out empty, an enum one is `null is not a member of
        // Gtk.Align` and a flags one the same. That half is detectable here because the
        // resolver knows which properties carry those types — see the header of
        // `36-setter-null.blp` in the manifest for the half that is NOT (a boolean property,
        // `Expected 'true' or 'false' for boolean value`, which needs ParamSpec types this
        // vocabulary does not have).
        const enumType = context.enumOrFlagsTypeOf?.(ownerType, property) ?? null;
        if (enumType !== null) {
            throw new BlueprintEmitError(
                `\`null\` is not a member of ${enumType}, and ` +
                    `\`${target}.${property}\` carries that type — the null literal is a value ` +
                    'for a string, numeric or object-typed property only',
                at(context, setter.line),
            );
        }
    } else {
        xml.text(scalarText(setter.value, ownerType, property, context));
    }
    xml.endTag();
}

/**
 * `Extension.argument` is documented as the parenthesised text UNDECODED, so unlike every
 * `StringValue` in the AST it still carries its quotes and its escapes. Decoded here and
 * nowhere else. A value that arrives without quotes is passed through, so a parser that
 * decodes it after all produces the same bytes.
 *
 * @param {Extension} extension @param {Pick<EmitContext, 'file'>} context
 */
function conditionText(extension, context) {
    const argument = extension.argument ?? '';
    const quote = argument.charAt(0);
    if (argument.length < 2 || (quote !== '"' && quote !== "'") || !argument.endsWith(quote)) return argument;
    return unescapeQuoted(argument.slice(1, -1), at(context, extension.line));
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

/** @param {string} body @param {import('./ast.d.mts').SourceLocation} where */
function unescapeQuoted(body, where) {
    let out = '';
    for (let i = 0; i < body.length; i += 1) {
        if (body[i] !== '\\') {
            out += body[i];
            continue;
        }
        i += 1;
        const replacement = STRING_ESCAPES.get(body[i]);
        if (replacement === undefined) {
            throw new BlueprintEmitError(`invalid escape sequence "\\${body[i]}" in a condition`, where);
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
 * `position` says whether the type is being INSTANTIATED or merely NAMED, because the resolver
 * answers the two differently: `Gtk.Widget { }` is an error in both compilers and
 * `template $Foo: Gtk.Widget { }` is a file the oracle compiles. See `src/resolve-ident.mjs`.
 *
 * @param {TypeRef} type @param {Pick<EmitContext, 'gtypeName' | 'file'>} context
 * @param {'object' | 'reference'} position
 */
function gtypeName(type, context, position) {
    if (context.gtypeName !== undefined) return context.gtypeName(type, at(context, type.line), position);
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

/**
 * An object REFERENCE: the same spelling, but only once the file is known to declare it.
 *
 * `objectId` answers what to WRITE. This answers whether there is anything to write at all,
 * and it is the rule the emitter did not have: the oracle resolves every reference and
 * refuses an unresolved one — `extra-menu: doesNotExist;` is `error: Could not find object
 * with ID doesNotExist` — while this emitter copied the spelling into the XML and said
 * nothing. GtkBuilder then meets an id nothing declares, at runtime, in a file that compiled.
 *
 * `null` was the instance of that a wild file hit, and it is not a keyword: blueprint reads
 * it as an identifier like any other, so `label: null` with a `Gtk.Label null` in the file is
 * `error: Cannot assign Gtk.Label to string` — a TYPE error, which means the id resolved. The
 * null LITERAL is only what is left when no object claims the name, and `emitSetter` is the
 * one place that reading reaches the XML.
 *
 * @param {string} id @param {number} line @param {string} where  what the id is, for the message
 * @param {EmitContext} context
 */
function objectRef(id, line, where, context) {
    if (id === 'template' && context.templateClass !== undefined) return context.templateClass;
    if (!context.idTypes.has(id)) {
        throw new BlueprintEmitError(
            `\`${id}\` is ${where}, and no object in this file is ` +
                `declared with that id — the reference compiler refuses the same file with ` +
                `"Could not find object with ID ${id}"`,
            at(context, line),
        );
    }
    return id;
}

/**
 * Whether this value is the null LITERAL rather than a reference to an object called `null`.
 *
 * The distinction is the whole rule, and it is decided by the file and not by the spelling:
 * blueprint has no `null` keyword, so an identifier spelled `null` is a reference wherever
 * something answers to the name, and the literal only where nothing does. Both halves are
 * measured — `Gtk.Label null { }` compiles (with `warning: null may be a confusing object
 * ID`) and `bind null.label` then binds to it.
 *
 * @param {Value} value @param {EmitContext} context
 */
function isNullLiteral(value, context) {
    return value.kind === 'ident' && value.name === 'null' && !context.idTypes.has('null');
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
function findTemplateClass(file, seams) {
    for (const root of file.roots) {
        if (root.kind !== 'template') continue;
        // The same two sources `emitTemplate` reads, and they must agree: a `$Name` is the class
        // being defined and reaches the XML verbatim, a TYPE reaches it as its GType. Reading
        // the spelling here while the `<template>` tag reads the GType is how one file came out
        // with `<template class="GtkListItem">` and `<lookup … type="ListItem">` in it —
        // `issue_187_dec.blp`, silently different and compiling to a class GtkBuilder cannot
        // find.
        return root.classType === undefined
            ? root.className
            : gtypeName(root.classType, /** @type {EmitContext} */ (seams), 'reference');
    }
    return undefined;
}

/**
 * Every object id in the file with the GType it was declared as, so a `<setter>` can resolve
 * an enum against the object it targets rather than against the breakpoint it is written in.
 *
 * TWO maps, because two callers want two different answers about the same id. `byId` is the
 * OWNER — `null` for an extern object, so no identifier inside it is resolved against a GIR
 * that does not describe it (`ownerOf`). `classes` is the GType NAME, extern included,
 * because that is what `<lookup type=…>` writes: measured on 0.20.4, `$MyThing t { }` and
 * `bind (t.prop)` is `<lookup name="prop" type="MyThing">t</lookup>`. One map cannot be both
 * without losing the case that needed the distinction.
 *
 * @param {BlueprintFile} file @param {Pick<EmitContext, 'gtypeName' | 'file'>} seams
 * @returns {{ byId: Map<string, string | null>, classes: Map<string, string> }}
 */
function indexObjectIds(file, seams) {
    /** @type {Map<string, string | null>} */
    const byId = new Map();
    /** @type {Map<string, string>} */
    const classes = new Map();
    const index = { byId, classes };
    for (const root of file.roots) {
        if (root.kind === 'object') indexObject(root, index, seams);
        else if (root.kind === 'template') indexBody(root.body, index, seams);
        // A top-level `menu` is a reference target like any object — 12-menu.blp points at one
        // with `menu-model: mainMenu` — and it is indexed as `null` for the reason an extern
        // target is: there is no GType whose ParamSpecs an enum could resolve against.
        //
        // Only the ROOT is indexed, and that is a bet on a parser limit rather than a fact
        // about the language: the oracle accepts `menu top { section sec { … } }` and resolves
        // `menu-model: sec` against it. Nothing diverges today because `MenuItem` has no `id`
        // field and the parser refuses a named section by name and line, so such a file never
        // reaches this index. WHOEVER LIFTS THAT LIMIT must index sections and submenus here
        // in the same commit, or the reference check below turns into a false refusal on a
        // file the oracle compiles.
        else if (root.id !== undefined) byId.set(root.id, null);
    }
    return index;
}

/**
 * @typedef {{ byId: Map<string, string | null>, classes: Map<string, string> }} IdIndex
 */

/**
 * The id index of ONE body, for a sub-document that must not see the outer file's ids.
 *
 * `indexObjectIds` walks a whole `BlueprintFile`; an inline `template` has no file of its own,
 * and giving it the outer index would let a lookup inside it resolve against an object the
 * oracle says it cannot even name.
 *
 * @param {ObjectBody} body @param {Pick<EmitContext, 'gtypeName' | 'file'>} seams
 * @returns {IdIndex}
 */
function indexBodyIds(body, seams) {
    /** @type {IdIndex} */
    const index = { byId: new Map(), classes: new Map() };
    indexBody(body, index, seams);
    return index;
}

/** @param {ObjectNode} object @param {IdIndex} index @param {Pick<EmitContext, 'gtypeName' | 'file'>} seams */
function indexObject(object, index, seams) {
    // An extern target is indexed as `null` and not left out: absent and extern are the same
    // to `Map.get`, and they must be, because `lookalike.orientation: vertical` on an extern
    // target keeps its spelling while the same setter on a `Gtk.Box` is `1`. The setter path
    // is a SECOND call site of the resolver, so an implementation that fixes only the object
    // body above is byte-equal on every golden that has no `setters { }` in it.
    if (object.id !== undefined) {
        const gtype = gtypeName(object.type, seams, 'object');
        index.byId.set(object.id, ownerOf(object.type, gtype));
        index.classes.set(object.id, gtype);
    }
    indexBody(object.body, index, seams);
}

/** @param {ObjectBody} body @param {IdIndex} index @param {Pick<EmitContext, 'gtypeName' | 'file'>} seams */
function indexBody(body, index, seams) {
    for (const property of body.properties) indexValue(property.value, index, seams);
    for (const child of body.children) {
        if (child.object.kind === 'object') indexObject(child.object, index, seams);
    }
}

/** @param {Value} value @param {IdIndex} index @param {Pick<EmitContext, 'gtypeName' | 'file'>} seams */
function indexValue(value, index, seams) {
    if (value.kind === 'object') indexObject(value.object, index, seams);
    else if (value.kind === 'list') {
        for (const item of value.items) indexValue(item, index, seams);
    }
}
