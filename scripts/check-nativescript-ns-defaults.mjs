#!/usr/bin/env node
// A NativeScript property this package models as always-present must BE always-present.
//
// THE INCIDENT
//
// `@gjsify/adwaita-nativescript` crashed at startup in Learn6502's Android port on a real
// emulator: `TypeError: … reading 'split'`. An `Adw.Clamp` had been given a child with no
// class, `_allocate` handed that child's `className` to `clampChildClassName`, and
// `replaceClasses` split it. NativeScript registers `classNameProperty` with NO
// `defaultValue` (`ui/core/view-base/index.ts:1592`) and `Property`'s getter answers
// `key in this ? this[key] : defaultValue` (`ui/core/properties/index.ts:303`), so an
// unwritten `className` reads `undefined` — which `Gtk.Box` and `Gtk.Label` produce by
// design, their constructors writing no class at all.
//
// TWO READERS BOTH SAID `string`, WHICH IS WHY NOTHING SAW IT. The ambient
// `src/ns-core.d.ts` declared `className: string`, so `gjsify tsc` held every call site
// CORRECT — and that slice is a `declare module`, so it WINS even over a real installed
// `@nativescript/core` (measured), meaning upstream's own types could not have corrected it.
// The off-device double `src/testing/ns-core.mts` initialised its backing field to `''` and
// coerced `value ?? ''` on write, so it could not PRODUCE the value a device produces:
// 1400+ tests passed over a defect that killed the app on launch. A double that smooths an
// edge off the platform cannot report that edge.
//
// WHAT IT CHECKS
//
// `status/nativescript-undefined-defaults.json` lists the members this package models whose
// NativeScript `Property` carries no `defaultValue` — each with the class it is registered
// on and where. For every one, BOTH files must declare a type that admits `undefined`, and
// the double must leave it without an initialiser. Two further arms:
//
//   - a ledger member the slice does not declare at all is a STALE ledger, not a pass;
//   - the same property NAME declared always-present on a class the ledger does not list
//     fails too, so `TabView.items` cannot quietly repeat what `SegmentedBar.items` was
//     measured for. Already-optional spellings elsewhere are fine and are not flagged.
//
// WHY A LEDGER AND NOT A LIVE READ of `@nativescript/core`: it is an OPTIONAL peer, absent
// from the workspace install by design (the package's AGENTS.md), so a check that needed it
// would be a check that never runs. The ledger carries its own provenance and the version it
// was measured against.
//
// THERE IS NO EXEMPTION BUCKET. A member that belongs in the ledger and is declared
// always-present is the defect itself; a reason would only be a reason to keep it.
//
// Plain Node over the repo's own files — no install, no build, no device.
//
// Usage: node scripts/check-nativescript-ns-defaults.mjs [--root <dir>]

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

const SRC = join(ROOT, 'packages/nativescript-bridge/adwaita/src');
const LEDGER = join(ROOT, 'status/nativescript-undefined-defaults.json');

/**
 * The two files that model NativeScript for this package, and what each owes a member.
 *
 * The slice is what `gjsify tsc` holds every call site against; the double is what the
 * off-device suite can actually produce. Getting only one of them right leaves the class
 * half-open — the type would refuse a bad call while the suite still could not reproduce
 * the value, or the suite would produce it while the compiler waved every use through.
 */
const MODELS = [
    { label: 'ambient slice', path: join(SRC, 'ns-core.d.ts'), requiresUninitialised: false },
    { label: 'testing double', path: join(SRC, 'testing/ns-core.mts'), requiresUninitialised: true },
];

/** A declaration admits `undefined` when its type says so or the member is optional. */
function admitsUndefined(member) {
    return member.optional || /(^|[|\s])undefined(\s|$|;)/.test(member.type);
}

/**
 * Members declared directly in each `class`/`interface` body of a TypeScript source.
 *
 * Brace counting rather than a parser: these two files are hand-written declaration
 * surfaces with no generics in a member position deep enough to confuse it, and a real
 * parser would make this gate depend on an install it exists to avoid. A member is
 * recorded with the class it is declared ON, so the same property name on two classes stays
 * two separate facts — `items` is registered on both `ListPickerBase` and
 * `SegmentedBarBase`, and `title` on `SegmentedBarItem` is a plain field with `''` behind it
 * while `ActionBar`'s is a `Property` with no default.
 */
