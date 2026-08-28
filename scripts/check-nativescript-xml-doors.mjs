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
//   2. No accessor in the package is a GETTER named after one of NativeScript's
//      setter-only accessors. `GridLayoutBase.rows` and `.columns` have setters and no
//      getters, so a same-named getter on a subclass shadows the setter and assignment
//      throws in strict mode — which every NativeScript bundle is. `AdwExpanderRow`
//      shipped `get rows()` for exactly one commit and broke `row.rows = 'auto,*'` for
//      apps that never touch XML.
//   3. Every exemption is checked back: a `STRING_TOLERANT` entry that stops accepting a
//      string, and a `NOT_AN_XML_WIDGET` file that turns up in the `ELEMENTS` map.
//
// Plain Node over the repo's own files — no install, no build. It defines nothing that
// writes, and `nativescript-xml-doors.mjs` beside it is a library for the same reason.
//
// Usage: node scripts/check-nativescript-xml-doors.mjs [--root <dir>]

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    attributeKind,
    coerces,
    COERCERS,
    NOT_AN_XML_WIDGET,
    NS_WIDGETS_DIR,
    readElements,
    readTypeSources,
    readWidgets,
    SETTER_ONLY_ON_BASE,
    setterOf,
    stringTolerant,
    STRING_TOLERANT,
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
        name = new RegExp(`export (?:abstract )?class ${name}\\b[^{]*?extends (Adw\\w+)`).exec(text)?.[1];
    }
}

let checked = 0;
for (const tag of [...reachable].sort()) {
    const { file, text } = sources.get(tag);
    // Only the setters this class DECLARES; an inherited one is checked on its owner.
    for (const [, name, annotation] of text.matchAll(/^ {4}set (\w+)\(\w+: ([^)]+)\) \{/gm)) {
        const kind = attributeKind(sources, types, annotation.trim());
        if (kind === null || kind === 'string') continue;
        checked += 1;
        const setter = setterOf(sources, tag, name);
        if (setter === null) continue;
        // A setter that delegates to a LOOSE normalizer must not also narrow it. Both
        // `resolveSpinnerSize` and `normalizeClampSize` `Number.parseFloat`, so
        // `size="24px"` and `maximum-size="50%"` are lengths; wrapping the argument in
        // `xmlNumber` replaces that with `Number` and both fall to the default. That
        // regression shipped in this file's first version and nothing could see it,
        // because "it calls a coercer" was all anything asked.
        const loose = Object.keys(STRING_TOLERANT).find((fn) => setter.executable.includes(`${fn}(`));
        if (loose !== undefined && setter.executable.includes(`${COERCERS[kind]}(`)) {
            failures.push(
                `${file}: ${tag}.${name} passes its value through ${COERCERS[kind]}() AND ${loose}(). ` +
                    `${loose}() already takes a string and parses it with Number.parseFloat, so the wrapper ` +
                    'only NARROWS it — a CSS-ish length like "24px" then falls back to the default. Drop the wrapper.',
            );
            continue;
        }
        if (coerces(setter, kind)) continue;
        failures.push(
            `${file}: ${tag}.${name} is declared \`${annotation.trim()}\` and does not go through ` +
                `${COERCERS[kind]}(). NativeScript hands a plain accessor the raw STRING, so a number falls ` +
                'back to the default and "false" is truthy — both silently, both rendering.',
        );
    }
}
notes.push(`${checked} non-string setter(s) on ${reachable.size} XML-reachable class(es), all coercing`);
if (checked === 0) failures.push('no non-string setter was found at all — arm 1 proved nothing');

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
    const declared = [...text.matchAll(/export (?:abstract )?class (Adw\w+)/g)].map((m) => m[1]);
    const offered = declared.filter((name) => elements.has(name) || reachable.has(name));
    if (offered.length > 0) {
        failures.push(
            `NOT_AN_XML_WIDGET says ${file} is "${why}", but ${offered.join(', ')} IS reachable from XML. ` +
                'Drop the entry — a stale exemption reads as considered.',
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
        `${Object.keys(STRING_TOLERANT).length} string-tolerant normalizer(s) verified.`,
);
