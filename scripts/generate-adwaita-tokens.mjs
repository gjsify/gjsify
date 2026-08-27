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
        .map((line) => line.replace(/^\s*\/\/\s?/, '').replace(/\s*-+\s*$/, '').trim())
        .join(' ')
        .trim();
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

const lightBody = mixinBody(readFileSync(lightSource, 'utf8'), 'light-theme', lightSource);
const darkBody = mixinBody(readFileSync(darkSource, 'utf8'), 'dark-theme', darkSource);

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

// A dark declaration whose name never appears in light is a token with no default. It
// is not an error — libadwaita has dark-only values — but it must be VISIBLE, because
// a consumer reading `light` alone would silently miss it.
const darkOnly = Object.keys(dark).filter((name) => light[name] === undefined).sort();

// `oklab(from …)`, `color-mix(…)` and bare `var(…)` aliases are deliberately
// EXPRESSIONS in the stylesheet: `--success-color` tracks a re-themed
// `--success-bg-color` (`_variables.scss:91-93`), which a literal cannot do. A browser
// evaluates them; a TypeScript object and NativeScript's CSS subset cannot. They are
// emitted verbatim and NAMED here, so a consumer that needs literals refuses by name
// rather than shipping the string "oklab(from var(--success-bg-color) min(l, 0.5) a b)"
// as if it were a colour.
const UNRESOLVED_RE = /\b(?:oklab|oklch|color-mix)\s*\(|^var\(/;
const unresolved = Object.entries(light)
    .filter(([, value]) => UNRESOLVED_RE.test(value))
    .map(([name]) => name)
    .sort();

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
export const ADWAITA_TOKENS: Readonly<Record<string, AdwTokenValues>> = ${JSON.stringify(
    Object.fromEntries(
        Object.entries(light).map(([name, value]) => [
            name,
            dark[name] !== undefined && dark[name] !== value ? { light: value, dark: dark[name] } : { light: value },
        ]),
    ),
    null,
    4,
)};

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
// so they do not share an extractor. Written with one regex for both first, and the
// "read NO tokens" guard below caught it immediately: the pattern keyed on the token
// name being a KEY, which is true of the core map (`'--x': { light: 'v' }`) and false
// of the website's records (`{ name: '--x', value: 'v' }`). The guard is the reason
// that was a failure rather than a green run over nothing.
const CORE_PAIRS = /['"](--[a-z0-9-]+)['"]\s*:\s*\{\s*["']?light["']?\s*:\s*['"]([^'"]*)['"]/g;
const WEBSITE_PAIRS =
    /["']?name["']?\s*:\s*['"](--[a-z0-9-]+)['"]\s*,\s*["']?value["']?\s*:\s*['"]([^'"]*)['"]/g;

const pairsWith = (re) => (text) =>
    [...text.matchAll(re)].map(([, name, value]) => `${name}=${value}`).sort().join('\n');

const emissions = [
    { path: coreOut, body: coreBody, pairs: pairsWith(CORE_PAIRS) },
    { path: websiteOut, body: websiteBody, pairs: pairsWith(WEBSITE_PAIRS) },
];

// Why data and not bytes: this script emits `JSON.stringify` output while the committed
// files are oxfmt's, so they differ in quote style and trailing commas. A byte
// comparison would need this process to run the formatter, and measured, with the
// workspace `node_modules/.bin` off PATH a GLOBAL `gjsify` is picked up instead and
// dies on a missing biome — reporting a current file as STALE. The contract is the
// token names and their values; reformatting is not a change to it, and
// `gjsify format --check` holds style tree-wide on its own.

if (CHECK) {
    let stale = false;
    for (const { path, body, pairs } of emissions) {
        const committed = pairs(readFileSync(path, 'utf8'));
        if (committed.length === 0) {
            console.error(
                `generate-adwaita-tokens --check: read NO tokens out of ${path}. That is the reader\n` +
                    '  broken, not the data stale — an empty comparison would pass against anything.',
            );
            process.exit(1);
        }
        if (committed !== pairs(body)) {
            console.error(`generate-adwaita-tokens --check: ${path} is STALE.`);
            stale = true;
        }
    }
    if (stale) {
        console.error('  Regenerate: node scripts/generate-adwaita-tokens.mjs');
        process.exit(1);
    }
    console.log(
        `generate-adwaita-tokens --check: OK (${total} light tokens in ${groups.length} groups, ` +
            `${Object.keys(dark).length} dark, ${darkOnly.length} dark-only, ${unresolved.length} unresolved)`,
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
