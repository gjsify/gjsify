#!/usr/bin/env node
// Every widget `@gjsify/adwaita-nativescript` offers for XML use survives being reached
// FROM XML.
//
// WHY THIS IS NOT THE GALLERY'S CHECK
//
// `check-generated-website-data.mjs` holds the 28 templates the website ships. That is
// the wrong scope for this rule twice over: it leaves 46 setters no template happens to
// name unchecked, and it protects nobody who writes their own XML against the PUBLISHED
// package — which is most of the people this port exists for. The gallery's own arm was
// the narrower claim wearing the broader one's words.
//
// WHAT IT CHECKS
//
//   1. Every setter whose DECLARED type is `number` or `boolean` puts the value through
//      `xmlNumber`/`xmlBoolean` (or a `STRING_TOLERANT` normalizer). NativeScript's
//      `setPropertyValue` ends in `instance[name] = value`, so the setter is handed the
//      STRING — and both directions fail silently. MEASURED on an emulator before this
//      existed: `<AdwAvatar size="96">` rendered at 48 because `Number.isFinite('96')`
//      is false, and `<AdwAboutDialog open="false">` OPENED the dialog because
//      `!!'false'` is true. `'true'` working by accident is why this is a rule and not
//      four repairs.
//
//      AND EVERY SETTER IS ACCOUNTED FOR, which is the half that was missing. The first
//      version read declarations with one regex and dropped whatever it could not spell,
//      without a word: MEASURED by putting an uncoerced setter on `AdwAvatar` in four
//      spellings and watching the gate exit 0 each time — `set x(value)` with no
//      annotation (this package compiles with `"strict": false`, so that is legal),
//      `value: Pixels` where `Pixels` is `number`, `value: 1 | 2 | 3`, and
//      `value: (typeof SIZES)[number]`, whose parenthesis no `\(([^)]+)\)` can match.
//      Three of the four did not even move the counter. So the reader parses every
//      declaration, an unreadable one is a FAILURE rather than a skip, and a type an
//      attribute genuinely cannot carry is COUNTED — the totals have to add up to the
//      setters that exist, or "all of them coerce" is a claim about the parser. STRING
//      doors are counted for the same reason and were the last bucket that was not:
//      they need no coercion, so the loop skipped them, so a reader that stopped
//      resolving `string` at all printed the same summary as one that resolved every one.
//   2. No accessor in the package is a GETTER named after one of NativeScript's
//      setter-only accessors. `GridLayoutBase.rows` and `.columns` have setters and no
//      getters, so a same-named getter on a subclass shadows the setter and assignment
//      throws in strict mode — which every NativeScript bundle is. `AdwExpanderRow`
//      shipped `get rows()` for exactly one commit and broke `row.rows = 'auto,*'` for
//      apps that never touch XML.
//   3. Every exemption is checked back: a `STRING_TOLERANT` entry that stops accepting a
//      string, and a `NOT_AN_XML_WIDGET` file that turns up in the `ELEMENTS` map.
//   4. THE THIRD DOOR (ADR 0034 § 4). Every constructible widget class takes the optional
//      construct-props bag and APPLIES it as the last statement of its own constructor.
//      Both halves are the rule: a class that takes `props` and never routes it accepts a
//      bag and drops it, and one that applies it anywhere but last has its own setup
//      overwrite what the caller asked for. Never forwarded to `super()` either — a
//      subclass of a subclass would apply the same bag two or three times, once before its
//      own children exist.
//   5. THE `Gtk.Align` TABLE. Its nick list is `GtkAlignNick`'s, in that order and that
//      spelling; every declared ALIAS names a member that comes before it; and every member
//      is either mapped onto a NativeScript alignment on BOTH axes or refused with a
//      reason. The constants themselves are derived from those two, so there is no number
//      here to get wrong — which matters because nothing in this repository carries GIR
//      enum VALUES and these gates run with no install: `GTK_ALIGN_BASELINE` was deprecated
//      in GTK 4.12 into an alias of `GTK_ALIGN_BASELINE_FILL`, so 2 of the 7 members are
//      NOT their position, and both in-repo shortcuts (the nick order, and `@girs`'s
//      initialiser-less `enum Align`) say otherwise. What this arm CANNOT hold is that one
//      alias declaration; `construct-props.spec.ts` pins the seven derived numbers instead.
//
// Plain Node over the repo's own files — no install, no build. It defines nothing that
// writes, and `nativescript-xml-doors.mjs` beside it is a library for the same reason.
//
// Usage: node scripts/check-nativescript-xml-doors.mjs [--root <dir>]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    attributeKind,
    coerces,
    COERCERS,
    CONSTRUCT_PROPS_APPLIER,
    constructorOf,
    doorFor,
    GTK_HOST_NICKS,
    JSON_DOORS,
    jsonDoors,
    NO_CONSTRUCT_PROPS,
    NOT_AN_XML_WIDGET,
    NS_CONSTRUCT_PROPS,
    NS_GTK_ALIGN,
    NS_WIDGETS_DIR,
    readElements,
    readNickUnion,
    readRecordLiteral,
    readStringArray,
    readTypeSources,
    readWidgets,
    SETTER_ONLY_ON_BASE,
    settersOf,
    stringTolerant,
    STRING_TOLERANT,
    WIDGET_CLASS,
} from './nativescript-xml-doors.mjs';

