#!/usr/bin/env node
// A collection a widget takes IN stays replaceable while the widget is LIVE.
//
// THE INCIDENT
//
// `<adw-combo-row>` and `<gtk-drop-down>` are the same list widget on GTK and compose the
// SAME `ComboState` here (ADR 0004). The drop-down observed `['options','items','selected',
// 'enable-search','disabled']` and published `options`/`items` setters that rebuild its
// popover. The row observed `['title','subtitle','selected']`, published no accessor at
// all, and parsed `items` once inside `connectedCallback`. So on the row:
//
//   row.items = ['Cyan', 'Magenta'];        // wrote an expando onto the element
//   row.setAttribute('items', '["Only"]');  // reached no attributeChangedCallback
//
// Both silent, both no-ops, and the byte-identical assignment on `<gtk-drop-down>` worked.
// Its NativeScript twin published `set options` all along, so three of the four widgets
// over that one state machine could be updated and the fourth could not. The row's own
// spec had already routed around it — reaching into the PRIVATE `_state` to grow the
// model, with a comment saying `items` is read at connect only — and
// `conformance/rows.ts` recorded that two of its four step ops "have no DOM spelling". The
// gap was written down in two places and held by nothing.
//
// WHY NOTHING ELSE REPORTS IT. `check-adwaita-element-properties.mjs` compares the element
// against the GIR SCALARS and excludes widget-valued properties, which is what
// `Adw.ComboRow:model` is. `check-vocabulary-alignment.mjs` measures ONE surface, the
// NativeScript widgets, and says so. `check-adwaita-connect-rebind.mjs` asks what a second
// CONNECT re-establishes, not what a later ASSIGNMENT reaches. A collection that is never
// replaced after connect looks exactly like one that cannot be.
//
// WHAT IT CHECKS, over the two IMPERATIVE renderers — `@gjsify/adwaita-web`'s custom
// elements and `@gjsify/adwaita-nativescript`'s widgets. (`@gjsify/adwaita-react-native`
// is deliberately out of scope: its widgets take props and Metro re-renders them, so there
// is no post-mount setter for it to be missing.)
//
//   1. A CORE COLLECTION IS REPLACEABLE. Every collection setter on a `@gjsify/adwaita-core`
//      state class — enumerated FROM CORE, so a sixth is in scope the day it is written —
//      must be reached, in every widget that calls it, from a member a CONSUMER can reach:
//      a `set` accessor, a public method, or — on the web — `attributeChangedCallback`,
//      counting ONE hop through a private applier ({@link consumerReachableNames}). A
//      widget whose only call site is `connectedCallback` has a model a consumer cannot
//      replace; reaching into `_state` past the widget is not a path a consumer has.
//   2. PARSED COLLECTION ATTRIBUTES ARE OBSERVED AND ACTED ON (web). An attribute the
//      element parses as a list must be in `observedAttributes` AND named by
//      `attributeChangedCallback`. Membership alone is not the question: delete only the
//      `columns` branch of `<adw-data-grid>`'s callback and `columns` stays observed, its
//      setter stays, and `<adw-data-grid columns='…'>` is dead after connect.
//   3. …AND IS SETTABLE AS THE MATCHING PROPERTY (web). Per COLLECTION, not per widget:
//      `<adw-data-grid>` carries two, and asking only whether the class has SOME list
//      setter let a surviving `set columns` cover a deleted `set rows`.
//
// THIS RULE SET IS THE SECOND ONE. The first made rule 1 COMPARATIVE — widgets over one
// state class had to AGREE, a split being the failure — and defended that with a claim
// that an absolute rule would report five view-switcher widgets fed from a private sync.
// Instrumented, the check never saw that state: `ViewSwitcherState.setPages` is TWO
// browser widgets and both publish `refreshPages()`. What the comparison actually hid was
// this reader's own wrong answer. Both `<adw-view-switcher-bar>` renderers were scored
// taken-once because their `setPages` sits in a private `_rebuild()` — and `_rebuild` is
// called from `attributeChangedCallback` on the web and from public `setStack()`/`refresh()`
// on NativeScript, so the model IS replaceable. The two agreed with each other, so the
// group was internally consistent and the comparison printed OK over two wrong verdicts:
// the exact failure this file exists to catch, occurring inside it. With the one-hop reach
// the tree has ONE widget left that cannot take a replaced model, and rule 1 is absolute.
//
// A GROUP IS STILL ONE CORE CLASS'S COLLECTION, never one setter NAME — `setPages` is
// declared by both `ViewSwitcherState` and `ViewSwitcherBarState`, and merging them would
// put unrelated widgets in one message. So the receiver is RESOLVED (see
// {@link stateFields} for the four declarations that do it), and a receiver that resolves
// to nothing while the name has several owners is a hard failure rather than a guess.
//
// THE LEDGER IS BIDIRECTIONAL. {@link CONNECT_TIME_ONLY} carries the widgets that take
// their collection once on purpose, with the reason and with what would retire it; an
// entry that becomes replaceable FAILS, so the list empties itself instead of rotting into
// a permanent exemption. {@link COLLECTION_CENSUS} is the other half — see § 4.
//
// KNOWN LIMITS, stated rather than papered over. Both are about REACH, and the census in
// § 4 is what keeps either from turning into a silent pass:
//
//   · INHERITANCE. Every reader here works on the tag's OWN class, sliced out of its file.
//     A collection a BASE class owns is invisible: the call site is outside the slice for
//     rule 1, and the `JSON.parse` with it for rules 2 and 3. This is live today —
//     `packages/nativescript-bridge/adwaita/src/widgets/view-switcher-base.ts:184` feeds
//     `ViewSwitcherState.setPages`, and the two NativeScript view-switchers deriving from
//     it are outside the corpus entirely, which is why the census has no entry for them.
//     Measured the other way round: move the pre-fix `<adw-combo-row>`'s connect-time
//     seeding one hop up into a base class and all three rules fall silent on the
//     unchanged bug.
//   · MODULE-LEVEL PARSING. The attribute reader sees a list parsed by a MEMBER of the
//     class — `JSON.parse` inline, or a helper taking the attribute name — not one parsed
//     by a module function. `adw-split-button.ts` has the only such shape today
//     (`parseMenuEntries(this.getAttribute('menu'))`), and rule 1 holds that widget anyway
//     because its collection is `SplitButtonState.setMenuModel`.
//
// Plain Node over the repo's own files — no install, no build — so it runs in
// `audit-runtimes.yml` next to the other repo-scoped Adwaita guards.
//
// Usage: node scripts/check-adwaita-collection-reactivity.mjs [--root <dir>]

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    adwaitaNativeScriptWidgets,
    adwaitaWebElements,
    observedAttributesByClass,
    stripComments,
    tagClass,
} from './adwaita-elements.mjs';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

