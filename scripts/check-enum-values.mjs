#!/usr/bin/env node
// The enum-value oracle annotates the nick lists exactly, and says so about the
// entries it cannot.
//
// WHAT THIS EXISTS FOR
//
// `generated/surface-data.mts` carries `ENUM_NICKS` — the names a GIR enum registers,
// in declaration order — and nothing in this repository carried the NUMBERS. A surface
// with no GI has to hand GTK an integer anyway, and the obvious derivation (count the
// position in the nick list) is wrong on 6 of the 129 enums the vocabulary covers. The
// worst is not an off-by-one: `GtkConstraintStrength.required` is 1001001000 where
// counting answers 0. `generated/enum-values.mts` is the answer, read from the
// installed typelib by `scripts/generate-enum-values.mjs`.
//
// WHICH HALF EACH GATE HOLDS, and why it is two gates and not one
//
// The numbers' SOURCE is a typelib, so the check that holds them against it needs a
// GNOME runtime: that is `gtk-host/src/generated.spec.ts`, which already asks the
// installed GTK whether every emitted NICK is real and now asks the same about every
// emitted VALUE. This file is the other half, and it runs where that one cannot — the
// required `checkout` + `setup-node` job, no install, no GNOME libraries — so it holds
// everything about the artifact that does not need the library: that every nick has a
// number or a stated reason, that no number names a nick the vocabulary does not have,
// and that every alias is declared from BOTH directions.
//
// A committed artifact whose source no gate can reach is exactly the "second truth"
// this repository refuses; the split is what makes it one. Neither half is decoration:
// without this one, a hand edit to the values would ship until somebody ran the GJS
// suite on a machine with GTK; without that one, the numbers would only ever be
// checked against themselves.
//
// THE ALIAS ARM IS THE ONE WORTH READING. Two nicks can name ONE member — GTK 4.12
// deprecated `GTK_ALIGN_BASELINE` into an alias of `GTK_ALIGN_BASELINE_FILL`, so both
// carry 4 and every later member sits one BELOW its position. The artifact keeps both
// nicks with the same number, so nothing is lost, and `ENUM_ALIASES` says which of the
// two a number should be spelled back as. This gate derives the alias groups from the
// VALUES and compares them with that table in both directions, so an alias that appears
// in a future GTK is a failure with a name rather than a silent shift.
//
// Self-tests before it reads the repository: no run of the real scan can show a rule
// that cannot fail, and a reader that has stopped reading looks exactly like a tree
// with nothing wrong in it.
//
// Usage: node scripts/check-enum-values.mjs [--root <dir>]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    ENUM_VALUES_FILE,
    entryKey,
    countingWouldBeWrong,
    groupsByValue,
    readBlock,
    readNickLists,
    readNumberRecord,
    readStringArray,
    readStringRecord,
    splitKey,
    SURFACE_DATA,
} from './enum-values.mjs';

const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : process.argv[rootFlag + 1];

// The floors below are not a claim about how big the vocabulary is. They are what
// separates "every rule passed" from "the reader returned nothing and every loop ran
// zero times" — the failure this repository has paid for often enough to name.
const FLOOR_ENUMS = 100;
const FLOOR_VALUES = 500;

/**
 * Every problem the two texts have with each other.
 *
 * Pure, so the vectors below can hand it a crafted pair and assert the arm fires. The
 * real scan is the same call with the repository's own two files.
 */