const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : process.argv[rootFlag + 1];

const failures = [];
const notes = [];

const { sources, files } = readWidgets(ROOT);
const types = readTypeSources(ROOT);
const elements = readElements(ROOT);

if (sources.size === 0) failures.push('no widget source was readable — every arm would pass vacuously');
if (elements.size === 0) failures.push("the widgets barrel's ELEMENTS map read as empty — arm 1 has no corpus");

failures.push(...stringTolerant(ROOT));
failures.push(...jsonDoors(ROOT));

// ---------------------------------------------------------------------------
// 1. every non-string setter reachable from XML coerces
// ---------------------------------------------------------------------------

/** Every class an XML element resolves to, its in-package ancestors included. */
const reachable = new Set();
for (const tag of elements) {
    if (!sources.has(tag)) {
        failures.push(`the ELEMENTS map offers <${tag}> for XML use, but no widget source declares that class.`);
        continue;
    }
    for (let name = tag; name !== undefined && sources.has(name);) {
        reachable.add(name);
        const { text } = sources.get(name);
        name = new RegExp(`export (?:abstract )?class ${name}\\b[^{]*?extends (${WIDGET_CLASS})`).exec(text)?.[1];
    }
}

let checked = 0;
let uncarryable = 0;
let strings = 0;
for (const tag of [...reachable].sort()) {
    const { file, text } = sources.get(tag);
    // Only the setters this class DECLARES; an inherited one is checked on its owner.
    // EVERY one of them, read by {@link settersOf} rather than by a regex that could
    // only spell some: a declaration the reader cannot parse is REPORTED here, because
    // the alternative — the shape this loop used to have — is a setter that produces no
    // finding, does not move the counter, and leaves the arm claiming it held them all.
    for (const setter of settersOf(text)) {
        const { name } = setter;
        if (setter.annotation === null) {
            failures.push(
                `${file}: \`set ${name}(${setter.params ?? '…'})\` declares no type for its parameter, so ` +
                    'nothing here can tell whether an XML attribute may carry it. This package compiles with ' +
                    '`"strict": false`, so the implicit `any` is not a type error either — annotate the ' +
                    'parameter, and the coercion rule applies to it like every other setter.',
            );
            continue;
        }
        const annotation = setter.annotation;
        const kind = attributeKind(types, annotation);
        // A string door needs no coercion — NativeScript hands the setter the raw string
        // and a string is what it wanted. COUNTED anyway, for the reason arm 1's header
        // gives about every other bucket: this was the one skip that moved no counter, so
        // "classified `string`" and "the reader never saw it" printed identically. Measured
        // on ADR 0048: `AdwTabView.selectedPage` went from an object type (uncarryable, 20)
        // to `string | null`, which is the whole claim that NativeScript XML got its tab
        // selection back — and the summary could not say it had.
        if (kind === 'string') {
            strings += 1;
            continue;
        }
        // `null` is "an XML attribute cannot carry this" — an array of options, another
        // View. COUNTED rather than passed over, so the arm's totals add up to the
        // setters it read: a skip nobody counts is how a resolver that stopped
        // understanding a type reads exactly like a package with nothing to check.
        if (kind === null) {
            uncarryable += 1;
            continue;
        }
        checked += 1;
        // A setter that delegates to a LOOSE normalizer must not also narrow it. Both
        // `resolveSpinnerSize` and `normalizeClampSize` `Number.parseFloat`, so
        // `size="24px"` and `maximum-size="50%"` are lengths; wrapping the argument in
        // `xmlNumber` replaces that with `Number` and both fall to the default. That
        // regression shipped in this file's first version and nothing could see it,
        // because "it calls a coercer" was all anything asked.
        const loose = Object.keys(STRING_TOLERANT).find((fn) => setter.executable.includes(`${fn}(`));
        if (kind !== 'json' && loose !== undefined && setter.executable.includes(`${COERCERS[kind]}(`)) {
            failures.push(
                `${file}: ${tag}.${name} passes its value through ${COERCERS[kind]}() AND ${loose}(). ` +
                    `${loose}() already takes a string and parses it with Number.parseFloat, so the wrapper ` +
                    'only NARROWS it — a CSS-ish length like "24px" then falls back to the default. Drop the wrapper.',
            );
            continue;
        }
        if (coerces(setter, kind)) continue;
        failures.push(
            `${file}: ${tag}.${name} is declared \`${annotation}\` and does not go through ` +
                `${doorFor(kind)}(). NativeScript hands a plain accessor the raw STRING, so a number falls ` +
                'back to the default, "false" is truthy, and a JSON object is one long label — all silently, ' +
                'all rendering.',
        );
    }
}
notes.push(`${checked} non-string setter(s) on ${reachable.size} XML-reachable class(es), all coercing`);
notes.push(`${strings} setter(s) an attribute carries as-is, needing no coercion`);
notes.push(`${uncarryable} setter(s) typed as something no XML attribute can carry, held by no rule and counted`);
if (checked === 0) failures.push('no non-string setter was found at all — arm 1 proved nothing');
if (strings === 0) failures.push('no string setter was found at all — the reader stopped resolving `string`');