const CORE_SRC = 'packages/web/adwaita-core/src';

/**
 * Widgets that take their collection ONCE on purpose — `<tag>.<setter>@<renderer>` → why.
 *
 * The bar is a DESIGN the widget's own file already states, plus what would retire it. An
 * entry is a tracked gap, never a verdict that the gap is fine.
 */
const CONNECT_TIME_ONLY = {
    'adw-toggle-group.setLabels@browser': {
        why:
            'The segments ARE the `<adw-toggle>` children — `adw-toggle-group.ts` says so at the ' +
            'class ("Children of <adw-toggle-group>; consumed at connect time") — so the web element ' +
            'has no list property on either side of them to keep alive, while NativeScript names the ' +
            'same list `options` because it has no child markup to read. What closes it is a live ' +
            'child scan, not a setter: upstream `adw_toggle_group_add`/`remove` do work at runtime, ' +
            'and matching them means observing the subtree and rebuilding — which also has to re-run ' +
            'the connect-time accessible-role decision and re-attach the roving tabindex.',
    },
};

/**
 * EVERY collection this reader can see, per widget — `<renderer>/<tag>` → the collections,
 * sorted. A core one is `<StateClass>.<setter>`, a parsed attribute is `attr:<name>`.
 *
 * This is the RATCHET, and it exists because the rules are asked per widget per
 * collection: one this reader stops seeing is asked nothing and answers nothing. It fails
 * in BOTH directions — an undeclared collection is a new one to hold, and a declared one
 * that has gone is either a real removal or a collection that merely MOVED out of reach,
 * which is the same silence wearing a passing exit code.
 *
 * Widgets with no collection are deliberately absent: this is the census of what is HELD,
 * not of what is registered, and `adwaita-elements.mjs` already holds the registered set.
 */
