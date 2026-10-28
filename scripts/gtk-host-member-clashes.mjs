// The readers behind `check-gtk-host-member-clashes.mjs`: what a GTK property is called on each
// port class, and which of those names a platform base already owns.
//
// Kept apart from the check so its self-test can hand each reader a broken input and watch the
// arm fail, as `nativescript-xml-doors.mjs` is kept apart from its check.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Where the port classes live, per package. */
export const NS_WIDGET_DIRS = [
    'packages/nativescript-bridge/adwaita/src/widgets',
    'packages/nativescript-bridge/gtksource/src',
];

export const GIR_PROPS = 'packages/framework/gtk-host/src/generated/props.ts';
export const NS_SNAPSHOT = 'status/nativescript-base-members.json';
export const NS_TABLE = 'packages/nativescript-bridge/adwaita/src/widgets/shadowed-properties.ts';
/** The NativeScript XML writer, which refuses the shadowed names by its own literal list. */
export const MARKUP = 'packages/web/adwaita-core/src/markup.ts';
// The elements' shared base (`WidgetElement`) sits beside them; without it every chain ends at a
// name the walk does not know and the web arm measures nothing.
export const WEB_ELEMENT_DIRS = [
    'packages/web/adwaita-web/src/elements',
    'packages/web/adwaita-web/src/widget-element.ts',
];
export const DOM_SNAPSHOT = 'status/html-element-members.json';

/** `kebab` / `snake` / `camel` → camel, as `propertyOf` spells a GObject property. */
export const camel = (name) => name.replace(/[-_]([a-z0-9])/g, (_, c) => c.toUpperCase());

/** camel → the snake case of a GObject accessor (`set_<snake>`). */
export const snake = (name) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/**
 * Every `<X>Props` interface of the generated GIR surface: its own camel-case properties and
 * the interfaces it extends. The quoted kebab spellings are the same properties again and are
 * skipped.
 */