export function inspect(surfaceText, valuesText) {
    const failures = [];
    const notes = [];

    const nickLists = readNickLists(surfaceText);
    const values = readNumberRecord(valuesText, 'ENUM_VALUES');
    const aliases = readStringRecord(valuesText, 'ENUM_ALIASES');
    const unavailable = readStringRecord(valuesText, 'ENUM_VALUES_UNAVAILABLE');
    const deprecated = new Set(readStringArray(valuesText, 'ENUM_DEPRECATED'));

    // --- 1. every number names a nick the vocabulary actually offers ---------
    for (const key of values.keys()) {
        const [gtype, nick] = splitKey(key);
        const nicks = nickLists.get(gtype);
        if (!nicks) {
            failures.push(
                `ENUM_VALUES carries ${key}, but ENUM_NICKS in ${SURFACE_DATA} declares no enum ${gtype}. ` +
                    'The values ANNOTATE the nick lists; a number for an enum the vocabulary dropped is a ' +
                    'fact about a library nothing else here describes.',
            );
            continue;
        }
        if (!nicks.includes(nick)) {
            failures.push(
                `ENUM_VALUES carries ${key}, but '${nick}' is not one of ${gtype}'s nicks. A nick spelled ` +
                    'differently from the vocabulary resolves to nothing on the way back out.',
            );
        }
    }

    // --- 2. every nick has a number or a stated reason, never both, never neither ---
    let covered = 0;
    for (const [gtype, nicks] of nickLists) {
        for (const nick of nicks) {
            const key = entryKey(gtype, nick);
            const hasValue = values.has(key);
            const hasReason = unavailable.has(key);
            if (hasValue && hasReason) {
                failures.push(
                    `${key} has a value AND an entry in ENUM_VALUES_UNAVAILABLE. One of the two is stale; ` +
                        'a nick that is excused and answered at once excuses nothing.',
                );
                continue;
            }
            if (!hasValue && !hasReason) {
                failures.push(
                    `${key} is a nick the vocabulary offers and this file gives it neither a value nor a ` +
                        'reason. That is the silent drop the declared remainder exists to prevent — ' +
                        `regenerate with \`gjs -m scripts/generate-enum-values.mjs\`, and if the member is ` +
                        'genuinely absent from your libraries the generator will say so in the table.',
                );
                continue;
            }
            covered += 1;
        }
    }
    for (const [key, why] of unavailable) {
        const [gtype, nick] = splitKey(key);
        if (!nickLists.get(gtype)?.includes(nick)) {
            failures.push(
                `ENUM_VALUES_UNAVAILABLE excuses ${key}, which is not a nick of any enum in ${SURFACE_DATA}. ` +
                    'A stale exemption reads as considered.',
            );
        }
        if (why.trim() === '') {
            failures.push(
                `ENUM_VALUES_UNAVAILABLE excuses ${key} with an empty reason. The value is the library and ` +
                    'version that was asked and had no such member; without it the entry says only that ' +
                    'something went missing.',
            );
        }
    }

    // --- 3. the alias table, held against the numbers in both directions -----
    for (const [key, target] of aliases) {
        const [gtype] = splitKey(key);
        const targetKey = entryKey(gtype, target);
        if (!values.has(key)) {
            failures.push(`ENUM_ALIASES declares ${key}, which has no value in ENUM_VALUES.`);
            continue;
        }
        if (!values.has(targetKey)) {
            failures.push(
                `ENUM_ALIASES points ${key} at '${target}', which is not a valued nick of ${gtype}. An alias ` +
                    'is a second NAME for a member of its own enum, so the target has to be one.',
            );
            continue;
        }
        if (values.get(key) !== values.get(targetKey)) {
            failures.push(
                `ENUM_ALIASES points ${key} (${values.get(key)}) at '${target}' (${values.get(targetKey)}). ` +
                    'Two nicks are aliases when they carry the SAME number; these carry two, so one of the ' +
                    'two tables is wrong about the library.',
            );
            continue;
        }
        if (aliases.has(targetKey)) {
            failures.push(
                `ENUM_ALIASES points ${key} at '${target}', which is itself an alias. The table answers ` +
                    '"which nick should a number be spelled back as", and a chain has no answer.',
            );
        }
    }

    let aliasGroups = 0;
    for (const [gtype, nicks] of nickLists) {
        const groups = groupsByValue(nicks, (nick) => values.get(entryKey(gtype, nick)));
        for (const [value, group] of groups) {
            if (group.length === 1) continue;
            aliasGroups += 1;
            const canonical = group.filter((nick) => !aliases.has(entryKey(gtype, nick)));
            if (canonical.length !== 1) {
                failures.push(
                    `${gtype} spells ${value} as ${group.length} nicks (${group.join(', ')}) and ` +
                        `${canonical.length} of them are undeclared. Exactly one is the name a number is ` +
                        'spelled back as and every other is an ENUM_ALIASES entry pointing at it — ' +
                        'regenerate, or the number has no single spelling.',
                );
                continue;
            }
            // The DIRECTION, from the typelib's own deprecation flag rather than from
            // an ordering convention. GTK deprecated the older of the two GtkAlign
            // names, so on this corpus the two rules agree; the day they do not, this
            // is the one that carries a reason.
            if (
                deprecated.has(entryKey(gtype, canonical[0])) &&
                group.some((n) => !deprecated.has(entryKey(gtype, n)))
            ) {
                failures.push(
                    `${gtype} spells ${value} as ${group.join(', ')} and the one a number is spelled back ` +
                        `as ('${canonical[0]}') is the DEPRECATED one. A live name is beside it; point the ` +
                        'aliases the other way.',
                );
            }
        }
    }

    for (const key of deprecated) {
        if (!values.has(key)) {
            failures.push(
                `ENUM_DEPRECATED names ${key}, which has no value in ENUM_VALUES. It is read off the same ` +
                    'typelib pass as the numbers, so a name here that is not there means the two halves of ' +
                    'one run disagree.',
            );
        }
    }

    // --- 4. non-vacuity, and the finding this artifact exists for ------------
    if (nickLists.size < FLOOR_ENUMS) {
        failures.push(
            `only ${nickLists.size} enum type(s) were read from ${SURFACE_DATA} — under the floor of ` +
                `${FLOOR_ENUMS}, so every rule above ran on almost nothing. The reader has stopped reading.`,
        );
    }
    if (values.size < FLOOR_VALUES) {
        failures.push(
            `only ${values.size} value(s) were read from ${ENUM_VALUES_FILE} — under the floor of ` +
                `${FLOOR_VALUES}. An empty or truncated oracle satisfies every rule above by having nothing ` +
                'to check.',
        );
    }
    if (aliasGroups === 0) {
        failures.push(
            'no enum spells one value under two nicks, so the alias arms checked nothing. GtkAlign has ' +
                'done this since GTK 4.12; if the vocabulary genuinely no longer covers an enum with an ' +
                'alias, this floor is what should be argued with rather than the arms it guards.',
        );
    }

    const wrong = countingWouldBeWrong(nickLists, values);
    if (wrong.length === 0) {
        failures.push(
            "every nick's value equals its position in the nick list, which is what this artifact exists " +
                'because it is NOT. Either the values were counted instead of read, or the corpus lost ' +
                'GtkAlign, GtkResponseType and the four others — and the two want different repairs.',
        );
    }

    notes.push(`${values.size} value(s) over ${nickLists.size} enum type(s), ${covered} nick(s) accounted for`);
    notes.push(
        `${aliases.size} alias(es) over ${aliasGroups} shared value(s), ` +
            `${deprecated.size} deprecated member(s), ${unavailable.size} unavailable on the generating host`,
    );
    notes.push(
        `${wrong.length} enum(s) where a nick's value is NOT its position — ` +
            wrong.map(([gtype, off]) => `${gtype} (${off.length})`).join(', '),
    );
    return { failures, notes };
}

