// The second, LOSSY exit of ADR 0053 clause 1: one AST, and `SharedNode` beside the XML.
//
// The ADR calls the projection "a second, LOSSY exit whose losses are exactly those six —
// named at the seam rather than discovered downstream". This is that seam. Every loss it
// takes is returned beside the tree, so nothing downstream has to discover one.
//
// FOUR OF THEM STOPPED BEING LOSSES, AND THAT IS WHAT MADE THE EXIT USABLE. ADR 0066 gave
// `template` and `object-id` a field each on the node. They are GtkBuilder's two ADDRESSING
// constructs — the class a tree DEFINES and the name a node is addressed BY — and dropping
// them is why no shipped `.blp` in this repository projected without loss: a file could
// declare a widget and not place one. ADR 0067 then gave the `_()` marking one, for the
// opposite reason: dropping it leaves a tree that looks FINISHED and whose captions
// `xgettext` can no longer see. ADR 0068 gave the STYLE CLASSES one, and closed the last
// loss any shipped `.blp` here reaches that is not a grammar: `styles [ ]` and
// `css-classes: [ ]` are two spellings of `GtkWidget:css-classes`, and both fill
// `styleClasses`. `bind` and `breakpoint` stay losses and stay declared; ADR 0067 § 3 says
// why each, and why the file-level `translation-domain` is not a node fact.
//
// WHAT THIS MAKES CHECKABLE, WHICH NOTHING WAS BEFORE
//
// `corpus/expectations.mjs` and `corpus/real-expectations.mjs` hold the hand-written
// `SharedNode` trees and their declared losses, written by reading the `.blp` before any
// parser existed. Until this file they were prose: the harness checked that they were
// STRUCTURALLY a `SharedNode` and that their line numbers were inside the file, and nothing
// checked that they were RIGHT. Stage D of `scripts/check-blueprint-corpus.mjs` runs this
// over the same files and compares, which turns the corpus's most expensive artefact
// into an oracle instead of a claim.
//
// TWO THINGS IT DELIBERATELY DOES NOT PRODUCE
//
// A loss's `detail` is prose for a human — "the id `labelOne`, which the setter on line 16
// needs" — and deriving it would either be a worse sentence or a template. Stage D compares
// kind and line, which is what a machine can be right about.
//
// The `comment` kind is not produced at all. Comments never reach the AST: the lexer skips
// them where they are legal, so there is nothing here to lose. `15-comments.blp` declares
// one anyway, because from the READER's side the loss is real, and stage D drops that kind
// before comparing rather than teaching this file to invent it.

/** @import { BlueprintFile, ObjectBody, ObjectNode, SourceLocation, TemplateNode, TypeRef, Value } from './ast.d.mts' */
/** @import { ProjectedLoss, SharedNode, SharedNodeProjection } from './shared-node.d.mts' */
import { numberLiteral } from './number-literal.mjs';

/**
 * The one seam through which introspection reaches this exit — the same `gtypeName` that
 * `emit-xml.mjs` declares, because a tag is the one thing the projection must spell right and
 * nothing in the syntax says how: `Gio.ListStore` is `GListStore`. Without it a tag is
 * namespace plus name, which is the C prefix of Gtk and Adw and of nothing else — so the
 * fallback is right for every corpus file and wrong for any third `using`, and stages D and E
 * hand in the resolver's seam rather than rely on that.
 *
 * @typedef {Object} ProjectOptions
 * @property {(type: TypeRef, where: SourceLocation, position?: 'object' | 'reference') => string} [gtypeName]
 */

/**
 * The GIR class name a tag is spelled with, through the seam where one is given.
 *
 * An unqualified type resolves against **Gtk alone** — measured on `blueprint-compiler`
 * 0.20.4, `Bin { }` under `using Adw 1;` is refused with "Namespace Gtk does not contain a
 * type called Bin". So the default is not "the first import", it is Gtk.
 *
 * `position` is what `src/resolve-ident.mjs` documents, and this exit defaults it the OTHER way
 * from that seam — to `'object'`, the stronger answer — because the seam is a public contract
 * handed in from outside and this is a private reader with two call sites, of which the object
 * one is the common one. The consequence is deliberate: the template parent here is the position
 * that has to say `'reference'` out loud, so dropping it fails stage D, while over in
 * `emit-xml.mjs` the object position is the one that has to say `'object'`, so dropping THAT
 * fails stage E. Between the two exits, each position is guarded at one of them.
 *
 * @param {ProjectOptions | undefined} options @param {string} file  the path a refusal names
 * @returns {(type: TypeRef, position?: 'object' | 'reference') => string}
 */
