#!/usr/bin/env node
// A collection a widget takes IN stays replaceable while the widget is LIVE — and two
// widgets sharing one core collection agree about it.
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
//   1. SHARED COLLECTIONS AGREE. Every collection setter on a `@gjsify/adwaita-core` state
//      class — enumerated FROM CORE, so a sixth one is in scope the day it is written —
//      groups the widgets that call it. Within a group, either every widget reaches it
//      from a member a CONSUMER can reach (a `set` accessor, a public method, or — on the
//      web — `attributeChangedCallback`), or none does. A SPLIT is the failure.
//
//      Comparative, not absolute, and that is the point: `ViewSwitcherState.setPages` is
//      fed from a private sync on all five widgets that carry it, because a view
//      switcher's pages are DERIVED from the stack rather than handed to it. Asking each
//      widget in isolation "is this replaceable" would report all five, which is how a
//      check with a high false-positive rate gets disabled and then protects nothing
//      (`check-adwaita-element-properties.mjs`' header records the same lesson). Asking
//      whether the widgets over ONE state machine answer alike reports neither those five
//      nor the derived collections, and does report a fourth widget that cannot be
//      updated while three siblings can.
//
//   2. PARSED COLLECTION ATTRIBUTES ARE OBSERVED (web). An attribute the element parses as
//      a list must be in that class's `observedAttributes`, or the markup spelling is the
//      dead one — `<adw-combo-row items='…'>` exactly. Absolute, because there is nothing
//      to compare: an unobserved attribute is inert on its own terms.
//   3. A PARSED COLLECTION IS ALSO A PROPERTY (web). An element that reads a collection out
//      of an attribute must publish a settable collection property too. Which NAME is not
//      asked: `<adw-split-button>` takes `menu=` and publishes `menuItems`, and that is a
//      vocabulary question this check has no business settling. Whether a JS consumer can
//      hand it a list at all is this one's.
//
// A GROUP IS ONE CORE CLASS'S COLLECTION, never one setter NAME, and the difference is
// load-bearing: `setPages` is declared by BOTH `ViewSwitcherState` and
// `ViewSwitcherBarState`, whose widgets legitimately answer differently —
// `<adw-view-switcher>` publishes `refreshPages()` (its MutationObserver drives it), and
// `<adw-view-switcher-bar>` has no list of its own at all, its pages being the stack's.
// Merged under the name, that pair reads as a split and reports two widgets that are
// right. So the receiver is RESOLVED — see {@link stateFields} for the four declarations
// that do it — and a receiver that resolves to nothing while the name has several owners
// is a hard failure, because a guess there merges two collections into one comparison in
// silence.
//
// THE LEDGER IS BIDIRECTIONAL. {@link CONNECT_TIME_ONLY} carries the widgets that take
// their collection once on purpose, with the reason and with what its siblings do instead;
// an entry that becomes replaceable FAILS, so the list empties itself instead of rotting
// into a permanent exemption.
//
// KNOWN LIMIT, stated rather than papered over: the attribute reader (rules 2 and 3) sees
// a list parsed by a member of the class — `JSON.parse` inline, or a helper that takes the
// attribute name — and not one parsed by a MODULE-level function. `adw-split-button.ts`
// has the only such shape today (`parseMenuEntries(this.getAttribute('menu'))`), and rule 1
// covers that widget anyway because its collection is `SplitButtonState.setMenuModel`. A
// non-core collection parsed through a module helper would be invisible here; there is
// none, and the counts this prints are what would show one arriving.
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
 * Widgets that take their collection ONCE while a sibling over the same state machine
 * takes it live — `<tag>.<setter>@<renderer>` → why.
 *
 * The bar is a DESIGN the widget's own file already states, plus what would retire it. An
 * entry is a tracked gap, never a verdict that the split is fine.
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
 * A member a CONSUMER can reach: a property setter, a public method, or the attribute
 * callback — setting an attribute is a consumer action, and the platform routes it here.
 *
 * `connectedCallback`, `constructor` and anything `_`-prefixed are the other side: they
 * run when the widget is BUILT, which is exactly the moment this check is not asking about.
 */
