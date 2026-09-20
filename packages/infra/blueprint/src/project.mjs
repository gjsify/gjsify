// The second, LOSSY exit of ADR 0053 clause 1: one AST, and `SharedNode` beside the XML.
//
// The ADR calls the projection "a second, LOSSY exit whose losses are exactly those six —
// named at the seam rather than discovered downstream". This is that seam. Every loss it
// takes is returned beside the tree, so nothing downstream has to discover one.
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
 * @param {ObjectBody} body @param {(type: TypeRef) => string} tag
 * @returns {{ props?: Record<string, string | number | boolean>, children?: object[] }}
 */
const projectBody = (body, tag) => {
    /** @type {Record<string, string | number | boolean>} */
    const props = {};
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
        const scalar = scalarOf(property.value, tag);
        if (scalar !== undefined) props[property.name] = scalar;
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
        ...(children.length > 0 ? { children } : {}),
    };
};

/**
 * @param {ObjectNode} object @param {string | undefined} slot @param {(type: TypeRef) => string} tag
 */
const projectObject = (object, slot, tag) => {
    const body = projectBody(object.body, tag);
    return {
        tag: tag(object.type),
        ...(slot === undefined ? {} : { slot }),
        ...body,
    };
};

/**
 * What the projection drops, by kind and line.
 *
 * @param {BlueprintFile} file
 * @returns {{ kind: string, line: number }[]}
 */
const lossesOf = (file) => {
    /** @type {{ kind: string, line: number }[]} */
    const lost = [];

    /** @param {ObjectBody} body */
    const walkBody = (body) => {
        for (const property of body.properties) {
            const value = property.value;
            if (value.kind === 'binding') lost.push({ kind: 'binding', line: property.line });
            else if (value.kind === 'list') {
                // `styles` has its own fate — ADR 0049 makes style classes a list, and
                // `props` holds none — while `strings`/`widgets` are ordinary value lists.
                lost.push({ kind: property.name === 'styles' ? 'styles' : 'value-list', line: property.line });
            } else if (value.kind === 'string' && value.translatable) {
                lost.push({ kind: 'translatable', line: property.line });
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
        if (object.id !== undefined) lost.push({ kind: 'object-id', line: object.line });
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
            lost.push({ kind: 'template', line: root.line });
            // The template's own class is the `template` loss above; an extern PARENT is a
            // second one, because the parent is what becomes the root tag.
            //
            // With no parent and a `$Name`, the template type is itself extern — the oracle's
            // `ExternType`, `incomplete`, validating nothing — and it is that name which becomes
            // the root tag. So the second loss is recorded at the template's own line.
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
 * @returns {{ node: object, lost: { kind: string, line: number }[] }}
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
        // The template's own class name is the loss; its PARENT type survives as the root
        // tag. `header-bar.blp` shows what that costs: the file is about an `AdwHeaderBar`
        // and projects to an `AdwBin`, because `AdwHeaderBar` is final and cannot be a
        // template parent.
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
        return {
            node: { tag: tag(rootType, 'reference'), ...projectBody(template.body, tag) },
            lost: lossesOf(file),
        };
    }
    return { node: projectObject(/** @type {ObjectNode} */ (root), undefined, tag), lost: lossesOf(file) };
}
