#!/usr/bin/env node
// The NativeScript XML template for every Adwaita gallery block that has one —
// emitted from ONE source, into the website AND into the app that inflates it.
//
// WHY A GENERATOR AND NOT ONE TEMPLATE TYPED INTO EACH PAGE
//
// The gallery's rule is that every snippet in it was compiled and run before it was
// written down, and an XML template is the one dialect where "it renders" cannot be
// read off the text. NativeScript's Builder fails SILENTLY in both directions that
// matter: an attribute whose setter does not coerce leaves the widget at its default
// (`instance[name] = value` with the raw STRING — `component-builder`'s
// `setPropertyValue` does nothing else for a plain accessor), and a child a widget
// cannot place is added to the layout anyway by `LayoutBase._addChildFromBuilder`,
// where it paints on top of whatever is in the first cell. Both render. Neither is
// what the template says.
//
// So the template a reader copies has to be the SAME BYTES an app loaded and
// asserted, and that is what this file arranges: one source
// (`adwaita-gallery-ns-templates.mjs`), two outputs, no second copy anywhere.
//
// WHAT IT WRITES
//
//   website/src/data/adwaita-nativescript-templates.ts   the template per block
//   showcases/dom/adwaita-gallery-nativescript/app/views/*.xml
//                                                        the files Builder.load()s
//   showcases/dom/adwaita-gallery-nativescript/app/expected.ts
//                                                        the tree the probe asserts
//   showcases/dom/adwaita-gallery-nativescript/app/adw.ts
//   showcases/dom/adwaita-gallery-nativescript/app/gtk.ts
//                                                        the two `xmlns` barrels
//
// The barrels are generated for the same reason the views are: NativeScript resolves
// `<adw:Clamp>` by reading `Clamp` off the module the `xmlns` names, so a template
// naming an element the barrel does not re-export fails at LOAD time with
// `Module 'Clamp' not found for element` — measured on Android, 2026-08-28. A
// hand-kept barrel is one more list that can fall behind the templates.
//
// TWO BARRELS, ONE PER NAMESPACE (ADR 0034 § Amendment 9). The prefix names a MODULE
// and nothing else, so it is the only thing in this dialect that can carry the library
// once the element name stops doing it: `<adw:Button>` and `<gtk:Button>` are the same
// element if both prefixes resolve to one module, and NativeScript would build the GTK
// button under the Adwaita prefix without a word. Two DISJOINT modules turn that into a
// load-time `Module '~/adw' not found for element 'adw:Button'`, which is a gate no
// lint rule has to be run for.
//
// THE EMITTED BYTES ARE FINAL. Nothing formats them, for the reason
// `generate-adwaita-framework-snippets.mjs` records at length: the jobs that run
// `check-generated-website-data.mjs` are `checkout` + `setup-node` and have no
// `node_modules`, so a generator that shelled out to a formatter went red on both
// platforms at once. The outputs are exempt in `.oxfmtrc.json` and `--check`
// compares BYTES.
//
// Usage: `node scripts/generate-adwaita-nativescript-templates.mjs [--check]`
//        `--check` writes nothing and exits 1 on any drift.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ADWAITA_GALLERY_NS_TEMPLATES, ADWAITA_GALLERY_NS_REFUSALS } from './adwaita-gallery-ns-templates.mjs';
import { namespaceExport } from './adwaita-elements.mjs';
import { WIDGET_CLASS } from './nativescript-xml-doors.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INDENT = '  ';
const TS_INDENT = '    ';

/** The showcase that loads every generated template and asserts the tree it built. */
export const NS_GALLERY_SHOWCASE = 'showcases/dom/adwaita-gallery-nativescript';

/** Where the package's clause-2 namespace barrels live — the ONE source of the split. */
export const NS_PACKAGE_SRC = 'packages/nativescript-bridge/adwaita/src';

/** XML prefix -> the app-local barrel module its `xmlns` names, without the `~/`. */
export const NS_XMLNS_BARRELS = { adw: 'adw', gtk: 'gtk' };

