// Read the Adwaita token declarations ONCE and emit every consumer's shape from that
// read.
//
// Replaces `website/scripts/generate-theming-tokens.mjs`, which read the same
// stylesheet for the website alone. A second reader of one source is a second truth:
// measured across this tree, the same values already live in NINE registers and four
// notations, and three of them disagree (`#1c71d8` vs `#0461be` for the standalone
// accent — `packages/web/adwaita-web/src/accent.ts:19` calls that one "a pre-existing
// inconsistency" and it is still live). This script does not fix those; it removes the
// one duplication it is in a position to remove, and gives the rest a place to
// converge on.
//
// SOURCE. `scss/_variables.scss`'s `light-theme` mixin and `_theme.scss`'s `dark-theme`
// mixin. A mixin rather than a bare `:root` because `.theme-light` includes the same
// tokens for a subtree opt-out — the stylesheet says why. Unlike the generator this
// replaces, the DARK values are read too: a token file that a GTK or React Native
// consumer configures once has no cascade to re-declare names in, so "the dark block
// re-declares the same names" is not an answer there, it is the missing half.
//
// EMISSIONS.
//   1. `packages/web/adwaita-core/src/tokens.generated.ts` — light+dark per token.
//      adwaita-core because it is the only Adwaita package every surface can import:
//      all four runtime slots `polyfill`, `headless: true`. `adwaita-web` holds the
//      SOURCE but is browser-only (`gjs:none, node:none, nativescript:none`), so it
//      cannot be the home of a value React Native has to read.
//   2. `website/src/data/adwaita-tokens.ts` — the light-only grouped shape the theming
//      page already renders, byte-compatible with what it consumed before.
//
// This script lives in `scripts/` rather than in either package because it reads one
// and writes both, the same position `scripts/adwaita-elements.mjs` already occupies.
// Putting it in `adwaita-core` would have it read its own dependent at build time.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const scssDir = join(repoRoot, 'packages/web/adwaita-web/scss');
const lightSource = join(scssDir, '_variables.scss');
const darkSource = join(scssDir, '_theme.scss');
const coreOut = join(repoRoot, 'packages/web/adwaita-core/src/tokens.generated.ts');
const websiteOut = join(repoRoot, 'website/src/data/adwaita-tokens.ts');

const CHECK = process.argv.includes('--check');

/** Pull one `@mixin <name> { … }` body out of a stylesheet. Braces do not nest inside. */
function mixinBody(css, name, source) {
    const match = css.match(new RegExp(`@mixin\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
    if (!match) {
        console.error(
            `generate-adwaita-tokens: no \`@mixin ${name}\` in ${source} — the scan is broken, not the stylesheet.`,
        );
        process.exit(1);
    }
    return match[1];
}

const DECL_RE = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/;
const COMMENT_RE = /^\s*\/\//;

/**
 * The unit of a section heading is the comment BLOCK, not the comment line.
 *
 * The stylesheet's comments are paragraphs about GTK internals, not one-line captions,
 * and a paragraph is a caption for the declaration it sits above. Two ways to get this
 * wrong, and this generator's history has both:
 *
 *   · Match any comment line starting with a capital (the generator this replaces).
 *     The LAST match before a declaration wins, so a paragraph's closing line became
 *     the title — 6 of 20 committed titles were mid-sentence fragments, rendered as
 *     section headers on the theming page.
 *   · Match the comment line directly above a declaration. Same failure, arrived at
 *     from the other side: it is the paragraph's closing line by construction.
 *
 * So: take consecutive comment lines as one block, treat the block as a heading when a
 * declaration follows it, and title it with the block's FIRST SENTENCE. `Window` and
 * `Cards / boxed lists` are one-line blocks and come through whole; a three-line
 * paragraph about separators is titled "Hairline separators (header underline,
 * sidebar/pane dividers)" rather than by whichever line happened to be last.
 */