// ---------------------------------------------------------------------------
// 2. no getter shadows a NativeScript setter-only accessor
// ---------------------------------------------------------------------------

// A getter ALONE is the hazard. A class that declares both halves has taken the name
// over deliberately and answers the assignment itself — `AdwDataGrid` owns `rows` and
// `columns` as its data, with a setter for each, and giving up GridLayout's track
// spelling is the documented trade. What throws is a getter with no setter beside it,
// because the property descriptor then carries `set: undefined`.
let owned = 0;
for (const [file, text] of files) {
    for (const [, name] of text.matchAll(/^ {4}get (\w+)\(\)/gm)) {
        if (!Object.hasOwn(SETTER_ONLY_ON_BASE, name)) continue;
        if (new RegExp(`^ {4}set ${name}\\(`, 'm').test(text)) {
            owned += 1;
            continue;
        }
        failures.push(
            `${file}: \`get ${name}()\` with no \`set ${name}()\` beside it shadows a setter-only accessor — ` +
                `${SETTER_ONLY_ON_BASE[name]} The descriptor then carries \`set: undefined\`, so assigning ` +
                `\`widget.${name} = …\` throws in strict mode, which every NativeScript bundle is. It breaks ` +
                'callers that never touch XML. Rename the getter, or declare a setter that means it.',
        );
    }
}
notes.push(
    `${Object.keys(SETTER_ONLY_ON_BASE).length} setter-only base accessor(s) unshadowed ` +
        `(${owned} deliberately re-declared with both halves)`,
);

// ---------------------------------------------------------------------------
// 3. the exemptions are still true
// ---------------------------------------------------------------------------

for (const [file, why] of Object.entries(NOT_AN_XML_WIDGET)) {
    const text = files.get(file);
    if (text === undefined) {
        failures.push(`NOT_AN_XML_WIDGET names ${NS_WIDGETS_DIR}/${file}, which is not there. Drop the entry.`);
        continue;
    }
    const declared = [...text.matchAll(new RegExp(`export (?:abstract )?class (${WIDGET_CLASS})`, 'g'))].map(
        (m) => m[1],
    );
    const offered = declared.filter((name) => elements.has(name) || reachable.has(name));
    if (offered.length > 0) {
        failures.push(
            `NOT_AN_XML_WIDGET says ${file} is "${why}", but ${offered.join(', ')} IS reachable from XML. ` +
                'Drop the entry — a stale exemption reads as considered.',
        );
    }
}

// ---------------------------------------------------------------------------
// 4. the construct-props bag reaches every widget, and is applied last
// ---------------------------------------------------------------------------

let applierSource = '';
try {
    applierSource = readFileSync(join(ROOT, NS_CONSTRUCT_PROPS), 'utf8');
} catch {
    failures.push(`${NS_CONSTRUCT_PROPS} is not readable — arm 4 has nothing to hold the widgets against.`);
}
if (applierSource !== '' && !applierSource.includes('export function applyConstructProps(')) {
    failures.push(`${NS_CONSTRUCT_PROPS} no longer exports applyConstructProps — every widget below calls it.`);
}