const COLLECTION_CENSUS = {
    'NativeScript/adw-alert-dialog': ['AdwAlertResponses.addResponses'],
    'NativeScript/adw-combo-row': ['ComboState.setOptions'],
    'NativeScript/adw-navigation-view': ['NavigationViewState.replaceWithTags'],
    'NativeScript/adw-sidebar': ['SidebarState.setSections'],
    'NativeScript/adw-split-button': ['SplitButtonState.setMenuModel'],
    'NativeScript/adw-toggle-group': ['ToggleGroupState.setLabels'],
    'NativeScript/adw-view-switcher-bar': ['ViewSwitcherBarState.setPages'],
    'NativeScript/gtk-drop-down': ['ComboState.setOptions'],
    'browser/adw-combo-row': ['ComboState.setOptions', 'attr:items', 'attr:options'],
    'browser/adw-data-grid': ['attr:columns', 'attr:rows'],
    'browser/adw-inline-view-switcher': ['ViewSwitcherState.setPages'],
    'browser/adw-navigation-view': ['NavigationViewState.replaceWithTags'],
    'browser/adw-sidebar': ['SidebarState.setSections'],
    'browser/adw-split-button': ['SplitButtonState.setMenuModel'],
    'browser/adw-toggle-group': ['ToggleGroupState.setLabels'],
    'browser/adw-view-switcher': ['ViewSwitcherState.setPages'],
    'browser/adw-view-switcher-bar': ['ViewSwitcherBarState.setPages'],
    'browser/gtk-drop-down': ['ComboState.setOptions', 'attr:items', 'attr:options'],
};

function fail(lines) {
    console.error(`check-adwaita-collection-reactivity: ${lines.join('\n  ')}`);
    process.exit(1);
}

/** A type annotation that names a LIST — `T[]`, `readonly T[]`, `ReadonlyArray<T>`, `Array<T>`. */
const LIST_TYPE = /\[\s*\]|\bReadonlyArray\s*<|\bArray\s*</;

/** Keywords that can open a `name(` at member indentation without being a member. */
const NOT_A_MEMBER = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'do', 'else']);

/** 1-based line of `index` in `code`, which `stripComments` keeps aligned with the source. */
const lineOf = (code, index) => code.slice(0, index).split('\n').length;

/**
 * The body of `className` in `code`, sliced between class declarations.
 *
 * The same partition `settablePropertiesOfClass` uses, and for the same reason: brace
 * matching needs a string-aware scanner, and a regex one gets a `}` inside a message
 * wrong. `null` when the class is not there — never an empty body, which would read as
 * "this widget has no collections" and make a whole row vanish from the comparison.
 */
function classBody(code, className) {
    const classes = [...code.matchAll(/\bclass\s+([A-Za-z0-9_$]+)/g)];
    const at = classes.findIndex(([, name]) => name === className);
    if (at < 0) return null;
    const from = classes[at].index;
    const to = at + 1 < classes.length ? classes[at + 1].index : code.length;
    return { text: code.slice(from, to), offset: from };
}

/**
 * The members declared directly in a class body — `{ kind, name, index }`, in order.
 *
 * Keyed on the ONE-LEVEL indent oxfmt gives a class member, which is what separates a
 * declaration from a call statement inside a body: `    set options(` against
 * `        this._state.setOptions(`. `oxfmt --check` is what keeps that true, and a member
 * this reader misses would take its call sites with it — so a widget class that yields NO
 * members is a failure below, not a pass.
 */
function membersOfClass(body) {
    const found = [];
    // Single spaces, never `\s*`: a permissive gap after the optional `get`/`set` swallows
    // the NEXT indent level, and `        attachRovingFocus({` — a call inside
    // `connectedCallback` — was read as a member of `<adw-view-switcher>` because of it.
    // Every call site under it then belonged to a member that does not exist.
    const declaration =
        /\n {4}(?:(?:public|private|protected|static|readonly|async|override|abstract) +)*(?:(get|set) +)?([A-Za-z_$#][A-Za-z0-9_$]*) *[(<]/g;
    for (const match of body.matchAll(declaration)) {
        const [, accessor, name] = match;
        if (NOT_A_MEMBER.has(name)) continue;
        found.push({ kind: accessor ?? 'method', name, index: match.index });
    }
    return found;
}

/** The member of `members` that `index` sits inside, or `null` above the first one. */
function memberAt(members, index) {
    let current = null;
    for (const member of members) {
        if (member.index > index) break;
        current = member;
    }
    return current;
}

/** The source text of one member, from its declaration to the next member's. */
function memberText(body, members, member) {
    const next = members.find((candidate) => candidate.index > member.index);
    return body.slice(member.index, next ? next.index : body.length);
}

/** The parameter list of a member, up to the first `)` — enough to read its type. */
function signatureOf(body, members, member) {
    const signature = /^[^)]*\)/.exec(memberText(body, members, member));
    return signature === null ? '' : signature[0];
}

/**
 * A member a CONSUMER can call directly: a property setter, a public method, or the
 * attribute callback — setting an attribute is a consumer action, and the platform routes
 * it here.
 *
 * `connectedCallback`, `constructor` and anything `_`-prefixed are the other side: they
 * run when the widget is BUILT, which is exactly the moment this check is not asking about.
 */