/** Where the generated outputs live, so the gate does not restate them. */
export const NS_GENERATED = {
    website: 'website/src/data/adwaita-nativescript-templates.ts',
    views: `${NS_GALLERY_SHOWCASE}/app/views`,
    expected: `${NS_GALLERY_SHOWCASE}/app/expected.ts`,
    barrels: {
        adw: `${NS_GALLERY_SHOWCASE}/app/${NS_XMLNS_BARRELS.adw}.ts`,
        gtk: `${NS_GALLERY_SHOWCASE}/app/${NS_XMLNS_BARRELS.gtk}.ts`,
    },
};

/**
 * The generated outputs `.oxfmtrc.json` must exempt.
 *
 * The `.xml` views are absent because oxfmt formats no XML; the `.ts` files are
 * generator output in the sense `generated/props.ts` is.
 */
export const NS_OXFMT_EXEMPT_OUTPUTS = [
    NS_GENERATED.website,
    NS_GENERATED.expected,
    ...Object.values(NS_GENERATED.barrels),
];

/** `Adw.Clamp` -> `AdwClamp`: the view file's name, and the probe's label. */
export const viewNameOf = (widget) => widget.replace('.', '');

/**
 * An element THIS package declares, told from a NativeScript-core one.
 *
 * `WIDGET_CLASS` and not `Adw` — the shared vocabulary, so this reads the same
 * question the gates read. `startsWith('Adw')` was the test until ADR 0034 clause 1
 * renamed four widgets to `Gtk*`, and then it answered "NativeScript core" for
 * `GtkButton` and `GtkEntry`: the two functions below silently dropped them, which is
 * `check-generated-website-data.mjs`'s prefix-as-membership-test defect arriving in
 * the generator. Nothing went red, because both outputs came from this one answer.
 * `check-generated-website-data.mjs` now holds it against the widget-class index.
 */
const OWN_ELEMENT = new RegExp(`^${WIDGET_CLASS}$`);

/**
 * Class name -> the XML spelling of it: `AdwClamp` -> `{ prefix: 'adw', member: 'Clamp' }`.
 *
 * READ OFF THE PACKAGE'S OWN NAMESPACE BARRELS, never decided here. That is the same
 * shape ADR 0034 clause 2 puts everywhere: which namespace a widget lands in is a
 * property of the widget's GType, `packages/nativescript-bridge/adwaita/src/namespace/`
 * is where it is written down, and `check-vocabulary-alignment.mjs` holds THAT against
 * the GIR tag table. A second placement rule here would be the prefix-as-membership-test
 * defect one level up — `startsWith('Adw')` twice cost this file exactly that.
 *
 * Memoised rather than computed at import: `check-generated-website-data.mjs` imports
 * `templateFor` from here, and an import must cost a definition and nothing else.
 */
let placement = null;
function widgetPlacement() {
    if (placement !== null) return placement;
    placement = new Map();
    const namespaces = namespaceExport(ROOT, NS_PACKAGE_SRC);
    if (namespaces === null) {
        throw new Error(
            `${NS_PACKAGE_SRC}/index.ts exports no Adw/Gtk namespace, so no element in this dialect has a ` +
                'name. ADR 0034 clause 2 is what the XML prefix reads; without it the templates cannot be emitted.',
        );
    }
    for (const [namespace, members] of namespaces) {
        const prefix = namespace.toLowerCase();
        if (!Object.hasOwn(NS_XMLNS_BARRELS, prefix)) {
            throw new Error(
                `no xmlns barrel is declared for the \`${namespace}\` namespace — add one to NS_XMLNS_BARRELS.`,
            );
        }
        for (const [member, binding] of members) placement.set(binding, { prefix, member });
    }
    return placement;
}

/**
 * One element's XML name: `<adw:Clamp>`, `<gtk:Entry>`, `<Label>`.
 *
 * A widget of this package with NO namespace member THROWS rather than falling through
 * to the unprefixed branch. Three have none (`AdwImageButton`, `AdwSliderRow`,
 * `AdwDataGrid`) and no gallery template names one; the day one does, the person adding
 * it has to decide which prefix it takes, because an unprefixed `<AdwDataGrid>` resolves
 * against NativeScript's OWN components and Builder finds nothing — silently, which is
 * how the four clause-1 renames shipped broken.
 */