let bagged = 0;
for (const [tag, { file, text }] of [...sources].sort()) {
    const exempt = NO_CONSTRUCT_PROPS[tag];
    const ctor = constructorOf(text, tag);
    if (ctor === null) {
        failures.push(`${file}: ${tag} declares no constructor, so nothing here can offer or refuse the bag.`);
        continue;
    }
    const takes = /\bprops\?: ConstructProps<(\w+)>/.exec(ctor.params);
    const statements = ctor.executable
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
    const applies = statements.filter((line) => line.startsWith(CONSTRUCT_PROPS_APPLIER));
    if (exempt !== undefined) {
        if (takes === null && applies.length === 0) continue;
        failures.push(
            `NO_CONSTRUCT_PROPS says ${tag} does not take a bag because "${exempt}" — but it does now. ` +
                'Drop the entry; a stale exemption reads as considered.',
        );
        continue;
    }
    if (takes === null) {
        failures.push(
            `${file}: ${tag}'s constructor takes no \`props?: ConstructProps<${tag}>\`. Every widget on this ` +
                'surface offers the bag (ADR 0034 § 4), so a caller porting `new Adw.X({ … })` off GJS meets ' +
                'one widget that silently does not. Add it, or declare the class in NO_CONSTRUCT_PROPS.',
        );
        continue;
    }
    if (takes[1] !== tag) {
        failures.push(
            `${file}: ${tag}'s constructor declares \`ConstructProps<${takes[1]}>\`. The bag is typed off the ` +
                'class it constructs, so the wrong one there accepts keys this widget does not have and ' +
                'refuses keys it does — at runtime, where the type said otherwise.',
        );
        continue;
    }
    if (applies.length === 0) {
        failures.push(
            `${file}: ${tag} takes a construct-props bag and never calls ${CONSTRUCT_PROPS_APPLIER}. It ` +
                'accepts the bag and drops it — the silent no-op this whole file exists to refuse, one door over.',
        );
        continue;
    }
    if (applies.length > 1) {
        failures.push(`${file}: ${tag} applies its bag ${applies.length} times; once, last, is the rule.`);
        continue;
    }
    if (statements.at(-1) !== `${CONSTRUCT_PROPS_APPLIER};`) {
        failures.push(
            `${file}: ${tag} applies its bag before the end of its constructor (last statement is ` +
                `\`${statements.at(-1)}\`). A construct property has to WIN over the constructor's own setup, ` +
                'which it only does if nothing runs after it.',
        );
        continue;
    }
    if (/super\([^)]*\bprops\b/.test(ctor.executable)) {
        failures.push(
            `${file}: ${tag} forwards its bag to super(). Each class applies its OWN bag, or a subclass of a ` +
                'subclass applies the same one twice — the second time before its own children exist.',
        );
        continue;
    }
    bagged += 1;
}
notes.push(
    `${bagged} widget class(es) take a construct-props bag and apply it last ` +
        `(${Object.keys(NO_CONSTRUCT_PROPS).length} abstract base(s) declared exempt)`,
);
if (bagged === 0) failures.push('no widget class was found to take a construct-props bag — arm 4 proved nothing');

// ---------------------------------------------------------------------------
// 5. the Gtk.Align table agrees with the GIR-derived nick list
// ---------------------------------------------------------------------------

