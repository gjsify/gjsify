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
// A filename is not the element. `checks.ts` defines `gtk-check-button` and
// `adw-radio`: the matrix scored a widget no page can use, and none for either it can.
// `adw-preferences-dialog.ts` also defines `adw-preferences-page`, so the matrix
// published "adwaita-web does not have it" about an element consumers already use.
// `adw-source-view` sits in `src/source-view/`, invisible to both filename readers —
// the same blindness that had kept it out of the ADR 0010 reset list.
//
// So this module is the ONE reader, of BOTH renderers: the NativeScript widget scan
// was a second copy in the same two files, with the same drift ahead of it. A web tag
// carries the prefix of the library that owns its GType — `adw-action-row` and
// `gtk-entry` alike, ADR 0034 clause 1 — and stripping it ({@link elementName}) leaves
// the bare name widget files and `*.meta.ts` story names are already spelled in. The
// NativeScript surface is `adw-` throughout, which is why {@link widgetClass} keeps a
// fixed prefix and only {@link tagClass} reads one.
//
// It answers the core-edge question here too ({@link coreReach}), for the same reason
// and one more: that derivation lived privately in `generate-status.mjs`, which CI
// never runs, so nothing could fail on a `CORE-VIA:` declaration that had stopped
// holding.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

import {
    TS_SOURCE_EXTENSIONS,
    resolveLocalSource,
    sourceExtensionRe,
    toPosixPath,
} from '../packages/infra/manifest-conformance/lib/index.mjs';

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
//
// BOTH PREFIXES, because the web surface names an element after the library that owns
// its GType (ADR 0034 clause 1): `<gtk-entry>` is `GtkEntry` and `<adw-action-row>` is
// `AdwActionRow`. A pattern that read only `adw-` would not have MISSED those nine
// elements quietly — `DEFINE_CALL` below counts what it could not parse and the reader
// throws — but it would have made the rename unlandable, which is the same wall from
// the other side.
const DEFINE_PATTERN = /customElements\s*\.\s*define\(\s*['"`]((?:adw|gtk)-[a-z0-9-]+)['"`]\s*,\s*([A-Za-z0-9_]+)/g;

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

/**
 * Every TypeScript source under `dir` — elements live outside `elements/` too
 * (`source-view/`).
 *
 * This walk feeds FOURTEEN gates (the five `check-adwaita-*` contracts, the four
 * storybook parity checks, vocabulary alignment, the two website checks,
 * `generate-status` and `storybook-registration`), so the `.ts`-only filter it carried
 * would have taken all fourteen blind at once the day an element was written as `.mts`
 * or `.tsx`. It throws when the set is EMPTY and says nothing when the set merely
 * shrinks, which is the half that costs.
 */
const SOURCE_RE = sourceExtensionRe(TS_SOURCE_EXTENSIONS);
const SPEC_RE = new RegExp(`\\.spec\\.(${TS_SOURCE_EXTENSIONS.join('|')})$`);

function sourceFiles(dir) {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        // A vendored copy under `src/` would register its own tags into a required check.
        if (entry.name === 'node_modules') continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) found.push(...sourceFiles(path));
        else if (SOURCE_RE.test(entry.name) && !SPEC_RE.test(entry.name)) found.push(path);
    }
    return found;
}

/** `adw-preferences-page` → `preferences-page`: the key rows, ledger entries and stories share. */
export const elementName = (tag) => tag.slice(tag.indexOf('-') + 1);

/** `preferences-page` → `PreferencesPage`, the tail every class name below ends in. */
const pascalCase = (name) =>
    name
        .split('-')
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join('');

/** `preferences-page` → `AdwPreferencesPage`: the class both renderers name it after. */
export const widgetClass = (name) => `Adw${pascalCase(name)}`;

/**
 * `gtk-entry` → `GtkEntry`, `adw-action-row` → `AdwActionRow`: the class a TAG names.
 *
 * The prefix is read off the tag rather than fixed at `Adw`, which is the whole of
 * ADR 0034 clause 1 as a function — the namespace belongs to whichever library owns the
 * GType, and `gtk-host/src/tags.ts` derives the tag from the GType by the same rule
 * running the other way. {@link widgetClass} stays `Adw`-only because the two
 * NativeScript-shaped surfaces are keyed on a BARE name with no prefix to read.
 */