const tagReader =
    (options, file) =>
    /** @param {TypeRef} type @param {'object' | 'reference'} [position] */
    (type, position = 'object') => {
        if (options?.gtypeName !== undefined) return options.gtypeName(type, { file, line: type.line }, position);
        // An extern type has no namespace to default: `$MyWidget` is `MyWidget`, never
        // `GtkMyWidget`. The same correction the emitter's fallback takes, for the same reason.
        if (type.extern === true) return `${type.namespace ?? ''}${type.name}`;
        return `${type.namespace ?? 'Gtk'}${type.name}`;
    };

/** `Adw.Breakpoint` is dropped whole rather than projected — it is not a widget. */
const isBreakpoint = (node) =>
    node.kind === 'object' && node.type.namespace === 'Adw' && node.type.name === 'Breakpoint';

/**
 * A value `SharedNode['props']` can hold, or undefined where it cannot.
 *
 * A number arrives as its SOURCE SPELLING and leaves as a JavaScript number, so `1.0` and
 * `1` become one value here. That is not a projection loss but a limit of the language the
 * trees are written in, and it is why the `.ui` golden and not the projection is the oracle
 * for number formatting.
 *
 * @param {Value} value @param {(type: TypeRef, position?: 'object' | 'reference') => string} tag
 */
const scalarOf = (value, tag) => {
    if (value.kind === 'string') return value.value;
    // `typeof<Gtk.Label>` is a class NAME, which is the one thing this exit already spells
    // right — `tag` is the same seam `SharedNode.tag` takes, asked about a value rather than
    // about an object. So it is projected rather than declared lost. The REFERENCE position,
    // for the reason `41-template-parent-abstract.blp` records one screen up: `typeof` names
    // a type without instantiating it, and `typeof<Gtk.Orientation>` is an enum, which the
    // object position refuses by construction.
    if (value.kind === 'type') return tag(value.type, 'reference');
    if (value.kind === 'number') {
        // `Number()` alone read `1_000` as `NaN`, and after that was patched here, `-0x10` too:
        // `17-numeric-forms.blp` projected a `null` prop both times. One reader for both exits.
        const { negative, digits } = numberLiteral(value.raw);
        const magnitude = Number(digits);
        return negative ? -magnitude : magnitude;
    }
    if (value.kind === 'bool') return value.value;
    // An enum member keeps its SOURCE spelling. The XML carries the resolved number; these
    // are two exits from one AST and not two views of one set of values.
    if (value.kind === 'ident') return value.name;
    return undefined;
};

/**
 * The style classes a property carries, or `undefined` where the property is not a list of them.
 *
 * ONE FIELD FOR TWO SPELLINGS, because they are one GTK property. `styles ["flat"]` is a block
 * and `css-classes: ["flat"]` is a property value, and both set `GtkWidget:css-classes` — so
 * both fill `styleClasses` and neither is a loss any more.
 *
 * A non-string item is NOT a style class here. `styles [ flat ]` parses in this package and the
 * reference compiler refuses it outright ("Unexpected tokens"), and `css-classes: [flat]` is
 * refused by this package's own emitter — so an ident in either position is a construct with no
 * oracle behind it, and it leaves as `value-list` rather than under a `styles` kind that nothing
 * else would ever produce.
 *
 * ONE READER FOR BOTH SEAMS. `projectBody` fills the field from this and `lossesOf` asks it the
 * same question to decide whether the line is still a loss. A second copy of the condition would
 * let a class the tree KEEPS be declared lost on the same line, which is stage D's two arms
 * contradicting each other about one file.
 *
 * @param {ObjectBody['properties'][number]} property
 * @returns {string[] | undefined}
 */