const qualify = (tag) => {
    const place = widgetPlacement().get(tag);
    if (place !== undefined) return `${place.prefix}:${place.member}`;
    if (OWN_ELEMENT.test(tag)) {
        throw new Error(
            `<${tag}> is a widget of @gjsify/adwaita-nativescript with no member in either namespace barrel, ` +
                'so this dialect has no name for it (ADR 0034 clause 2). Give it a member, or give this ' +
                'gallery block a refusal in ADWAITA_GALLERY_NS_REFUSALS.',
        );
    }
    return tag;
};

/**
 * Every element of this package the templates name, per XML prefix — exactly what each
 * barrel must re-export, as the MEMBER name the template writes.
 */
export function elementsUsed() {
    /** @type {Record<string, Set<string>>} */
    const used = Object.fromEntries(Object.keys(NS_XMLNS_BARRELS).map((prefix) => [prefix, new Set()]));
    const walk = (node) => {
        const place = widgetPlacement().get(node.tag);
        if (place !== undefined) used[place.prefix].add(place.member);
        for (const child of node.children ?? []) walk(child);
    };
    for (const template of ADWAITA_GALLERY_NS_TEMPLATES) walk(template.root);
    return Object.fromEntries(Object.entries(used).map(([prefix, names]) => [prefix, [...names].sort()]));
}

/**
 * One attribute value, as XML text.
 *
 * Booleans and numbers become their source spelling and nothing more, because that
 * is all an attribute can be: NativeScript hands a plain accessor the STRING, so the
 * template cannot promise a type and the probe is what checks the widget recovers
 * one. `&`, `<` and `"` are escaped; `>` needs no escape inside an attribute and
 * escaping it would make the template differ from what an author would write.
 */
const attrValue = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/**
 * One node as XML, with the namespace declarations on the root only.
 *
 * One attribute stays on the tag line; more than one goes one per line — the same
 * rule `generate-adwaita-framework-snippets.mjs` applies to the Solid, Vue and React
 * panes this one renders beside, so a reader meets one shape across four dialects
 * and a six-property status page stays readable in a narrow code block.
 */
function xml(node, depth, rootAttrs = []) {
    const pad = INDENT.repeat(depth);
    const attrs = [...rootAttrs, ...Object.entries(node.props ?? {}).map(([n, v]) => `${n}="${attrValue(v)}"`)];
    const inline = attrs.length <= 1;
    const head = inline
        ? `${pad}<${qualify(node.tag)}${attrs.length > 0 ? ` ${attrs[0]}` : ''}`
        : [`${pad}<${qualify(node.tag)}`, ...attrs.map((a) => `${pad}${INDENT}${a}`)].join('\n');

    const children = node.children ?? [];
    if (children.length === 0) return `${head}${inline ? ' />' : `\n${pad}/>`}`;

    const body = children
        .map((child) => {
            if (child.slot === undefined) return xml(child, depth + 1);
            // NativeScript's complex-property syntax: the element is named
            // `<Parent.property>` and the parent's `_addChildFromBuilder` receives
            // that name. It is the ONLY way markup can say which slot a child wants.
            const wrapper = `${qualify(node.tag)}.${child.slot}`;
            const inner = xml(child, depth + 2);
            return `${INDENT.repeat(depth + 1)}<${wrapper}>\n${inner}\n${INDENT.repeat(depth + 1)}</${wrapper}>`;
        })
        .join('\n');
    return `${head}${inline ? '>' : `\n${pad}>`}\n${body}\n${pad}</${qualify(node.tag)}>`;
}

/** The XML prefixes one tree actually uses, in `NS_XMLNS_BARRELS` order. */
function prefixesUsed(node, into = new Set()) {
    const place = widgetPlacement().get(node.tag);
    if (place !== undefined) into.add(place.prefix);
    for (const child of node.children ?? []) prefixesUsed(child, into);
    return Object.keys(NS_XMLNS_BARRELS).filter((prefix) => into.has(prefix));
}

