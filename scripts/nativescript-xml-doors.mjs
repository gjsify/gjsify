// What NativeScript's XML Builder can and cannot reach in `@gjsify/adwaita-nativescript`,
// read out of the widget sources.
//
// A LIBRARY, not a program: it defines readers and returns findings, and it writes
// nothing and exits nothing. Two callers share it — `check-nativescript-xml-doors.mjs`
// holds the whole package, `check-generated-website-data.mjs` holds the gallery
// templates against the same facts — and a second parser would be a second truth about
// the same source.
//
// THE TWO DOORS, and why a reader has to know the difference
//
//   · An ATTRIBUTE. `ui/builder/component-builder`'s `setPropertyValue` ends in
//     `instance[name] = value` for a plain accessor, so the setter receives a STRING.
//     A setter whose DECLARED type is `number` or `boolean` must therefore coerce.
//   · A CHILD. `LayoutBaseCommon._addChildFromBuilder` ignores the name and calls
//     `addChild`, so a widget that wants a child anywhere but its layout's first cell
//     has to override it.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Where the widget classes live, relative to the repo root. */
export const NS_WIDGETS_DIR = 'packages/nativescript-bridge/adwaita/src/widgets';

/**
 * Where a setter's type ALIASES are declared.
 *
 * The widgets are not self-contained here: `AdwButtonVariant` is
 * `'default' | AdwButtonStyleClass`, and that second half is a headless type in
 * `@gjsify/adwaita-core` derived from an `as const` array. A resolver that stopped at
 * the widget directory answered "not a string" for a type that is nothing but strings,
 * and every `<AdwButton variant="pill">` in the gallery failed a check that was wrong.
 */
export const NS_TYPE_DIRS = [
    NS_WIDGETS_DIR,
    'packages/nativescript-bridge/adwaita/src',
    'packages/web/adwaita-core/src',
];

/**
 * Modules under `widgets/` that declare a class but are NOT reachable from XML.
 *
 * Checked back like every exemption here: an entry that stops declaring a class, or
 * that turns up in the `ELEMENTS` map, fails rather than sitting there.
 */
export const NOT_AN_XML_WIDGET = {
    'split-view-state.ts': 'a headless state machine, driven from a widget — it has no element name.',
};

/**
 * Functions that already take what XML hands over, so a setter delegating to one needs
 * no `xmlNumber`/`xmlBoolean` of its own.
 *
 * Each is VERIFIED against its own declaration, not trusted: `stringTolerant()` reads
 * the signature and fails if the first parameter stops accepting a `string`. They exist
 * because they are LOOSER than `xmlNumber` on purpose — both `Number.parseFloat`, so
 * `size="24px"` and `maximum-size="50%"` are lengths rather than garbage. Wrapping them
 * in `xmlNumber` narrowed exactly that, which is why it was undone.
 */
export const STRING_TOLERANT = {
    resolveSpinnerSize: 'packages/web/adwaita-core/src/chrome.ts',
    normalizeClampSize: 'packages/web/adwaita-core/src/chrome.ts',
    normalizeClampProp: `${NS_WIDGETS_DIR}/chrome.ts`,
};

/** The coercers this package's own door is made of. */
export const COERCERS = { number: 'xmlNumber', boolean: 'xmlBoolean' };

/**
 * NativeScript accessors that have a SETTER and no getter.
 *
 * A getter of the same name on a subclass shadows the setter, and assignment then
 * throws in strict mode — which every NativeScript bundle is. MEASURED: `rows` and
 * `columns` on `GridLayoutBase` (whose getters are `rowsInternal`/`columnsInternal`)
 * are the only two on the bases this package extends, across `View`, `ViewBase`,
 * `LayoutBase`, `StackLayout`, `FlexboxLayout`, `ScrollView`, `ContentView`,
 * `TextBase`, `Button` and `Image`. `AdwExpanderRow` added `get rows()` and broke
 * `expanderRow.rows = 'auto,*'` for apps that never touch XML.
 */