const styleClassesOf = (property) => {
    if (property.value.kind !== 'list') return undefined;
    if (property.name !== 'styles' && property.name !== 'css-classes') return undefined;
    const items = property.value.items;
    if (!items.every((item) => item.kind === 'string')) return undefined;
    return items.map((item) => /** @type {{ value: string }} */ (item).value);
};

/**
 * @param {ObjectBody} body @param {(type: TypeRef) => string} tag
 * @returns {Pick<SharedNode, 'props' | 'children'>}
 */
const projectBody = (body, tag) => {
    /** @type {Record<string, string | number | boolean>} */
    const props = {};
    /** @type {Record<string, { context?: string }>} */
    const translatable = {};
    /** @type {string[]} */
    const styleClasses = [];
    /** @type {{ line: number, order: number, slot?: string, object: ObjectNode }[]} */
    const placed = [];

    for (const property of body.properties) {
        // An object-valued property becomes a slotted child. `[start]` becomes one too, and
        // `SharedNode` has one field for both — the conflation is declared in the header of
        // `corpus/expectations.mjs`, and this is the single line that performs it.
        if (property.value.kind === 'object') {
            placed.push({
                line: property.line,
                order: property.order,
                slot: property.name,
                object: property.value.object,
            });
            continue;
        }
        // Appended in BODY ORDER, which is the order the golden writes them in, and concatenated
        // where one node writes both spellings: they are one property, so the node carries the
        // union the file wrote. No corpus file writes both, and picking a winner would be a rule
        // nothing holds.
        if (property.value.kind === 'list') {
            styleClasses.push(...(styleClassesOf(property) ?? []));
            continue;
        }
        const scalar = scalarOf(property.value, tag);
        if (scalar === undefined) continue;
        props[property.name] = scalar;
        // The marking travels with the prop and is keyed by the same name, so the two cannot
        // come apart. A fresh object rather than the AST's own: the tree is handed to
        // consumers that may keep it, and sharing the parser's node would let one of them
        // reach back into the parse. Absent `context` stays absent — `{}` is "marked, no
        // context", which is what `_()` means beside `C_()`.
        if (property.value.kind === 'string' && property.value.translatable !== undefined) {
            const { context } = property.value.translatable;
            translatable[property.name] = context === undefined ? {} : { context };
        }
    }
    for (const child of body.children) {
        placed.push({
            line: child.line,
            order: child.order,
            slot: child.slot,
            object: /** @type {ObjectNode} */ (child.object),
        });
    }

    // Source order, across both arrays. `toolbar-view.blp` interleaves a `[top]` bracket, a
    // `content:` property and a `[bottom]` bracket, so concatenating the two arrays gets the
    // order wrong. `line` recovers it until two members share one — legal, and pinned by
    // `26-one-line-members.blp` — which is what `order` is for.
    placed.sort((a, b) => a.line - b.line || a.order - b.order);

    const children = placed
        .filter((entry) => !isBreakpoint(entry.object))
        .map((entry) => projectObject(entry.object, entry.slot, tag));

    return {
        ...(Object.keys(props).length > 0 ? { props } : {}),
        ...(Object.keys(translatable).length > 0 ? { translatable } : {}),
        ...(styleClasses.length > 0 ? { styleClasses } : {}),
        ...(children.length > 0 ? { children } : {}),
    };
};

/**
 * @param {ObjectNode} object @param {string | undefined} slot @param {(type: TypeRef) => string} tag
 * @returns {SharedNode}
 */
const projectObject = (object, slot, tag) => {
    const body = projectBody(object.body, tag);
    return {
        tag: tag(object.type),
        // The id is the node's NAME and not a property of it, which is why it is a field and
        // not a prop: `Gtk.Box canvasContainer { }` emits `<object class="GtkBox"
        // id="canvasContainer">`, an attribute beside the class rather than a value inside it.
        // And it is worth carrying although `bind` stays a loss: measured in ADR 0066, EVERY id
        // in this repository's shipped `.blp` is read from the sibling TypeScript through
        // `InternalChildren` and NONE by a `bind` inside the file, so the name is the
        // component's public addressing surface rather than an input to the binding language.
        ...(object.id === undefined ? {} : { id: object.id }),
        ...(slot === undefined ? {} : { slot }),
        ...body,
    };
};

