#!/usr/bin/env node
// Solid, Vue and React snippets for the Adwaita gallery — emitted from ONE source
// per widget, plus the three probe showcases that COMPILE and RUN exactly the
// markup that ships.
//
// WHY A GENERATOR AND NOT 120 SNIPPETS
//
// 40 gallery blocks times three adapters is 120 hand-written snippets, and the
// three adapters render the SAME element tree — `@gjsify/gtk-host` is one host
// with three subpaths, and `check-adapter-import-direction.mjs` already forbids an
// adapter from containing a widget name at all. So the DIFFERENCE between the
// three snippets for a widget is syntax, and syntax is the one thing a generator
// is reliably better at than a person: measured on the trees in
// `adwaita-gallery-trees.mjs`, Solid and React emit BYTE-IDENTICAL markup, and Vue
// differs only in attribute casing and its `:prop="…"` binding form.
//
// WHERE THE DIALECTS GENUINELY DIVERGE, and why the generator stops there
//
// It is not markup. It is everything a static tree does not contain:
//
//   · CONTROL FLOW. Solid needs `<For>`/`<Show>` from the ADAPTER (`solid-js/web`'s
//     build DOM nodes nobody can place); Vue has `v-for`/`v-if`; React maps and
//     ternaries. Three different constructs with three different reconciliation
//     paths — the host-counter showcases exist to measure exactly that.
//   · REFS. Solid's `ref` is a callback, React's is `Ref<T>` (callback OR a
//     `createRef` object), Vue's is a template ref resolved by name. Any widget
//     whose property POINTS AT ANOTHER WIDGET needs one — which is why
//     `Adw.ViewSwitcher`, `Adw.ViewSwitcherBar` and `Adw.InlineViewSwitcher` are
//     refusals here rather than snippets: their `stack` is a widget reference.
//   · EVENT SEMANTICS. `onClicked` in JSX, `@clicked` in a Vue template — and
//     under React the handler runs in a scheduled lane, so the tree is NOT patched
//     when the signal returns. A generated snippet that showed a click handler
//     would be telling three different truths in one shape.
//
// The gallery blocks are static widget trees, so none of that is in scope; the
// generator emits markup and the wrapper line that mounts it, and nothing else.
//
// WHAT IT WRITES
//
//   website/src/data/adwaita-framework-snippets.ts    the three snippets per block
//   showcases/gtk/adwaita-gallery-{solid,vue,react}/  the probe that runs them
//
// The probe sources are generated so that what is asserted is the SAME TEXT that
// ships — a generator whose output nobody ran is worth less than three snippets
// somebody wrote by hand.
//
// Usage: `node scripts/generate-adwaita-framework-snippets.mjs [--check]`
//        `--check` writes nothing and exits 1 on any drift.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ADWAITA_GALLERY_REFUSALS, ADWAITA_GALLERY_TREES } from './adwaita-gallery-trees.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INDENT = '    ';

// ---------------------------------------------------------------- markup emitters

/**
 * THE EMITTED BYTES ARE FINAL — nothing formats them, and that is a requirement
 * rather than a preference.
 *
 * THE INCIDENT. The first version piped every output through
 * `node_modules/.bin/oxfmt --stdin-filepath`, so the generator and `oxfmt --check`
 * could not contradict each other. It went red on `main` in two jobs at once, on
 * both platforms:
 *
 *     cannot format AdwPreferencesGroup.snippet.tsx — spawnSync …/node_modules/.bin/oxfmt ENOENT
 *     cannot format AdwPreferencesGroup.snippet.tsx — spawnSync D:\a\…\node_modules\.bin\oxfmt ENOENT
 *
 * `Detect runtime-triplet drift` and `Manifest checks (Windows)` are `checkout` +
 * `setup-node` and NOTHING else — no install, no build, no `node_modules`. That is
 * deliberate and it is what `check-generated-website-data.mjs`'s own header
 * promises: "Plain Node over the repo's own files — no install, no build". So the
 * dependency could not be relocated, only removed: `require.resolve('oxfmt')` has
 * no package to find, and `packages/infra/oxfmt-native` is a build output that job
 * does not have either. (The Windows path also shows a `.bin` shim spawned without
 * its `.cmd` — a second failure waiting behind the first, and one more thing that
 * simply stops existing when the subprocess does.)
 *
 * WHAT REPLACES IT. This file owns its own line breaking, the three generated probe
 * sources are exempt in `.oxfmtrc.json` — their formatting is a generator's output,
 * not a person's, the same reason that file already exempts `cli.gjs.mjs`,
 * `test.gjs.mjs` and `templates/` — and `--check` compares BYTES with no dependency
 * at all. Arm 7 of the gate holds the exemption so it cannot quietly stop matching.
 *
 * The gain is not only portability: snippet text and probe text are now identical
 * BY CONSTRUCTION, because both come from `markup()` through the same frame. The
 * formatter used to reach only one of the two and arm 6 had to compare trimmed
 * lines to survive it.
 */

