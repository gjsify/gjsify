#!/usr/bin/env node
// Every icon name `@gjsify/react-native`'s Ionicons map points at is a real one — asked
// of the icon set this repository VENDORS, not of the machine running the check.
//
// THE INCIDENT. The map's targets were verified once, by asking
// `Gtk.IconTheme.has_icon` on the author's desktop, and that assertion shipped as a spec
// vector whose comment read "every TARGET held against the installed icon theme". The
// sentence is honest about the mechanism and blind to the consequence: "the installed
// theme" is not the SAME theme in two environments. `checkmark-symbolic` exists in
// adwaita-icon-theme 50.0 on a current Fedora desktop and not in the CI container's, so
// a map measured on one machine turned CI red on the other — 1 of 94 targets, and the
// map's shape was never wrong. What was wrong is that the only check was a gate on one
// host's theme version.
//
// So the authority moves here, to something that does not move: `packages/web/adwaita-icons`
// vendors the Adwaita symbolic set as source, one `/** <name>-symbolic */` doc comment per
// export. Reading SOURCE is deliberate and is the same choice `check-adwaita-icon-masks.mjs`
// states for itself — this gate runs in `audit-runtimes.yml`, which neither installs nor
// builds, so reading a build artifact would make it pass by finding nothing. It is also
// why the icon NAMES are read rather than the package imported: each export is an inlined
// SVG string, and pulling the set into a consumer costs of the order of a megabyte.
//
// WHAT THIS DOES NOT REPLACE. `surfaces.spec.ts` still asks the installed theme, because
// GTK draws `image-missing` for a name it cannot resolve and reports nothing. The two
// halves answer different questions: this one says the mapping names real icons, that one
// says this host can draw them. Only the first is a property of the code.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MAP = join(ROOT, 'packages/framework/react-native/src/surfaces/icon-map.ts');
const VENDORED = join(ROOT, 'packages/web/adwaita-icons');

const problems = [];
const fail = (message) => problems.push(message);

/**
 * The icon names the vendored set carries.
 *
 * From the `/** <name>-symbolic *\/` doc comment above each export, not from the export
 * IDENTIFIER: the identifier is camelCase and the round trip back to a kebab name is
 * lossy in both directions (`view-more-horizontal` and `viewMoreHorizontal` agree, but
 * a numeral or an RTL suffix does not survive a mechanical inversion). The comment is
 * the name GTK is asked for, which is the thing being checked.
 */
export function vendoredIconNames(sources) {
    const names = new Set();
    for (const source of sources) {
        for (const match of source.matchAll(/^\/\*\* ([a-z0-9-]+-symbolic) \*\//gm)) names.add(match[1]);
    }
    return names;
}

/** The `(ionicon, target)` pairs the map declares. */
export function iconMapPairs(source) {
    const start = source.indexOf('export const IONICONS');
    if (start === -1) throw new Error('IONICONS declaration not found');
    const end = source.indexOf('\n};', start);
    if (end === -1) throw new Error('IONICONS literal is not terminated');
    const pairs = [];
    // A `//` line inside the literal is a comment, and a comment may legally mention a
    // name in quotes — the anchored key-then-value shape is what keeps one out.
    for (const line of source.slice(start, end).split('\n')) {
        const match = /^ {4}'?([A-Za-z0-9-]+)'?:\s*'([a-z0-9-]+)',$/.exec(line);
        if (match) pairs.push({ ionicon: match[1], target: match[2] });
    }
    return pairs;
}

// --- self-test ---------------------------------------------------------------
//
// The negatives carry it, as everywhere else here: a parser that also picked up a
// commented-out row would report a mapping that does not exist, and one that missed the
// quoted-key form would check two thirds of the table and say nothing.

function selfTest() {
    let vectors = 0;
    const ok = (name, actual, expected) => {
        vectors++;
        const a = JSON.stringify(actual);
        const e = JSON.stringify(expected);
        if (a !== e) fail(`self-test ${name}: expected ${e}, got ${a}`);
    };
    const wrap = (inner) => `export const IONICONS: Readonly<Record<string, string>> = {\n${inner}\n};\n`;

    ok('a bare key', iconMapPairs(wrap("    home: 'go-home-symbolic',")), [
        { ionicon: 'home', target: 'go-home-symbolic' },
    ]);
    ok(
        'a QUOTED key, which two thirds of the table uses',
        iconMapPairs(wrap("    'chevron-back': 'go-previous-symbolic',")),
        [{ ionicon: 'chevron-back', target: 'go-previous-symbolic' }],
    );
    ok('several rows', iconMapPairs(wrap("    a: 'x-symbolic',\n    b: 'y-symbolic',")).length, 2);
    // Negatives.
    ok('a commented-out row is not a mapping', iconMapPairs(wrap("    // gone: 'x-symbolic',\n    a: 'y-symbolic',")), [
        { ionicon: 'a', target: 'y-symbolic' },
    ]);
    ok(
        'a prose comment naming an icon is not a mapping',
        iconMapPairs(wrap("    // see 'x-symbolic' below\n    a: 'y-symbolic',")),
        [{ ionicon: 'a', target: 'y-symbolic' }],
    );
    vectors++;
    let threw = false;
    try {
        iconMapPairs('nothing here');
    } catch {
        threw = true;
    }
    if (!threw) fail('self-test: a source without the declaration must throw, not return []');

    ok(
        'reads a vendored name out of its doc comment',
        [...vendoredIconNames(['/** object-select-symbolic */\nexport const objectSelectSymbolic = `<svg/>`;'])],
        ['object-select-symbolic'],
    );
    ok(
        'does not read a name out of prose',
        [...vendoredIconNames(['// mentions object-select-symbolic in passing'])],
        [],
    );
    return vectors;
}

const label = 'check-rn-icon-targets';
const vectors = selfTest();

const sources = readdirSync(VENDORED)
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => readFileSync(join(VENDORED, entry), 'utf8'));
const vendored = vendoredIconNames(sources);
if (vendored.size === 0) {
    // A vacuous authority would let every target through. This is the check that stops
    // a refactor of the vendored package turning this gate into a formality.
    fail(`no icon names found in ${VENDORED} — the authority is empty, so nothing below was really checked`);
}

const pairs = iconMapPairs(readFileSync(MAP, 'utf8'));
if (pairs.length === 0) fail('the Ionicons map declares no rows at all');

const unknown = pairs.filter((pair) => !vendored.has(pair.target));
if (unknown.length > 0) {
    fail(
        `${unknown.length} target(s) name an icon the vendored Adwaita set does not carry:\n` +
            unknown.map((p) => `  ${p.ionicon} -> ${p.target}`).join('\n') +
            `\n  Either the name is a typo, or it is NEWER than the set this repository pins — ` +
            `\`checkmark-symbolic\` was the second case and it turned CI red on a container whose ` +
            `adwaita-icon-theme predates it. Pick a name the vendored set has.`,
    );
}

if (problems.length > 0) {
    for (const problem of problems) console.error(`${label}: ${problem}`);
    console.error(`${label}: FAILED`);
    process.exit(1);
}
console.log(`${label}: self-test green — ${vectors} vector(s).`);
console.log(
    `${label}: ${pairs.length} Ionicons row(s) over ${new Set(pairs.map((p) => p.target)).size} distinct target(s), ` +
        `all present in the ${vendored.size} names packages/web/adwaita-icons vendors.`,
);