/**
 * What the projection drops, by kind and line.
 *
 * @param {BlueprintFile} file
 * @returns {ProjectedLoss[]}
 */
const lossesOf = (file) => {
    /** @type {ProjectedLoss[]} */
    const lost = [];

    /** @param {ObjectBody} body */
    const walkBody = (body) => {
        for (const property of body.properties) {
            const value = property.value;
            if (value.kind === 'binding') lost.push({ kind: 'binding', line: property.line });
            else if (value.kind === 'list') {
                // Style classes are carried now — ADR 0068 gave them `styleClasses`, through the
                // one reader above. Everything else bracketed is still a loss: `widgets [ ]` is a
                // list of object REFERENCES and `strings [ ]` emits as `<items>` rather than as a
                // property at all, so neither is a value `props` could hold.
                if (styleClassesOf(property) === undefined) {
                    lost.push({ kind: 'value-list', line: property.line });
                }
            } else if (value.kind === 'menu') {
                // A menu written AT the property. `SharedNode` has no menu form — a top-level
                // one is already a `menu` loss, and this is the same loss in a second position.
                // Without this arm it left through no arm at all: measured, `inline_menu.blp`
                // projected a bare `GtkMenuButton` with an EMPTY loss list.
                lost.push({ kind: 'menu', line: property.line });
            } else if (value.kind === 'object') walkObject(value.object);
        }
        for (const signal of body.signals) lost.push({ kind: 'signal', line: signal.line });
        for (const extension of body.extensions) lost.push({ kind: extension.name, line: extension.line });
        // Each list by its own NAME, the way a block extension is, because that is the name a
        // reader of the loss goes looking for. Six kinds for one mechanism is the honest count:
        // a consumer told `marks` was dropped learns something a consumer told `extension-list`
        // was dropped does not.
        for (const list of body.extensionLists) lost.push({ kind: list.name, line: list.line });
        // A whole SECOND document, and `SharedNode` is one tree: there is no nesting form for
        // a sub-document with its own id scope, so the block is declared lost rather than
        // flattened into the parent. Flattening would be worse than dropping it — the ids
        // inside are allowed to collide with the outer file's, so a merged tree could carry
        // two different objects under one name and no consumer could tell.
        if (body.inlineTemplate !== undefined) {
            lost.push({ kind: 'inline-template', line: body.inlineTemplate.line });
        }
        for (const child of body.children) {
            // `<child internal-child="…">` is a DIFFERENT element from `<child type="…">`, and
            // `SharedNode.slot` carries the second. A renderer handed the first as a slot would
            // put the object in the wrong place, so the annotation is dropped and declared.
            if (child.internalChild !== undefined) lost.push({ kind: 'internal-child', line: child.line });
            // The widget survives and its ROLE does not: `SharedNode` has no dialog-response
            // form, and a renderer handed the button without it would show a dialog whose
            // buttons answer nothing.
            if (child.response !== undefined) lost.push({ kind: 'action-widget', line: child.line });
            if (isBreakpoint(child.object)) {
                // Named on the OBJECT line, never on the bracket above it — the convention
                // stated once in the header of `corpus/expectations.mjs`.
                lost.push({ kind: 'breakpoint', line: child.object.line });
                continue;
            }
            walkObject(child.object);
        }
    };

    /** @param {ObjectNode} object */
    const walkObject = (object) => {
        // An extern type is the one loss where the text SURVIVES and the meaning does not.
        // `SharedNode.tag` is a GIR class name — that is what a renderer looks up — and
        // `MyWidget` is a class the application registers at runtime, in no GIR at all. So
        // the tag is spelled right and is not resolvable, and a consumer told nothing would
        // discover that as a missing widget rather than as a declared limit.
        if (object.type.extern === true) lost.push({ kind: 'extern', line: object.line });
        walkBody(object.body);
    };

    // The gettext domain is a fact about the FILE and `SharedNode` is a tree: there is nowhere
    // for it to go, and a renderer that translated against the wrong domain would be wrong
    // silently.
    if (file.translationDomain !== undefined) lost.push({ kind: 'translation-domain', line: 1 });

    // `SharedNode` is ONE tree and a file may hold several roots, so the projection keeps
    // the first widget one and every other root is a loss: a `menu` by its own kind, because
    // ADR 0042 already made menus a portable value and gives that loss a different future,
    // and anything else as a plain sibling.
    let keptWidget = false;
    for (const root of file.roots) {
        if (root.kind === 'menu') {
            lost.push({ kind: 'menu', line: root.line });
            continue;
        }
        if (keptWidget) {
            lost.push({ kind: 'sibling-object', line: root.line });
            continue;
        }
        keptWidget = true;
        if (root.kind === 'template') {
            // The class the template DEFINES is `SharedNode.template` since ADR 0066 and is no
            // longer a loss. An extern PARENT still is — the parent is what becomes the root tag,
            // and a tag no GIR describes is the one loss where the text survives and the meaning
            // does not.
            //
            // With no parent and a `$Name`, the template type is itself extern — the oracle's
            // `ExternType`, `incomplete`, validating nothing — and it is that name which becomes
            // the root tag. So the `extern` loss is recorded at the template's own line.
            //
            // With no parent and a TYPE (`template ListItem`), it is not extern at all: the
            // type is a real one and the tag is its GType. Declaring a loss there would name a
            // limit the file does not have.
            if (root.parent === undefined && (root.classType === undefined || root.classType.extern === true)) {
                lost.push({ kind: 'extern', line: root.line });
            } else if (root.parent?.extern === true) lost.push({ kind: 'extern', line: root.parent.line });
            walkBody(root.body);
        } else walkObject(root);
    }
    return lost;
};