function isPublicMember(member) {
    if (member === null) return false;
    if (member.kind === 'set') return true;
    if (member.kind === 'get') return false;
    if (member.name.startsWith('_') || member.name.startsWith('#')) return false;
    return !['constructor', 'connectedCallback', 'disconnectedCallback'].includes(member.name);
}

/**
 * Member names a consumer's call REACHES: the public ones, plus — ONE hop — the private
 * ones a public member calls.
 *
 * The hop is not a softening, it is the difference between a right and a wrong answer.
 * Both `<adw-view-switcher-bar>` renderers funnel their `setPages` through a private
 * `_rebuild()` that `attributeChangedCallback` (web) and `setStack()`/`refresh()`
 * (NativeScript) call — so the model IS replaceable, and reading only the lexical member
 * scored the pair as taken-once. Routing a setter through one private applier is a shape
 * this tree uses everywhere; a reader that fails it would push authors to inline the
 * applier back into every caller.
 *
 * ONE hop, the same bound `check-adwaita-connect-rebind.mjs`'s `reach()` takes and for the
 * same reason: a transitive walk reports a path because something four methods away
 * mentions the applier, which is not the same claim.
 */
function consumerReachableNames(body, members) {
    const names = new Set();
    for (const member of members) {
        if (!isPublicMember(member)) continue;
        names.add(member.name);
        for (const [, called] of memberText(body, members, member).matchAll(
            /\bthis\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g,
        )) {
            names.add(called);
        }
    }
    return names;
}

// ---------------------------------------------------------------------------
// 1. The core collection setters, read from core.