function headingTitle(blockLines) {
    const text = blockLines
        .map((line) =>
            line
                .replace(/^\s*\/\/\s?/, '')
                .replace(/\s*-+\s*$/, '')
                .trim(),
        )
        .join(' ')
        .trim();
    // A block of nothing but rule characters is a divider, not a caption. The strip
    // above runs PER LINE and takes only the last dash run, so `// ---- ----` survives
    // it as the title `----` and would render as a section header.
    if (!/[\p{L}\p{N}]/u.test(text)) return '';
    // `. ` and not `.`, so `(\`_colors.scss:79,141\`).` stays one sentence.
    const end = text.indexOf('. ');
    return (end === -1 ? text : text.slice(0, end + 1)).replace(/\.$/, '').trim();
}

/** `[{title, tokens: [{name, value}]}]` from a mixin body, grouped by its own headings. */
function parseGroups(body) {
    const lines = body.split('\n');
    const groups = [];
    let current = { title: 'General', tokens: [] };
    for (let i = 0; i < lines.length; i++) {
        if (COMMENT_RE.test(lines[i])) {
            const block = [];
            while (i < lines.length && COMMENT_RE.test(lines[i])) block.push(lines[i++]);
            // The first non-blank line after the block decides whether it captioned
            // anything. A trailing paragraph that captions nothing is not a section.
            let next = i;
            while (next < lines.length && lines[next].trim() === '') next++;
            if (next < lines.length && DECL_RE.test(lines[next])) {
                const title = headingTitle(block);
                if (title !== '') {
                    if (current.tokens.length > 0) groups.push(current);
                    current = { title, tokens: [] };
                }
            }
            i--; // the outer loop's `i++` re-reads the line the inner loop stopped on
            continue;
        }
        const decl = DECL_RE.exec(lines[i]);
        if (decl) current.tokens.push({ name: decl[1], value: decl[2].trim() });
    }
    if (current.tokens.length > 0) groups.push(current);
    return groups;
}

/** `{ '--name': 'value' }` from a mixin body, ignoring structure. */
function parseFlat(body) {
    const out = {};
    for (const line of body.split('\n')) {
        const decl = DECL_RE.exec(line);
        if (decl) out[decl[1]] = decl[2].trim();
    }
    return out;
}

// ------------------------------------------------------------------ self-test

/**
 * `[what it holds, a mixin body, the shape it must parse to]`.
 *
 * Run on EVERY invocation, this repo's own shape for a reader: a reader with no
 * fixtures behind it reports its own bugs as facts about the stylesheet, and this one
 * is walked by hand — `parseGroups` steps its own index through a comment block and
 * hands it back to the loop, and `headingTitle` decides where a sentence ends.
 *
 * Every row is a shape that was measured, not imagined. The divider row is the one
 * that was WRONG: the trailing-dash strip runs per line and takes only the last run,
 * so `// ---- ----` came through as the section title `----`.
 *
 * The orphan row pins a rule `assertFullyRead` now makes unreachable from a real
 * stylesheet, and it stays because it is the ONLY input that tells the "captions
 * nothing" test apart from `parseGroups` dropping an empty group at the end: measured,
 * deleting that test leaves every other row here green.
 */
const PARSER_VECTORS = [
    ['a one-line caption titles what follows it', '// Window\n--a: 1;', 'Window=--a'],
    [
        'a paragraph is titled by its FIRST sentence, not its last line',
        '// Hairline separators. Subtle in\n// BOTH themes, the way libadwaita draws them.\n--a: 1;',
        'Hairline separators=--a',
    ],
    ['a blank line between caption and declaration still captions it', '// Window\n\n--a: 1;', 'Window=--a'],
    ['a trailing paragraph captions nothing and is not a section', '--a: 1;\n\n// A closing note', 'General=--a'],
    ['a comment block at the very end does not run off the body', '--a: 1;\n// last line of the file', 'General=--a'],
    [
        'a block followed by neither blank nor declaration captions nothing',
        '--a: 1;\n// Orphan\nnot-a-declaration\n--b: 2;',
        'General=--a+--b',
    ],
    [
        'of two blocks split by a blank, the one touching the declaration wins',
        '// Orphan\n\n// Real\n--a: 1;',
        'Real=--a',
    ],
    ['a block of rule characters is a divider, not a heading', '// ---- ----\n--a: 1;', 'General=--a'],
    ['a block of nothing but `//` has no title to give', '//\n//\n--a: 1;', 'General=--a'],
    ['a first sentence that is empty is no title either', '// . Not a sentence\n--a: 1;', 'General=--a'],
    ['prose with no declaration under it yields no group at all', '// only prose', ''],
];