let alignSource = null;
let nicks = null;
try {
    alignSource = readFileSync(join(ROOT, NS_GTK_ALIGN), 'utf8');
} catch {
    failures.push(`${NS_GTK_ALIGN} is not readable — arm 5 would pass vacuously.`);
}
try {
    nicks = readNickUnion(readFileSync(join(ROOT, GTK_HOST_NICKS), 'utf8'), 'GtkAlignNick');
} catch {
    failures.push(`${GTK_HOST_NICKS} is not readable — arm 5 has no independent side to compare against.`);
}
if (nicks === null && alignSource !== null) {
    failures.push(`${GTK_HOST_NICKS} declares no GtkAlignNick — the table below would be held against nothing.`);
}
if (alignSource !== null && nicks !== null) {
    const order = readStringArray(alignSource, 'GTK_ALIGN_NICKS');
    const aliases = readRecordLiteral(alignSource, 'GTK_ALIGN_ALIASES');
    const horizontal = readRecordLiteral(alignSource, 'NS_HORIZONTAL_ALIGNMENT');
    const vertical = readRecordLiteral(alignSource, 'NS_VERTICAL_ALIGNMENT');
    const refusals = readRecordLiteral(alignSource, 'GTK_ALIGN_REFUSALS');
    const unreadable = [
        ['GTK_ALIGN_NICKS', order],
        ['GTK_ALIGN_ALIASES', aliases],
        ['NS_HORIZONTAL_ALIGNMENT', horizontal],
        ['NS_VERTICAL_ALIGNMENT', vertical],
        ['GTK_ALIGN_REFUSALS', refusals],
    ].filter(([, read]) => read === null);
    if (unreadable.length > 0) {
        failures.push(
            `${NS_GTK_ALIGN}: ${unreadable.map(([name]) => name).join(', ')} could not be read as a flat ` +
                'declaration. A reader that cannot read one has to say so; silence here is a clean bill for ' +
                'a table nothing looked at.',
        );
    } else {
        if (order.join(' ') !== nicks.join(' ')) {
            failures.push(
                `GTK_ALIGN_NICKS is [${order.join(', ')}] where GtkAlignNick in ${GTK_HOST_NICKS} is ` +
                    `[${nicks.join(', ')}]. ORDER is part of the comparison, not only membership: the ` +
                    'constants are derived from this sequence, so a member in the wrong place shifts every ' +
                    'number after it and a misspelling silently loses one.',
            );
        }
        for (const [alias, target] of aliases) {
            const stripped = target.replace(/^'|'$/g, '');
            const at = order.indexOf(alias);
            const to = order.indexOf(stripped);
            if (at === -1) {
                failures.push(`GTK_ALIGN_ALIASES names '${alias}', which is not a Gtk.Align member.`);
            } else if (to === -1) {
                failures.push(`GTK_ALIGN_ALIASES points '${alias}' at '${stripped}', which is not a member.`);
            } else if (to >= at) {
                failures.push(
                    `GTK_ALIGN_ALIASES points '${alias}' at '${stripped}', which does not come before it. An ` +
                        'alias takes the value of a member already counted; pointing forward would make the ' +
                        'derivation depend on a number that does not exist yet.',
                );
            }
        }
        for (const nick of order) {
            const mapped = [horizontal.has(nick), vertical.has(nick)];
            const refused = refusals.has(nick);
            if (mapped[0] !== mapped[1]) {
                failures.push(
                    `Gtk.Align '${nick}' is mapped on one axis and not the other. Every member of this enum ` +
                        'means something on both, or on neither — an axis-shaped hole is the silent omission ' +
                        'ADR 0034 § 1 refuses.',
                );
                continue;
            }
            if (mapped[0] === refused) {
                failures.push(
                    refused
                        ? `Gtk.Align '${nick}' is both mapped onto a NativeScript alignment and declared refused.`
                        : `Gtk.Align '${nick}' is neither mapped onto a NativeScript alignment nor declared in ` +
                              'GTK_ALIGN_REFUSALS with a reason. A member with no counterpart is a DECLARATION ' +
                              '(ADR 0034 § 1), never an absence.',
                );
            }
        }
        for (const [nick, why] of refusals) {
            if (!order.includes(nick)) {
                failures.push(`GTK_ALIGN_REFUSALS names '${nick}', which is not a Gtk.Align member.`);
            } else if (why.length < 20) {
                failures.push(`GTK_ALIGN_REFUSALS['${nick}'] gives no reason worth the name: ${why}`);
            }
        }
        notes.push(
            `${order.length} Gtk.Align member(s) held against GtkAlignNick in order — ` +
                `${horizontal.size} mapped per axis, ${refusals.size} declared refused, ` +
                `${aliases.size} declared alias(es); the constants are derived from those and the alias ` +
                'declaration is the one GIR fact no in-repo oracle can check',
        );
    }
}

for (const note of notes) console.log(`check-nativescript-xml-doors: ${note}`);

if (failures.length > 0) {
    console.error(`\ncheck-nativescript-xml-doors: ${failures.length} problem(s):\n`);
    for (const line of failures) console.error(`  ${line}`);
    process.exit(1);
}

console.log(
    `check-nativescript-xml-doors: OK — ${elements.size} element(s), ` +
        `${Object.keys(STRING_TOLERANT).length} string-tolerant normalizer(s) and ` +
        `${Object.keys(JSON_DOORS).length} JSON door(s) verified.`,
);
