// What each Adwaita renderer ships, read from the code that registers it.
//
// THE INCIDENT
//
// Three scripts needed one fact — which elements adwaita-web ships — and derived it
// separately. `check-adwaita-reset-components.mjs` scanned `customElements.define`
// over all of `src/`; `generate-status.mjs` and `check-storybook-widget-coverage.mjs`
// each listed FILENAMES matching `adw-*.ts` in `src/elements/`, non-recursively. Same
// CI job, 65 against 50, and the smaller answer fed the published widget matrix.
//
// A filename is not the element. `adw-checks.ts` defines `adw-checkbox` and
// `adw-radio`: the matrix scored a widget no page can use, and none for either it can.
// `adw-preferences-dialog.ts` also defines `adw-preferences-page`, so the matrix
// published "adwaita-web does not have it" about an element consumers already use.
// `adw-source-view` sits in `src/source-view/`, invisible to both filename readers —
// the same blindness that had kept it out of the ADR 0010 reset list.
//
// So this module is the ONE reader, of BOTH renderers: the NativeScript widget scan
// was a second copy in the same two files, with the same drift ahead of it. `adw-` is
// the whole naming rule the tree follows, and stripping it ({@link elementName}) leaves
// the bare name widget files and `*.meta.ts` story names are already spelled in.
//
// It answers the core-edge question here too ({@link coreReach}), for the same reason
// and one more: that derivation lived privately in `generate-status.mjs`, which CI
// never runs, so nothing could fail on a `CORE-VIA:` declaration that had stopped
// holding.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

import { toPosixPath } from '../packages/infra/manifest-conformance/lib/index.mjs';

/** Repo-relative source roots, so callers can name them in their own messages. */
export const ADWAITA_WEB_SRC = 'packages/web/adwaita-web/src';
export const ADWAITA_NS_WIDGETS = 'packages/nativescript-bridge/adwaita/src/widgets';
/** The GTK showcase owns the renderer-agnostic metas all three targets import. */
export const ADWAITA_STORY_SRC = 'showcases/gtk/adwaita-storybook/src';
/** …and the NativeScript showcase imports those metas and adds its own rendering. */
export const ADWAITA_NS_STORY_SRC = 'showcases/dom/adwaita-storybook-nativescript/src';

/**
 * Story files carrying `suffix`, anywhere under `dir` — `name` → absolute path.
 *
 * Four checks asked the same question of the same tree and each walked it itself.
 * The copies had not drifted yet, which is exactly the moment to lift one: it is
 * the same argument {@link elementName} above makes one level down.
 *
 * THE FILE SET IS NOT THE RENDERED SET. Two of the three targets register through a
 * hand-written list module, so a file here can render nowhere; `storybookRegistration`
 * in `storybook-registration.mjs` is the reader that answers that. The set-returning
 * wrapper this used to carry is gone with the story-parity gate that leaned on it.
 */
export function storyFilesWith(dir, suffix) {
    /** @type {Map<string, string>} */
    const found = new Map();
    const walk = (current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            // A vendored copy under `src/` would put its stories into a required check.
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            const child = join(current, entry.name);
            if (entry.isDirectory()) walk(child);
            else if (entry.name.endsWith(suffix)) found.set(entry.name.slice(0, -suffix.length), child);
        }
    };
    walk(dir);
    return found;
}

// A story's category is the part of its title before the first `/` — the same split
// StorybookController._groupByCategory makes. EVERY `title:` is read, not the first:
// three meta files declare two metas each, and a reader that stops at one would let
// the second land in an undeclared category with nothing failing.
const META_TITLE = /^\s*title:\s*'([^']+)'/gm;

/**
 * Every renderer-agnostic story meta, keyed by the bare name the widget files, the
 * three story renderings, the ledgers and the website gallery all spell it in.
 *
 * THROWS on an empty scan, for the reason {@link adwaitaWebElements} does: nothing
 * is missing from an empty set, so a moved showcase passes every consumer at once.
 *
 * @param {string} root repository root
 * @returns {Map<string, {path: string, file: string, titles: string[], source: string}>}
 */