const parserFailures = PARSER_VECTORS.flatMap(([label, body, expected]) => {
    const parsed = parseGroups(body)
        .map((group) => `${group.title}=${group.tokens.map((token) => token.name).join('+')}`)
        .join(' | ');
    return parsed === expected ? [] : [`${label} — expected \`${expected}\`, parsed \`${parsed}\``];
});
if (parserFailures.length > 0) {
    console.error('generate-adwaita-tokens: SELF-TEST failed. The reader is broken, so nothing it goes on to');
    console.error('  say about the stylesheet can be believed:');
    for (const failure of parserFailures) console.error(`  - ${failure}`);
    process.exit(1);
}

/**
 * Every line of a mixin body is a comment, a blank, or a declaration `DECL_RE` reads.
 *
 * Anything else is a token dropped with no signal: a value wrapped over two lines, an
 * uppercase custom property (`--Foo` is a distinct property to CSS and no property at
 * all to `DECL_RE`), a nested `@media`. The emission would simply be missing it, and
 * every check downstream compares that emission with itself.
 */
function assertFullyRead(body, source) {
    const stray = body
        .split('\n')
        .filter((line) => line.trim() !== '' && !COMMENT_RE.test(line) && !DECL_RE.test(line));
    if (stray.length === 0) return;
    console.error(
        `generate-adwaita-tokens: ${stray.length} line(s) in ${source} that this reader does not\n` +
            '  understand, and a line it cannot read is a token it drops without saying so:\n' +
            stray.map((line) => `    ${line.trim()}`).join('\n'),
    );
    process.exit(1);
}

const lightBody = mixinBody(readFileSync(lightSource, 'utf8'), 'light-theme', lightSource);
const darkBody = mixinBody(readFileSync(darkSource, 'utf8'), 'dark-theme', darkSource);
assertFullyRead(lightBody, lightSource);
assertFullyRead(darkBody, darkSource);

const groups = parseGroups(lightBody);
const light = parseFlat(lightBody);
const dark = parseFlat(darkBody);

const total = groups.reduce((sum, group) => sum + group.tokens.length, 0);
if (total === 0) {
    console.error('generate-adwaita-tokens: parsed the light mixin and found no tokens — that is a broken parse.');
    process.exit(1);
}
if (Object.keys(dark).length === 0) {
    console.error('generate-adwaita-tokens: parsed the dark mixin and found no tokens — that is a broken parse.');
    process.exit(1);
}
// One name declared twice in the light mixin: the map keeps the last value, the
// grouped shape keeps both records, and `ADWAITA_TOKEN_COUNT` counts the records — so
// the two emissions would disagree about the size of the same contract.
if (Object.keys(light).length !== total) {
    const seen = new Map();
    for (const group of groups) {
        for (const token of group.tokens) seen.set(token.name, (seen.get(token.name) ?? 0) + 1);
    }
    console.error(
        `generate-adwaita-tokens: declared twice in ${lightSource} — ` +
            `${[...seen]
                .filter(([, n]) => n > 1)
                .map(([name]) => name)
                .join(', ')}.`,
    );
    process.exit(1);
}

// A dark declaration whose name never appears in light is a token with no default. It
// is not an error — libadwaita has dark-only values — but it must be VISIBLE, because
// a consumer reading `light` alone would silently miss it.
const darkOnly = Object.keys(dark)
    .filter((name) => light[name] === undefined)
    .sort();

