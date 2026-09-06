// What NativeScript's XML Builder can and cannot reach in `@gjsify/adwaita-nativescript`,
// read out of the widget sources.
//
// A LIBRARY, not a program: it defines readers and returns findings, and it writes
// nothing and exits nothing. Two callers share it — `check-nativescript-xml-doors.mjs`
// holds the whole package, `check-generated-website-data.mjs` holds the gallery
// templates against the same facts — and a second parser would be a second truth about
// the same source.
//
// THE THREE DOORS, and why a reader has to know the difference
//
//   · An ATTRIBUTE. `ui/builder/component-builder`'s `setPropertyValue` ends in
//     `instance[name] = value` for a plain accessor, so the setter receives a STRING.
//     A setter whose DECLARED type is `number` or `boolean` must therefore coerce.
//   · A CHILD. `LayoutBaseCommon._addChildFromBuilder` ignores the name and calls
//     `addChild`, so a widget that wants a child anywhere but its layout's first cell
//     has to override it.
//   · A CONSTRUCT-PROPS BAG (ADR 0034 § 4). The optional first parameter a TypeScript
//     caller passes, which the XML builder never does — it calls `new instanceType()`
//     with no arguments. It is a door because it reaches the same setters from a second
//     side: a value arriving through it is a real JS value rather than a string, so a
//     setter must NOT widen its declared type to admit an enum constant — that would
//     drag the number into the ATTRIBUTE door, where it has no coercer.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { stripComments } from '../packages/infra/manifest-conformance/lib/strip-comments.mjs';
import { namespaceExport } from './adwaita-elements.mjs';

/** Where the widget classes live, relative to the repo root. */
export const NS_WIDGETS_DIR = 'packages/nativescript-bridge/adwaita/src/widgets';

/** The package's `src`, where the clause-2 namespace barrels are re-exported from. */
export const NS_PACKAGE_SRC = 'packages/nativescript-bridge/adwaita/src';

/**
 * Where a setter's type ALIASES are declared.
 *
 * The widgets are not self-contained here. The incident was `AdwButtonVariant`, which was
 * `'default' | AdwButtonStyleClass` with that second half a headless type in
 * `@gjsify/adwaita-core` derived from an `as const` array: a resolver that stopped at the
 * widget directory answered "not a string" for a type that is nothing but strings, and
 * every `<GtkButton variant="pill">` in the gallery failed a check that was wrong. That
 * type is GONE since ADR 0049 — the third entry is not. Removing it moves the count of
 * setters "typed as something no XML attribute can carry" from 19 to 33, so fourteen other
 * doors still resolve through `adwaita-core`.
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

/**
 * The JSON doors: a setter whose value is an OBJECT reaches XML as one of these.
 *
 * A THIRD kind beside `number` and `boolean`, and it exists because a portable VALUE is
 * not a primitive. `AdwSpinRow.adjustment` takes `Gtk.Adjustment`'s six numbers as one
 * object (ADR 0047) — an attribute can carry that, as the JSON text the setter parses,
 * which is a different thing from "an attribute cannot carry this" and was indistinguishable
 * from it before: `attributeKind` answered `null` for `AdwAdjustmentInput | string`, so the
 * setter landed in the UNCARRYABLE bucket and no rule looked at it again.
 *
 * The declared shape is what opts in: a setter annotated `<Something> | string` says the
 * attribute spelling exists. `AdwComboRow.model` is annotated `AdwListModelInput`, which
 * RESOLVES to a union containing `string` — and a bare string there is one ITEM, not JSON.
 * That is why the test reads the setter's own annotation rather than the resolved alias.
 *
 * Each entry is VERIFIED against its own declaration by `jsonDoors()`, like
 * `STRING_TOLERANT` is: a door that stops taking a string stops being one.
 */
export const JSON_DOORS = {
    parseAdjustment: 'packages/web/adwaita-core/src/adjustment.ts',
};

/** The coercers this package's own door is made of. */
export const COERCERS = { number: 'xmlNumber', boolean: 'xmlBoolean' };

/** What a setter of `kind` must put its value through, named for a failure message. */
export function doorFor(kind) {
    return kind === 'json' ? Object.keys(JSON_DOORS).join(' / ') : COERCERS[kind];
}

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
export const executable = stripComments;

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

/**
 * The ambient `@nativescript/core` slice this package declares for itself.
 *
 * `@nativescript/core` is an optional peer and absent from the workspace install, so
 * this file IS the only in-repo statement of what a NativeScript view already carries.
 * A reader asking "does this widget have that property" needs it, because the answer is
 * yes for `className` and `opacity` without any widget declaring them.
 */