/**
 * The template as it ships: the root carries the default namespace and the prefixes
 * this tree uses — no more.
 *
 * `xmlns:adw="~/adw"` is a MODULE path, not a package name — NativeScript loads it and
 * reads the element name off its exports, and a bare package specifier does not
 * resolve. The default `xmlns` is NativeScript's own, so `<Label>` and `<StackLayout>`
 * beside the Adwaita elements need no prefix.
 *
 * ONLY THE PREFIXES USED, because a reader copies these bytes: an `xmlns:gtk` over a
 * template with no GTK element is a declaration of a module the app then has to have,
 * and the barrel it names is generated from what the templates use.
 */
export function templateFor(node, note) {
    const head = [
        'xmlns="http://schemas.nativescript.org/tns.xsd"',
        ...prefixesUsed(node).map((prefix) => `xmlns:${prefix}="~/${NS_XMLNS_BARRELS[prefix]}"`),
    ];
    const body = xml(node, 0, head);
    return note === undefined ? `${body}\n` : `<!-- ${note} -->\n${body}\n`;
}

// ------------------------------------------------------------- website data file

function websiteData() {
    const rows = ADWAITA_GALLERY_NS_TEMPLATES.map(
        (t) => `${TS_INDENT}'${t.widget}': ${JSON.stringify(templateFor(t.root, t.note).trimEnd())},`,
    ).join('\n');
    const refusals = Object.entries(ADWAITA_GALLERY_NS_REFUSALS)
        .map(([widget, why]) => `${TS_INDENT}'${widget}': ${JSON.stringify(why)},`)
        .join('\n');
    return `// GENERATED by scripts/generate-adwaita-nativescript-templates.mjs — do not edit.
//
// The NativeScript XML template for every gallery block that has one, keyed by the
// block's \`<AdwWidget title="…">\`. Rendered by the component rather than written
// per page, for the reason \`AdwWidget.astro\` already gives about the attribute
// table: written per page, it did not survive — four of the forty blocks had one.
//
// Every template in here was INFLATED AND ASSERTED before it was written down:
// \`showcases/dom/adwaita-gallery-nativescript\` loads these exact bytes through
// NativeScript's \`Builder\` on a real Android device and walks the view tree the
// loader built. That matters more here than in any other dialect, because a
// NativeScript template fails silently in both directions — an attribute whose
// setter does not coerce leaves the default in place, and a child a widget cannot
// place is added to the layout anyway.

/** Gallery block title -> its NativeScript XML template. */
export const ADWAITA_NATIVESCRIPT_TEMPLATES: Readonly<Record<string, string>> = {
${rows}
};

/**
 * Gallery blocks that deliberately have NO XML template, and why.
 *
 * Exported so a page can say so rather than leaving a reader to wonder: a missing
 * tab and a tab that cannot exist look identical, and only one of them is a fact.
 * NativeScript's Builder reaches a widget through an attribute (a STRING) and a
 * child (placed only where the widget overrides \`_addChildFromBuilder\`); a reason
 * below names which of those two doors is shut.
 */
export const ADWAITA_NATIVESCRIPT_REFUSALS: Readonly<Record<string, string>> = {
${refusals}
};
`;
}

// -------------------------------------------------------------- probe: the barrel

function barrel(prefix) {
    const names = elementsUsed()[prefix];
    const namespace = prefix === 'adw' ? 'Adw' : 'Gtk';
    return `// GENERATED by scripts/generate-adwaita-nativescript-templates.mjs — do not edit.
//
// The module every generated template's \`xmlns:${prefix}="~/${NS_XMLNS_BARRELS[prefix]}"\` resolves to,
// and it holds the \`${namespace}\` half of the vocabulary and nothing else.
//
// NativeScript reads the element name off THIS module's exports
// (\`component-builder\`'s \`createComponentInstance\`), so a template naming an
// element absent here fails at load with \`Module '<name>' not found for element\` —
// measured on Android, 2026-08-28. Generated from the templates themselves so the
// two cannot fall out of step.
//
// ONE BARREL PER NAMESPACE is what makes the prefix mean something (ADR 0034
// § Amendment 9): the two modules are disjoint, so \`<${prefix}:${prefix === 'adw' ? 'Button' : 'Clamp'}>\` — the wrong
// library under this prefix — fails to load instead of quietly building the right
// widget under the wrong name.

export {
${names.map((name) => `${TS_INDENT}${name},`).join('\n')}
} from '@gjsify/adwaita-nativescript/${prefix}';
`;
}