// `oklab(from …)`, `color-mix(…)` and `var(…)` references are deliberately
// EXPRESSIONS in the stylesheet: `--success-color` tracks a re-themed
// `--success-bg-color` (`_variables.scss:91-93`), which a literal cannot do. A browser
// evaluates them; a TypeScript object and NativeScript's CSS subset cannot. They are
// emitted verbatim and NAMED here, so a consumer that needs literals refuses by name
// rather than shipping the string "oklab(from var(--success-bg-color) min(l, 0.5) a b)"
// as if it were a colour.
//
// `\bvar\s*\(` and not `^var\(`: the anchored form only saw an alias that IS the whole
// value, so `calc(var(--font-size-base) * 1.2)` would read as a literal. Measured
// against today's stylesheet the two forms select the same seven tokens — this widens
// the rule for the next value, it does not correct the current output.
const UNRESOLVED_RE =
    /\b(?:oklab|oklch|color-mix|light-dark)\s*\(|\bvar\s*\(|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|color)\s*\(\s*from\b/;
const unresolved = Object.entries(light)
    .filter(([, value]) => UNRESOLVED_RE.test(value))
    .map(([name]) => name)
    .sort();

// The reader in `--check` unescapes `\'`, `\"` and `\\` and nothing else, because that is
// all a CSS value in this stylesheet has ever needed. A value carrying anything else
// would round-trip through the formatter into an escape the reader misreads, and
// misreading compares WRONG rather than failing. So draw the limit here, loudly,
// instead of widening a decoder for a case that does not exist yet.
const unreadable = [
    ...Object.entries(light),
    ...Object.entries(dark),
    ...groups.map((group) => ['a group title', group.title]),
].filter(([, text]) => /[\\\n\r]/.test(text));
if (unreadable.length > 0) {
    console.error(
        'generate-adwaita-tokens: value(s) this generator cannot read back out of its own output —\n' +
            unreadable.map(([name, text]) => `    ${name}: ${JSON.stringify(text)}`).join('\n') +
            '\n  Widen `unquote` in the --check reader before emitting them.',
    );
    process.exit(1);
}

// Built once and used twice: this is what the core file says, and it is what --check
// expects to read back out of it. Two spellings of the same rule would drift.
const tokenValues = Object.fromEntries(
    Object.entries(light).map(([name, value]) => [
        name,
        dark[name] !== undefined && dark[name] !== value ? { light: value, dark: dark[name] } : { light: value },
    ]),
);

const banner = (script) =>
    `// AUTO-GENERATED by scripts/${script}. DO NOT EDIT BY HAND.\n` +
    `//\n` +
    `// Source: packages/web/adwaita-web/scss/_variables.scss (\`light-theme\`) and\n` +
    `// _theme.scss (\`dark-theme\`). ADR 0010 decision 2: these custom properties ARE\n` +
    `// the public theming contract of \`@gjsify/adwaita-web\`.\n`;

const coreBody = `${banner('generate-adwaita-tokens.mjs')}
/** One token's declared values. \`dark\` is absent when the dark theme keeps the default. */
export interface AdwTokenValues {
    readonly light: string;
    readonly dark?: string;
}

/**
 * Every declared Adwaita token, light and dark.
 *
 * The VALUES as the stylesheet writes them — including the expressions listed in
 * {@link ADWAITA_UNRESOLVED_TOKENS}. Nothing here is evaluated.
 */
export const ADWAITA_TOKENS: Readonly<Record<string, AdwTokenValues>> = ${JSON.stringify(tokenValues, null, 4)};

/**
 * Tokens the dark theme declares and the light theme does not.
 *
 * Visible rather than merged away: a consumer reading only \`light\` would otherwise
 * miss them with no signal.
 */
export const ADWAITA_DARK_ONLY_TOKENS: readonly string[] = ${JSON.stringify(darkOnly, null, 4)};

/**
 * Tokens whose value is a CSS expression, not a literal.
 *
 * \`oklab(from …)\` and \`color-mix(…)\` are deliberate: they track a re-themed base
 * colour, which a literal cannot. A browser evaluates them. A TypeScript scale and
 * NativeScript's CSS subset cannot — so a consumer that needs literals must refuse
 * these by name instead of passing the expression through as a colour.
 *
 * \`--border-color\` is the hard case and is in this list for a different reason:
 * \`currentColor\` is a value of the cascade at paint time, so it has no build-time
 * resolution at all, in any target.
 */
export const ADWAITA_UNRESOLVED_TOKENS: readonly string[] = ${JSON.stringify(unresolved, null, 4)};

/** How many tokens the light contract carries — derived, never typed. */
export const ADWAITA_TOKEN_COUNT = ${total};
`;

const websiteBody = `${banner('generate-adwaita-tokens.mjs')}
export interface AdwToken {
    /** The custom property, e.g. \`--accent-bg-color\`. */
    name: string;
    /** Its light-mode default. Dark mode re-declares the same names. */
    value: string;
}

export interface AdwTokenGroup {
    title: string;
    tokens: AdwToken[];
}

export const ADWAITA_TOKEN_GROUPS: AdwTokenGroup[] = ${JSON.stringify(groups, null, 4)};

/** How many tokens the contract carries — derived, never typed. */
export const ADWAITA_TOKEN_COUNT = ${total};
`;

// Compare the DATA, not the bytes — and the two emissions do not have the same shape,
// so they do not share a reader. Written with one regex for both first, and reading
// NOTHING out of the website file caught it immediately: the pattern keyed on the token
// name being a KEY, which is true of the core map (`'--x': { light: 'v' }`) and false
// of the website's records (`{ name: '--x', value: 'v' }`). A reader that comes back
// empty is why that was a failure rather than a green run over nothing.
//
// AGAINST THE DATA, not against a second reading of this run's own output. The first
// version compared reader(committed) with reader(body), and a reader that mis-reads
// BOTH sides the same way passes: the value pattern was `['"]([^'"]*)['"]`, the two
// font stacks START with a quote (`'Adwaita Sans', …`), so both sides yielded the
// empty string and reordering the stack in the stylesheet left --check green.
// Measured on this tree, the same symmetry hid every dark value, both name lists, the
// token count and all 21 website group titles — the emitted half of the point of
// reading the dark mixin at all. `readCore`/`readWebsite` are checked against the
// data, and against this run's own output FIRST, which keeps the two failures apart:
// reader broken, or file stale.

/** One JavaScript string literal, in either quote style, escapes included. */
const STRING = String.raw`'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"`;
/** An object key the formatter may have quoted (`JSON.stringify`) or not (oxfmt). */
const key = (word) => String.raw`(?:'${word}'|"${word}"|\b${word}\b)`;
/** Only the escapes the emitted values can contain — held to that by `unreadable`. */
const unquote = (literal) => literal.slice(1, -1).replace(/\\(['"\\])/g, '$1');

const CORE_ENTRY = new RegExp(
    String.raw`(${STRING})\s*:\s*\{\s*${key('light')}\s*:\s*(${STRING})` +
        String.raw`(?:\s*,\s*${key('dark')}\s*:\s*(${STRING}))?\s*,?\s*\}`,
    'g',
);
const WEBSITE_ITEM = new RegExp(
    String.raw`${key('title')}\s*:\s*(${STRING})` +
        String.raw`|${key('name')}\s*:\s*(${STRING})\s*,\s*${key('value')}\s*:\s*(${STRING})`,
    'g',
);

const listOf = (text, name) => {
    const block = text.match(new RegExp(String.raw`export const ${name}[^=]*=\s*\[([^\]]*)\]`));
    return block === null ? null : [...block[1].matchAll(new RegExp(STRING, 'g'))].map(([literal]) => unquote(literal));
};
const numberOf = (text, name) => {
    const found = text.match(new RegExp(String.raw`export const ${name}[^=]*=\s*(\d+)`));
    return found === null ? null : Number(found[1]);
};

/** Everything the core emission asserts, read back out of the TypeScript. */
const readCore = (text) => ({
    tokens: Object.fromEntries(
        [...text.matchAll(CORE_ENTRY)].map(([, name, lightValue, darkValue]) => [
            unquote(name),
            darkValue === undefined
                ? { light: unquote(lightValue) }
                : { light: unquote(lightValue), dark: unquote(darkValue) },
        ]),
    ),
    darkOnly: listOf(text, 'ADWAITA_DARK_ONLY_TOKENS'),
    unresolved: listOf(text, 'ADWAITA_UNRESOLVED_TOKENS'),
    count: numberOf(text, 'ADWAITA_TOKEN_COUNT'),
});

/** The same for the website's grouped shape: titles and grouping, not only the pairs. */
function readWebsite(text) {
    const found = [];
    for (const [, title, name, value] of text.matchAll(WEBSITE_ITEM)) {
        if (title !== undefined) found.push({ title: unquote(title), tokens: [] });
        // A record before any title cannot be placed. Reported as a read failure rather
        // than quietly dropped, which is the whole reason this file compares shapes.
        else if (found.length === 0) return null;
        else found.at(-1).tokens.push({ name: unquote(name), value: unquote(value) });
    }
    return { groups: found, count: numberOf(text, 'ADWAITA_TOKEN_COUNT') };
}

/**
 * Every JSON path at which two emitted shapes disagree.
 *
 * So a failure NAMES what moved. Key order counts as a difference on purpose: the
 * emission order is part of what the website page renders.
 */
function differences(want, found, path = '') {
    if (JSON.stringify(want) === JSON.stringify(found)) return [];
    if (want === null || found === null || typeof want !== 'object' || typeof found !== 'object') {
        return [
            `${path === '' ? '(whole file)' : path}: expected ${JSON.stringify(want)}, found ${JSON.stringify(found)}`,
        ];
    }
    const keys = [...new Set([...Object.keys(want), ...Object.keys(found)])];
    return keys.flatMap((each) => differences(want[each], found[each], path === '' ? each : `${path}.${each}`));
}

const emissions = [
    {
        path: coreOut,
        body: coreBody,
        read: readCore,
        data: { tokens: tokenValues, darkOnly, unresolved, count: total },
    },
    { path: websiteOut, body: websiteBody, read: readWebsite, data: { groups, count: total } },
];

// Why data and not bytes: this script emits `JSON.stringify` output while the committed
// files are oxfmt's, so they differ in quote style and trailing commas. A byte
// comparison would need this process to run the formatter, and measured, with the
// workspace `node_modules/.bin` off PATH a GLOBAL `gjsify` is picked up instead and
// dies on a missing biome — reporting a current file as STALE. The contract is the
// token names and their values; reformatting is not a change to it, and
// `gjsify format --check` holds style tree-wide on its own.

/** At most a screenful of differences, indented under the line that introduces them. */
const listed = (lines) =>
    lines
        .slice(0, 8)
        .map((line) => `    ${line}`)
        .join('\n') + (lines.length > 8 ? `\n    … and ${lines.length - 8} more` : '');

if (CHECK) {
    let stale = false;
    for (const { path, body, read, data } of emissions) {
        // Reading this run's OWN output has to reproduce the data exactly. Until it does,
        // a difference in the committed file cannot be read as staleness — and a reader
        // that cannot see a field is a reader that passes over any value of it.
        const unread = differences(data, read(body));
        if (unread.length > 0) {
            console.error(
                `generate-adwaita-tokens --check: cannot read back what this run just emitted for\n` +
                    `  ${path}. That is the READER broken, not the data stale — a field it cannot see\n` +
                    '  would compare equal against anything.\n' +
                    listed(unread),
            );
            process.exit(1);
        }
        const drift = differences(data, read(readFileSync(path, 'utf8')));
        if (drift.length > 0) {
            console.error(`generate-adwaita-tokens --check: ${path} is STALE.\n${listed(drift)}`);
            stale = true;
        }
    }
    if (stale) {
        console.error('  Regenerate: node scripts/generate-adwaita-tokens.mjs');
        process.exit(1);
    }
    console.log(
        `generate-adwaita-tokens --check: OK (${total} light tokens in ${groups.length} groups, ` +
            `${Object.keys(dark).length} dark, ${darkOnly.length} dark-only, ${unresolved.length} unresolved; ` +
            `${PARSER_VECTORS.length} parser vector(s) green)`,
    );
    process.exit(0);
}

for (const { path, body } of emissions) {
    writeFileSync(path, body, 'utf8');
    const result = spawnSync('gjsify', ['format', path], { stdio: 'inherit' });
    if (result.error || result.status !== 0) {
        console.warn(`  note: could not run \`gjsify format ${path}\` — written but unformatted.`);
    }
}
console.log(
    `generate-adwaita-tokens: wrote ${emissions.length} file(s) — ${total} light tokens in ` +
        `${groups.length} groups, ${Object.keys(dark).length} dark, ${darkOnly.length} dark-only, ` +
        `${unresolved.length} unresolved.`,
);
