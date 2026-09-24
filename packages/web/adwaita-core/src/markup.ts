// A `SharedTreeNode` written out as the MARKUP each port reads: `<adw-*>` custom elements for
// `@gjsify/adwaita-web`, NativeScript XML for `@gjsify/adwaita-nativescript`.
//
// WHY TEXT, WHEN BOTH PORTS ALREADY BUILD THE TREE. `mountSharedTree` and the NativeScript
// `build` realise a tree without any markup in between, which is what a `.blp`-driven app
// wants. A reader of the gallery wants the other thing: to see how the same layout is
// written in each port's own template syntax, without Blueprint. Hand-writing that beside
// the `.blp` is the drift the one-Blueprint shape exists to remove, so the website renders
// it from the projection with these two functions, and each port's test suite loads the
// text back through its own door (the DOM parser, NativeScript's XML builder) and holds it
// to the tree its builder makes.
//
// EACH FUNCTION FOLLOWS ITS PORT'S BUILDER, rule for rule, and names the rule where it is
// applied: `buildSharedTree` in `adwaita-web/src/shared-tree-builder.ts` and `build` in
// `adwaita-nativescript/src/builder/index.ts`. A rule changed there is a rule changed here,
// and the two round-trip specs are what notice when it is not.
//
// HERE AND NOT IN EITHER PORT because the website renders both at build time, and the
// NativeScript package cannot be imported off a device: every widget module evaluates
// `@nativescript/core` at module scope. This file needs only the case rules in `./tags`.

import type { SharedTreeNode } from './conformance/shared-trees.js';
import { GTK_WIDGET_MARGIN_CSS, attributeOf, hostTagOf, propertyOf } from './tags.js';

const INDENT = '  ';

/**
 * A start tag wider than this breaks into one attribute per line. The gallery's code panes
 * are narrow, and a `label` carrying a sentence would otherwise scroll the pane sideways;
 * a short tag stays on one line so a block with many small widgets stays short.
 */
const LINE_WIDTH = 80;

/** `name="value"`, or the bare `name` of a present boolean attribute (`value === null`). */
type Attribute = readonly [name: string, value: string | null];

/** A value as attribute text, delimiters included. */
type Quote = (value: string) => string;

/** One element with its children, laid out by {@link LINE_WIDTH}. */
function element(
    depth: number,
    name: string,
    attributes: readonly Attribute[],
    quote: Quote,
    body: readonly string[],
    selfClosing: boolean,
): string {
    const pad = INDENT.repeat(depth);
    const pairs = attributes.map(([attr, value]) => (value === null ? attr : `${attr}=${quote(value)}`));
    const empty = body.length === 0;
    const close = empty ? (selfClosing ? ' />' : `></${name}>`) : '>';
    const inline = `${pad}<${[name, ...pairs].join(' ')}${close}`;
    const head =
        inline.length <= LINE_WIDTH || pairs.length === 0
            ? inline
            : [
                  `${pad}<${name}`,
                  ...pairs.map((pair) => `${pad}${INDENT}${pair}`),
                  `${pad}${empty ? (selfClosing ? '/>' : `></${name}>`) : '>'}`,
              ].join('\n');
    return empty ? head : [head, ...body, `${pad}</${name}>`].join('\n');
}

// ------------------------------------------------------------------ adwaita-web

/** HTML text content: `&` and `<` are all it has to escape. */
const htmlText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * HTML attribute text: `&` and the delimiter are all an attribute value has to escape. The
 * delimiter follows the value, as in {@link xmlQuote}: a string list's JSON reads as
 * `strings='["Blue","Teal"]'`, the way an author writes it, not as a run of `&quot;`.
 */