export function adwaitaStoryMetas(root) {
    const dir = join(root, ADWAITA_STORY_SRC);
    /** @type {Map<string, {path: string, file: string, titles: string[], source: string}>} */
    const metas = new Map();
    const walk = (current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const path = join(current, entry.name);
            if (entry.isDirectory()) {
                walk(path);
                continue;
            }
            if (!entry.name.endsWith('.meta.ts')) continue;
            const source = readFileSync(path, 'utf8');
            metas.set(entry.name.slice(0, -'.meta.ts'.length), {
                path,
                file: toPosixPath(relative(root, path)),
                titles: [...source.matchAll(META_TITLE)].map(([, title]) => title),
                source,
            });
        }
    };
    if (existsSync(dir)) walk(dir);

    if (metas.size === 0) {
        throw new Error(
            `no *.meta.ts under ${ADWAITA_STORY_SRC}. Either the showcase moved or the naming ` +
                'convention changed — a scan that finds nothing passes vacuously, so this is a ' +
                'failure, not a pass.',
        );
    }
    return new Map([...metas].sort(([a], [b]) => a.localeCompare(b)));
}

// The registration WITH the class it registers, in any quote style: reading the class
// is what makes a HALF rename fail instead of shrinking the set (see the throw below).
const DEFINE_PATTERN = /customElements\s*\.\s*define\(\s*['"`](adw-[a-z0-9-]+)['"`]\s*,\s*([A-Za-z0-9_]+)/g;

// The discriminator for the pattern itself: a call it cannot read is an element the
// whole tree is blind to, and counting only what matched can never show that.
const DEFINE_CALL = /customElements\s*\.\s*define\(/g;

/**
 * Every non-spec `.ts` source file of the web renderer, absolute.
 *
 * Exported because a check about the CODE — rather than about the element SET — still
 * has to see the files no `customElements.define` names: `elements/modal-surface.ts`
 * and `elements/roving-focus.ts` are exactly where the two keyboard contracts live, and
 * a reader keyed on the element set is blind to both.
 *
 * @param {string} root repository root
 * @returns {string[]} absolute paths
 */
export function adwaitaWebSources(root) {
    return sourceFiles(join(root, ADWAITA_WEB_SRC));
}

/** Every `.ts` under `dir` — elements live outside `elements/` too (`source-view/`). */
function sourceFiles(dir) {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        // A vendored copy under `src/` would register its own tags into a required check.
        if (entry.name === 'node_modules') continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) found.push(...sourceFiles(path));
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) found.push(path);
    }
    return found;
}

/** `adw-preferences-page` → `preferences-page`: the key rows, ledger entries and stories share. */
export const elementName = (tag) => tag.slice('adw-'.length);

/** `preferences-page` → `AdwPreferencesPage`: the class both renderers name it after. */
export const widgetClass = (name) =>
    `Adw${name
        .split('-')
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join('')}`;

/** The shared headless behaviour both renderers are meant to delegate to. */
const CORE_PACKAGE = '@gjsify/adwaita-core';

// USING a sibling element and DELEGATING to one are the same import edge, so the
// difference is not derivable and is declared instead — in the delegating file's own
// header, where `CORE-ONLY:` already puts this kind of claim. Spelled with the
// specifier the file imports and HELD to it, so a declaration cannot outlive the
// edge it describes — which is how the last one survived its own deletion.
const CORE_VIA = 'CORE-VIA:';
const CORE_VIA_PATTERN = /CORE-VIA:\s*(\S+)\s*—\s*([^\n]*)/g;

// A floor on length, not on meaning — filler clears it, and no check reads a sentence.
// It is the LAST arm for that reason: what stands between an arbitrary sibling and a
// published `✅ core` is the import arm in {@link coreReach}, never this one.
const MIN_REASON = 40;

/** The leading comment block: a claim a reader of this file meets before the code. */
function fileHeader(text) {
    const header = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed !== '' && !trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*')) break;
        header.push(trimmed);
    }
    return header.join('\n');
}

/**
 * `{ type A, type B }` — a named clause with no value binding at all. Neither renderer
 * sets `verbatimModuleSyntax`, so TypeScript erases such a statement whole; the web
 * `adw-menu-button` carries a separate side-effect import for precisely that reason.
 */
function bindsOnlyTypes(clause) {
    const named = /^\{([^}]*)\}$/.exec(clause.trim());
    if (named === null) return false;
    const entries = named[1]
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');
    return entries.length > 0 && entries.every((entry) => /^type\s+\S/.test(entry));
}

/**
 * A source with its comments blanked out, so a static reader claims only what the
 * module RUNS. `[^:]` before `//` keeps a `https://` inside a string intact. Shared,
 * because #1123 is what a reader without it costs: `.osd` and `.linked` read as
 * implemented off a comment while the code spelled something else.
 *
 * @param {string} text
 */