/**
 * Project a parsed `.blp` into the node shape ADR 0051's renderers consume.
 *
 * @param {BlueprintFile} file @param {ProjectOptions} [options]
 * @returns {SharedNodeProjection}
 */
export function projectToSharedNode(file, options) {
    const tag = tagReader(options, file.file);
    const root = file.roots.find((candidate) => candidate.kind !== 'menu');
    if (root === undefined) {
        // Every corpus file has one. A file of nothing but menus would need a projection
        // with no tree, and `SharedNode` has no empty form — refusing beats inventing a root.
        throw new Error('this file declares no widget root, so it has no SharedNode projection');
    }
    if (root.kind === 'template') {
        // The PARENT type becomes the root tag and the class being defined goes beside it in
        // `template`. `header-bar.blp` is why both are needed: the file is about an
        // `AdwHeaderBar` and its root tag is `AdwBin`, because `AdwHeaderBar` is final and
        // cannot be a template parent — so the tag alone never named the subject.
        const template = /** @type {TemplateNode} */ (root);
        // Parentless: there is no parent to become the tag, and the class being DEFINED is
        // the only name the file states. It is extern by construction, which is exactly the
        // shape `tag` already spells without a namespace default — `$MyWidget` is
        // `MyWidget`, never `GtkMyWidget`.
        // Three sources, in the order the file decides: a parent type, the TYPE the template
        // names, or the `$Name` it defines. The third is extern by construction; the second is
        // not, and projecting its spelling where the XML writes its GType would make the two
        // exits disagree about one file — `template ListItem` is `<template class="GtkListItem">`
        // and must not be a `ListItem` tag here.
        const rootType = template.parent ??
            template.classType ?? /** @type {TypeRef} */ ({
                extern: true,
                name: template.className,
                line: template.line,
            });
        // The class being defined, spelled exactly as `<template class="…">` writes it —
        // `findTemplateClass` in `emit-xml.mjs` is the same two lines, and they must stay the
        // same two: `template ListItem` is `<template class="GtkListItem">`, so reading the
        // SPELLING here while the XML reads the GType is how one file came out saying two
        // different things about one class. Stage D's addressing arm holds the two exits
        // together on this value rather than trusting the comment.
        const templateClass =
            template.classType === undefined ? template.className : tag(template.classType, 'reference');
        return {
            node: {
                tag: tag(rootType, 'reference'),
                template: templateClass,
                ...projectBody(template.body, tag),
            },
            lost: lossesOf(file),
        };
    }
    return { node: projectObject(/** @type {ObjectNode} */ (root), undefined, tag), lost: lossesOf(file) };
}