export const SETTER_ONLY_ON_BASE = {
    rows: 'GridLayoutBase.rows is setter-only (its getter is `rowsInternal`).',
    columns: 'GridLayoutBase.columns is setter-only (its getter is `columnsInternal`).',
};

/** Strip comments, so a coercer NAMED in prose is not mistaken for one that runs. */
export const executable = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * Every source a type alias might be declared in — the widgets plus the headless core.
 *
 * Flat, one level deep per directory: these two trees keep their types at the top of a
 * module, and walking deeper would pull in `lib/` build output, where a stale copy of
 * the same alias would answer first.
 */
export function readTypeSources(root) {
    const texts = [];
    const seen = new Set();
    for (const dir of NS_TYPE_DIRS) {
        let entries = [];
        try {
            entries = readdirSync(join(root, dir));
        } catch {
            continue;
        }
        for (const file of entries) {
            if (!file.endsWith('.ts') || file.endsWith('.spec.ts')) continue;
            const abs = join(root, dir, file);
            if (seen.has(abs)) continue;
            seen.add(abs);
            try {
                texts.push(readFileSync(abs, 'utf8'));
            } catch {
                // A directory entry that is not a readable file is simply not a source.
            }
        }
    }
    return texts;
}

/** Every widget source, indexed by the class it declares. */
export function readWidgets(root) {
    const sources = new Map();
    const files = new Map();
    for (const file of readdirSync(join(root, NS_WIDGETS_DIR)).filter((f) => f.endsWith('.ts'))) {
        if (file.endsWith('.spec.ts')) continue;
        const text = readFileSync(join(root, NS_WIDGETS_DIR, file), 'utf8');
        files.set(file, text);
        // The file NAME is not the class name for every widget — `AdwSplitViewBase`
        // lives in `split-view-base.ts` — so the index is built from the declarations.
        for (const [, name] of text.matchAll(/export (?:abstract )?class (Adw\w+)/g)) sources.set(name, { file, text });
    }
    return { sources, files };
}

/** The `ELEMENTS` map in the widgets barrel: what the port offers for XML use. */
export function readElements(root) {
    const text = readFileSync(join(root, NS_WIDGETS_DIR, 'index.ts'), 'utf8');
    const block = /const ELEMENTS = \{([\s\S]*?)\n\} as const;/.exec(text);
    return new Set(block === null ? [] : [...block[1].matchAll(/^\s{4}(Adw\w+),/gm)].map((m) => m[1]));
}

/** A class and every ancestor of it inside this package, nearest first. */
export function chainOf(sources, tag) {
    const chain = [];
    for (let name = tag; name !== undefined && sources.has(name);) {
        const { text } = sources.get(name);
        chain.push(text);
        name = new RegExp(`export (?:abstract )?class ${name}\\b[^{]*?extends (Adw\\w+)`).exec(text)?.[1];
    }
    return chain;
}

/**
 * One setter, as the DECLARED type it accepts and the code that runs.
 *
 * The declared type is the key everything else turns on, and it is the correction of a
 * real hole: keying on the JS literal in a template instead meant `{ flat: 'false' }`
 * and `{ flat: false }` emitted byte-identical XML while only one of them was checked.
 * What an attribute may carry is a property of the WIDGET, never of how a template
 * happened to spell it.
 */
export function setterOf(sources, tag, name) {
    for (const text of chainOf(sources, tag)) {
        const found = new RegExp(`^ {4}set ${name}\\((\\w+): ([^)]+)\\) \\{`, 'm').exec(text);
        if (found === null) continue;
        const body = text.slice(found.index, text.indexOf('\n    }', found.index));
        return { annotation: found[2].trim(), body, executable: executable(body) };
    }
    return null;
}

/**
 * Is this type nothing but strings, as far as an XML attribute is concerned?
 *
 * Two forms carry the whole package: a union whose members are string literals or other
 * such aliases, and `(typeof ARRAY)[number]` over an `as const` array of string
 * literals — which is how `@gjsify/adwaita-core` spells its style-class sets. Anything
 * else answers `false`, including a type this reader simply cannot see: a resolver that
 * guessed would be the one thing worse than a strict one, because the guess would be
 * "an attribute can carry it".
 */