export const NS_CORE_TYPES = 'packages/nativescript-bridge/adwaita/src/ns-core.d.ts';

/**
 * Every property name the ambient slice declares, from any of its declarations.
 *
 * Deliberately over-broad — event-payload and options-bag keys land in here too. The
 * set is used to EXEMPT a name from "this widget has no such property", so a name too
 * many costs coverage and a name too few costs a false alarm, and only one of those
 * gets a check switched off.
 */
export function readCoreProperties(root) {
    const text = readFileSync(join(root, NS_CORE_TYPES), 'utf8');
    return new Set([...text.matchAll(/^\s{4,}([A-Za-z_$][A-Za-z0-9_$]*)\??:/gm)].map((m) => m[1]));
}

/**
 * Where the construct-props bag lives, and where its `Gtk.Align` table does.
 *
 * TWO files because they answer different questions: the applier is behaviour with a spec
 * beside it, the table is DATA that a gate holds against the GIR-derived nick list.
 */
export const NS_CONSTRUCT_PROPS = `${NS_WIDGETS_DIR}/construct-props.ts`;
export const NS_GTK_ALIGN = `${NS_WIDGETS_DIR}/gtk-align.ts`;

/**
 * The in-repo, GIR-derived nick lists — `packages/framework/gtk-host/src/generated/props.ts`.
 *
 * The independent side of the `Gtk.Align` table, and the only one that needs no install:
 * this file is emitted from each `@girs` package's `vocabulary` entry by a generator that
 * has never heard of the NativeScript port, and the gates run in a `checkout` +
 * `setup-node` job with no `node_modules` at all (`audit-runtimes.yml`). It carries the
 * SPELLING and the ORDER of
 * every nick and no values — which is exactly why the values are authored and declared.
 */
export const GTK_HOST_NICKS = 'packages/framework/gtk-host/src/generated/props.ts';

/**
 * Widget classes that do NOT take a construct-props bag, and why.
 *
 * ABSTRACT BASES ONLY, and the checker enforces the word rather than trusting it: an entry
 * must name a class this package still declares, and declares `abstract`. This is the only
 * table here that can answer a rule by SUBTRACTION — everything else in arm 4 fails a widget
 * for missing something, while an entry here takes a widget out of the question and shows up
 * as nothing but a smaller printed count. Measured before it was held: `AdwAvatar` exempted
 * and stripped of its bag left the gate at exit 0 one widget short, and a name nothing
 * declares raised the exempt count instead of failing.
 */
export const NO_CONSTRUCT_PROPS = {
    AdwSplitViewBase:
        'abstract, and constructed only by AdwNavigationSplitView / AdwOverlaySplitView, which take their ' +
        'own bag. Applying one here would run BEFORE the subclass has built its panes, and the subclass ' +
        'would then overwrite it.',
    AdwViewSwitcherBase:
        'abstract, and constructed only by AdwViewSwitcher / AdwInlineViewSwitcher, for the same reason: a ' +
        'bag applied in a base is applied before the derived constructor has run.',
};

/** How the bag is spelled, in the one place both halves of the rule can read it. */
export const CONSTRUCT_PROPS_APPLIER = 'applyConstructProps(this, props)';

/**
 * The constructor a class declares — its parameter list and its body — or `null`.
 *
 * The body ends at the first line indented four spaces, the same bound {@link settersOf}
 * uses and for the same reason: everything inside a method is indented eight or more.
 */