// ---------------------------------------------------------------------------
// self-tests — every arm, and every reader, on a crafted input
// ---------------------------------------------------------------------------

const NICKS = `export const ENUM_NICKS: Readonly<Record<string, readonly string[]>> = {
    GtkAlign: ['fill', 'baseline-fill', 'baseline'],
    GtkOrientation: ['horizontal', 'vertical'],
};`;

const VALUES = `export const ENUM_VALUES: Readonly<Record<string, number>> = {
    'GtkAlign.fill': 0,
    'GtkAlign.baseline-fill': 4,
    'GtkAlign.baseline': 4,
    'GtkOrientation.horizontal': 0,
    'GtkOrientation.vertical': 1,
};
export const ENUM_ALIASES: Readonly<Record<string, string>> = {
    'GtkAlign.baseline': 'baseline-fill',
};
export const ENUM_DEPRECATED: readonly string[] = ['GtkAlign.baseline'];
export const ENUM_VALUES_UNAVAILABLE: Readonly<Record<string, string>> = {};`;

/** The crafted pair is green before anything is broken in it. */
const vectors = [];
const selfTestFailures = [];

const vector = (name, surface, values, expect) => vectors.push({ name, surface, values, expect });

// Each of these must fail, with ITS OWN message — a vector that fails for the wrong
// reason is a rule nobody has tested.
vector(
    'a value for an enum the vocabulary does not declare',
    NICKS,
    VALUES.replace("    'GtkAlign.fill': 0,", "    'GtkAlign.fill': 0,\n    'GtkNoSuchEnum.a': 0,"),
    'declares no enum GtkNoSuchEnum',
);
vector(
    'a value whose nick is not one of the enum has',
    NICKS,
    VALUES.replace("    'GtkAlign.fill': 0,", "    'GtkAlign.fill': 0,\n    'GtkAlign.baseline_fill': 4,"),
    "is not one of GtkAlign's nicks",
);
vector(
    'a nick with neither a value nor a reason',
    NICKS,
    VALUES.replace("    'GtkOrientation.vertical': 1,\n", ''),
    'neither a value nor a reason',
);
vector(
    'a nick with a value AND a reason',
    NICKS,
    VALUES.replace(
        'ENUM_VALUES_UNAVAILABLE: Readonly<Record<string, string>> = {}',
        "ENUM_VALUES_UNAVAILABLE: Readonly<Record<string, string>> = {\n    'GtkAlign.fill': 'Gtk 4.0.0',\n}",
    ),
    'has a value AND an entry in ENUM_VALUES_UNAVAILABLE',
);
vector(
    'an exemption for a nick nothing offers',
    NICKS,
    VALUES.replace(
        'ENUM_VALUES_UNAVAILABLE: Readonly<Record<string, string>> = {}',
        "ENUM_VALUES_UNAVAILABLE: Readonly<Record<string, string>> = {\n    'GtkAlign.gone': 'Gtk 4.0.0',\n}",
    ),
    'which is not a nick of any enum',
);
vector(
    'an exemption with an empty reason',
    NICKS,
    VALUES.replace("    'GtkOrientation.vertical': 1,\n", '').replace(
        'ENUM_VALUES_UNAVAILABLE: Readonly<Record<string, string>> = {}',
        "ENUM_VALUES_UNAVAILABLE: Readonly<Record<string, string>> = {\n    'GtkOrientation.vertical': ' ',\n}",
    ),
    'with an empty reason',
);
vector(
    'an alias pointing at a nick with a different number',
    NICKS,
    VALUES.replace("'GtkAlign.baseline': 'baseline-fill'", "'GtkAlign.baseline': 'fill'"),
    'Two nicks are aliases when they carry the SAME number',
);
vector(
    'an alias pointing outside its enum',
    NICKS,
    VALUES.replace("'GtkAlign.baseline': 'baseline-fill'", "'GtkAlign.baseline': 'vertical'"),
    'is not a valued nick of GtkAlign',
);
vector(
    'a shared value with no alias declared',
    NICKS,
    VALUES.replace("    'GtkAlign.baseline': 'baseline-fill',\n", ''),
    '2 of them are undeclared',
);
vector(
    'an alias pointing at the deprecated half',
    NICKS,
    VALUES.replace("'GtkAlign.baseline': 'baseline-fill'", "'GtkAlign.baseline-fill': 'baseline'"),
    'is the DEPRECATED one',
);
vector(
    'a deprecated member with no value',
    NICKS,
    VALUES.replace("['GtkAlign.baseline']", "['GtkAlign.baseline', 'GtkAlign.nowhere']"),
    'ENUM_DEPRECATED names GtkAlign.nowhere',
);
vector(
    'an oracle whose values are all their positions',
    "export const ENUM_NICKS: Readonly<Record<string, readonly string[]>> = {\n    GtkOrientation: ['horizontal', 'vertical'],\n};",
    "export const ENUM_VALUES: Readonly<Record<string, number>> = {\n    'GtkOrientation.horizontal': 0,\n    'GtkOrientation.vertical': 1,\n};\nexport const ENUM_ALIASES: Readonly<Record<string, string>> = {};\nexport const ENUM_DEPRECATED: readonly string[] = [];\nexport const ENUM_VALUES_UNAVAILABLE: Readonly<Record<string, string>> = {};",
    'which is what this artifact exists because it is NOT',
);