const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const HOST_WIDGET_TABLE = join(ROOT, 'packages/framework/gtk-host/src/generated/widgets.ts');

/**
 * `adw-header-bar` -> `AdwHeaderBar`, the GType the probe reads back.
 *
 * THE TABLE, NOT A RULE, and that is forced rather than chosen. This used to camel-case
 * the tag back — the namespace prepended AFTER the rest, never substituted for the
 * prefix, because substituting first left no dash in front of the first word and
 * `adw-preferences-group` came out `AdwpreferencesGroup`, a GType nothing has, which
 * made the probe report every widget as missing while the adapter had built all 18.
 *
 * The rule survived that repair and still could not be right: `gtk-host`'s `tagOf`
 * collapses an acronym run, so `GtkGLArea` is `gtk-gl-area` and reads back as
 * `GtkGlArea` — a second GType nothing has, waiting for the first gallery block to
 * draw a `Gtk.GLArea`. GType -> tag is a rule (`hostTagOf` in
 * `adwaita-gallery-shared-trees.mjs`, held row for row by arm 11); tag -> GType is
 * only ever a lookup in the table `tagOf` stamped, which is why `gtk-host` keeps the
 * GType name as its table key.
 */
const readHostWidgetTable = () => {
    let src;
    try {
        src = readFileSync(HOST_WIDGET_TABLE, 'utf8');
    } catch (error) {
        // A raw ENOENT stack out of a module body reads like a broken generator. It is
        // a missing gtk-host build input, and the message has to say which one.
        throw new Error(`generate-adwaita-framework-snippets: cannot read ${HOST_WIDGET_TABLE} (${error.message})`);
    }
    const rows = [...src.matchAll(/\{\s*gtype:\s*'([^']+)',\s*tag:\s*'([^']+)'/g)];
    // An empty read would turn every lookup below into a throw naming the TAG, which is
    // the one thing that would not be wrong.
    if (rows.length === 0) {
        throw new Error(`generate-adwaita-framework-snippets: ${HOST_WIDGET_TABLE} yielded no gtype/tag row`);
    }
    return new Map(rows.map((m) => [m[2], m[1]]));
};

const GTYPE_BY_TAG = readHostWidgetTable();

export const gtypeOfTag = (tag) => {
    const gtype = GTYPE_BY_TAG.get(tag);
    if (gtype === undefined) {
        throw new Error(`generate-adwaita-framework-snippets: <${tag}> is not a tag gtk-host generates`);
    }
    return gtype;
};

/**
 * An array value as a JS literal, with SINGLE-quoted strings.
 *
 * Single quotes are not a style choice. A Vue attribute is written inside DOUBLE
 * quotes, so `JSON.stringify` — which double-quotes every string and every key — ends
 * the attribute at the first entry: `:menu-model="[{"label":…"` is three attributes and
 * a parse error. Emitting the literal by hand keeps ONE writer for both dialects, which
 * is the same reason `markup()` is one walk with two attribute functions.
 *
 * Object entries are what the portable menu model needs (ADR 0042): `menuModel` takes a
 * list of `{ label, action }` descriptors, and before it there was no snippet at all —
 * a `GMenuModel` has no literal spelling, which is exactly what the refusal said.
 */
function jsLiteral(value, pad = '') {
    if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    if (Array.isArray(value)) {
        // A list of OBJECTS goes one per line. `cssClasses={['flat']}` is short and
        // stays inline; a three-item menu on one line is 150 columns, and the gallery
        // renders these in a narrow code block — the same reason `markup()` already
        // breaks a tag with more than one attribute.
        if (!value.some((entry) => entry !== null && typeof entry === 'object')) {
            return `[${value.map((entry) => jsLiteral(entry)).join(', ')}]`;
        }
        const rows = value.map((entry) => `${pad}${INDENT}${jsLiteral(entry, pad + INDENT)},`).join('\n');
        return `[\n${rows}\n${pad}]`;
    }
    if (value !== null && typeof value === 'object') {
        return `{ ${Object.entries(value)
            .map(([k, v]) => `${k}: ${jsLiteral(v, pad)}`)
            .join(', ')} }`;
    }
    return JSON.stringify(value);
}

/**
 * One attribute, in JSX. A string is a quoted attribute; everything else is an
 * expression, because `spacing="12"` would hand GObject a string for an int
 * property — the case it drops silently.
 */
function jsxAttr(name, value, pad = '') {
    if (typeof value === 'string') return `${name}=${JSON.stringify(value)}`;
    if (value === true) return name;
    if (Array.isArray(value)) return `${name}={${jsLiteral(value, pad)}}`;
    return `${name}={${JSON.stringify(value)}}`;
}

/** One attribute, in a Vue template: kebab-case, and `:` for anything not a string. */
function vueAttr(name, value, pad = '') {
    const attr = kebab(name);
    if (typeof value === 'string') return `${attr}=${JSON.stringify(value)}`;
    if (Array.isArray(value)) return `:${attr}="${jsLiteral(value, pad)}"`;
    return `:${attr}="${JSON.stringify(value)}"`;
}

/**
 * A node as markup, in one dialect.
 *
 * The two forms are the same walk with a different attribute writer, deliberately:
 * a second walk is a second place for the tree shape to drift.
 */
function markup(node, dialect, depth = 0) {
    const pad = INDENT.repeat(depth);
    const attr = dialect === 'vue' ? vueAttr : jsxAttr;
    const parts = [];
    if (node.slot !== undefined) parts.push(`slot=${JSON.stringify(node.slot)}`);
    // The attribute's own indent, so a multi-line value (a menu model) lines up under
    // the tag rather than at column 0.
    for (const [name, value] of Object.entries(node.props ?? {})) parts.push(attr(name, value, pad + INDENT));

    const children = node.children ?? [];
    // One attribute stays on the tag line; more than one goes one per line, which
    // is what keeps a six-property status page readable in a 60-column code block.
    const inline = parts.length <= 1;
    const head = inline
        ? `${pad}<${node.tag}${parts.length > 0 ? ` ${parts[0]}` : ''}`
        : [`${pad}<${node.tag}`, ...parts.map((p) => `${pad}${INDENT}${p}`)].join('\n');

    if (children.length === 0) return `${head}${inline ? ' />' : `\n${pad}/>`}`;
    const body = children.map((child) => markup(child, dialect, depth + 1)).join('\n');
    return `${head}${inline ? '>' : `\n${pad}>`}\n${body}\n${pad}</${node.tag}>`;
}

/** `Adw.HeaderBar` -> `AdwHeaderBar`, the component name in a snippet. */
const componentName = (widget) => widget.replace('.', '');

/**
 * The MARKUP REGION of the shipped snippet, as trimmed non-empty lines.
 *
 * Taken out of `snippetFor` rather than re-derived from the tree, so what the gate
 * compares is the text that actually ships. Trimmed because the two land at
 * different depths — the snippet is a component of its own, the Vue probe nests
 * every tree inside one `<gtk-box>`; and the region is bounded because the frames
 * around the markup are dialect-specific by design: JSX carries the `const X = ()
 * => (` the probe also uses, a Vue SFC carries `<template>`, which the probe has
 * exactly once for all 18.
 */
export function snippetLines(tree, dialect) {
    const lines = snippetFor(tree, dialect)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
    // Vue's frame is the SFC's `<template>` and the mount note; the probe carries
    // `<template>` once for all 18, so it cannot be part of any one snippet.
    if (dialect === 'vue') {
        return lines.filter((line) => !line.startsWith('<!--') && line !== '<template>' && line !== '</template>');
    }
    // JSX's frame is only the mount note: `const X = () => (…)` is the SAME
    // declaration the probe emits, so keeping it makes the match stricter. A
    // markup-only rule ("lines starting with <") does not survive the formatter —
    // measured: oxfmt collapses a single-element component to
    // `const AdwSpinner = () => <adw-spinner … />;`, which starts with `const`, and
    // the region came out EMPTY for all six leaf widgets.
    return lines.filter((line) => !line.startsWith('//'));
}

/**
 * The generated outputs `.oxfmtrc.json` must exempt, so the gate does not restate
 * them.
 *
 * `Gallery.vue` is deliberately absent: the config's blanket Vue pattern already
 * covers it, and listing it again would be an entry arm 7 could not distinguish
 * from a live one.
 */
export const OXFMT_EXEMPT_OUTPUTS = [
    'website/src/data/adwaita-framework-snippets.ts',
    'showcases/gtk/adwaita-gallery-solid/src/app.tsx',
    'showcases/gtk/adwaita-gallery-react/src/app.tsx',
    'showcases/gtk/adwaita-gallery-vue/src/app.ts',
];

/** Where each dialect's probe source lives, so the gate does not restate it. */
export const PROBE_SOURCES = {
    solid: 'showcases/gtk/adwaita-gallery-solid/src/app.tsx',
    react: 'showcases/gtk/adwaita-gallery-react/src/app.tsx',
    vue: 'showcases/gtk/adwaita-gallery-vue/src/Gallery.vue',
};

function snippetFor(tree, dialect) {
    const name = componentName(tree.widget);
    const note = tree.note === undefined ? '' : `${dialect === 'vue' ? `<!-- ${tree.note} -->` : `// ${tree.note}`}\n`;
    if (dialect === 'vue') {
        return `${note}<!-- ${name}.vue — mount(${name}, container) from '@gjsify/gtk-host/vue' -->
<template>
${markup(tree.root, 'vue', 1)}
</template>`;
    }
    const mount =
        dialect === 'solid'
            ? `// mount(() => <${name} />, container) — from '@gjsify/gtk-host/solid'`
            : `// createRoot(container).render(<${name} />) — from '@gjsify/gtk-host/react'`;
    // The SAME frame the probe emits around the same `markup()` call, so the two are
    // one string, not two that happen to agree.
    return `${note}${mount}\nconst ${name} = () => (\n${markup(tree.root, dialect, 1)}\n);`;
}

// ------------------------------------------------------------- website data file

function websiteData() {
    const rows = ADWAITA_GALLERY_TREES.map((tree) => {
        const entry = ['solid', 'vue', 'react']
            .map((d) => `${INDENT.repeat(2)}${d}: ${JSON.stringify(snippetFor(tree, d))},`)
            .join('\n');
        return `${INDENT}'${tree.widget}': {\n${entry}\n${INDENT}},`;
    }).join('\n');
    const refusals = Object.entries(ADWAITA_GALLERY_REFUSALS)
        .map(([widget, why]) => `${INDENT}'${widget}': ${JSON.stringify(why)},`)
        .join('\n');
    return `// GENERATED by scripts/generate-adwaita-framework-snippets.mjs — do not edit.
//
// The Solid, Vue and React snippet for every gallery block that has one, keyed by
// the block's \`<AdwWidget title="…">\`. Rendered by the component rather than
// written per page, for the reason \`AdwWidget.astro\` already gives about the
// attribute table: written per page, it did not survive.
//
// Every snippet in here was COMPILED AND RUN before it was written down —
// \`showcases/gtk/adwaita-gallery-{solid,vue,react}\` build this exact markup and
// assert the resulting widget tree against GTK, with the diagnostics gate on.

/** Snippet dialects, in the order the gallery shows them. */
export type FrameworkDialect = 'solid' | 'vue' | 'react';

/** Gallery block title -> its snippet in each dialect. */
export const ADWAITA_FRAMEWORK_SNIPPETS: Readonly<
    Record<string, Readonly<Record<FrameworkDialect, string>>>
> = {
${rows}
};

/**
 * Gallery blocks that deliberately have NO framework snippet, and why.
 *
 * Exported so a page can say so rather than leaving a reader to wonder: a missing
 * tab and a tab that cannot exist look identical, and only one of them is a fact.
 */
export const ADWAITA_FRAMEWORK_REFUSALS: Readonly<Record<string, string>> = {
${refusals}
};
`;
}

// ------------------------------------------------------------------- probe files

/** The expected tree, as the literal the probe walks. */
function expectedLiteral() {
    const node = (n, depth) => {
        const pad = INDENT.repeat(depth);
        const parts = [`tag: '${n.tag}'`, `gtype: '${gtypeOfTag(n.tag)}'`];
        if (n.slot !== undefined) parts.push(`slot: '${n.slot}'`);
        if (n.props !== undefined) parts.push(`props: ${JSON.stringify(n.props)}`);
        if (n.children !== undefined)
            parts.push(`children: [\n${n.children.map((c) => node(c, depth + 2)).join(',\n')}\n${pad}${INDENT}]`);
        return `${pad}{ ${parts.join(', ')} }`;
    };
    return ADWAITA_GALLERY_TREES.map(
        (t) => `${INDENT}{ widget: '${t.widget}', root:\n${node(t.root, 2)}\n${INDENT}},`,
    ).join('\n');
}

/**
 * The assertion driver, identical in all three probes.
 *
 * GENERATED into each package rather than shared through a fourth one: it is
 * emitted from this single template, so the copies are build output in the sense
 * `generated/props.ts` is, not three files anybody maintains. A shared module
 * would have to be a workspace package or a relative import across two showcase
 * boundaries, and both cost more than the bytes do.
 */
const DRIVER = `
/** \`AdwHeaderBar\` for an \`Adw.HeaderBar\` instance — the GType, not the JS class. */
const gtypeOf = (w: Gtk.Widget): string =>
    (w as unknown as { constructor: { $gtype?: { name: string } } }).constructor.$gtype?.name ?? '?';

/** Enum props are authored as GTK's own nicks and read back as ints. */
const NICKS: Record<string, Record<string, number>> = {
    orientation: { horizontal: Gtk.Orientation.HORIZONTAL, vertical: Gtk.Orientation.VERTICAL },
    halign: { fill: Gtk.Align.FILL, start: Gtk.Align.START, end: Gtk.Align.END, center: Gtk.Align.CENTER },
    valign: { fill: Gtk.Align.FILL, start: Gtk.Align.START, end: Gtk.Align.END, center: Gtk.Align.CENTER },
};

/**
 * A \`GMenuModel\` property against the portable model the tree declares (ADR 0042).
 *
 * The declared value is an ARRAY and what the widget holds is a \`Gio.MenuModel\`, so
 * \`!==\` would fail every time. Compared item by item on the two attributes GIO
 * actually stores — the label, and the action \`set_detailed_action\` parsed out — which
 * is what proves the ARRAY became a real menu rather than merely being accepted.
 */
function menuMatches(actual: unknown, expected: unknown): boolean {
    const model = actual as Gio.MenuModel | null;
    const declared = expected as Array<{ label?: string; action?: string }>;
    if (model === null || model === undefined) return false;
    if (model.get_n_items() !== declared.length) return false;
    for (let i = 0; i < declared.length; i += 1) {
        const label = model.get_item_attribute_value(i, 'label', null)?.get_string()[0];
        if (label !== declared[i].label) return false;
        // \`app.save-as\` is stored under \`action\`; a targeted one would also carry
        // \`target\`, and no gallery tree writes one.
        const action = model.get_item_attribute_value(i, 'action', null)?.get_string()[0];
        if (action !== declared[i].action) return false;
    }
    return true;
}

/** Does the REAL widget carry every property the tree declares? */
function propsMatch(widget: Gtk.Widget, props: Record<string, unknown> | undefined): boolean {
    for (const [name, expected] of Object.entries(props ?? {})) {
        if (name === 'cssClasses') {
            const have = widget.get_css_classes();
            if (!(expected as string[]).every((c) => have.includes(c))) return false;
            continue;
        }
        if (name === 'menuModel') {
            if (!menuMatches((widget as unknown as Record<string, unknown>)[name], expected)) return false;
            continue;
        }
        const actual = (widget as unknown as Record<string, unknown>)[name];
        const wanted = typeof expected === 'string' && NICKS[name] !== undefined ? NICKS[name][expected] : expected;
        if (actual !== wanted) return false;
    }
    return true;
}

/** Breadth-first, so the nearest match under a parent wins over a deeper one. */
function findUnused(root: Gtk.Widget, expect: Expect, used: Set<Gtk.Widget>): Gtk.Widget | null {
    const queue: Gtk.Widget[] = [root];
    while (queue.length > 0) {
        const widget = queue.shift() as Gtk.Widget;
        if (widget !== root && !used.has(widget) && gtypeOf(widget) === expect.gtype && propsMatch(widget, expect.props))
            return widget;
        for (let c = widget.get_first_child(); c !== null; c = c.get_next_sibling()) queue.push(c);
    }
    return null;
}

/**
 * The widget a slot HOLDS, when the parent has an exact getter for it.
 *
 * \`undefined\` means no getter exists and the caller has to search. Selecting
 * beats searching wherever it is possible, and not only for exactness: two
 * children of the same GType with no distinguishing props are indistinguishable to
 * a structural search, and the first one BFS reaches wins. MEASURED on
 * \`Adw.OverlaySplitView\`, whose sidebar and content are both a bare
 * \`<adw-toolbar-view>\`: the sidebar declaration matched the CONTENT widget, and
 * the failure surfaced four levels down as "its window title was not built" — a
 * true statement about the wrong widget, which is the most expensive kind.
 */
function slotChild(parent: Gtk.Widget, slot: string): Gtk.Widget | null | undefined {
    if (parent instanceof Adw.ToolbarView) return slot === 'content' ? parent.get_content() : undefined;
    if (parent instanceof Adw.HeaderBar) return slot === 'title' ? parent.get_title_widget() : undefined;
    if (parent instanceof Adw.OverlaySplitView || parent instanceof Adw.NavigationSplitView) {
        if (slot === 'sidebar') return parent.get_sidebar();
        if (slot === 'content') return parent.get_content();
    }
    return undefined;
}

/**
 * Whether a slot was honoured — EXACTLY where the widget has a getter for it.
 *
 * \`null\` means the slot has no readable counterpart (\`add_prefix\` and
 * \`add_suffix\` are write-only and libadwaita puts no marker class on either), and
 * the caller records that as unverified rather than as a pass. A slot asserted as
 * "the child is somewhere in the subtree" asserts nothing: that is true of every
 * slot the child could have gone into.
 */
function slotHonoured(parent: Gtk.Widget, slot: string, child: Gtk.Widget): boolean | null {
    if (parent instanceof Adw.ToolbarView) {
        // \`add_top_bar\`/\`add_bottom_bar\` are write-only and the height getters read
        // 0 until allocation, which a headless probe never does. The style class
        // libadwaita puts on the revealer it wraps each bar in is readable, and it
        // separates the two slots — measured on libadwaita 1.9 / gjs 1.88.1.
        for (let w: Gtk.Widget | null = child; w !== null && w !== parent; w = w.get_parent()) {
            const classes = w.get_css_classes();
            if (classes.includes('top-bar')) return slot === 'top';
            if (classes.includes('bottom-bar')) return slot === 'bottom';
        }
        return false;
    }
    if (parent instanceof Adw.HeaderBar) {
        // Same shape: \`pack_start\`/\`pack_end\` are write-only, and what is readable
        // is the Gtk.CenterBox libadwaita builds inside every header bar.
        let centerBox: Gtk.CenterBox | null = null;
        const queue: Gtk.Widget[] = [parent];
        while (queue.length > 0 && centerBox === null) {
            const w = queue.shift() as Gtk.Widget;
            if (w instanceof Gtk.CenterBox) centerBox = w;
            else for (let c = w.get_first_child(); c !== null; c = c.get_next_sibling()) queue.push(c);
        }
        if (centerBox === null) return false;
        const side = slot === 'start' ? centerBox.get_start_widget() : centerBox.get_end_widget();
        for (let w: Gtk.Widget | null = child; w !== null; w = w.get_parent()) if (w === side) return true;
        return false;
    }
    return null;
}

/** A stable signature of the REAL tree, so the three dialects can be compared. */
function signature(widget: Gtk.Widget, depth = 0): string {
    let out = \`\${'  '.repeat(depth)}\${gtypeOf(widget)}\\n\`;
    for (let c = widget.get_first_child(); c !== null; c = c.get_next_sibling()) out += signature(c, depth + 1);
    return out;
}

const hash = (text: string): string => {
    let h = 5381;
    for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    return h.toString(16);
};

/** Walk one declared tree against the widget the adapter actually built. */
function assertTree(expect: Expect, widget: Gtk.Widget, label: string, check: ProbeCheck, used: Set<Gtk.Widget>): void {
    used.add(widget);
    check(\`\${label}: is \${expect.gtype}\`, gtypeOf(widget) === expect.gtype);
    for (const [name, value] of Object.entries(expect.props ?? {})) {
        check(\`\${label}: \${name} reached GTK\`, propsMatch(widget, { [name]: value }));
    }
    for (const child of expect.children ?? []) {
        // SELECT before searching: a getter names the exact widget the slot holds,
        // which both proves the placement and removes the ambiguity a structural
        // search has between two same-typed children.
        const held = child.slot === undefined ? undefined : slotChild(widget, child.slot);
        if (held !== undefined) {
            check(\`\${label} > \${child.tag}: slot="\${child.slot}" holds it\`, held !== null);
            if (held === null) continue;
            assertTree(child, held, \`\${label} > \${child.tag}\`, check, used);
            continue;
        }
        const found = findUnused(widget, child, used);
        check(\`\${label} > \${child.tag}: built\`, found !== null);
        if (found === null) continue;
        if (child.slot !== undefined) {
            const honoured = slotHonoured(widget, child.slot, found);
            if (honoured === null) unverifiedSlots.push(\`\${label} > \${child.tag} slot="\${child.slot}"\`);
            else check(\`\${label} > \${child.tag}: slot="\${child.slot}" honoured\`, honoured);
        }
        assertTree(child, found, \`\${label} > \${child.tag}\`, check, used);
    }
}

const unverifiedSlots: string[] = [];

/** Assert every declared tree against the roots the adapter mounted, in order. */
function assertAll(container: Gtk.Widget, check: ProbeCheck): Record<string, unknown> {
    const roots: Gtk.Widget[] = [];
    for (let c = container.get_first_child(); c !== null; c = c.get_next_sibling()) roots.push(c);
    check(\`the adapter built \${EXPECTED.length} roots (saw \${roots.length})\`, roots.length === EXPECTED.length);

    const signatures: Record<string, string> = {};
    for (let i = 0; i < EXPECTED.length && i < roots.length; i += 1) {
        const expect = EXPECTED[i];
        assertTree(expect.root, roots[i], expect.widget, check, new Set<Gtk.Widget>());
        signatures[expect.widget] = hash(signature(roots[i]));
    }
    return { widgets: EXPECTED.length, unverifiedSlots: unverifiedSlots.length, signatures };
}
`;

/** The shared head of every probe: the tree literal plus the driver. */
function probeCore() {
    return `/**
 * What each adapter hands back.
 *
 * \`root\` is the ONE box holding the 18 gallery roots; \`owner\` is what has to be
 * disposed and presented, and the two differ by adapter: Solid builds the box
 * itself, while Vue and React render INTO a container, so their owner is that
 * container and the box is its first child. Keeping both is what lets the
 * assertions and the teardown each look at the right widget.
 */
interface Ui {
    readonly root: Gtk.Widget;
    readonly owner: Gtk.Widget;
    readonly app: Adw.Application | null;
}

/**
 * The GUI path. The window belongs to the APPLICATION and is never a free
 * toplevel: \`scripts/showcase-smoke.mjs\` launches this showcase and greps for
 * GJS's fatal markers, and a toplevel with no application is a Gtk-WARNING at
 * exit 0 — the shape that gate exists to catch.
 */
function present(ui: Ui, dialect: string): void {
    const window = new Adw.ApplicationWindow({
        application: ui.app ?? undefined,
        title: \`Adwaita gallery — \${dialect}\`,
        defaultWidth: 640,
        defaultHeight: 760,
    });
    const scroller = new Gtk.ScrolledWindow({ propagateNaturalHeight: true });
    scroller.set_child(ui.owner);
    window.set_content(scroller);
    window.present();
}

interface Expect {
    readonly tag: string;
    readonly gtype: string;
    readonly slot?: string;
    readonly props?: Record<string, unknown>;
    readonly children?: readonly Expect[];
}

/** Every gallery tree this probe builds, from \`scripts/adwaita-gallery-trees.mjs\`. */
const EXPECTED: readonly { widget: string; root: Expect }[] = [
${expectedLiteral()}
];
${DRIVER}`;
}

const GENERATED_BANNER = (dialect) =>
    `// GENERATED by scripts/generate-adwaita-framework-snippets.mjs — do not edit.
//
// Every gallery block that carries a ${dialect} snippet, in ONE tree, compiled by
// this showcase's own build and asserted against the real GTK widget tree. The
// markup below is the SAME TEXT the website ships in
// \`website/src/data/adwaita-framework-snippets.ts\` — that is the whole point of
// generating both from \`scripts/adwaita-gallery-trees.mjs\`: a snippet nobody ran
// is a claim, and this file is what turns it into a measurement.`;

function solidProbe() {
    const components = ADWAITA_GALLERY_TREES.map(
        (t) => `const ${componentName(t.widget)} = () => (\n${markup(t.root, 'solid', 1)}\n);`,
    ).join('\n\n');
    const uses = ADWAITA_GALLERY_TREES.map((t) => `${INDENT.repeat(2)}<${componentName(t.widget)} />`).join('\n');
    return `${GENERATED_BANNER('Solid')}

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { createRoot } from 'solid-js';

import { registerBuiltinWidgets, runHostProbeApp, type ProbeCheck } from '@gjsify/gtk-host';
import { widgetOf } from '@gjsify/gtk-host/solid';
import type { HostNode } from '@gjsify/gtk-host';

registerBuiltinWidgets();

${components}

/** Every gallery snippet in one column, so one mount carries them all. */
const Gallery = () => (
${INDENT}<gtk-box orientation="vertical" spacing={24}>
${uses}
${INDENT}</gtk-box>
);

${probeCore()}
await runHostProbeApp<Ui>({
${INDENT}applicationId: 'eu.jumplink.AdwaitaGallerySolid',
${INDENT}// \`createRoot\`, not bare JSX: a computation created without an owner is never
${INDENT}// disposed, Solid says so on stderr, and the harness counts stderr.
${INDENT}build: (app) => {
${INDENT.repeat(2)}const root = createRoot(() => widgetOf((<Gallery />) as HostNode));
${INDENT.repeat(2)}return { root, owner: root, app };
${INDENT}},
${INDENT}assert: (ui, check) => assertAll(ui.root, check),
${INDENT}teardown: (ui) => ui.owner.run_dispose(),
${INDENT}present: (ui) => present(ui, 'Solid'),
});
`;
}

function reactProbe() {
    const components = ADWAITA_GALLERY_TREES.map(
        (t) => `const ${componentName(t.widget)} = () => (\n${markup(t.root, 'react', 1)}\n);`,
    ).join('\n\n');
    const uses = ADWAITA_GALLERY_TREES.map((t) => `${INDENT.repeat(2)}<${componentName(t.widget)} />`).join('\n');
    return `${GENERATED_BANNER('React')}

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { registerBuiltinWidgets, runHostProbeApp, type ProbeCheck } from '@gjsify/gtk-host';
import { createRoot, flushSync } from '@gjsify/gtk-host/react';

registerBuiltinWidgets();

${components}

/** Every gallery snippet in one column, so one root carries them all. */
const Gallery = () => (
${INDENT}<gtk-box orientation="vertical" spacing={24}>
${uses}
${INDENT}</gtk-box>
);

${probeCore()}
await runHostProbeApp<Ui>({
${INDENT}applicationId: 'eu.jumplink.AdwaitaGalleryReact',
${INDENT}build: (app) => {
${INDENT.repeat(2)}// React renders INTO a container: a toplevel is not a child of anything, so
${INDENT.repeat(2)}// the container is a plain box and the window is the application's.
${INDENT.repeat(2)}const container = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
${INDENT.repeat(2)}const root = createRoot(container);
${INDENT.repeat(2)}// SYNCHRONOUS on purpose: \`resolveUpdatePriority\` returns the default lane, so
${INDENT.repeat(2)}// an ordinary render is handed to the scheduler and lands on a GLib timer —
${INDENT.repeat(2)}// the assertions would read an empty box. \`flushSync\` is the documented way
${INDENT.repeat(2)}// to make the commit happen before the call returns.
${INDENT.repeat(2)}flushSync(() => root.render(<Gallery />));
${INDENT.repeat(2)}return { root: container.get_first_child() as Gtk.Widget, owner: container, app };
${INDENT}},
${INDENT}assert: (ui, check) => assertAll(ui.root, check),
${INDENT}teardown: (ui) => ui.owner.run_dispose(),
${INDENT}present: (ui) => present(ui, 'React'),
});
`;
}

function vueSfc() {
    const uses = ADWAITA_GALLERY_TREES.map((t) => markup(t.root, 'vue', 2)).join('\n');
    return `<!-- GENERATED by scripts/generate-adwaita-framework-snippets.mjs — do not edit.

     Every gallery block that carries a Vue snippet, in ONE single-file component,
     compiled by \`@gjsify/rolldown-plugin-vue\` and asserted against the real GTK
     widget tree. The markup is the SAME TEXT the website ships. -->
<template>
${INDENT}<gtk-box orientation="vertical" :spacing="24">
${uses}
${INDENT}</gtk-box>
</template>
`;
}

function vueEntry() {
    return `${GENERATED_BANNER('Vue')}

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { registerBuiltinWidgets, runHostProbeApp, type ProbeCheck } from '@gjsify/gtk-host';
import { mount } from '@gjsify/gtk-host/vue';

import Gallery from './Gallery.vue';

registerBuiltinWidgets();

${probeCore()}
await runHostProbeApp<Ui>({
${INDENT}applicationId: 'eu.jumplink.AdwaitaGalleryVue',
${INDENT}build: (app) => {
${INDENT.repeat(2)}// Vue mounts INTO a container, so the container is a plain box: an
${INDENT.repeat(2)}// \`adw-application-window\` at the root of a template would ask GTK to parent
${INDENT.repeat(2)}// a toplevel and earn a Gtk-WARNING at exit 0.
${INDENT.repeat(2)}const container = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
${INDENT.repeat(2)}mount(Gallery, container);
${INDENT.repeat(2)}return { root: container.get_first_child() as Gtk.Widget, owner: container, app };
${INDENT}},
${INDENT}assert: (ui, check) => assertAll(ui.root, check),
${INDENT}teardown: (ui) => ui.owner.run_dispose(),
${INDENT}present: (ui) => present(ui, 'Vue'),
});
`;
}

// ------------------------------------------------------------------------- main

/**
 * Every committed output, built ON DEMAND.
 *
 * A function and not a top-level array, for the same reason `RUN_AS_PROGRAM` below
 * exists: `check-generated-website-data.mjs` IMPORTS this module for `snippetLines`
 * and `PROBE_SOURCES`, and whatever the module body does, it does during that
 * import. The array version rendered all five files on import — which is how the
 * formatter's `ENOENT` became a crash inside a gate that never asked for a file to
 * be written. An import should cost a definition, nothing else.
 */
const buildOutputs = () => [
    ['website/src/data/adwaita-framework-snippets.ts', websiteData()],
    [PROBE_SOURCES.solid, solidProbe()],
    [PROBE_SOURCES.react, reactProbe()],
    [PROBE_SOURCES.vue, vueSfc()],
    ['showcases/gtk/adwaita-gallery-vue/src/app.ts', vueEntry()],
];

/**
 * ONLY when run as a program.
 *
 * MEASURED, and it is the reason this guard exists rather than a convention:
 * `check-generated-website-data.mjs` imports `snippetLines` and `PROBE_SOURCES`
 * from this module, and without the guard that import RAN the writer — with the
 * gate's own `process.argv`, which carries no `--check`. So the gate silently
 * rewrote every generated file back to source before looking at it, and a
 * hand-edited probe passed. A check that repairs what it is about to check is the
 * most expensive shape in this repository, and it was one import away.
 */
const RUN_AS_PROGRAM = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

const check = process.argv.includes('--check');
const outputs = RUN_AS_PROGRAM ? buildOutputs() : [];
let drifted = 0;
for (const [rel, content] of outputs) {
    const file = join(ROOT, rel);
    let current = null;
    try {
        current = readFileSync(file, 'utf8');
    } catch {
        current = null;
    }
    if (current === content) continue;
    if (check) {
        drifted += 1;
        console.error(`drift: ${rel} — re-run \`node scripts/generate-adwaita-framework-snippets.mjs\``);
        continue;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    console.log(`wrote ${rel}`);
}
if (RUN_AS_PROGRAM && check) {
    if (drifted > 0) process.exit(1);
    console.log(`generated snippets are current (${outputs.length} files, ${ADWAITA_GALLERY_TREES.length} widgets)`);
}