// ------------------------------------------------------------ probe: the expected tree

/** The expected tree, as the literal the probe walks. */
function expectedLiteral() {
    const node = (n, depth) => {
        const pad = TS_INDENT.repeat(depth);
        // The QUALIFIED name, so the probe's label and the template a reader copies are
        // the same string: a failure reading `<adw:Clamp>` names what the XML says.
        const parts = [`tag: '${qualify(n.tag)}'`];
        if (n.slot !== undefined) parts.push(`slot: '${n.slot}'`);
        if (n.props !== undefined) parts.push(`props: ${JSON.stringify(n.props)}`);
        if (n.children !== undefined)
            parts.push(`children: [\n${n.children.map((c) => node(c, depth + 2)).join(',\n')}\n${pad}${TS_INDENT}]`);
        return `${pad}{ ${parts.join(', ')} }`;
    };
    return ADWAITA_GALLERY_NS_TEMPLATES.map(
        (t) =>
            `${TS_INDENT}{ widget: '${t.widget}', view: '${viewNameOf(t.widget)}', root:\n${node(t.root, 2)}\n${TS_INDENT}},`,
    ).join('\n');
}

function expectedModule() {
    const names = elementsUsed();
    const namespaces = Object.entries(names)
        .filter(([, members]) => members.length > 0)
        .map(([prefix]) => (prefix === 'adw' ? 'Adw' : 'Gtk'));
    const classes = Object.entries(names).flatMap(([prefix, members]) =>
        members.map((member) => `${TS_INDENT}'${prefix}:${member}': ${prefix === 'adw' ? 'Adw' : 'Gtk'}.${member},`),
    );
    return `// GENERATED by scripts/generate-adwaita-nativescript-templates.mjs — do not edit.
//
// What each generated view under \`app/views/\` must have BUILT, as the literal
// \`gallery-page.ts\` walks. It is the same source the template came from, so what
// the probe asserts and what the website ships cannot describe different trees.
//
// \`ELEMENT_CLASSES\` maps a template's element name to the class an instance must
// be, and it exists because a bundled class NAME is not a fact: Rolldown may rename
// one, and \`constructor.name\` would then read as a mismatch that is not one.
// \`instanceof\` asks the runtime instead.

import { Label, StackLayout, type View } from '@nativescript/core';

import { ${namespaces.join(', ')} } from '@gjsify/adwaita-nativescript';

/** One node of a declared template tree. */
export interface ExpectNode {
    /** The XML element name as the template writes it, e.g. \`adw:Clamp\` or \`Label\`. */
    tag: string;
    /** The parent property this child asked for, when it asked for one. */
    slot?: string;
    /** Attribute name -> the value the widget must READ BACK, typed. */
    props?: Record<string, string | number | boolean>;
    children?: ExpectNode[];
}

/** One template, its view file, and the tree it must build. */
export interface ExpectView {
    widget: string;
    view: string;
    root: ExpectNode;
}

/** Element name -> the class \`Builder\` must have instantiated for it. */
export const ELEMENT_CLASSES: Record<string, new () => View> = {
${[...classes, `${TS_INDENT}Label,`, `${TS_INDENT}StackLayout,`].join('\n')}
};

export const EXPECTED: readonly ExpectView[] = [
${expectedLiteral()}
];
`;
}

// ------------------------------------------------------------------------ writing