function isConsumerReachable(member) {
    if (member === null) return false;
    if (member.kind === 'set') return true;
    if (member.kind === 'get') return false;
    if (member.name.startsWith('_') || member.name.startsWith('#')) return false;
    return !['constructor', 'connectedCallback', 'disconnectedCallback'].includes(member.name);
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
    const parsers = members.filter((member) => memberText(body.text, members, member).includes('JSON.parse('));
    const parsedAttributes = new Map();
    for (const parser of parsers) {
        const source = memberText(body.text, members, parser);
        // (a) the literal read inside the parsing member itself.
        for (const [, name] of source.matchAll(/\bgetAttribute\(\s*['"]([^'"]+)['"]/g)) {
            if (!parsedAttributes.has(name)) parsedAttributes.set(name, lineIn(parser.index));
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
/** setter → the widgets feeding it, each with whether a consumer can reach it. */
const groups = new Map();
const counts = new Map();

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

        // Rule 1 — collect; the agreement is decided per group, below.
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
                reachable: sites.some((site) => isConsumerReachable(site.member)),
            });
        }

        if (!renderer.web) continue;
        const observed = new Set(observedAttributesByClass(text).byClass.get(className) ?? []);

        // Rule 2 — a parsed collection attribute is observed.
        for (const [attribute, line] of widget.parsedAttributes) {
            collections += 1;
            if (observed.has(attribute)) continue;
            problems.push(
                `${file}:${line}: <${tag}> parses \`${attribute}\` as a list but does not observe it ` +
                    `(observedAttributes = [${[...observed].join(', ')}]).`,
                `    \`<${tag} ${attribute}='…'>\` therefore works once, at connect, and a later ` +
                    'setAttribute reaches no callback at all.',
                `    Fix: add '${attribute}' to observedAttributes and act on it in ` +
                    'attributeChangedCallback (see `<adw-data-grid>` and `<gtk-drop-down>`).',
            );
        }

        // Rule 3 — …and is reachable as a property too.
        if (widget.parsedAttributes.size > 0 && widget.listSetters.length === 0) {
            const [attribute, line] = [...widget.parsedAttributes][0];
            problems.push(
                `${file}:${line}: <${tag}> takes a collection through the \`${attribute}\` attribute and ` +
                    'publishes no settable list property, so a JS consumer has to round-trip its model ' +
                    'through JSON.stringify to hand it over.',
                '    Fix: publish the list as a property. The NAME is not asked here — `<adw-split-button>` ' +
                    'takes `menu=` and publishes `menuItems` — only that one exists.',
            );
        }
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

// Rule 1 — the agreement, per core collection.
const ledgered = new Set();
for (const [collection, widgets] of [...groups].sort()) {
    const live = widgets.filter((widget) => widget.reachable);
    const once = widgets.filter((widget) => !widget.reachable);
    if (live.length === 0 || once.length === 0) continue;
    const owner = coreSetters.get(widgets[0].setter).find((candidate) => candidate.className === widgets[0].owner);

    for (const widget of once) {
        if (CONNECT_TIME_ONLY[widget.key] !== undefined) {
            ledgered.add(widget.key);
            continue;
        }
        problems.push(
            `${widget.file}:${widget.line}: <${widget.tag}> (${widget.renderer}) feeds ${collection} only ` +
                `from ${widget.through.map((name) => `\`${name}\``).join(', ')}, so a model replaced after ` +
                'the widget is live reaches nothing, silently — while its siblings over that same state ' +
                'machine take one:',
            ...live.map(
                (sibling) =>
                    `      <${sibling.tag}> (${sibling.renderer}) through ` +
                    `${sibling.through.map((name) => `\`${name}\``).join(', ')} — ${sibling.file}:${sibling.line}`,
            ),
            `    The state is ${widget.owner} (${owner?.file}:${owner?.line}); reaching into it past the ` +
                'widget is not a path a consumer has.',
            '    Fix: publish a `set` accessor (or a public method) that forwards to it — and, on the web, ' +
                'observe the attribute spelling too. Otherwise ledger it in CONNECT_TIME_ONLY with the ' +
                'design that replaces it.',
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
            `collection from ${widget.through.map((name) => `\`${name}\``).join(', ')}, or no sibling ` +
            'disagrees with it any more. Either way the exemption is stale — drop it.',
    );
}

if (problems.length > 0) fail(problems);

console.log(
    `check-adwaita-collection-reactivity: OK — ${coreSetters.size} core collection setter(s) over ` +
        `${groups.size} widget group(s); ` +
        `${[...counts].map(([label, n]) => `${n} collection(s) on ${label}`).join(', ')}; ` +
        `${Object.keys(CONNECT_TIME_ONLY).length} ledgered as taken once.`,
);