export const tagClass = (tag) => `${pascalCase(tag.slice(0, tag.indexOf('-')))}${pascalCase(elementName(tag))}`;

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
 * `gtk-menu-button` carries a separate side-effect import for precisely that reason.
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
 * PER CLASS and not per file, because a file is not an element: `checks.ts`
 * defines `<gtk-check-button>` and `<adw-radio>`, and `adw-preferences-dialog.ts`
 * also defines `<adw-preferences-page>`. Reading a file's first literal and
 * attributing it to every tag the file registers is the same mistake as reading
 * a FILENAME for the element set, which is the incident at the top of this file.
 *
 * A class whose list this cannot work out is reported as UNREADABLE by
 * {@link observedAttributes} rather than as empty: an element with no attributes
 * and an element this cannot read are different facts, and only one of them is a
 * reason to document nothing. EVERY shape therefore has to land in one of those
 * two — the failure is a third outcome, a computed list read as the empty one,
 * which is a silent wrong answer wearing the shape of a right one. Two did:
 * `return [...PROPERTY_ATTRIBUTES];` (no quoted string in it, and not the bare
 * `return NAME;` shape either) and a subclass that simply inherits its base's
 * getter. `<adw-wrap-box>` published "observes nothing" over 14 attributes its own
 * `attributeChangedCallback` serves, and the website rendered no attribute pane at
 * all for it while every gate stayed green.
 */