/** Every non-spec `.ts` under a repo-relative directory, recursively. */
function sourcesUnder(dir) {
    const found = [];
    const walk = (current) => {
        for (const entry of readdirSync(join(ROOT, current), { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            const child = `${current}/${entry.name}`;
            if (entry.isDirectory()) walk(child);
            else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) found.push(child);
        }
    };
    walk(dir);
    return found.sort();
}

/**
 * `setterName` → the core state class(es) declaring it, with where.
 *
 * A COLLECTION setter is a public method of an exported state class whose parameter list
 * names a list. `set x(v: T[])` accessors are deliberately not in here: this map exists to
 * attribute a widget's CALL SITE (`this._state.setOptions(…)`), and an accessor is never
 * called by name.
 */
function coreCollectionSetters() {
    const byName = new Map();
    for (const file of sourcesUnder(CORE_SRC)) {
        const code = stripComments(readFileSync(join(ROOT, file), 'utf8'));
        for (const declaration of code.matchAll(/\bexport\s+class\s+([A-Za-z0-9_$]+)/g)) {
            const className = declaration[1];
            const body = classBody(code, className);
            if (body === null) continue;
            const members = membersOfClass(body.text);
            for (const member of members) {
                if (member.kind !== 'method' || member.name.startsWith('_') || member.name.startsWith('#')) continue;
                if (!LIST_TYPE.test(signatureOf(body.text, members, member))) continue;
                if (!byName.has(member.name)) byName.set(member.name, []);
                byName.get(member.name).push({ className, file, line: lineOf(code, body.offset + member.index) });
            }
        }
    }
    return byName;
}

// ---------------------------------------------------------------------------
// 2. What one widget class does with collections.

/**
 * Read one widget class: its settable collection properties, and the attributes it parses
 * as lists.
 */
function readWidget(text, className, coreClasses) {
    const code = stripComments(text);
    const body = classBody(code, className);
    if (body === null) return null;
    const members = membersOfClass(body.text);
    const lineIn = (index) => lineOf(code, body.offset + index);
    const fields = stateFields(body.text, coreClasses);

    const listSetters = members
        .filter((member) => member.kind === 'set' && LIST_TYPE.test(signatureOf(body.text, members, member)))
        .map((member) => member.name);

    // Members whose body parses JSON — where a collection attribute is read.
    //
    // "IN A MEMBER THAT PARSES" IS NOT "PARSED", and the looser reading was measured wrong
    // on the very element this file was written for: the pre-fix `<adw-combo-row>` reads
    // `getAttribute('selected')` two statements below its `JSON.parse(getAttribute('items'))`,
    // and a member-wide scan reported the scalar `selected` as a collection with no list
    // setter. A check that invents a collection is worse than one that misses it — that
    // claim is what a reader would go and act on. So the literal has to FEED the parse.
    const parsers = members.filter((member) => memberText(body.text, members, member).includes('JSON.parse('));
    const parsedAttributes = new Map();
    for (const parser of parsers) {
        const source = memberText(body.text, members, parser);
        // Locals a `JSON.parse` consumes — the indirect shape both selectors use:
        // `const raw = this.getAttribute('options') ?? this.getAttribute('items');` and,
        // below it, `JSON.parse(raw)`.
        const parsedLocals = [...source.matchAll(/JSON\.parse\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)/g)].map(
            ([, local]) => local,
        );
        // (a) the literal read in a STATEMENT that feeds the parse — directly, or by
        //     declaring one of those locals.
        for (const statement of source.split(';')) {
            const feeds =
                statement.includes('JSON.parse(') ||
                parsedLocals.some((local) => new RegExp(`\\b(?:const|let|var)\\s+${local}\\b`).test(statement));
            if (!feeds) continue;
            for (const [, name] of statement.matchAll(/\bgetAttribute\(\s*['"]([^'"]+)['"]/g)) {
                if (!parsedAttributes.has(name)) parsedAttributes.set(name, lineIn(parser.index));
            }
        }
        // (b) a helper that takes the attribute NAME — its call sites carry the literal.
        if (!source.includes('getAttribute(')) continue;
        for (const match of body.text.matchAll(
            new RegExp(`\\bthis\\.${parser.name}\\s*[(<][^)]*?['"]([^'"]+)['"]`, 'g'),
        )) {
            if (!parsedAttributes.has(match[1])) parsedAttributes.set(match[1], lineIn(match.index));
        }
    }

    return { members, listSetters, parsedAttributes, body, lineIn, stateFields: fields };
}

/**
 * `this.<field>` → the class that field holds, for the state objects a widget composes.
 *
 * Four shapes, all of them in the tree and all of them declarations rather than
 * inferences: a typed field (`_state: ViewSwitcherState = …`), a constructed one
 * (`_state = new ComboState()`), a typed getter (`private get _state(): ViewSwitcherState`
 * — `<adw-view-switcher>` builds its state lazily so a `scheduler` set before connect is
 * the one used), and a `create<Class>()` factory, which is how the NativeScript widgets
 * reach a state they must not construct directly. The factory name is only believed when
 * it spells a class core actually exports.
 */
function stateFields(body, coreClasses) {
    const fields = new Map();
    const remember = (name, className) => {
        if (className && coreClasses.has(className) && !fields.has(name)) fields.set(name, className);
    };
    for (const [, name, type] of body.matchAll(
        /\n {4}(?:(?:public|private|protected|static|readonly) +)*([A-Za-z_$][A-Za-z0-9_$]*) *: *([A-Za-z0-9_$]+)/g,
    )) {
        remember(name, type);
    }
    for (const [, name, type] of body.matchAll(
        /\n {4}(?:(?:public|private|protected|static|abstract) +)*get +([A-Za-z_$][A-Za-z0-9_$]*) *\( *\) *: *([A-Za-z0-9_$]+)/g,
    )) {
        remember(name, type);
    }
    for (const [, name, className] of body.matchAll(
        /(?:this\.)?([A-Za-z_$][A-Za-z0-9_$]*)(?: *: *[^=;]+)? *= *new +([A-Za-z0-9_$]+) *[(<]/g,
    )) {
        remember(name, className);
    }
    for (const [, name, className] of body.matchAll(
        /(?:this\.)?([A-Za-z_$][A-Za-z0-9_$]*)(?: *: *[^=;]+)? *= *create([A-Za-z0-9_$]+) *\(/g,
    )) {
        remember(name, className);
    }
    return fields;
}

/**
 * The attribute names `attributeChangedCallback` ACTS on — every string literal it
 * mentions, plus (one hop) the literals of the private members it calls.
 *
 * Deliberately every literal rather than only `name === 'x'`: the callbacks in this tree
 * spell that test more than one way, and a reader tuned to a single spelling reports the
 * others as dead. Over-accepting here costs a missed branch; under-accepting costs a false
 * failure on correct code, which is what gets a check disabled and then protecting nothing.
 */
function attributeBranches(widget) {
    const acted = new Set();
    const callback = widget.members.find((member) => member.name === 'attributeChangedCallback');
    if (callback === undefined) return acted;
    let source = memberText(widget.body.text, widget.members, callback);
    for (const [, called] of source.matchAll(/\bthis\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
        const hop = widget.members.find((member) => member.name === called && member.kind === 'method');
        if (hop !== undefined) source += `\n${memberText(widget.body.text, widget.members, hop)}`;
    }
    for (const [, literal] of source.matchAll(/['"]([A-Za-z][A-Za-z0-9-]*)['"]/g)) acted.add(literal);
    return acted;
}

/**
 * Every call to `.<setter>(` in a widget body, with the member it sits in and the core
 * class the receiver holds (`null` when the receiver names none — a forwarding helper
 * such as NativeScript's `NavigationStack`, which is not itself a core state).
 */
function coreCallSites(widget, setter) {
    const sites = [];
    for (const match of widget.body.text.matchAll(new RegExp(`\\.${setter}\\s*\\(`, 'g'))) {
        const receiver = /this\.([A-Za-z0-9_$]+)$/.exec(widget.body.text.slice(0, match.index));
        sites.push({
            member: memberAt(widget.members, match.index),
            line: widget.lineIn(match.index),
            owner: receiver === null ? null : (widget.stateFields.get(receiver[1]) ?? null),
        });
    }
    return sites;
}

// ---------------------------------------------------------------------------
// 3. The two corpora, and the rules over them.

const coreSetters = coreCollectionSetters();
if (coreSetters.size === 0) {
    fail([
        `no collection setter was found on any exported state class under ${CORE_SRC}. Either the ` +
            'package moved or the member reader stopped matching — with an empty core set every ' +
            'widget passes rule 1 vacuously, so this is a failure, not a pass.',
    ]);
}
/** The state classes a widget field may be believed to hold. */
const coreClasses = new Set([...coreSetters.values()].flat().map((owner) => owner.className));

const RENDERERS = [
    { label: 'browser', tags: adwaitaWebElements(ROOT), web: true },
    { label: 'NativeScript', tags: adwaitaNativeScriptWidgets(ROOT), web: false },
];

const problems = [];
/** collection → the widgets feeding it, each with whether a consumer can reach it. */
const groups = new Map();
const counts = new Map();
/** `<renderer>/<tag>` → the collections found on it, for the census below. */
const found = new Map();

for (const renderer of RENDERERS) {
    if (renderer.tags.size === 0) {
        fail([
            `${renderer.label} registered no widget at all. A corpus that stops matching passes every ` +
                'rule below, so an empty one is a failure.',
        ]);
    }
    let collections = 0;

    for (const [tag, file] of [...renderer.tags].sort()) {
        const className = tagClass(tag);
        const text = readFileSync(join(ROOT, file), 'utf8');
        const widget = readWidget(text, className, coreClasses);
        if (widget === null) continue;
        // A class with code in it but no readable member is the vacuous pass this whole
        // file exists to refuse — its call sites would read as none. A marker class
        // (`class AdwBottomSheetContent extends HTMLElement {}`, four of them here) has no
        // code and no members, and that is the true answer rather than an unreadable one.
        if (widget.members.length === 0) {
            if (!/\bthis\./.test(widget.body.text)) continue;
            fail([
                `${file}: ${className} has a body but yielded no members. The member reader keys on ` +
                    "oxfmt's four-space class indentation; a class it cannot read has its call sites " +
                    'read as none, which passes rule 1 for the wrong reason.',
            ]);
        }

        const census = [];
        const reachableNames = consumerReachableNames(widget.body.text, widget.members);

        // Rule 1 — collect; the verdict is per widget, with its siblings named, below.
        for (const [setter, owners] of coreSetters) {
            const sites = coreCallSites(widget, setter);
            if (sites.length === 0) continue;
            collections += 1;
            // Which core class this widget's collection IS. A receiver that names one
            // settles it; otherwise the setter's single owner does. A setter with SEVERAL
            // owners and no readable receiver is a guess, and a guess here silently merges
            // two different collections into one comparison — so it fails instead.
            const resolved = [...new Set(sites.map((site) => site.owner).filter((owner) => owner !== null))];
            let owner = resolved[0] ?? (owners.length === 1 ? owners[0].className : null);
            if (resolved.length > 1) owner = null;
            if (owner === null) {
                fail([
                    `${file}:${sites[0].line}: <${tag}> calls \`${setter}\`, which ` +
                        `${owners.map((candidate) => candidate.className).join(' and ')} both declare, through a ` +
                        'receiver this reader cannot resolve to one of them.',
                    '    Declare the field with its type, construct it with `new`, give the getter a return ' +
                        'type, or name the factory `create<Class>` — all four are already in the tree. ' +
                        'Guessing would merge two different collections into one comparison.',
                ]);
            }
            const collection = `${owner}.${setter}`;
            census.push(collection);
            if (!groups.has(collection)) groups.set(collection, []);
            groups.get(collection).push({
                key: `${tag}.${setter}@${renderer.label}`,
                tag,
                setter,
                owner,
                renderer: renderer.label,
                file,
                line: sites[0].line,
                through: [...new Set(sites.map((site) => site.member?.name ?? '<class body>'))],
                reachable: sites.some((site) => site.member !== null && reachableNames.has(site.member.name)),
            });
        }

        if (renderer.web) {
            const observed = new Set(observedAttributesByClass(text).byClass.get(className) ?? []);
            // What `attributeChangedCallback` ACTS on: the attribute names it (or, one hop,
            // a private member it calls) mentions as a literal.
            const acted = attributeBranches(widget);

            for (const [attribute, line] of widget.parsedAttributes) {
                collections += 1;
                census.push(`attr:${attribute}`);

                // Rule 2 — observed AND acted on. Membership alone is not the question:
                // deleting only the `columns` branch of `<adw-data-grid>`'s callback leaves
                // `columns` observed, its setter intact, and the markup spelling dead after
                // connect. The platform calls the callback; a callback that ignores the name
                // is the same silence one layer in.
                if (!observed.has(attribute)) {
                    problems.push(
                        `${file}:${line}: <${tag}> parses \`${attribute}\` as a list but does not observe ` +
                            `it (observedAttributes = [${[...observed].join(', ')}]).`,
                        `    \`<${tag} ${attribute}='…'>\` therefore works once, at connect, and a later ` +
                            'setAttribute reaches no callback at all.',
                        `    Fix: add '${attribute}' to observedAttributes and act on it in ` +
                            'attributeChangedCallback (see `<adw-data-grid>` and `<gtk-drop-down>`).',
                    );
                } else if (!acted.has(attribute)) {
                    problems.push(
                        `${file}:${line}: <${tag}> observes \`${attribute}\` but its ` +
                            'attributeChangedCallback never names it, so the platform delivers the change ' +
                            'and nothing acts on it — a dead spelling that reads as a live one.',
                        `    Fix: branch on '${attribute}' in attributeChangedCallback and re-render from ` +
                            'the parsed model (see `<adw-data-grid>` and `<gtk-drop-down>`).',
                    );
                }

                // Rule 3 — …and the same collection is settable as a property. PER
                // COLLECTION, not per widget: `<adw-data-grid>` carries two, and asking
                // only whether the class has SOME list setter let `set columns` cover a
                // deleted `set rows`.
                const property = attribute.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
                if (widget.listSetters.includes(property)) continue;
                problems.push(
                    `${file}:${line}: <${tag}> takes the \`${attribute}\` collection through the ` +
                        `attribute and publishes no \`${property}\` list setter ` +
                        `(list setters: [${widget.listSetters.join(', ') || 'none'}]), so a JS consumer ` +
                        'has to round-trip that model through JSON.stringify to hand it over.',
                    `    Fix: publish \`set ${property}(value: T[])\` beside the attribute, the way ` +
                        '`<adw-data-grid>` and `<gtk-drop-down>` publish theirs.',
                );
            }
        }

        found.set(`${renderer.label}/${tag}`, census.sort());
    }

    counts.set(renderer.label, collections);
    if (collections === 0) {
        fail([
            `${renderer.label} yielded no collection at all across ${renderer.tags.size} widgets. Both ` +
                'renderers carry several; a reader that finds none is broken, and a check with nothing ' +
                'in scope passes vacuously.',
        ]);
    }
}

// Rule 1 — asked of EVERY widget over a core collection, on its own terms.
const ledgered = new Set();
for (const [collection, widgets] of [...groups].sort()) {
    const live = widgets.filter((widget) => widget.reachable);
    const owner = coreSetters.get(widgets[0].setter).find((candidate) => candidate.className === widgets[0].owner);

    for (const widget of widgets.filter((candidate) => !candidate.reachable)) {
        if (CONNECT_TIME_ONLY[widget.key] !== undefined) {
            ledgered.add(widget.key);
            continue;
        }
        problems.push(
            `${widget.file}:${widget.line}: <${widget.tag}> (${widget.renderer}) feeds ${collection} only ` +
                `from ${widget.through.map((name) => `\`${name}\``).join(', ')}, so a model replaced after ` +
                'the widget is live reaches nothing, silently.',
            ...(live.length === 0
                ? [`    Nothing over ${collection} publishes a path, so there is no sibling to copy from.`]
                : ['    Its siblings over that same state machine publish one:']),
            ...live.map(
                (sibling) =>
                    `      <${sibling.tag}> (${sibling.renderer}) through ` +
                    `${sibling.through.map((name) => `\`${name}\``).join(', ')} — ${sibling.file}:${sibling.line}`,
            ),
            `    The state is ${widget.owner} (${owner?.file}:${owner?.line}); reaching into it past the ` +
                'widget is not a path a consumer has.',
            '    Fix: publish a `set` accessor (or a public method) that forwards to it — one hop through a ' +
                'private applier counts — and, on the web, observe the attribute spelling too. Otherwise ' +
                'ledger it in CONNECT_TIME_ONLY with the design that replaces it.',
        );
    }
}

// The ledger cannot outlive what it explains — in either direction.
for (const [key, entry] of Object.entries(CONNECT_TIME_ONLY)) {
    if (ledgered.has(key)) continue;
    const widget = [...groups.values()].flat().find((candidate) => candidate.key === key);
    if (widget === undefined) {
        problems.push(
            `CONNECT_TIME_ONLY names ${key}, which no widget feeds any more. The collection was renamed, ` +
                'moved or removed — drop the entry rather than leave an exemption nothing is measured ' +
                `against. (It said: ${entry.why.slice(0, 80)}…)`,
        );
        continue;
    }
    problems.push(
        `${widget.file}:${widget.line}: ${key} is ledgered as taken once, but it now reaches the ` +
            `collection from ${widget.through.map((name) => `\`${name}\``).join(', ')}. The exemption is ` +
            'stale — drop it.',
    );
}

// ---------------------------------------------------------------------------
// 4. THE CENSUS — what makes a corpus that SHRINKS go red instead of quiet.
//
// Every rule above is asked PER WIDGET PER COLLECTION, so a collection this reader stops
// seeing is asked nothing and answers nothing. Measured on the pre-fix `<adw-combo-row>`,
// where all three rules fire: move the connect-time seeding one hop up into a base class
// in the same file — behaviour identical, bug still there — and rule 1 loses the call site
// (`classBody` slices the tag's own class), rules 2 and 3 lose the `JSON.parse`, and the
// run prints OK with the browser count down 15 → 12.
//
// A count in a summary line is a human reading CI, which is the "green CI that checked
// nothing" shape one level in. So the collections are NAMED, per widget, and the
// comparison fails in BOTH directions: a new one has to be declared, and one that stops
// being visible fails whether it left the tree or merely left this reader's reach.
const census = [...found].filter(([, list]) => list.length > 0).sort();
const censusSeen = new Set();
for (const [where, list] of census) {
    censusSeen.add(where);
    const declared = COLLECTION_CENSUS[where];
    if (declared === undefined) {
        problems.push(
            `COLLECTION_CENSUS has no entry for ${where}, which carries ${list.join(', ')}. Declare it — ` +
                'the census is what proves this reader still SEES each collection the rules above hold.',
        );
        continue;
    }
    const gone = declared.filter((name) => !list.includes(name));
    const extra = list.filter((name) => !declared.includes(name));
    if (gone.length === 0 && extra.length === 0) continue;
    problems.push(
        `COLLECTION_CENSUS disagrees about ${where}: declared [${declared.join(', ')}], found ` +
            `[${list.join(', ')}].`,
        ...(gone.length > 0
            ? [
                  `    ${gone.join(', ')} is no longer VISIBLE here. If the collection really went, update ` +
                      'the census. If it only MOVED — into a base class, into a helper module — the widget ' +
                      'still has it and every rule above has quietly stopped asking about it.',
              ]
            : []),
        ...(extra.length > 0 ? [`    ${extra.join(', ')} is new — declare it.`] : []),
    );
}
for (const where of Object.keys(COLLECTION_CENSUS)) {
    if (censusSeen.has(where)) continue;
    problems.push(
        `COLLECTION_CENSUS names ${where}, on which this reader now finds no collection at all. The widget ` +
            'was renamed or removed — or its collections moved out of reach and every rule above went quiet ' +
            'on it, which is the failure this census exists to make loud.',
    );
}

if (problems.length > 0) fail(problems);

// The counts are for a reader; the CENSUS is what holds them. Printing both together is
// deliberate — a number in a log line is what this file's first version mistook for a
// mechanism.
console.log(
    `check-adwaita-collection-reactivity: OK — ${coreSetters.size} core collection setter(s) over ` +
        `${groups.size} collection(s); ` +
        `${[...counts].map(([label, n]) => `${n} on ${label}`).join(', ')}, ` +
        `across ${census.length} widget(s), each matching COLLECTION_CENSUS exactly; ` +
        `${Object.keys(CONNECT_TIME_ONLY).length} ledgered as taken once.`,
);
