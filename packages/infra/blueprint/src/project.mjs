// The second, LOSSY exit of ADR 0053 clause 1: one AST, and `SharedNode` beside the XML.
//
// The ADR calls the projection "a second, LOSSY exit whose losses are exactly those six —
// named at the seam rather than discovered downstream". This is that seam. Every loss it
// takes is returned beside the tree, so nothing downstream has to discover one.
//
// WHAT THIS MAKES CHECKABLE, WHICH NOTHING WAS BEFORE
//
// `corpus/expectations.mjs` and `corpus/real-expectations.mjs` hold 36 hand-written
// `SharedNode` trees and 119 declared losses, written by reading the `.blp` before any
// parser existed. Until this file they were prose: the harness checked that they were
// STRUCTURALLY a `SharedNode` and that their line numbers were inside the file, and nothing
// checked that they were RIGHT. Stage D of `scripts/check-blueprint-corpus.mjs` runs this
// over the same 36 files and compares, which turns the corpus's most expensive artefact
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

/** @import { BlueprintFile, ObjectBody, ObjectNode, TemplateNode, Value } from './ast.d.mts' */

/**
 * The GIR class name a tag is spelled with.
 *
 * An unqualified type resolves against **Gtk alone** — measured on `blueprint-compiler`
 * 0.20.4, `Bin { }` under `using Adw 1;` is refused with "Namespace Gtk does not contain a
 * type called Bin". So the default is not "the first import", it is Gtk.
 *
 * @param {{ namespace?: string, name: string }} type
 */
const tagOf = (type) => `${type.namespace ?? 'Gtk'}${type.name}`;

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
 * @param {Value} value
 */
const scalarOf = (value) => {
    if (value.kind === 'string') return value.value;
    if (value.kind === 'number') return Number(value.raw);
    if (value.kind === 'bool') return value.value;
    // An enum member keeps its SOURCE spelling. The XML carries the resolved number; these
    // are two exits from one AST and not two views of one set of values.
    if (value.kind === 'ident') return value.name;
    return undefined;
};

/**
 * @param {ObjectBody} body
 * @returns {{ props?: Record<string, string | number | boolean>, children?: object[] }}
 */
const projectBody = (body) => {
    /** @type {Record<string, string | number | boolean>} */
    const props = {};
    /** @type {{ line: number, slot?: string, object: ObjectNode }[]} */
    const placed = [];

    for (const property of body.properties) {
        // An object-valued property becomes a slotted child. `[start]` becomes one too, and
        // `SharedNode` has one field for both — the conflation is declared in the header of
        // `corpus/expectations.mjs`, and this is the single line that performs it.
        if (property.value.kind === 'object') {
            placed.push({ line: property.line, slot: property.name, object: property.value.object });
            continue;
        }
        const scalar = scalarOf(property.value);
        if (scalar !== undefined) props[property.name] = scalar;
    }
    for (const child of body.children) {
        placed.push({ line: child.line, slot: child.slot, object: /** @type {ObjectNode} */ (child.object) });
    }

    // Source order, across both arrays. `toolbar-view.blp` interleaves a `[top]` bracket, a
    // `content:` property and a `[bottom]` bracket, so concatenating the two arrays gets the
    // order wrong and only the line recovers it.
    placed.sort((a, b) => a.line - b.line);

    const children = placed
        .filter((entry) => !isBreakpoint(entry.object))
        .map((entry) => projectObject(entry.object, entry.slot));

    return {
        ...(Object.keys(props).length > 0 ? { props } : {}),
        ...(children.length > 0 ? { children } : {}),
    };
};

/**
 * @param {ObjectNode} object
 * @param {string} [slot]
 */
const projectObject = (object, slot) => {
    const body = projectBody(object.body);
    return {
        tag: tagOf(object.type),
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
            } else if (value.kind === 'object') walkObject(value.object);
        }
        for (const signal of body.signals) lost.push({ kind: 'signal', line: signal.line });
        for (const extension of body.extensions) lost.push({ kind: extension.name, line: extension.line });
        for (const child of body.children) {
            if (isBreakpoint(child.object)) {
                // Named on the OBJECT line, never on the bracket above it — the convention
                // stated once in the header of `corpus/expectations.mjs`.
                lost.push({ kind: 'breakpoint', line: child.object.line });
                continue;
            }
            walkObject(/** @type {ObjectNode} */ (child.object));
        }
    };

    /** @param {ObjectNode} object */
    const walkObject = (object) => {
        if (object.id !== undefined) lost.push({ kind: 'object-id', line: object.line });
        walkBody(object.body);
    };

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
            walkBody(root.body);
        } else walkObject(root);
    }
    return lost;
};

/**
 * Project a parsed `.blp` into the node shape ADR 0051's renderers consume.
 *
 * @param {BlueprintFile} file
 * @returns {{ node: object, lost: { kind: string, line: number }[] }}
 */
export function projectToSharedNode(file) {
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
        return { node: { tag: tagOf(template.parent), ...projectBody(template.body) }, lost: lossesOf(file) };
    }
    return { node: projectObject(/** @type {ObjectNode} */ (root), undefined), lost: lossesOf(file) };
}