export function constructorOf(text, name) {
    const at = new RegExp(`^export (?:abstract )?class ${name}\\b`, 'm').exec(text);
    if (at === null) return null;
    const decl = /^ {4}constructor\(/m.exec(text.slice(at.index));
    if (decl === null) return null;
    const open = at.index + decl.index + decl[0].length - 1;
    const close = matchingParen(text, open);
    if (close === -1) return null;
    const brace = text.indexOf('{', close);
    if (brace === -1) return null;
    const after = /\n {4}\S/g;
    after.lastIndex = brace;
    const end = after.exec(text)?.index ?? text.length;
    const body = text.slice(brace + 1, end);
    return { params: text.slice(open + 1, close).trim(), body, executable: executable(body) };
}

/** The index of the `}` closing the `{` at {@link open}, or -1 when nothing does. */
export function matchingBrace(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i += 1) {
        if (text[i] === '{') depth += 1;
        else if (text[i] === '}') {
            depth -= 1;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/**
 * A `Record` literal in a TypeScript source, as a Map of key to raw value text.
 *
 * Deliberately shallow — one flat `{ key: value, … }` per declaration, values read as the
 * text between the colon and the comma. Every table this reads is that shape on purpose:
 * a gate that needed a parser to read its own ledger would be a second TypeScript
 * implementation, which is how the two truths start.
 *
 * The body is bounded by a BRACE MATCH and not by the next `\n};`. Measured while
 * building the arm that reads these: an EMPTY declaration (`= {};`) has no such line, so a
 * lazy match ran past it into the next table and reported that one's four entries as this
 * one's — a reader answering about the wrong declaration, at exit 0 with a plausible
 * count. An empty table has to read as empty.
 */
export function readRecordLiteral(text, name) {
    const code = executable(text);
    const decl = new RegExp(`export const ${name}\\b[^=]*= \\{`).exec(code);
    if (decl === null) return null;
    const open = decl.index + decl[0].length - 1;
    const close = matchingBrace(code, open);
    if (close === -1) return null;
    const entries = new Map();
    for (const [, key, value] of code.slice(open + 1, close).matchAll(/^ {4}'?([\w-]+)'?:\s*([\s\S]*?),$/gm)) {
        entries.set(key, value.trim());
    }
    return entries;
}

/** A flat `as const` array of string literals in a TypeScript source, in order. */
export function readStringArray(text, name) {
    const code = executable(text);
    const decl = new RegExp(`export const ${name}\\b[^=]*= \\[`).exec(code);
    if (decl === null) return null;
    const close = code.indexOf(']', decl.index);
    if (close === -1) return null;
    return code
        .slice(decl.index + decl[0].length, close)
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '')
        .map((item) => (/^'[^']*'$/.test(item) ? item.slice(1, -1) : item));
}

/**
 * The members of `export type <name> = 'a' | 'b' | …;`, in declaration order.
 *
 * Order is the point: for a GIR enum with no aliased member it IS the value, which is what
 * makes the two members of `GtkAlign` where it is NOT the value a declaration rather than
 * a typo.
 */
export function readNickUnion(text, name) {
    const decl = new RegExp(`export type ${name} =([^;]+);`).exec(text);
    if (decl === null) return null;
    return decl[1]
        .split('|')
        .map((part) => part.trim())
        .filter((part) => part !== '')
        .map((part) => (/^'[^']*'$/.test(part) ? part.slice(1, -1) : part));
}

/**
 * A widget class name on this surface: the library prefix, then the widget.
 *
 * `Adw\w+` alone was the whole rule until ADR 0034 clause 1 landed here — four widgets
 * are `Gtk*` now (`gtk-entry.ts` exports `GtkEntry`), and a reader that cannot see them
 * reports a shipped widget as "not a widget class in the package".
 */
export const WIDGET_CLASS = '(?:Adw|Gtk)\\w+';

/**
 * How a CALLER names a widget: the namespace member (`Adw.SwitchRow`) or, for the three
 * widgets that have none, the class (`AdwImageButton`).
 *
 * The class spelling stopped being reachable from the package root in ADR 0034
 * § Amendment 9, so a reader keyed on {@link WIDGET_CLASS} alone finds nothing in a
 * migrated caller — and finding nothing is not an error in any of them: they skip an
 * unresolved name and carry on. Both gates that read caller code (`check-doc-fences`,
 * `check-storybook-control-parity`) went from full coverage to zero without a word the
 * first time this was tried, which is why the two spellings live in ONE pattern.
 */
export const WIDGET_REFERENCE = '(?:Adw|Gtk)\\.?\\w+';

/**
 * Namespace member -> the class it binds, e.g. `Adw.SwitchRow` -> `AdwSwitchRow`.
 *
 * Read off the package's own `src/namespace/` barrels through the shared reader, so the
 * placement is stated once. A LOOKUP AND NOT A STRING TRANSFORM, and the example that
 * used to justify it is gone: `Gtk.Image` bound `AdwIcon` until 2026-09-05, when the
 * widget took the GIR name (ADR 0034 § Amendment 10) and every member began reading
 * alike. What keeps this a lookup is that the barrel DECIDES the placement — `Adw` or
 * `Gtk` per member, from the library owning the GType — and a transform would have to
 * re-derive that decision from the name it is trying to produce.
 */
export function readNamespaceSpellings(root) {
    const spellings = new Map();
    const namespaces = namespaceExport(root, NS_PACKAGE_SRC);
    for (const [namespace, members] of namespaces ?? []) {
        for (const [member, binding] of members) spellings.set(`${namespace}.${member}`, binding);
    }
    if (spellings.size === 0) {
        throw new Error(
            `${NS_PACKAGE_SRC}/index.ts exports no Adw/Gtk namespace member. Every caller of this package ` +
                'names its widgets through one (ADR 0034 clause 2), so a reader that finds none reports every ' +
                'caller as naming nothing — the vacuous pass this module refuses everywhere else.',
        );
    }
    return spellings;
}

/**
 * The class a caller's spelling names, or `null` when it names none.
 *
 * @param {string} spelling as written in the caller — `Adw.SwitchRow` or `AdwImageButton`
 * @param {Map<string, string>} spellings from {@link readNamespaceSpellings}
 */
export const widgetClassOf = (spelling, spellings) =>
    spelling.includes('.') ? (spellings.get(spelling) ?? null) : spelling;

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
        const declares = new RegExp(`export (?:abstract )?class (${WIDGET_CLASS})`, 'g');
        for (const [, name] of text.matchAll(declares)) sources.set(name, { file, text });
    }
    return { sources, files };
}

/** The `ELEMENTS` map in the widgets barrel: what the port offers for XML use. */
export function readElements(root) {
    const text = readFileSync(join(root, NS_WIDGETS_DIR, 'index.ts'), 'utf8');
    const block = /const ELEMENTS = \{([\s\S]*?)\n\} as const;/.exec(text);
    const listed = new RegExp(`^\\s{4}(${WIDGET_CLASS}),`, 'gm');
    return new Set(block === null ? [] : [...block[1].matchAll(listed)].map((m) => m[1]));
}

/** A class and every ancestor of it inside this package, nearest first. */
export function chainOf(sources, tag) {
    const chain = [];
    for (let name = tag; name !== undefined && sources.has(name);) {
        const { text } = sources.get(name);
        chain.push(text);
        name = new RegExp(`export (?:abstract )?class ${name}\\b[^{]*?extends (${WIDGET_CLASS})`).exec(text)?.[1];
    }
    return chain;
}

/** The index of the `)` closing the `(` at {@link open}, or -1 when nothing does. */
export function matchingParen(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i += 1) {
        if (text[i] === '(') depth += 1;
        else if (text[i] === ')') {
            depth -= 1;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/**
 * EVERY setter a source declares, read by scanning rather than by one regex — including
 * the ones no regex over `([^)]+)` can spell.
 *
 * Two shapes were INVISIBLE to the single-regex reader this replaces, and both went
 * green with an uncoerced setter because a setter it could not parse produced no
 * finding and did not even move the counter:
 *
 *   · `set x(value)` with no annotation at all. This package compiles with
 *     `"strict": false`, so an implicit `any` parameter is not a type error — the
 *     one shape where a setter is provably unchecked is also the one the reader
 *     dropped.
 *   · `set x(value: (typeof SIZES)[number])`. A type containing a parenthesis cannot
 *     match `\(([^)]+)\)`, and that is the exact spelling `@gjsify/adwaita-core` uses
 *     for its `as const` sets.
 *
 * So {@link annotation} is `null` rather than absent when the parameter carries no
 * type, and the caller REPORTS that instead of skipping it. A reader that cannot read
 * a declaration has to say so; silence is indistinguishable from a clean bill.
 *
 * The BODY ends at the first line indented four spaces — the closing `}` of a
 * conventionally formatted setter, or the next member of the class. The old bound
 * (`indexOf('\n    }')`) ran past a one-line setter into whatever followed, so
 * `set x(v: number) { this._x = v; }` sitting above a setter that DOES coerce read as
 * coercing itself: a false pass, counted, with the arm reporting one more setter held.
 */
export function settersOf(text) {
    const setters = [];
    for (const match of text.matchAll(/^ {4}set (\w+)\(/gm)) {
        const open = match.index + match[0].length - 1;
        const close = matchingParen(text, open);
        if (close === -1) {
            setters.push({ name: match[1], params: null, annotation: null, body: '', executable: '' });
            continue;
        }
        const params = text.slice(open + 1, close).trim();
        const brace = text.indexOf('{', close);
        // The body's own statements are indented eight spaces or more, so the first
        // four-space line after the opening brace is where this member ends.
        const after = new RegExp('\\n {4}\\S', 'g');
        after.lastIndex = brace === -1 ? close : brace;
        const end = after.exec(text)?.index ?? text.length;
        const body = text.slice(match.index, end);
        const typed = /^(\w+)\s*:\s*([\s\S]+)$/.exec(params);
        setters.push({
            name: match[1],
            params,
            annotation: typed === null ? null : typed[2].trim(),
            body,
            executable: executable(body),
        });
    }
    return setters;
}

/**
 * One setter, as the DECLARED type it accepts and the code that runs.
 *
 * The declared type is the key everything else turns on, and it is the correction of a
 * real hole: keying on the JS literal in a template instead meant `{ flat: 'false' }`
 * and `{ flat: false }` emitted byte-identical XML while only one of them was checked.
 * What an attribute may carry is a property of the WIDGET, never of how a template
 * happened to spell it.
 *
 * An UNTYPED setter answers `null` here, exactly as a missing one does, because a
 * caller asking "what may this attribute carry" has no answer either way. The gate that
 * holds the whole package uses {@link settersOf} instead and reports the difference.
 */
export function setterOf(sources, tag, name) {
    for (const text of chainOf(sources, tag)) {
        const found = settersOf(text).find((setter) => setter.name === name);
        if (found === undefined) continue;
        return found.annotation === null ? null : found;
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
    // An identifier or nothing. A union member can be any TYPE EXPRESSION — splitting
    // `readonly (string | AdwMenuEntry)[]` on `|` yields `readonly (string`, and
    // interpolating that into a pattern threw `Unterminated group` and took the whole
    // gate down. A resolver that CRASHES on a type it does not know is the same defect
    // as one that guesses, one exit code louder.
    if (!/^\w+$/.test(name) || seen.has(name)) return false;
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

/** The right-hand side of `export type <name> = …;`, or `null` where nothing declares it. */
function aliasRhs(texts, name) {
    if (!/^\w+$/.test(name)) return null;
    for (const text of texts) {
        const decl = new RegExp(`export type ${name} =([^;]+);`).exec(text);
        if (decl !== null) return decl[1].trim();
    }
    return null;
}

/**
 * What the members of an `as const` array are, as an attribute kind.
 *
 * `(typeof ARRAY)[number]` is how `@gjsify/adwaita-core` spells a closed set, and the
 * elements decide: `['pill', 'flat']` is a string, `[1, 2, 3]` is a NUMBER and still
 * arrives as one. Reading the spelling instead would answer "number" for both, because
 * the index type is literally `number`.
 */
function arrayLiteralKind(texts, name) {
    for (const text of texts) {
        const arr = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(text);
        if (arr === null) continue;
        const items = arr[1]
            .split(',')
            .map((i) => i.trim())
            .filter((i) => i !== '');
        if (items.length === 0) return null;
        if (items.every((i) => /^'[^']*'$/.test(i))) return 'string';
        if (items.every((i) => /^-?\d+(?:\.\d+)?$/.test(i))) return 'number';
        if (items.every((i) => i === 'true' || i === 'false')) return 'boolean';
        return null;
    }
    return null;
}

/**
 * `'number'`, `'boolean'`, `'string'` — or `null` when an attribute cannot carry it.
 *
 * This is the KEY the whole coercion rule turns on, and it is a property of the WIDGET.
 * Keying on the JS literal a template happened to write instead left a hole the size of
 * the defect: `{ flat: 'false' }` and `{ flat: false }` emit byte-identical XML, and
 * only one of the two was ever checked.
 *
 * THE LITERAL SPELLINGS ARE NOT DECORATION. A number reaches this port through more
 * spellings than the word `number`, and each one that answered `null` was a setter the
 * coercion rule silently did not apply to — MEASURED with an uncoerced probe setter on
 * `AdwAvatar`, three times green: `1 | 2 | 3`, an alias `export type Pixels = number`,
 * and `(typeof SIZES)[number]`. `null` has to mean "an attribute cannot carry this",
 * never "I could not tell", which is why the alias is RESOLVED rather than shrugged at.
 */
export function attributeKind(texts, annotation, seen = new Set()) {
    const list = [...texts];
    // BEFORE the `number` test, because the index type of `(typeof SIZES)[number]` is
    // spelled `number` while the values are whatever the array holds — usually strings.
    const inline = /^\(typeof (\w+)\)\[number\]$/.exec(annotation.trim());
    if (inline !== null) return arrayLiteralKind(list, inline[1]);
    // A CALLBACK is not an attribute in any spelling, and it is refused BEFORE the
    // primitive tests because its parameter list is full of primitive words:
    // `SidebarItemFilter` is `(item: AdwSidebarItemSpec, index: number) => boolean`,
    // and asking `/\bnumber\b/` about it answers "number" for a function.
    if (/=>/.test(annotation)) return null;
    if (/\bnumber\b/.test(annotation)) return 'number';
    if (/\bboolean\b/.test(annotation)) return 'boolean';
    const parts = annotation
        .split('|')
        .map((p) => p.trim())
        .filter((p) => p !== 'null' && p !== 'undefined');
    if (parts.length === 0) return null;
    if (parts.every((p) => p === 'string' || /^'[^']*'$/.test(p) || stringUnion(list, p))) return 'string';
    if (parts.every((p) => /^-?\d+(?:\.\d+)?$/.test(p))) return 'number';
    if (parts.every((p) => p === 'true' || p === 'false')) return 'boolean';
    // A JSON DOOR — see {@link JSON_DOORS}. Reached only when some member is NOT
    // string-ish (the test above would have answered `string`), so `| string` beside it
    // is the widget saying an attribute carries this as text the setter parses.
    if (parts.length > 1 && parts.includes('string')) return 'json';
    // One named alias left: resolve it and ask the same question of what it stands for.
    // `seen` is what keeps `type A = B; type B = A;` from recurring forever.
    if (parts.length === 1 && /^\w+$/.test(parts[0]) && !seen.has(parts[0])) {
        seen.add(parts[0]);
        const rhs = aliasRhs(list, parts[0]);
        if (rhs === null) return null;
        const derived = /^\(typeof (\w+)\)\[number\]$/.exec(rhs);
        if (derived !== null) return arrayLiteralKind(list, derived[1]);
        // A PLAIN type expression or nothing. Anything with a bracket in it — a
        // function, a generic, an object shape, an array — is not an attribute, and
        // recursing into it would read the primitives in its INTERIOR as the kind.
        if (/[=(){}[\]<>]/.test(rhs)) return null;
        return attributeKind(list, rhs, seen);
    }
    return null;
}

/**
 * Every member a class declares, its in-package ancestors included.
 *
 * Getters, setters and methods in one set, because a refusal reason names a member the
 * way a reader would — `GtkDropDown.options`, `AdwToastOverlay.showToast` — without
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
    // A JSON door is not interchangeable with a primitive coercer: `xmlNumber` on an
    // object gives the fallback, and `parseAdjustment` on a number gives nothing
    // authored. So this kind is held against ITS OWN doors and no others.
    if (kind === 'json') return Object.keys(JSON_DOORS).some((fn) => setter.executable.includes(`${fn}(`));
    if (setter.executable.includes(`${COERCERS[kind]}(`)) return true;
    return Object.keys(STRING_TOLERANT).some((fn) => setter.executable.includes(`${fn}(`));
}

/**
 * Every `JSON_DOORS` entry really is a total string→object door.
 *
 * The twin of {@link stringTolerant}, and it asks for two things rather than one: the
 * first parameter still accepts a `string`, AND the function does not throw on a bad one.
 * The second is what a door IS — an attribute is where an author's typo arrives, and a
 * door that throws stops the element upgrading rather than ignoring the typo.
 */
export function jsonDoors(root) {
    const problems = [];
    for (const [fn, rel] of Object.entries(JSON_DOORS)) {
        let text = null;
        try {
            text = readFileSync(join(root, rel), 'utf8');
        } catch {
            problems.push(`JSON_DOORS names ${fn} in ${rel}, which is not readable.`);
            continue;
        }
        const decl = new RegExp(`export function ${fn}\\(\\s*\\w+: ([^,)]+)`).exec(text);
        if (decl === null) {
            problems.push(`JSON_DOORS names ${fn}, which ${rel} does not export as a function.`);
            continue;
        }
        if (!/\bstring\b/.test(decl[1])) {
            problems.push(
                `JSON_DOORS names ${fn}, whose first parameter is \`${decl[1].trim()}\` — it no longer ` +
                    'accepts a string, so an XML attribute cannot reach it.',
            );
            continue;
        }
        const body = text.slice(text.indexOf(`export function ${fn}(`));
        if (!/\bcatch\b/.test(body.slice(0, body.indexOf('\n}\n') + 1))) {
            problems.push(
                `JSON_DOORS names ${fn}, whose body has no \`catch\` — a door is where an author's typo ` +
                    'arrives, and one that throws stops the element upgrading instead of ignoring the typo.',
            );
        }
    }
    return problems;
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