const baseline = inspect(NICKS, VALUES);
// The crafted pair is deliberately TINY, so the two SIZE floors object to it and
// nothing else may: it carries an alias and it carries a value that is not its
// position, so the other two floors are satisfied. Any other count means an arm fires
// on a clean input, which would make every vector below pass for the wrong reason.
if (baseline.failures.length !== 2) {
    selfTestFailures.push(
        `the self-test baseline produced ${baseline.failures.length} failure(s) instead of the two size ` +
            `floors: ${baseline.failures.join(' | ')}`,
    );
}
for (const { name, surface, values, expect } of vectors) {
    let fired = [];
    try {
        fired = inspect(surface, values).failures;
    } catch (error) {
        selfTestFailures.push(`vector "${name}" threw instead of reporting: ${error.message}`);
        continue;
    }
    if (!fired.some((f) => f.includes(expect))) {
        selfTestFailures.push(`vector "${name}" did not produce a failure containing "${expect}"`);
    }
}

// The readers, separately: each must THROW on input it cannot read, because the
// alternative — answering with fewer facts — is the failure mode that makes a green
// run meaningless.
const readerVectors = [
    ['a missing declaration', () => readBlock('const other = {};', 'ENUM_VALUES')],
    ['an unclosed literal', () => readBlock('export const ENUM_VALUES = {', 'ENUM_VALUES')],
    [
        'a nick list entry that is not an array',
        () => readNickLists('export const ENUM_NICKS = {\n    GtkAlign: 3,\n};'),
    ],
    [
        'a nick that is not a quoted string',
        () => readNickLists("export const ENUM_NICKS = {\n    GtkAlign: ['fill', FILL],\n};"),
    ],
    ['an empty nick table', () => readNickLists('export const ENUM_NICKS = {\n};')],
    [
        'a value that is not a number',
        () => readNumberRecord("export const ENUM_VALUES = {\n    'GtkAlign.fill': 'zero',\n};", 'ENUM_VALUES'),
    ],
    [
        'a duplicated value key',
        () =>
            readNumberRecord(
                "export const ENUM_VALUES = {\n    'GtkAlign.fill': 0,\n    'GtkAlign.fill': 1,\n};",
                'ENUM_VALUES',
            ),
    ],
    [
        'a string record entry that is not a string',
        () => readStringRecord("export const ENUM_ALIASES = {\n    'GtkAlign.baseline': 4,\n};", 'ENUM_ALIASES'),
    ],
    [
        'an array item that is not a quoted string',
        () => readStringArray('export const ENUM_DEPRECATED = [FILL];', 'ENUM_DEPRECATED'),
    ],
    ['a key with no dot in it', () => splitKey('GtkAlign')],
];
for (const [name, run] of readerVectors) {
    let threw = false;
    try {
        run();
    } catch {
        // The message is the reader's own; what is under test is that it raises at all.
        threw = true;
    }
    if (!threw) selfTestFailures.push(`reader vector "${name}" returned instead of throwing`);
}

if (selfTestFailures.length > 0) {
    console.error('check-enum-values self-test FAILED — the rules below were not read against the repository:');
    for (const failure of selfTestFailures) console.error(`  - ${failure}`);
    process.exit(1);
}
console.log(`self-test green — ${vectors.length} failing vector(s), ${readerVectors.length} reader vector(s).`);

// ---------------------------------------------------------------------------
// the real scan
// ---------------------------------------------------------------------------

let result;
try {
    result = inspect(
        readFileSync(join(ROOT, SURFACE_DATA), 'utf8'),
        readFileSync(join(ROOT, ENUM_VALUES_FILE), 'utf8'),
    );
} catch (error) {
    console.error(`check-enum-values FAILED to read its inputs: ${error.message}`);
    process.exit(1);
}

for (const note of result.notes) console.log(note);
if (result.failures.length > 0) {
    console.error(`\ncheck-enum-values FAILED — ${result.failures.length} problem(s):`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
    process.exit(1);
}
console.log('the enum-value oracle annotates every nick the vocabulary offers.');