function declaredMembers(source) {
    const members = [];
    const lines = source.split('\n');
    let current = null;
    let depth = 0;
    let classDepth = -1;
    for (const [index, raw] of lines.entries()) {
        const line = raw.replace(/\/\/.*$/, '');
        const opened = line.match(/(?:export\s+)?(?:abstract\s+)?(?:class|interface)\s+(\w+)/);
        if (opened && line.includes('{')) {
            current = opened[1];
            classDepth = depth;
        }
        if (current !== null && depth === classDepth + 1) {
            const member = line.match(/^\s*(?:readonly\s+|declare\s+)?(\w+)(\?)?\s*:\s*([^;=]+?)\s*(?:;|=(.*))?$/);
            if (member && !/^(constructor|if|for|while|return|import|export)$/.test(member[1])) {
                members.push({
                    class: current,
                    name: member[1],
                    optional: member[2] === '?',
                    type: member[3].trim(),
                    initialised: member[4] !== undefined,
                    line: index + 1,
                });
            }
            // An accessor pair models the same member: what a reader gets is the GETTER's
            // return type, and there is no initialiser to speak of. The double spells
            // `className` this way because its setter also rebuilds `cssClasses`.
            const accessor = line.match(/^\s*get\s+(\w+)\s*\(\s*\)\s*:\s*([^{]+?)\s*\{/);
            if (accessor) {
                members.push({
                    class: current,
                    name: accessor[1],
                    optional: false,
                    type: accessor[2].trim(),
                    initialised: false,
                    line: index + 1,
                });
            }
            // `name = value` with no annotation: an inferred, always-present field.
            const inferred = line.match(/^\s*(\w+)\s*=\s*[^=]/);
            if (inferred) {
                members.push({
                    class: current,
                    name: inferred[1],
                    optional: false,
                    type: 'inferred',
                    initialised: true,
                    line: index + 1,
                });
            }
        }
        for (const ch of line) {
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (current !== null && depth <= classDepth) {
                    current = null;
                    classDepth = -1;
                }
            }
        }
    }
    return members;
}

const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
const failures = [];
let held = 0;

if (!Array.isArray(ledger.members) || ledger.members.length === 0) {
    failures.push(`${relative(ROOT, LEDGER)} lists no members — this gate would then hold nothing at all.`);
}

for (const model of MODELS) {
    const source = readFileSync(model.path, 'utf8');
    const members = declaredMembers(source);
    if (members.length === 0) {
        failures.push(
            `${relative(ROOT, model.path)}: the reader found NO declared members. The file moved or its ` +
                'shape changed — a scan that matches nothing reports OK over a tree it never looked at.',
        );
        continue;
    }

    for (const entry of ledger.members) {
        const declared = members.filter((m) => m.class === entry.class && m.name === entry.property);
        if (declared.length === 0) {
            // The double legitimately models fewer classes than the slice does; the slice
            // does not get that excuse, since the ledger is written from it.
            if (model.requiresUninitialised && !members.some((m) => m.class === entry.class)) continue;
            failures.push(
                `${relative(ROOT, model.path)}: the ledger lists \`${entry.class}.${entry.property}\` but the ` +
                    `${model.label} does not declare it. Either the member moved and the ledger is stale, or a ` +
                    'declaration this gate was holding has been deleted — say which, do not just drop the entry.',
            );
            continue;
        }
        for (const member of declared) {
            if (!admitsUndefined(member)) {
                failures.push(
                    `${relative(ROOT, model.path)}:${member.line}: \`${entry.class}.${entry.property}\` is declared ` +
                        `\`${member.type}\`, promising a value NativeScript does not give. Its Property is ` +
                        `registered on \`${entry.registeredOn}\` with no \`defaultValue\` (${entry.source}), so it ` +
                        'reads `undefined` until something writes it. Declare it `| undefined`.',
                );
                continue;
            }
            if (model.requiresUninitialised && member.initialised) {
                failures.push(
                    `${relative(ROOT, model.path)}:${member.line}: \`${entry.class}.${entry.property}\` is ` +
                        'initialised, so this double can never produce the unwritten state a device produces. ' +
                        'That is exactly how the suite stayed green over an app that died on launch — drop the ' +
                        'initialiser.',
                );
                continue;
            }
            held++;
        }
    }

    // The same property name, declared always-present on a class the ledger does not list.
    const ledgerProps = new Set(ledger.members.map((m) => m.property));
    const ledgerPairs = new Set(ledger.members.map((m) => `${m.class}.${m.property}`));
    for (const member of members) {
        if (!ledgerProps.has(member.name)) continue;
        if (ledgerPairs.has(`${member.class}.${member.name}`)) continue;
        if (admitsUndefined(member) && !(model.requiresUninitialised && member.initialised)) continue;
        failures.push(
            `${relative(ROOT, model.path)}:${member.line}: \`${member.class}.${member.name}\` is declared ` +
                'always-present, and that property name is one the ledger records as undefined-until-written on ' +
                'another class. Measure what NativeScript answers for THIS class before the first write, then ' +
                'either add it to the ledger and declare it `| undefined`, or record in the ledger why this one ' +
                'differs.',
        );
    }
}

if (failures.length > 0) {
    console.error(`check-nativescript-ns-defaults: ${failures.length} problem(s):\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
        `\nThe ledger and what each entry was measured from: ${relative(ROOT, LEDGER)}\n` +
            'A property NativeScript leaves unset is not an edge case here: `Gtk.Box` and `Gtk.Label` ship\n' +
            'without a class of their own, and every plain @nativescript/core view a consumer builds is in\n' +
            'the same state.',
    );
    process.exit(1);
}

console.log(
    `check-nativescript-ns-defaults: ${held} declaration(s) across ${MODELS.length} model(s) state what ` +
        `NativeScript answers before the first write (measured against ${ledger.measuredAgainst}).`,
);
