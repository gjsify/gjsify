#!/usr/bin/env node
// The hand-written CLI reference page must not drift from the CLI it documents.
//
// THE INCIDENT. An audit of `website/src/content/docs/cli-reference.md` against
// `packages/infra/cli/src/commands/` found it stale in exactly the ways nothing
// was checking: the `ship` formats table was missing the `appimage` row added
// alongside `deb`/`rpm`/`flatpak`, and — the bigger miss — `gjsify link` and
// `gjsify unlink` (real, `--help`-listed commands, in the CLI since ADR 0065)
// had no section at all. Both are the same failure: the page is hand-written,
// so a new command or a new row lands in `packages/` and nothing walks the page
// that promises to list them. `check-ship-format-vocabulary.mjs` already closes
// this gap between two SOURCE files; this script is its counterpart for the
// PUBLISHED page a reader cannot check against the tree themselves.
//
// THREE CHEAP SUB-CHECKS, each a set comparison between a literal parsed out of
// the CLI source and a literal parsed out of the page — no build, no `--help`,
// so no dependency on GTK or a compiled bundle:
//
//   1. every top-level command `packages/infra/cli/src/commands/*.ts` registers
//      (`command: '<name> …'`) has a `### \`gjsify <name>\`` heading;
//   2. every `FormatId` in `utils/ship/types.ts` appears in the ship "formats,
//      and where each one packs" table;
//   3. every rule `oxlint-plugin-gjsify/src/index.ts` registers appears as
//      `gjsify/<rule>` somewhere on the page.
//
// Each direction is checked — a stale page entry for a removed command or rule
// is exactly as wrong as a missing one, and silently accepting "documents a
// superset" is how a rename leaves the old name behind forever.
//
// EVERY SOURCE OF TRUTH ON BOTH SIDES MUST YIELD SOMETHING, CHECKED
// INDEPENDENTLY. A set diff between two EMPTY sets is empty, so a broken
// parser — the commands dir moved, the `FormatId` regex stopped matching, the
// page's anchor heading got reworded and a split found nothing — reads as
// "nothing missing, nothing extra" and this would otherwise exit 0 having
// compared nothing to nothing. Caught in review before landing: `--root` a
// fixture where the commands dir is empty and the page has no headings either,
// and the first draft printed "0 command(s) … accounted for" and exited 0. So
// each of the six collections (three parsed from source, three parsed from the
// page) is asserted non-empty ON ITS OWN, before any diff runs on it — never
// inferred from whether the OTHER side of that same axis is empty, which is
// exactly the condition that hid the hole.
//
//   node scripts/check-website-cli-reference.mjs
//   node scripts/check-website-cli-reference.mjs --root <dir>   # point at a fixture tree

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootFlag = process.argv.indexOf('--root');
if (rootFlag !== -1 && process.argv[rootFlag + 1] === undefined) {
    console.error('  ✗ --root was given with no directory after it.');
    process.exit(2);
}
const ROOT = rootFlag !== -1 ? process.argv[rootFlag + 1] : join(dirname(fileURLToPath(import.meta.url)), '..');

const COMMANDS_DIR = 'packages/infra/cli/src/commands';
const FLATPAK_INDEX = `${COMMANDS_DIR}/flatpak/index.ts`;
const FORMAT_TYPES = 'packages/infra/cli/src/utils/ship/types.ts';
const OXLINT_PLUGIN_INDEX = 'packages/infra/oxlint-plugin-gjsify/src/index.ts';
const DOC = 'website/src/content/docs/cli-reference.md';

const problems = [];
const read = (rel) => {
    try {
        return readFileSync(join(ROOT, rel), 'utf8');
    } catch (error) {
        problems.push(`${rel} could not be read (${error.code ?? error.message}).`);
        return null;
    }
};

/**
 * Fail loudly when a collection this check is about to diff turns out empty.
 * Called on EVERY collection, source and page alike, independently of what
 * the other side of that same axis holds — see the header on why "both sides
 * agree because both are empty" must never read as a pass.
 */
function requireNonEmpty(size, what, where, hint) {
    if (size > 0) return true;
    problems.push(`${where}: found zero ${what}. ${hint}`);
    return false;
}

// ---------------------------------------------------------------------------
// 1. Top-level commands.

/** Every `command: '<name> …'` value's first token, from one file's text. */
function commandNamesIn(text) {
    return [...text.matchAll(/^\s*command:\s*'([^'\s]+)/gm)].map((m) => m[1]);
}

const commandNames = new Set();
if (ROOT !== null) {
    let entries;
    try {
        entries = readdirSync(join(ROOT, COMMANDS_DIR), { withFileTypes: true });
    } catch (error) {
        problems.push(`${COMMANDS_DIR} could not be listed (${error.code ?? error.message}).`);
        entries = [];
    }
    for (const entry of entries) {
        // Only files directly in `commands/` — `flatpak/`'s OTHER files are
        // `gjsify flatpak <sub>` subcommands, a different heading shape
        // (`#### \`gjsify flatpak <sub>\``), and out of scope here.
        if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) continue;
        const text = read(`${COMMANDS_DIR}/${entry.name}`);
        if (text !== null) for (const name of commandNamesIn(text)) commandNames.add(name);
    }
    const flatpakIndex = read(FLATPAK_INDEX);
    if (flatpakIndex !== null) for (const name of commandNamesIn(flatpakIndex)) commandNames.add(name);
}
const commandsSourceOk = requireNonEmpty(
    commandNames.size,
    "top-level `command: '…'` declarations",
    COMMANDS_DIR,
    'The directory may be empty, moved, or the `command:` field pattern changed — this check cannot tell ' +
        'that apart from a CLI with zero commands, so it refuses to compare nothing to the page.',
);