const htmlQuote: Quote = (value) => {
    const quote = value.includes('"') && !value.includes("'") ? "'" : '"';
    const escaped = value
        .replace(/&/g, '&amp;')
        .replace(quote === '"' ? /"/g : /'/g, quote === '"' ? '&quot;' : '&#39;');
    return `${quote}${escaped}${quote}`;
};

function htmlElement(node: SharedTreeNode, depth: number): string {
    const attributes: Attribute[] = [];
    // `buildSharedTree`: the id, the props through `attributeOf`, the style classes as
    // `class`, then the placement as `slot=` — in that order.
    if (node.id !== undefined) attributes.push(['id', node.id]);
    const style: string[] = [];
    for (const [prop, value] of Object.entries(node.props ?? {})) {
        // A boolean is the attribute's PRESENCE (`toggleAttribute`), so `false` is no
        // attribute at all and `true` is the bare name.
        if (typeof value === 'boolean') {
            if (value) attributes.push([attributeOf(prop), null]);
        } else {
            attributes.push([attributeOf(prop), String(value)]);
        }
        // A margin is inline style as well, in the order the builder sets it.
        const margin = GTK_WIDGET_MARGIN_CSS[attributeOf(prop)];
        if (margin !== undefined) style.push(`${margin}: ${Number(value)}px;`);
    }
    if (style.length > 0) attributes.push(['style', style.join(' ')]);
    if (node.styleClasses !== undefined && node.styleClasses.length > 0) {
        attributes.push(['class', node.styleClasses.join(' ')]);
    }
    // `writeExtensions`: a string list is its `strings` attribute, a JSON array.
    const strings = node.extensions?.strings;
    if (strings !== undefined) attributes.push(['strings', JSON.stringify(strings.map((string) => string.value))]);
    if (node.slot !== undefined) attributes.push(['slot', node.slot]);
    // …and each response an `<adw-alert-response>` child, ahead of the authored children.
    const responses = (node.extensions?.responses ?? []).map((response) => {
        const pairs = [`id=${htmlQuote(response.id)}`];
        if (response.appearance !== undefined) pairs.push(`appearance=${htmlQuote(response.appearance)}`);
        if (response.enabled === false) pairs.push('enabled="false"');
        const label = htmlText(response.label);
        return `${INDENT.repeat(depth + 1)}<adw-alert-response ${pairs.join(' ')}>${label}</adw-alert-response>`;
    });
    const body = [...responses, ...(node.children ?? []).map((child) => htmlElement(child, depth + 1))];
    return element(depth, hostTagOf(node.tag), attributes, htmlQuote, body, false);
}

/**
 * The tree as `<adw-*>`/`<gtk-*>` markup: what `buildSharedTree` would build, spelled as the
 * HTML a page could hold instead. Parsed into a document, it yields the same elements with
 * the same attributes, classes and `slot=` as `mountSharedTree(node)` does.
 */
export function sharedTreeHtml(node: SharedTreeNode): string {
    return htmlElement(node, 0);
}

// ---------------------------------------------------------- adwaita-nativescript

/**
 * The XML prefix and member of a GIR class name: `AdwClamp` -> `adw` + `Clamp`.
 *
 * The same split the NativeScript builder's `elementFor` makes — the prefix names the
 * library, the member is the rest — and the prefix is the `xmlns` barrel the element is
 * read off (`xmlns:adw="~/adw"`), one per library, as the gallery page explains.
 */
function xmlNameOf(tag: string): { prefix: string; member: string } {
    const match = /^(Adw|Gtk)([A-Z]\w*)$/.exec(tag);
    if (match === null) throw new Error(`sharedTreeNativeScriptXml: ${tag} is not an Adw or Gtk class name`);
    return { prefix: match[1].toLowerCase(), member: match[2] };
}

/**
 * XML attribute text. The delimiter follows the value — single quotes when it carries a
 * double quote — which is what an author writes, and what the gallery's generated
 * NativeScript templates already do.
 */
const xmlQuote: Quote = (value) => {
    const quote = value.includes('"') ? "'" : '"';
    const escaped = value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(quote === '"' ? /"/g : /'/g, quote === '"' ? '&quot;' : '&apos;');
    return `${quote}${escaped}${quote}`;
};

function prefixesOf(node: SharedTreeNode, into: Set<string>): Set<string> {
    into.add(xmlNameOf(node.tag).prefix);
    for (const child of node.children ?? []) prefixesOf(child, into);
    return into;
}

const NATIVESCRIPT_XMLNS = 'http://schemas.nativescript.org/tns.xsd';

function xmlElement(node: SharedTreeNode, depth: number, rootAttributes: readonly Attribute[]): string {
    const { prefix, member } = xmlNameOf(node.tag);
    const name = `${prefix}:${member}`;
    const attributes: Attribute[] = [...rootAttributes];
    // `build`: the id, every prop through `propertyOf` as a STRING (an XML attribute can be
    // nothing else, and the widget's setter coerces it), then the style classes as one
    // space-separated `styleClasses`.
    if (node.id !== undefined) attributes.push(['id', node.id]);
    for (const [prop, value] of Object.entries(node.props ?? {})) {
        attributes.push([propertyOf(prop), String(value)]);
    }
    if (node.styleClasses !== undefined && node.styleClasses.length > 0) {
        attributes.push(['styleClasses', node.styleClasses.join(' ')]);
    }
    // ADR 0072's string list: `build` passes the items as the `{ strings }` construct bag,
    // and a template has no constructor to pass them to, so they are the `strings` member.
    const strings = node.extensions?.strings;
    if (strings !== undefined) attributes.push(['strings', JSON.stringify(strings.map((string) => string.value))]);
    const body = (node.children ?? []).map((child) => {
        if (child.slot === undefined) return xmlElement(child, depth + 1, []);
        // A placement is NativeScript's complex-property element, `<adw:Clamp.child>`: the
        // builder hands the child to `_addChildFromBuilder` under that property's name, which
        // is the name `build` passes for an authored slot.
        const pad = INDENT.repeat(depth + 1);
        const wrapper = `${name}.${child.slot}`;
        return [`${pad}<${wrapper}>`, xmlElement(child, depth + 2, []), `${pad}</${wrapper}>`].join('\n');
    });
    return element(depth, name, attributes, xmlQuote, body, true);
}

/**
 * The tree as a NativeScript XML template: what the port's `build` would build, spelled as
 * markup NativeScript's `Builder` loads. The root declares NativeScript's default namespace
 * and one `xmlns` barrel per library the tree uses — no more, since each is a module the app
 * then has to provide.
 */
export function sharedTreeNativeScriptXml(node: SharedTreeNode): string {
    const prefixes = [...prefixesOf(node, new Set())].sort();
    const namespaces: Attribute[] = [
        ['xmlns', NATIVESCRIPT_XMLNS],
        ...prefixes.map((prefix): Attribute => [`xmlns:${prefix}`, `~/${prefix}`]),
    ];
    return xmlElement(node, 0, namespaces);
}