export function observedAttributesByClass(text) {
    const code = stripComments(text);
    /** @type {Map<string, string[]>} */
    const byClass = new Map();
    /** @type {Map<string, string>} */
    const extendsBase = new Map();
    /** @type {Map<string, string>} */
    const pending = new Map();
    /** Classes with NO getter of their own, which therefore use their base's. */
    /** @type {Map<string, string>} */
    const inherits = new Map();
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

    const classes = [...code.matchAll(/\bclass\s+((?:Adw|Gtk)[A-Za-z0-9]*)(?:\s+extends\s+([A-Za-z0-9_.]+))?/g)];
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
            else {
                // No getter here is not "observes nothing" when there is a base to
                // take one from — `AdwCarouselIndicatorDots` has neither and observed
                // `for` through `AdwCarouselIndicator` all along. Recorded rather than
                // resolved, because the base can live in another file.
                byClass.set(name, []);
                if (classes[i][2]) inherits.set(name, classes[i][2]);
            }
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
        // Read the literal IN ORDER: the emitted list is documented as declaration
        // order, and a spread can sit anywhere in it.
        /** @type {string[]} */
        const own = [];
        let unresolvedSpread = null;
        for (const [, quoted, spreadName, ofBase] of literal[1].matchAll(
            /'([^']+)'|\.\.\.\s*([A-Za-z0-9_$]+)(\.observedAttributes)?/g,
        )) {
            if (quoted !== undefined) {
                own.push(quoted);
            } else if (ofBase) {
                // `[...AdwEntryRow.observedAttributes, 'revealed']` — resolved after
                // the whole pillar is read, because the base can live in another file.
                pending.set(name, spreadName);
            } else {
                // `[...PROPERTY_ATTRIBUTES]` — a named list in this module, spread
                // rather than returned by name. Unresolved it yields no attribute at
                // all, which is why it is a failure and not an empty list.
                const named = constants.get(spreadName);
                if (named === undefined) unresolvedSpread = spreadName;
                else own.push(...named);
            }
        }
        // A literal with text in it that yielded no name is the third outcome again,
        // in whatever shape comes next (a double-quoted string, a `.concat`): only
        // `return [];` may read as none.
        if (unresolvedSpread !== null || (own.length === 0 && !pending.has(name) && literal[1].trim() !== '')) {
            unreadable.push(name);
            continue;
        }
        byClass.set(name, own);
    }

    return { byClass, unreadable, pending, inherits, extendsBase };
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
    /** @type {Map<string, string>} */
    const inherits = new Map();
    const badClasses = new Set();
    for (const file of new Set(tags.values())) {
        const read = observedAttributesByClass(readFileSync(join(root, file), 'utf8'));
        sources.set(file, read);
        for (const [klass, attrs] of read.byClass) perClass.set(klass, attrs);
        for (const [klass, base] of read.pending) spreads.set(klass, base);
        for (const [klass, base] of read.inherits) inherits.set(klass, base);
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
    // A subclass with no getter of its own answers with its base's list, exactly as
    // the platform does. `extends HTMLElement` resolves to nothing and stays empty,
    // which is the one case where empty is the true answer. Iterated to a fixpoint so
    // a two-step chain lands, and bounded so a cycle cannot spin.
    for (let pass = 0; pass < inherits.size; pass++) {
        let changed = false;
        for (const [klass, base] of inherits) {
            const inherited = perClass.get(base);
            if (inherited === undefined || inherited.length === 0) continue;
            if (perClass.get(klass)?.length) continue;
            perClass.set(klass, [...inherited]);
            changed = true;
        }
        if (!changed) break;
    }

    for (const [tag, file] of tags) {
        const klass = tagClass(tag);
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
 * The properties ONE class lets a caller set — `set <name>(` inside its own body.
 *
 * {@link settableProperties} answers the same question for a whole FILE, which is the
 * right unit for the web pillar (a module registers several elements and the question is
 * "can this target honour that control at all"). The property LEDGER needs the finer
 * unit: every disagreement it records is attributed to one widget, and a helper class
 * sharing a file would put its setters on the widget's row. Measured today at 0 files
 * with two classes under the NativeScript widget directory — which is exactly when a
 * reader should stop depending on that being true.
 *
 * Sliced between class declarations, the same way {@link observedAttributesByClass}
 * partitions a file. Returns `null` when the class is not there at all: a reader that
 * silently answered "no settable properties" would make a widget's whole row vanish from
 * the comparison, and an empty row is indistinguishable from an aligned one.
 *
 * @param {string} text the module source
 * @param {string} className the class to read
 * @returns {Set<string>|null}
 */
export function settablePropertiesOfClass(text, className) {
    const code = stripComments(text);
    const classes = [...code.matchAll(/\bclass\s+([A-Za-z0-9_$]+)/g)];
    const at = classes.findIndex(([, name]) => name === className);
    if (at < 0) return null;
    const from = classes[at].index;
    const to = at + 1 < classes.length ? classes[at + 1].index : code.length;
    return new Set(
        [...code.slice(from, to).matchAll(/\bset\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)].map(([, name]) => name),
    );
}

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
 * NOWHERE and was published core-backed off a comment, `gtk-menu-button` off a type.
 *
 * ONE HOP, and never DERIVED into another renderer element. A renderer delegates through a
 * helper for a reason the tree makes visible: an NS spec cannot import a module that
 * `extends GridLayout`, so the pure half moves out (`chrome.ts`, `avatar-color.ts`)
 * and the helper is where the core edge lives. A transitive walk would report a
 * widget as core-backed because something four modules away imports core, which is
 * not the same claim; and `adw-source-view` embeds `gtk-image`, whose edge is not a
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
    // TS sources import the EMITTED `.js` sibling; the file on disk is the TypeScript
    // one, and which extension that is comes from the disk rather than from a suffix
    // rewrite that can only ever land on `.ts`.
    const sibling = (file, spec) => resolveLocalSource(file, spec) ?? resolve(file, '..', spec.replace(/\.js$/, '.ts'));
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
            const expected = tagClass(tag);
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
                'outside the `adw-`/`gtk-` rule, or a spelling DEFINE_PATTERN does not match. Either way ' +
                'that element has no matrix row and no ADR 0010 reset entry, and nothing else would say so.',
        );
    }

    if (defined.size === 0) {
        throw new Error(
            `no customElements.define('adw-…'/'gtk-…') calls found under ${ADWAITA_WEB_SRC}. ` +
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

// `gtk-button.ts`, plus the `.android`/`.ios` halves NativeScript splits a module into
// (`icons.android.ts` beside `icons.ios.ts` here already): two files, one widget. Any
// other dotted name — `gtk-button.d.ts` — is not a widget name and is not read as one,
// which the `[a-z0-9-]+` base still guarantees.
//
// The extension comes from the shared vocabulary because `.ts` alone CONTRADICTED the
// rule one layer down: `nativescript-platforms.mjs` declares `VARIANT_EXTENSIONS`
// including `tsx` and `mts` for this very naming scheme, so the build resolves a
// `gtk-button.android.tsx` that this scan could not see.
const NS_WIDGET_FILE = new RegExp(`^adw-([a-z0-9-]+)(?:\\.(?:android|ios))?\\.(?:${TS_SOURCE_EXTENSIONS.join('|')})$`);

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

/** The React Native surface: one barrel, and the base module each widget lives in. */
export const ADWAITA_RN_SRC = 'packages/framework/adwaita-react-native/src';

/** `export { AdwClamp } from './widgets/clamp.js';` — the only shape the barrel uses. */
const RN_BARREL_EXPORT = /export\s*\{\s*(Adw[A-Za-z0-9]*)\s*\}\s*from\s*'\.\/widgets\/([a-z0-9-]+)\.js'/g;

/**
 * Every widget `@gjsify/adwaita-react-native` ships → its repo-relative base module.
 *
 * A THIRD naming convention, because the package has neither of the other two: no
 * `customElements.define`, and its modules are `clamp.ts` rather than `adw-clamp.ts`
 * (the `Adw` lives in the exported component, and the platform split puts
 * `clamp.gtk.tsx` beside it). So the widget set is the BASE BARREL's export list,
 * which is also what `exports['.']` resolves for a condition-blind tool and what
 * `check-adwaita-rn-platform-split.mjs` rule 5 already holds for completeness.
 *
 * The class name is held against the module name the same way the other two readers
 * hold theirs: `export { AdwClamp } from './widgets/bin.js'` is refused rather than
 * recorded, because a widget under a name its module does not promise drops out of
 * every set derived from here with nothing failing.
 *
 * @param {string} root repository root
 * @returns {Map<string, string>} bare widget name → repo-relative base module
 */
export function adwaitaReactNativeWidgets(root) {
    const barrel = join(root, ADWAITA_RN_SRC, 'index.ts');
    const text = stripComments(readFileSync(barrel, 'utf8'));
    /** @type {Map<string, string>} */
    const widgets = new Map();
    for (const [, exported, module] of text.matchAll(RN_BARREL_EXPORT)) {
        const expected = widgetClass(module);
        if (exported !== expected) {
            throw new Error(
                `${ADWAITA_RN_SRC}/index.ts exports ${exported} from ./widgets/${module}.js, not ${expected}. ` +
                    'A widget and its module are renamed together or not at all: rename one alone and the ' +
                    'widget leaves the set this reader feeds with no gate failing.',
            );
        }
        const source = resolveLocalSource(barrel, `./widgets/${module}.js`);
        if (source === null) {
            throw new Error(
                `${ADWAITA_RN_SRC}/index.ts exports ${exported} from ./widgets/${module}.js, which resolves ` +
                    'to no source file. The barrel names the type authority for both platform halves, so a ' +
                    'specifier with nothing behind it is a widget nothing can read.',
            );
        }
        widgets.set(module, toPosixPath(relative(root, source)));
    }

    if (widgets.size === 0) {
        throw new Error(
            `no \`export { Adw… } from './widgets/…'\` line in ${ADWAITA_RN_SRC}/index.ts. ` +
                'Either the barrel moved or its export shape changed — a scan that finds nothing ' +
                'passes vacuously, so this is a failure, not a pass.',
        );
    }
    return new Map([...widgets].sort(([a], [b]) => a.localeCompare(b)));
}

/** The two GIR namespaces clause 2 is satisfied by. Nothing else is a namespace here. */
const NAMESPACE_NAMES = ['Adw', 'Gtk'];

/** `export const Adw = { … }` — one flat object literal, which is all the clause needs. */
const NAMESPACE_DECLARATION = /export const (Adw|Gtk) = \{([^}]*)\}/g;

/** `export { Adw, Gtk } from './namespace.js'` — the one hop {@link namespaceExport} follows. */
const NAMESPACE_REEXPORT = /export\s*\{([^}]*)\}\s*from\s*'(\.[^']*)'/g;