// ---------------------------------------------------------------------------
// 2. Ship format ids.

function formatIds(text) {
    const m = text.match(/export type FormatId\s*=\s*([^;]+);/);
    if (!m) return null;
    return [...m[1].matchAll(/'([^']+)'/g)].map((q) => q[1]);
}

const shipTypesText = read(FORMAT_TYPES);
const declaredFormats = shipTypesText === null ? null : formatIds(shipTypesText);
if (shipTypesText !== null && declaredFormats === null) {
    problems.push(`${FORMAT_TYPES}: could not find \`export type FormatId = …;\`.`);
}
const formatsSourceOk =
    declaredFormats !== null &&
    requireNonEmpty(
        declaredFormats.length,
        'quoted members in the `FormatId` union',
        FORMAT_TYPES,
        'The union was found but names nothing — this check cannot tell that apart from a CLI that ships no ' +
            'installable format, so it refuses to compare nothing to the page.',
    );

// ---------------------------------------------------------------------------
// 3. oxlint-plugin-gjsify rule names.

function pluginRuleNames(text) {
    const m = text.match(/rules:\s*\{([^}]*)\}/);
    if (!m) return null;
    return [...m[1].matchAll(/'([a-z][a-z-]*)':/g)].map((q) => q[1]);
}

const pluginIndexText = read(OXLINT_PLUGIN_INDEX);
const declaredRules = pluginIndexText === null ? null : pluginRuleNames(pluginIndexText);
if (pluginIndexText !== null && declaredRules === null) {
    problems.push(`${OXLINT_PLUGIN_INDEX}: could not find the \`rules: { … }\` object.`);
}
const rulesSourceOk =
    declaredRules !== null &&
    requireNonEmpty(
        declaredRules.length,
        'entries in the `rules: { … }` object',
        OXLINT_PLUGIN_INDEX,
        'The object was found but declares no rule — this check cannot tell that apart from a plugin with ' +
            'nothing registered, so it refuses to compare nothing to the page.',
    );

// ---------------------------------------------------------------------------
// Read the page once, compare all three against it.

const docText = read(DOC);

function diffSets(what, declared, documented, { fixHint }) {
    if (declared === null || documented === null) return;
    const missing = declared.filter((x) => !documented.has(x));
    const extra = [...documented].filter((x) => !declared.includes(x));
    if (missing.length > 0) {
        problems.push(`${DOC}: missing ${what} ${missing.map((x) => `\`${x}\``).join(', ')} — ${fixHint}.`);
    }
    if (extra.length > 0) {
        problems.push(
            `${DOC}: documents ${what} ${extra.map((x) => `\`${x}\``).join(', ')}, which the CLI source no ` +
                `longer has — the page outlived a rename or removal.`,
        );
    }
}

if (docText !== null) {
    const documentedCommands = new Set([...docText.matchAll(/^### `gjsify ([a-z][a-z-]*)`$/gm)].map((m) => m[1]));
    const commandsPageOk = requireNonEmpty(
        documentedCommands.size,
        '`### `gjsify <name>`` headings',
        DOC,
        'The page may have lost every command section, or the heading shape changed — this check cannot ' +
            'tell that apart from a page with nothing to say, so it refuses to compare nothing to the source.',
    );
    if (commandsSourceOk && commandsPageOk) {
        diffSets('command(s)', [...commandNames], documentedCommands, {
            fixHint: 'add a `### `gjsify <name>`` section (see AGENTS.md for the CLI package)',
        });
    }

    const formatTableText = docText.split('#### The formats, and where each one packs')[1]?.split(/\n#{2,4} /)[0];
    const documentedFormats = new Set(
        [...(formatTableText ?? '').matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]),
    );
    const formatsPageOk = requireNonEmpty(
        documentedFormats.size,
        'rows in the ship "formats, and where each one packs" table',
        DOC,
        'The `#### The formats, and where each one packs` heading may be missing or reworded, or the table ' +
            'lost every row — this check cannot tell that apart from a page with nothing to say, so it ' +
            'refuses to compare nothing to the source.',
    );
    if (formatsSourceOk && formatsPageOk) {
        diffSets('ship format(s)', declaredFormats, documentedFormats, {
            fixHint: 'add a row to the "formats, and where each one packs" table',
        });
    }

    const lintSectionText = docText.split('### `gjsify lint`')[1]?.split(/\n#{2,3} /)[0] ?? '';
    const documentedRules = new Set([...lintSectionText.matchAll(/`gjsify\/([a-z][a-z-]*)`/g)].map((m) => m[1]));
    const rulesPageOk = requireNonEmpty(
        documentedRules.size,
        '`gjsify/<rule>` references under `### `gjsify lint``',
        DOC,
        'The `### `gjsify lint`` heading may be missing or reworded, or the section lost every rule mention ' +
            '— this check cannot tell that apart from a page with nothing to say, so it refuses to compare ' +
            'nothing to the source.',
    );
    if (rulesSourceOk && rulesPageOk) {
        diffSets('oxlint-plugin-gjsify rule(s)', declaredRules, documentedRules, {
            fixHint: 'list it under `gjsify lint`',
        });
    }
}

if (problems.length > 0) {
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error(`check-website-cli-reference: ${problems.length} problem(s).`);
    process.exit(1);
}

console.log(
    `check-website-cli-reference: ${commandNames.size} command(s), ${declaredFormats?.length ?? 0} ship ` +
        `format(s) and ${declaredRules?.length ?? 0} lint rule(s) all accounted for on the page.`,
);