export function stripComments(text) {
    return text.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * `observedAttributes` per CLASS, from the returned array literal.
 *
 * PER CLASS and not per file, because a file is not an element: `adw-checks.ts`
 * defines `<adw-checkbox>` and `<adw-radio>`, and `adw-preferences-dialog.ts`
 * also defines `<adw-preferences-page>`. Reading a file's first literal and
 * attributing it to every tag the file registers is the same mistake as reading
 * a FILENAME for the element set, which is the incident at the top of this file.
 *
 * The scan is deliberately literal-only. A class whose list is computed —
 * spread from a base, concatenated — is reported as UNREADABLE by
 * {@link observedAttributes} rather than as empty: an element with no attributes
 * and an element this cannot read are different facts, and only one of them is a
 * reason to document nothing.
 */
export function observedAttributesByClass(text) {
    const code = stripComments(text);
    /** @type {Map<string, string[]>} */
    const byClass = new Map();
    /** @type {Map<string, string>} */
    const extendsBase = new Map();
    /** @type {Map<string, string>} */
    const pending = new Map();
    const unreadable = [];

    // A module-level `const NAME = ['a', 'b']` a getter can return by name.
    /** @type {Map<string, string[]>} */
    const constants = new Map();
    for (const [, name, body] of code.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]*)?=\s*\[([^\]]*)\]/g)) {
        constants.set(
            name,
            [...body.matchAll(/'([^']+)'/g)].map(([, attr]) => attr),
        );
    }

    const classes = [...code.matchAll(/\bclass\s+(Adw[A-Za-z0-9]*)(?:\s+extends\s+([A-Za-z0-9_.]+))?/g)];
    for (let i = 0; i < classes.length; i++) {
        const name = classes[i][1];
        if (classes[i][2]) extendsBase.set(name, classes[i][2]);
        const from = classes[i].index;
        const to = i + 1 < classes.length ? classes[i + 1].index : code.length;
        const body = code.slice(from, to);
        // The return-type annotation is optional and present on some: `(): string[]`.
        const getter = /static get observedAttributes\(\)\s*(?::[^{]*)?\{\s*return\s+([^;]+);/.exec(body);
        if (!getter) {
            if (/static get observedAttributes\(\)/.test(body)) unreadable.push(name);
            else byClass.set(name, []);
            continue;
        }
        const expression = getter[1].trim();
        const literal = /^\[([\s\S]*)\]$/.exec(expression);
        if (!literal) {
            // `return PAGE_ATTRIBUTES;` — a named list declared in this module.
            const named = constants.get(expression);
            if (named) byClass.set(name, named);
            else unreadable.push(name);
            continue;
        }
        const inner = literal[1];
        const own = [...inner.matchAll(/'([^']+)'/g)].map(([, attr]) => attr);
        // `[...AdwEntryRow.observedAttributes, 'revealed']` — resolved after the
        // whole pillar is read, because the base can live in another file.
        const spread = /\.\.\.\s*([A-Za-z0-9_]+)\.observedAttributes/.exec(inner);
        if (spread) pending.set(name, spread[1]);
        byClass.set(name, own);
    }

    return { byClass, unreadable, pending, extendsBase };
}

/**
 * Registered tag → the attributes that tag observes, for the whole web pillar.
 *
 * Joined through {@link widgetClass}, the same rule `adwaitaWebElements` already
 * THROWS on when a tag and its class disagree — so the join cannot silently miss.
 */
export function observedAttributes(root) {
    const tags = adwaitaWebElements(root);
    /** @type {Map<string, string[]>} */
    const byTag = new Map();
    const unreadable = [];

    // Read every source once, then resolve. A `[...Base.observedAttributes, 'x']`
    // spread is the reason for two passes: `AdwPasswordEntryRow` extends
    // `AdwEntryRow` from ANOTHER file, so its own list is not complete until that
    // one has been read.
    const sources = new Map();
    /** @type {Map<string, string[]>} */
    const perClass = new Map();
    /** @type {Map<string, string>} */
    const spreads = new Map();
    const badClasses = new Set();
    for (const file of new Set(tags.values())) {
        const read = observedAttributesByClass(readFileSync(join(root, file), 'utf8'));
        sources.set(file, read);
        for (const [klass, attrs] of read.byClass) perClass.set(klass, attrs);
        for (const [klass, base] of read.pending) spreads.set(klass, base);
        for (const klass of read.unreadable) badClasses.add(klass);
    }
    for (const [klass, base] of spreads) {
        const inherited = perClass.get(base);
        if (inherited === undefined) {
            badClasses.add(klass);
            continue;
        }
        // Base first, so the order matches what the class itself returns.
        perClass.set(klass, [...inherited, ...(perClass.get(klass) ?? [])]);
    }

    for (const [tag, file] of tags) {
        const klass = widgetClass(elementName(tag));
        if (badClasses.has(klass)) {
            unreadable.push(`${tag} (${klass} in ${file})`);
            continue;
        }
        const attrs = perClass.get(klass);
        if (attrs === undefined) {
            unreadable.push(`${tag} (no class ${klass} in ${file})`);
            continue;
        }
        byTag.set(tag, attrs);
    }
    return { byTag, unreadable };
}

/**
 * Every property a widget class lets a caller SET — `set <name>(`, PLUS the
 * attributes it observes.
 *
 * The question is "can this target honour that control at all". A settable
 * property of the control's own name is one answer a story cannot argue with;
 * an OBSERVED ATTRIBUTE of that name is the other, and leaving it out made 11
 * of the web pillar's elements invisible here — the attribute-only ones, which
 * carry no `set` accessor at all. Accessors alone: a `setFoo(value)` method is
 * the widget's internal wiring, and a control is bound to a property.
 */
export const settableProperties = (text) => {
    const setters = new Set(
        [...stripComments(text).matchAll(/\bset\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)].map(([, name]) => name),
    );
    // `show-apply-button` is the attribute; `showApplyButton` is the control name
    // a meta declares. Both spellings go in, so the caller can ask either way.
    for (const attrs of observedAttributesByClass(text).byClass.values()) {
        for (const attr of attrs) {
            setters.add(attr);
            setters.add(attr.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()));
        }
    }
    return setters;
};