export function readGirProps(text) {
    const interfaces = new Map();
    const head = /^export interface (\w+)Props(?:\s+extends\s+([^{]+))?\s*\{\n([\s\S]*?)^\}/gm;
    for (const [, name, parents = '', body] of text.matchAll(head)) {
        const props = [...body.matchAll(/^ {4}(\w+)\??:/gm)].map(([, prop]) => prop);
        const bases = parents
            .split(',')
            .map((base) => base.trim().replace(/Props$/, ''))
            .filter((base) => base !== '');
        interfaces.set(name, { props, bases });
    }
    return interfaces;
}

/** The GIR properties of `type`, inherited ones included, each with the type that declares it. */
export function girPropsOf(interfaces, type) {
    const found = new Map();
    const visit = (name) => {
        const iface = interfaces.get(name);
        if (iface === undefined) return;
        for (const prop of iface.props) if (!found.has(prop)) found.set(prop, name);
        for (const base of iface.bases) visit(base);
    };
    visit(type);
    return found;
}

/**
 * The classes of a port source: name, the expression it extends, its GType name and the
 * accessors it declares itself. Comments are stripped first, so a class NAMED in prose is not
 * read as one that exists.
 */
export function readPortClasses(file, text) {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const classes = [];
    // `extends withSignals(\n    GridLayout,\n)` is the same head as the one-line form, and so is
    // `withSignals(GridLayout, {` — the declaration object opens where the call would close.
    const head =
        /^export (?:abstract )?class (\w+)(?:<[^{]*?>)? extends ([\w.]+)(?:<[^(]*?>)?(?:\(\s*(\w+)\s*(?:,\s*\{|,?\s*\)))?/gm;
    const starts = [...code.matchAll(head)];
    for (const [index, match] of starts.entries()) {
        const [, name, outer, inner] = match;
        const body = code.slice(match.index, starts[index + 1]?.index ?? code.length);
        const gtype = /static readonly GTypeName(?::\s*string)?\s*=\s*'(\w+)'/.exec(body)?.[1] ?? null;
        const accessors = new Set([...body.matchAll(/^ {4}(?:override )?(?:get|set) (\w+)\(/gm)].map(([, n]) => n));
        const methods = new Set([...body.matchAll(/^ {4}(?:override )?(\w+)\(/gm)].map(([, n]) => n));
        // `ConstructProps<Self, { direction: … }>` — the GTK properties the class carries under a
        // name the platform owns, so they took no accessor.
        const bag = /ConstructProps<\s*\w+\s*,\s*\{([\s\S]*?)\}\s*,?\s*>/.exec(body)?.[1] ?? '';
        const shadowed = new Set([...bag.matchAll(/(\w+)\??:/g)].map(([, n]) => n));
        classes.push({
            file,
            name,
            base: inner ?? outer,
            wrapper: inner === undefined ? null : outer,
            gtype,
            accessors,
            methods,
            shadowed,
        });
    }
    return classes;
}

/** Every port class of every package in `dirs`, keyed by class name. */
export function readAllPortClasses(root, dirs = NS_WIDGET_DIRS) {
    const all = new Map();
    for (const dir of dirs) {
        // An entry is a directory of class files, or one file.
        const files = dir.endsWith('.ts') ? [dir] : readdirSync(join(root, dir)).map((entry) => join(dir, entry));
        for (const file of files) {
            if (!file.endsWith('.ts') || file.endsWith('.d.ts') || file.includes('.spec.')) continue;
            const text = readFileSync(join(root, file), 'utf8');
            // `import { View as NsView }` — the local alias of a platform class.
            const aliases = new Map([...text.matchAll(/\b(\w+) as (\w+)\b/g)].map(([, real, local]) => [local, real]));
            for (const cls of readPortClasses(file, text)) {
                all.set(cls.name, { ...cls, base: aliases.get(cls.base) ?? cls.base });
            }
        }
    }
    return all;
}

/**
 * The platform class a port class lands on, walking port bases first; `null` when the chain
 * leaves the port at a name the snapshot does not hold.
 */
export function platformBaseOf(classes, snapshot, name) {
    const seen = new Set();
    let current = classes.get(name);
    while (current !== undefined && !seen.has(current.name)) {
        seen.add(current.name);
        if (Object.hasOwn(snapshot.classes, current.base)) return current.base;
        current = classes.get(current.base);
    }
    return null;
}

/** The port classes from `name` up to the platform, nearest first. */
export function portChainOf(classes, name) {
    const chain = [];
    for (let current = classes.get(name); current !== undefined; current = classes.get(current.base)) {
        if (chain.includes(current)) break;
        chain.push(current);
    }
    return chain;
}

/**
 * Every `Declarer.property` where a GTK-side property of a port class has a name its platform
 * base already declares. The GTK side is the class's GIR properties (inherited ones included)
 * plus the accessors the port declares itself — a property the port invented is still a
 * property a consumer writes by that name.
 */
export function clashesOf(classes, interfaces, snapshot) {
    const clashes = new Map();
    for (const cls of classes.values()) {
        const platform = platformBaseOf(classes, snapshot, cls.name);
        if (platform === null) continue;
        const members = new Set(snapshot.classes[platform]);
        const chain = portChainOf(classes, cls.name);
        const gtype = chain.find((link) => link.gtype !== null)?.gtype ?? null;
        const gtk = gtype === null ? new Map() : girPropsOf(interfaces, gtype);
        for (const link of chain) {
            const declarer = link.gtype ?? link.name;
            for (const accessor of link.accessors) if (!gtk.has(accessor)) gtk.set(accessor, declarer);
            // The bag's shadowed keys are the port's properties too, once their accessor is gone.
            // A bare `get_<p>` / `set_<p>` pair is not: `GtkWindow.get_focus` and
            // `GtkWidget.set_direction` are GTK methods, not properties.
            for (const prop of link.shadowed) if (!gtk.has(prop)) gtk.set(prop, declarer);
        }
        for (const [prop, declarer] of gtk) {
            if (!members.has(prop)) continue;
            const key = `${declarer}.${prop}`;
            if (!clashes.has(key)) clashes.set(key, { platform, classes: new Set(), implementers: new Set() });
            clashes.get(key).classes.add(cls.name);
            if (chain.some((link) => link.accessors.has(prop))) clashes.get(key).implementers.add(cls.name);
        }
    }
    return clashes;
}

/**
 * The web arm's view of the same question: each custom element is a port class whose platform
 * base is `HTMLElement`, and its GType is its class name (`AdwSplitButton` is `<adw-split-button>`).
 */
export function webClashesOf(classes, interfaces, members) {
    const named = new Map(
        [...classes].map(([name, cls]) => [name, { ...cls, gtype: cls.gtype ?? (interfaces.has(name) ? name : null) }]),
    );
    return clashesOf(named, interfaces, { classes: { HTMLElement: members } });
}

/**
 * The decided names of `shadowed-properties.ts`: each `SHADOWED_PROPERTIES` entry's `routed`
 * and `refused` GType lists, and each `SHARED_PROPERTIES` entry's `declarer`. Read as text —
 * the job running the check has no TypeScript — and strictly: an entry the reader cannot spell
 * is an error, not a skip.
 */
export function readShadowedTable(text) {
    const block = (name) => {
        const start = text.indexOf(`export const ${name} = {`);
        if (start === -1) throw new Error(`${name} is not declared`);
        const end = text.indexOf('\n} as const', start);
        if (end === -1) throw new Error(`${name} does not end in \`} as const\``);
        return text.slice(start, end);
    };
    const entries = (body) => {
        const found = new Map();
        const heads = [...body.matchAll(/^ {4}(\w+): \{$/gm)];
        for (const [index, head] of heads.entries()) {
            found.set(head[1], body.slice(head.index, heads[index + 1]?.index ?? body.length));
        }
        return found;
    };
    const list = (entry, field) => {
        const match = new RegExp(`^ {8}${field}: \\[([^\\]]*)\\],$`, 'm').exec(entry);
        if (match === null) throw new Error(`no \`${field}: [...]\` list`);
        return [...match[1].matchAll(/'(\w+)'/g)].map(([, name]) => name);
    };
    const shadowed = new Map();
    for (const [prop, entry] of entries(block('SHADOWED_PROPERTIES'))) {
        try {
            shadowed.set(prop, { routed: list(entry, 'routed'), refused: list(entry, 'refused') });
        } catch (error) {
            throw new Error(`SHADOWED_PROPERTIES.${prop}: ${error.message}`);
        }
    }
    const shared = new Map();
    for (const [prop, entry] of entries(block('SHARED_PROPERTIES'))) {
        const declarer = /^ {8}declarer: '(\w+)',$/m.exec(entry)?.[1];
        if (declarer === undefined) throw new Error(`SHARED_PROPERTIES.${prop}: no \`declarer: '…'\``);
        shared.set(prop, { declarer });
    }
    return { shadowed, shared };
}

/** Every `Declarer.prop` the table decides, in the shape {@link clashesOf} keys by. */
export function tableKeys({ shadowed, shared }) {
    const keys = new Set();
    for (const [prop, { routed, refused }] of shadowed) {
        for (const gtype of [...routed, ...refused]) keys.add(`${gtype}.${prop}`);
    }
    for (const [prop, { declarer }] of shared) keys.add(`${declarer}.${prop}`);
    return keys;
}