function stringUnion(texts, name, seen = new Set()) {
    if (seen.has(name)) return false;
    seen.add(name);
    for (const text of texts) {
        const decl = new RegExp(`export type ${name} =([^;]+);`).exec(text);
        if (decl === null) continue;
        const rhs = decl[1].trim();
        const derived = /^\(typeof (\w+)\)\[number\]$/.exec(rhs);
        if (derived !== null) {
            for (const source of texts) {
                const arr = new RegExp(`const ${derived[1]} = \\[([^\\]]*)\\]`).exec(source);
                if (arr === null) continue;
                const items = arr[1]
                    .split(',')
                    .map((i) => i.trim())
                    .filter((i) => i !== '');
                return items.length > 0 && items.every((i) => /^'[^']*'$/.test(i));
            }
            return false;
        }
        return rhs
            .split('|')
            .map((part) => part.trim())
            .filter((part) => part !== '' && part !== 'null' && part !== 'undefined')
            .every((part) => part === 'string' || /^'[^']*'$/.test(part) || stringUnion(texts, part, seen));
    }
    return false;
}

/**
 * `'number'`, `'boolean'`, `'string'` — or `null` when an attribute cannot carry it.
 *
 * This is the KEY the whole coercion rule turns on, and it is a property of the WIDGET.
 * Keying on the JS literal a template happened to write instead left a hole the size of
 * the defect: `{ flat: 'false' }` and `{ flat: false }` emit byte-identical XML, and
 * only one of the two was ever checked.
 */
export function attributeKind(sources, texts, annotation) {
    if (/\bnumber\b/.test(annotation)) return 'number';
    if (/\bboolean\b/.test(annotation)) return 'boolean';
    const parts = annotation
        .split('|')
        .map((p) => p.trim())
        .filter((p) => p !== 'null' && p !== 'undefined');
    if (parts.length === 0) return null;
    const list = [...texts];
    if (parts.every((p) => p === 'string' || /^'[^']*'$/.test(p) || stringUnion(list, p))) return 'string';
    return null;
}

/**
 * Every member a class declares, its in-package ancestors included.
 *
 * Getters, setters and methods in one set, because a refusal reason names a member the
 * way a reader would — `AdwDropDown.options`, `AdwToastOverlay.showToast` — without
 * caring which of the three it is.
 */
export function membersOf(sources, tag) {
    const members = new Set();
    for (const text of chainOf(sources, tag)) {
        for (const [, name] of text.matchAll(/^ {4}(?:get|set) (\w+)[(<]/gm)) members.add(name);
        for (const [, name] of text.matchAll(/^ {4}(?:async )?(\w+)\(/gm)) members.add(name);
    }
    return members;
}

/** Does the setter actually put the value through something that accepts a string? */
export function coerces(setter, kind) {
    if (kind === 'string') return true;
    if (setter.executable.includes(`${COERCERS[kind]}(`)) return true;
    return Object.keys(STRING_TOLERANT).some((fn) => setter.executable.includes(`${fn}(`));
}

/** Every `STRING_TOLERANT` entry really does declare a `string` in its first parameter. */
export function stringTolerant(root) {
    const problems = [];
    for (const [fn, rel] of Object.entries(STRING_TOLERANT)) {
        let text = null;
        try {
            text = readFileSync(join(root, rel), 'utf8');
        } catch {
            problems.push(`STRING_TOLERANT names ${fn} in ${rel}, which is not readable.`);
            continue;
        }
        const decl = new RegExp(`export function ${fn}\\(\\s*\\w+: ([^,)]+)`).exec(text);
        if (decl === null) {
            problems.push(`STRING_TOLERANT names ${fn}, which ${rel} does not export as a function.`);
            continue;
        }
        if (!/\bstring\b/.test(decl[1])) {
            problems.push(
                `STRING_TOLERANT names ${fn}, whose first parameter is \`${decl[1].trim()}\` — it no longer ` +
                    'accepts a string, so a setter delegating to it hands GObject the raw attribute.',
            );
        }
    }
    return problems;
}