/**
 * What a module imports or re-exports AS VALUES — comments out, and BOTH `type`
 * spellings out: the statement-level `import type { X } from` and the inline
 * `import { type X } from`, which emits nothing either ({@link bindsOnlyTypes}).
 *
 * A clause this cannot read as a value binding counts as no edge. That direction is
 * deliberate: an unseen edge under-claims a widget, which the matrix already words as
 * "no path is VISIBLE", while a claimed edge nothing runs is the incident below.
 */
function valueImports(text) {
    const code = stripComments(text);
    const specs = [...code.matchAll(/(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g)].map(([, spec]) => spec);
    for (const [, clause, spec] of code.matchAll(
        /(?:^|[\n;])\s*(?:import|export)\s+(?!type[\s{])([^'"]*)from\s*['"]([^'"]+)['"]/g,
    )) {
        if (!bindsOnlyTypes(clause)) specs.push(spec);
    }
    return specs;
}

/**
 * Does a module reach `@gjsify/adwaita-core`? — the question the matrix's "core"
 * cell asks, for `rendererFiles`, the element files of the renderer(s) in scope.
 *
 * "Backed by core" is an import edge we can SEE, which a sentence about core and an
 * erased `import type` are not — both were counted: `adw-header-bar` imports core
 * NOWHERE and was published core-backed off a comment, `adw-menu-button` off a type.
 *
 * ONE HOP, and never DERIVED into another renderer element. A renderer delegates through a
 * helper for a reason the tree makes visible: an NS spec cannot import a module that
 * `extends GridLayout`, so the pure half moves out (`chrome.ts`, `avatar-color.ts`)
 * and the helper is where the core edge lives. A transitive walk would report a
 * widget as core-backed because something four modules away imports core, which is
 * not the same claim; and `adw-source-view` embeds `adw-icon`, whose edge is not a
 * claim about the source view. The verdict is per FILE: every tag
 * `adw-alert-dialog.ts` registers carries that one file's edge, no finer.
 *
 * THROWS on a `CORE-VIA:` header that does not hold — see {@link CORE_VIA}. Held in
 * order: the declaring file must IMPORT the specifier it names (a declaration whose
 * own first edge is missing is the incident above, restored — the marker outlives the
 * import and the widget stays core-backed off prose); the named module must be a
 * SIBLING ELEMENT of this renderer, because a helper is what the one hop already
 * covers and needs no marker; and it must reach core BY IMPORT, not by a marker of its
 * own, since a chain of declarations is a ledger whose first link alone stays checkable.
 *
 * @param {Set<string>} rendererFiles absolute paths of the renderer element files
 * @param {string} root repository root, for naming files in a failure
 * @returns {(file: string) => boolean}
 */
export function coreReach(rendererFiles, root) {
    const read = (file) => {
        try {
            return readFileSync(file, 'utf8');
        } catch {
            return '';
        }
    };
    const importsCore = (text) => valueImports(text).some((spec) => spec.startsWith(CORE_PACKAGE));
    // TS sources import the EMITTED `.js` sibling; the file on disk is `.ts`.
    const sibling = (file, spec) => resolve(file, '..', spec.replace(/\.js$/, '.ts'));
    const byImport = (file) => {
        const text = read(file);
        if (importsCore(text)) return true;
        return valueImports(text).some(
            (spec) =>
                spec.startsWith('.') &&
                !rendererFiles.has(sibling(file, spec)) &&
                importsCore(read(sibling(file, spec))),
        );
    };

    return (file) => {
        const text = read(file);
        const direct = byImport(file);
        if (!text.includes(CORE_VIA)) return direct;

        const where = `${relative(root, file)}: CORE-VIA`;
        // EVERY occurrence is held, not the first one found: an unread marker is
        // decoration, it can carry a second module that never gets checked, and a bare
        // `TODO` parked in it hides from `gjsify/todo-needs-anchor` at the same time.
        const markers = [...fileHeader(text).matchAll(CORE_VIA_PATTERN)];
        if (markers.length !== text.split(CORE_VIA).length - 1) {
            throw new Error(
                `${where} is not in the file header, or is not spelled \`CORE-VIA: <module> — <reason>\`. ` +
                    'Nothing reads it where it stands, so the widget is scored as if it were not there.',
            );
        }
        if (direct) {
            throw new Error(
                `${where} declares a delegation, but this file reaches ${CORE_PACKAGE} on its own. ` +
                    'The marker carries nothing and outlives its reason — delete it.',
            );
        }
        const imported = valueImports(text);
        for (const [, spec, reason] of markers) {
            if (!imported.includes(spec)) {
                throw new Error(
                    `${where} names ${spec}, which this file does not import as a value. ` +
                        'A delegation with no import edge behind it is a sentence, and a sentence is ' +
                        'what published this widget core-backed the first time.',
                );
            }
            const target = sibling(file, spec);
            if (!rendererFiles.has(target)) {
                throw new Error(
                    `${where} names ${spec} (${relative(root, target)}), which is not an element of ` +
                        'this renderer. A helper is already the one hop above and needs no marker; a ' +
                        'sibling ELEMENT is the only edge that hop deliberately refuses to see.',
                );
            }
            if (!byImport(target)) {
                throw new Error(
                    `${where} names ${spec}, which does not reach ${CORE_PACKAGE} itself. ` +
                        'Delegating to a second copy is still two copies.',
                );
            }
            if (reason.trim().length < MIN_REASON) {
                throw new Error(
                    `${where} names ${spec} with no real reason — say what behaviour runs there instead of here.`,
                );
            }
        }
        return true;
    };
}

/**
 * Every custom element adwaita-web defines → the file defining it, so a failure
 * can name the file to open. Sorted by tag; several files define two or three.
 *
 * THROWS on an empty scan: nothing is missing from an empty set, so a reader that
 * finds nothing lets every consumer pass vacuously — which is exactly what a moved
 * package or a stale pattern produces. An unreadable `define(` and a tag registering
 * something other than its `Adw<Tag>` throw for the same reason: both shrink the set.
 *
 * @param {string} root repository root
 * @returns {Map<string, string>} tag → repo-relative defining file
 */
export function adwaitaWebElements(root) {
    const src = join(root, ADWAITA_WEB_SRC);
    /** @type {Map<string, string>} */
    const defined = new Map();
    const unreadable = [];
    const files = sourceFiles(src);
    const elements = new Set();
    for (const file of files) {
        const text = readFileSync(file, 'utf8');
        const calls = (text.match(DEFINE_CALL) ?? []).length;
        let matched = 0;
        for (const [, tag, registered] of text.matchAll(DEFINE_PATTERN)) {
            matched += 1;
            const expected = widgetClass(elementName(tag));
            if (registered !== expected) {
                throw new Error(
                    `${relative(root, file)} registers <${tag}> as ${registered}, not ${expected}. ` +
                        'A tag and its class are renamed together or not at all: rename one alone and ' +
                        'the widget drops out of the set both renderers share with no gate failing.',
                );
            }
            defined.set(tag, relative(root, file));
            elements.add(file);
        }
        if (matched < calls) unreadable.push(relative(root, file));
    }

    if (unreadable.length > 0) {
        throw new Error(
            `customElements.define(…) this reader could not parse, in ${unreadable.join(', ')}: a tag ` +
                'outside the `adw-` rule, or a spelling DEFINE_PATTERN does not match. Either way that ' +
                'element has no matrix row and no ADR 0010 reset entry, and nothing else would say so.',
        );
    }

    if (defined.size === 0) {
        throw new Error(
            `no customElements.define('adw-…') calls found under ${ADWAITA_WEB_SRC}. ` +
                'Either the package moved or DEFINE_PATTERN stopped matching — a scan that ' +
                'finds nothing passes vacuously, so this is a failure, not a pass.',
        );
    }

    verifyCoreVia(files, elements, root);
    return new Map([...defined].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Every `CORE-VIA:` declaration in one renderer package, held against that package's
 * tree — {@link coreReach} throws on one that does not.
 *
 * IT RUNS HERE because `generate-status.mjs`, the only consumer that asks about core
 * edges, is not a gate: CI never runs it, so an arm living there could never fail a
 * PR. This reader is what `check-adwaita-reset-components` and
 * `check-storybook-widget-coverage` call, and both already refuse whatever it refuses.
 */
function verifyCoreVia(files, elements, root) {
    const reach = coreReach(elements, root);
    for (const file of files) reach(file);
}

// `adw-button.ts`, plus the `.android`/`.ios` halves NativeScript splits a module into
// (`icons.android.ts` beside `icons.ios.ts` here already): two files, one widget. Any
// other dotted name — `adw-button.d.ts` — is not a widget name and is not read as one.
const NS_WIDGET_FILE = /^adw-([a-z0-9-]+)(?:\.(?:android|ios))?\.ts$/;

/** Declaring a class AT ALL is what makes a file a widget file — the word in prose is not. */
const CLASS_DECLARATION = /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+[A-Za-z0-9_]+/m;

/** The class must LEAVE the file; how it is spelled on the way out is free. */
const exportsClass = (text, name) =>
    new RegExp(`export\\s+(?:default\\s+)?(?:abstract\\s+)?class\\s+${name}\\b`).test(text) ||
    new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(text);

/**
 * Every widget the NativeScript Adwaita port ships → its repo-relative file.
 *
 * NativeScript has no `customElements.define`. A widget here is a class extending a
 * `@nativescript/core` view, named `Adw<Widget>` in `adw-<name>.ts`, and every file
 * here but one is that. The exception is `adw-accent.ts`, two functions that push CSS
 * at `Application`: no view, nothing to place in a layout, and the directory listing
 * scored it as a NativeScript-only WIDGET the browser had yet to port.
 *
 * DECLARING NO CLASS is therefore the exemption and the only one — a file that declares
 * one and does not export it under the name its filename promises THROWS. Same
 * vacuous-scan contract as {@link adwaitaWebElements}.
 *
 * @param {string} root repository root
 * @returns {Map<string, string>} bare widget name → repo-relative file
 */
export function adwaitaNativeScriptWidgets(root) {
    const dir = join(root, ADWAITA_NS_WIDGETS);
    /** @type {Map<string, string>} */
    const widgets = new Map();
    const files = sourceFiles(dir);
    const elements = new Set();
    for (const file of files) {
        const match = NS_WIDGET_FILE.exec(basename(file));
        if (!match) continue;
        const text = readFileSync(file, 'utf8');
        if (!CLASS_DECLARATION.test(text)) continue;
        const expected = widgetClass(match[1]);
        if (!exportsClass(text, expected)) {
            throw new Error(
                `${relative(root, file)} declares a class but does not export ${expected}. ` +
                    'A widget file names its class after itself; without that this file drops out ' +
                    'of the widget set silently, and every consumer of it shrinks with no failure.',
            );
        }
        widgets.set(match[1], relative(root, file));
        elements.add(file);
    }

    if (widgets.size === 0) {
        throw new Error(
            `no adw-<name>.ts file under ${ADWAITA_NS_WIDGETS} exports an Adw* class. ` +
                'Either the package moved or the naming convention changed — a scan that ' +
                'finds nothing passes vacuously, so this is a failure, not a pass.',
        );
    }

    verifyCoreVia(files, elements, root);
    return new Map([...widgets].sort(([a], [b]) => a.localeCompare(b)));
}