/**
 * The `Adw`/`Gtk` object literals in one already-comment-stripped source.
 *
 * @param {string} code
 * @returns {Map<string, Map<string, string>>} namespace → member → bound identifier
 */
function namespaceMembers(code) {
    /** @type {Map<string, Map<string, string>>} */
    const found = new Map();
    for (const [, namespace, body] of code.matchAll(NAMESPACE_DECLARATION)) {
        /** @type {Map<string, string>} */
        const members = new Map();
        for (const part of body.split(',')) {
            const entry = part.trim();
            if (entry === '') continue;
            const [member, binding] = entry.split(':').map((half) => half.trim());
            members.set(member, binding === undefined || binding === '' ? member : binding);
        }
        found.set(namespace, new Map([...members].sort(([a], [b]) => a.localeCompare(b))));
    }
    return found;
}

/**
 * The namespace object a surface exports, or `null` when it exports none.
 *
 * ADR 0034 clause 2: a surface's vocabulary is also reachable as `Adw.Bin`, not only as
 * `AdwBin`. Read generically from the package's own `src/index.ts` rather than listed
 * per surface, so a renderer that adopts the clause is picked up by having done it —
 * the alternative is a table saying who has adopted it, which is the thing that goes
 * stale while the code moves.
 *
 * Reports, never throws on absence: a renderer that has not adopted the clause is the
 * state this reader exists to make visible rather than a fault.
 *
 * Only the GIR namespace names count. Clause 2 is satisfied by `Adw`/`Gtk`, not by any
 * exported object literal that happens to start with a capital — matching those would
 * report a config bag or a lookup table as an adopted namespace, which is worse than
 * reporting nothing.
 *
 * ONE RE-EXPORT HOP IS FOLLOWED, because the entry point a surface must not grow is the
 * one this reader looks at first: the repo rule is that an `index.ts` is barrel re-exports
 * only, and a member per widget plus an import per module would make the barrel mostly
 * construction. So `export { Adw, Gtk } from './namespace.js'` resolves and the
 * declaration is read THERE. Exactly one hop: a chain would make "where is this surface's
 * vocabulary" a search rather than a lookup. A specifier that resolves to nothing THROWS
 * — the surface names a namespace module it does not have, and reporting that as "no
 * namespace" would answer a broken file with the word for an honest absence.
 *
 * THE BINDING IS READ, not only the member name. `Gtk.Entry` naming `AdwEntry` and
 * `Gtk.Entry` naming `AdwButton` are the same member list and different vocabularies,
 * so a consumer that holds the members against the widgets on disk needs the right-hand
 * side too. Shorthand (`{ Bin, Clamp }`) binds a member to its own name.
 *
 * @param {string} root repository root
 * @param {string} srcDir the package's `src`, repo-relative
 * @returns {Map<string, Map<string, string>> | null} namespace → member → bound
 *   identifier, or null if the surface exports no namespace
 */
export function namespaceExport(root, srcDir) {
    const path = join(root, srcDir, 'index.ts');
    if (!existsSync(path)) return null;
    const code = stripComments(readFileSync(path, 'utf8'));
    const found = namespaceMembers(code);
    for (const [, names, specifier] of code.matchAll(NAMESPACE_REEXPORT)) {
        const exported = names.split(',').map((name) => name.trim());
        if (!exported.some((name) => NAMESPACE_NAMES.includes(name))) continue;
        const source = resolveLocalSource(path, specifier);
        if (source === null) {
            throw new Error(
                `${srcDir}/index.ts re-exports ${exported.filter((name) => NAMESPACE_NAMES.includes(name)).join(', ')} ` +
                    `from '${specifier}', which resolves to no source file.`,
            );
        }
        for (const [namespace, members] of namespaceMembers(stripComments(readFileSync(source, 'utf8')))) {
            found.set(namespace, members);
        }
    }
    return found.size === 0 ? null : found;
}