/**
 * ONLY when run as a program.
 *
 * MEASURED, twice, and the second time was this file: `check-generated-website-data.mjs`
 * imports `templateFor`, `viewNameOf` and `NS_GENERATED` from here, and without this
 * guard that import RAN the writer — with the GATE's `process.argv`, which carries no
 * `--check`. So the gate rewrote all four committed outputs back to source (and
 * `rmSync`d any view it thought stale) before looking at them: hand-editing
 * `app/views/AdwAvatar.xml` to `size="48"` left the check at exit 0 reporting "28 XML
 * template(s) byte-identical", and the file came back saying `size="96"`.
 *
 * `generate-adwaita-framework-snippets.mjs` already carried this guard AND this
 * incident in its own header. A check that repairs what it is about to check is the
 * most expensive shape in this repository, and it was one import away — again. An
 * import must cost a definition and nothing else, which is why the outputs are BUILT
 * inside the guard rather than merely written inside it.
 *
 * The guard is not the whole answer either, because it fails OPEN: forget it once more
 * and every gate stays green. So `audit-runtimes.yml` asserts a clean tree after each
 * call, and a generator that writes during a check is then a red diff rather than a
 * quiet repair.
 */
const RUN_AS_PROGRAM = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

const CHECK = process.argv.includes('--check');

/** Every committed output, as `[relative path, bytes]`. Built only when run. */
function buildOutputs() {
    const outputs = [
        [NS_GENERATED.website, websiteData()],
        ...Object.entries(NS_GENERATED.barrels).map(([prefix, rel]) => [rel, barrel(prefix)]),
        [NS_GENERATED.expected, expectedModule()],
    ];
    for (const template of ADWAITA_GALLERY_NS_TEMPLATES) {
        outputs.push([
            `${NS_GENERATED.views}/${viewNameOf(template.widget)}.xml`,
            templateFor(template.root, template.note),
        ]);
    }
    return outputs;
}

if (RUN_AS_PROGRAM) {
    const drift = [];
    const outputs = buildOutputs();
    for (const [rel, content] of outputs) {
        const abs = join(ROOT, rel);
        let have = null;
        try {
            have = readFileSync(abs, 'utf8');
        } catch {
            have = null;
        }
        if (have === content) continue;
        if (CHECK) {
            drift.push(`${rel}: ${have === null ? 'missing' : 'out of date'}`);
            continue;
        }
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content);
    }

    // A view file left behind by a template that became a refusal is a template the
    // probe would keep loading and the website would never show — green, and about
    // nothing. `--check` reports it; a write removes it.
    const wanted = new Set(ADWAITA_GALLERY_NS_TEMPLATES.map((t) => `${viewNameOf(t.widget)}.xml`));
    let stale = [];
    try {
        stale = readdirSync(join(ROOT, NS_GENERATED.views)).filter((f) => f.endsWith('.xml') && !wanted.has(f));
    } catch {
        stale = [];
    }
    for (const file of stale) {
        if (CHECK) drift.push(`${NS_GENERATED.views}/${file}: no template emits it any more`);
        else rmSync(join(ROOT, NS_GENERATED.views, file));
    }

    if (CHECK) {
        if (drift.length > 0) {
            console.error('generate-adwaita-nativescript-templates: committed output is stale:');
            for (const line of drift) console.error(`  ${line}`);
            console.error('\nRe-run: node scripts/generate-adwaita-nativescript-templates.mjs');
            process.exit(1);
        }
        console.log(
            `generate-adwaita-nativescript-templates: ${outputs.length} generated file(s) current ` +
                `(${ADWAITA_GALLERY_NS_TEMPLATES.length} template(s), ` +
                `${Object.keys(ADWAITA_GALLERY_NS_REFUSALS).length} refusal(s))`,
        );
    } else {
        console.log(
            `generate-adwaita-nativescript-templates: ${ADWAITA_GALLERY_NS_TEMPLATES.length} template(s), ` +
                `${Object.keys(ADWAITA_GALLERY_NS_REFUSALS).length} refusal(s), ` +
                `${Object.entries(elementsUsed())
                    .map(([prefix, members]) => `${members.length} in ~/${NS_XMLNS_BARRELS[prefix]}`)
                    .join(', ')}` +
                (stale.length > 0 ? `, removed ${stale.length} stale view(s)` : ''),
        );
    }
}
