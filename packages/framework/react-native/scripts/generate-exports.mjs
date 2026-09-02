#!/usr/bin/env node
// Emit one refusing export per React Native name this layer does not answer yet.
//
// GENERATED AND COMMITTED, like the widget table (ADR 0028's reasoning applies
// unchanged): a bundler needs static export names to resolve an import at all, so
// these cannot be produced by a loop at runtime. Committing the output is what makes
// `import { FlatList } from 'react-native'` resolve to something that can explain
// itself, instead of to a `MISSING_EXPORT` that can only say the name is absent.
//
// Run: `gjsify workspace @gjsify/react-native run generate`
// The spec asserts the file on disk matches what this would emit, so a stale
// generated file fails a test rather than shipping.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG = dirname(dirname(fileURLToPath(import.meta.url)));
const TABLE = join(PKG, 'src/support-table.ts');
export const INDEX = join(PKG, 'src/index.ts');
export const OWN_OUT = join(PKG, 'src/generated/own-exports.ts');
/** The whole support document, generated end to end (ADR 0036 § 6). */
export const SUPPORT_DOC = join(PKG, 'SUPPORT.md');
/** The PROP surface's document — one section per primitive (ADR 0037). */
export const PROP_DOC = join(PKG, 'PROPS.md');

/** The package every surface is a subpath of. `support-table.ts` spells it the same way. */
export const PACKAGE = '@gjsify/react-native';

/**
 * The generated refusals module for one surface.
 *
 * Derived from the TARGET rather than declared per row, so a surface added to the
 * registry needs nothing here: the root is `react-native` (its own npm name, which is
 * what the file is about) and every other one is its subpath.
 */
export const slugFor = (target) => (target === PACKAGE ? 'react-native' : target.slice(PACKAGE.length + 1));
export const outFor = (target) => join(PKG, `src/generated/unsupported-${slugFor(target)}.ts`);

/**
 * The surface registry, read out of `support-table.ts`' source.
 *
 * SOURCE and not the built module, for the reason every parser in this file has: a
 * consumer's `node_modules` ships `lib` and not `src`, and this generator runs before
 * a build. The rows are plain string fields, and `check-rn-surface.mjs` self-tests
 * this parser against fixtures that must parse and fixtures that must not.
 */
export function readSurfaces(source) {
    const start = source.indexOf('export const SURFACES: readonly Surface[] = [');
    if (start === -1) throw new Error('SURFACES declaration not found');
    const end = source.indexOf('\n];', start);
    if (end === -1) throw new Error('SURFACES literal is not terminated');
    const body = source.slice(start, end);
    const surfaces = [];
    for (const block of body.split(/\n    \{\n/).slice(1)) {
        const pick = (field) => {
            const match = new RegExp(`^        ${field}: '((?:[^'\\\\]|\\\\.)*)',$`, 'm').exec(block);
            return match ? match[1] : undefined;
        };
        const module = pick('module');
        const label = pick('label');
        const declaration = pick('declaration');
        // `target: PACKAGE` for the root, `` target: `${PACKAGE}/sub` `` for the rest.
        const root = /^        target: PACKAGE,$/m.test(block);
        const sub = /^        target: `\$\{PACKAGE\}\/([^`]+)`,$/m.exec(block);
        if (module === undefined || label === undefined || declaration === undefined || (!root && sub === null)) {
            throw new Error(`SURFACES row is missing a field: ${JSON.stringify(block.slice(0, 120))}`);
        }
        const target = root ? PACKAGE : `${PACKAGE}/${sub[1]}`;
        surfaces.push({ module, target, label, declaration, out: outFor(target), slug: slugFor(target) });
    }
    if (surfaces.length === 0) throw new Error('SURFACES is empty');
    return surfaces;
}

/**
 * The source slice one table literal occupies.
 *
 * Anchored on `export const <NAME>: Readonly`, not on `<NAME>: Readonly`: the router
 * table's name ENDS with the first one's, so a bare substring search finds the wrong
 * declaration for whichever table is asked for second.
 */
function tableBody(source, declaration) {
    const start = source.indexOf(`export const ${declaration}: Readonly`);
    if (start === -1) throw new Error(`${declaration} declaration not found`);
    const end = source.indexOf('\n};', start);
    if (end === -1) throw new Error(`${declaration} literal is not terminated`);
    return source.slice(start, end);
}

/** Names and statuses, from the table's source. Same parse as `check-rn-surface.mjs`. */
export function readEntries(source, declaration = 'SUPPORT_TABLE') {
    const body = tableBody(source, declaration);
    const entries = [];
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const key = /^ {4}([A-Za-z_$][A-Za-z0-9_$]*):\s*\{/.exec(lines[i]);
        if (!key) continue;
        // The status is on the same line for a one-liner, or within the entry's
        // own block for a multi-line one. Bounded by the next four-space key.
        let status = null;
        for (let j = i; j < lines.length; j++) {
            if (j > i && /^ {4}[A-Za-z_$][A-Za-z0-9_$]*:\s*\{/.test(lines[j])) break;
            const found = /status:\s*'([a-z-]+)'/.exec(lines[j]);
            if (found) {
                status = found[1];
                break;
            }
        }
        if (status === null) throw new Error(`no status found for ${key[1]}`);
        entries.push({ name: key[1], status });
    }
    return entries;
}

export function render(entries, label, module) {
    const refused = entries.filter((e) => e.status !== 'supported' && e.status !== 'partial');
    const lines = [
        '// GENERATED by scripts/generate-exports.mjs — do not edit.',
        '//',
        `// One export per ${label} name this layer does not answer yet, each a value`,
        '// that refuses with the support table’s own sentence. Why these exist at all, and',
        '// why they are generated rather than looped: see the generator and `unsupported.ts`.',
        '//',
        '// The MODULE is passed with every name (ADR 0036): `StatusBar` is a react-native',
        '// export and the whole of expo-status-bar, `Image` is react-native’s and',
        '// expo-image’s — without it the one-argument lookup answers from whichever surface',
        '// the registry lists first, so a planned name would report another surface’s',
        '// "is available".',
        '',
    ];
    // NO IMPORT WHEN THERE IS NOTHING TO REFUSE HERE. A surface whose whole table is
    // `supported`/`partial` emits an empty module, and an unused import there is a
    // `tsc` error (TS6133) — which is how this was found: the generator was correct
    // about the exports and wrong about the file.
    const emitted = refused.filter((entry) => entry.name !== 'default');
    if (emitted.length > 0) {
        lines.push("import { unsupported } from '../unsupported.js';", '');
    } else {
        // WHICH of the two reasons, because they are not the same claim: "every name is
        // answered" is FALSE for a surface whose only refusal is its `default`, and that
        // one is declared in the entry module rather than here. No surface is in that
        // state today, so the note that would have been wrong is written before it can
        // be printed.
        lines.push(
            refused.length === 0
                ? '// Nothing to refuse: every name in this surface’s table is answered.'
                : '// Nothing to refuse HERE: this surface’s only refusal is its `default`, which its',
            ...(refused.length === 0 ? [] : ['// entry module declares — see the note below.']),
            '',
        );
    }
    let skippedDefault = false;
    for (const { name } of refused) {
        // `export const default` is not a thing and `export * from` never carries a
        // default, so a surface whose DEFAULT export refuses declares it in its own
        // entry module. Skipped loudly rather than silently: the comment is what tells
        // the next reader why the name is missing from a file generated from the table.
        if (name === 'default') {
            skippedDefault = true;
            continue;
        }
        lines.push(`export const ${name} = unsupported('${name}', '${module}');`);
    }
    if (skippedDefault) {
        lines.push(
            '',
            '// `default` is in this surface’s table and NOT emitted here: `export const default`',
            '// is a syntax error and `export * from` never re-exports a default. Its entry module',
            "// declares `export default unsupported('default', '" + module + "')` instead.",
        );
    }
    // AN EMPTY MODULE IS STILL A MODULE, and that is what `export {}` buys: without it
    // `export * from './unsupported-<slug>.js'` is TS2306 ("file is not a module"), so a
    // surface with nothing to refuse could not be re-exported at all — and it was not.
    // MEASURED: `@react-native-async-storage/async-storage`'s generated module was
    // imported by NOTHING for its whole life, so the day a name in that table stopped
    // being answered the refusal would have been generated, checked by
    // `check-rn-surface.mjs`, and reachable from no import in the package. The entry
    // module re-exports this file unconditionally now, which is only possible because
    // the empty case is a module.
    if (emitted.length === 0) lines.push('', 'export {};');
    lines.push('');
    return lines.join('\n');
}

/**
 * The refusals a generated module declares, as `(name, module)` pairs.
 *
 * WHY THE COMPARISON IS THIS AND NOT THE BYTES. `run generate` is
 * `node scripts/generate-exports.mjs && gjsify format src/generated`, so the FORMATTER
 * is part of generation — and two of the eighteen surfaces emit something it changes:
 * the one with nothing to refuse emits a second trailing blank line, and
 * `expo-status-bar` has a name long enough that the call wraps over four lines. A
 * byte-for-byte check therefore called both files permanently stale no matter how
 * often they were regenerated, because the thing on disk is the formatter's output and
 * the thing being compared was this function's.
 *
 * The rule that fixes it is already written down one comparison further on, for
 * `own-exports.ts`: "its exact bytes are the formatter's claim while the derivation's
 * claim is the set". This is that rule applied to the modules it was not applied to.
 *
 * The set is the (name, module) PAIR rather than the name, because the module is what
 * makes a refusal answer from the right surface — dropping it is how `expo-image`'s
 * planned `Image` reported react-native's "is available".
 */
export function readRefusals(source) {
    const out = [];
    // MASKED FIRST, through the same function the own-export derivation uses: a
    // commented-out `export const Ghost = unsupported(…)` is documentation, not an
    // export, and the first version of this reader reported it. `maskSource` blanks
    // comments and string CONTENT while preserving length, so the match offsets below
    // still line up with the original text.
    for (const match of maskSource(source).matchAll(
        /export const ([A-Za-z_$][\w$]*)\s*=\s*unsupported\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*,?\s*\)/g,
    )) {
        // The NAMES come back out of the ORIGINAL text, because `maskSource` blanks
        // what is between the quotes. Length-preserving masking is what makes that a
        // slice by index rather than a second parse.
        const literal = /'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'/.exec(
            source.slice(match.index, match.index + match[0].length),
        );
        if (literal === null) continue;
        out.push({ binding: match[1], name: literal[1], module: literal[2] });
    }
    return out;
}

/** Statuses in the order a reader wants to see them, with a heading each. */
const SECTIONS = [
    ['supported', 'Supported'],
    ['partial', 'Supported, with named limits'],
    ['planned', 'Planned'],
    ['no-desktop-meaning', 'No meaning on a desktop window'],
    ['refused', 'Refused'],
    ['not-reachable', 'Not reachable in this build chain'],
];

/**
 * One surface's section of the support document.
 *
 * Generated rather than written, for the reason the whole mechanism exists: a hand-kept
 * copy of this is the one that drifts, and the drifted one is what a consumer reads
 * before they file an issue.
 */
export function renderSurfaceSection(surface, entries, table) {
    const out = [
        `## \`${surface.module}\``,
        '',
        `Imported from \`${surface.module}\`; answered by \`${surface.target}\`.`,
        '',
    ];
    for (const [status, heading] of SECTIONS) {
        const rows = entries.filter((e) => e.status === status);
        if (rows.length === 0) continue;
        out.push(`### ${heading} (${rows.length})`, '', '| export | tier | GTK | why |', '|---|---|---|---|');
        for (const { name } of rows) {
            const entry = table[name];
            // A `|` in a cell ENDS the cell. `Platform`'s reason is
            // `OS is "linux" | "macos" | "windows"`, which silently split one row
            // into four columns and pushed the reason out of the table — visible
            // only to a reader, which is the audience this section has.
            const cell = (text) => String(text).replaceAll('|', '\\|');
            out.push(
                `| \`${name}\` | ${cell(entry.tier ?? '—')} | ${cell(entry.gtk ?? '—')} | ${cell(entry.reason)} |`,
            );
        }
        out.push('');
    }
    return out.join('\n');
}

/**
 * The whole support document — every surface, in registry order.
 *
 * A SEPARATE FILE and not a block inside the README, which is a change ADR 0036 made
 * necessary rather than a preference: react-native's own section is ~100 table rows,
 * and sixteen more surfaces would put ~250 rows of generated table between a reader
 * and the two paragraphs of the README they came for. The README points here.
 *
 * Generated end to end, so there are no markers to lose — `check-rn-surface.mjs`
 * compares the file byte for byte.
 */
export function renderSupportDoc(sections) {
    return [
        '<!-- GENERATED by scripts/generate-exports.mjs — do not edit. -->',
        '',
        '# What `@gjsify/react-native` answers for',
        '',
        'One section per npm package this layer declares a surface for (ADR 0032 § 8, ADR 0036).',
        'Every row comes from `src/support-table.ts`, which is also what the bundler gate reads and',
        'what the runtime refusals print — so this document cannot disagree with either.',
        '',
        'A package that is NOT listed here has no entry on purpose: it reaches no platform, so it is',
        "the consumer's own dependency and works unmodified. ADR 0036 § 5 states that rule.",
        '',
        ...sections,
    ].join('\n');
}

// --- the PROP surface (ADR 0037) -----------------------------------------------
//
// IMPORTED, not parsed, and that is the one place in this file where the two differ.
// Every reader above parses `support-table.ts`' SOURCE because a consumer's
// `node_modules` ships `lib` and not `src` and this generator runs before a build.
// The same constraint holds here — `check-rn-surface.mjs` runs in a job that
// deliberately does no install and no build — but a PARSER is the wrong instrument
// for `primitives/table.ts`: its rows spread shared records (`...COMMON`,
// `...TEXT_INPUT_COMMON`) and CALL functions to build refusal sentences
// (`PRESSED_STYLE_IS_CSS('active:opacity-70')`), so a parse would report the spread
// instead of the row's answer — a second truth about the one question this layer
// exists to answer.
//
// Node's own TypeScript type stripping resolves that: `import()` of a `.ts` file
// needs no build, no install and no flag on the Node the `check` job pins. The two
// modules it loads are chosen for it — `primitives/table.ts` and `primitives/
// answers.ts` are the only two with no VALUE import of a sibling, because Node does
// NOT rewrite a `./x.js` specifier to `./x.ts`. `answers.ts`' header records that
// constraint at the other end, so a value import added there fails here loudly rather
// than silently changing what this document is derived from.

/** The prop table and its classifier, loaded from source. */
export async function readPropSurface() {
    const table = await import(pathToFileURL(join(PKG, 'src/primitives/table.ts')).href);
    const answers = await import(pathToFileURL(join(PKG, 'src/primitives/answers.ts')).href);
    return { table, answers };
}

/** A `|` ENDS a Markdown cell, so every cell escapes its own. Learnt from `Platform`'s reason. */
const cell = (text) => String(text).replaceAll('|', '\\|');

/** One primitive (or one variant of one) → its section. */
function renderPrimitiveSection(heading, primitive, spec, note, { table, answers }) {
    const out = [`## ${heading}`, ''];
    const facts = [`widget \`${spec.tag}\``];
    if (spec.content !== undefined) facts.push(`children go into \`${spec.content.tag}\``);
    if (spec.backdrop !== undefined) facts.push(`backdrop \`${spec.backdrop.tag}\``);
    facts.push(spec.textSink === null ? 'takes no text child' : `a text child writes \`${spec.textSink}\``);
    if (spec.handle !== undefined) facts.push(`a \`ref\` receives the \`${spec.handle}\` handle, not the widget`);
    out.push(`${facts.join(' · ')}.`, '');
    if (note !== null) out.push(note, '');
    out.push('| prop | answer | GTK | why |', '|---|---|---|---|');
    for (const prop of answers.propNamesOf(spec)) {
        const answer = answers.answerFor(primitive, spec, prop, table.FRAMEWORK_PROPS);
        out.push(
            `| \`${prop}\` | ${answer.status} | ${answer.gtk.length === 0 ? '—' : answer.gtk.map((one) => `\`${cell(one)}\``).join(', ')} | ${answer.why === '' ? '—' : cell(answer.why)} |`,
        );
    }
    out.push('');
    return out.join('\n');
}

/**
 * The whole prop document.
 *
 * A SEPARATE FILE from `SUPPORT.md` for the reason ADR 0036 § 2 made that one a
 * separate file from the README: the two answer different questions at different
 * grains, and ~500 prop rows in front of the import surface would bury it.
 */
export function renderPropDoc(surface) {
    const { table } = surface;
    const sections = [];
    for (const [primitive, spec] of Object.entries(table.PRIMITIVES)) {
        sections.push(renderPrimitiveSection(`\`<${primitive}>\``, primitive, spec, null, surface));
        const branch = spec.switchOn;
        if (branch === undefined) continue;
        sections.push(
            renderPrimitiveSection(
                `\`<${primitive} ${branch.prop}>\``,
                primitive,
                branch.whenTrue,
                `One React Native prop, two GTK widgets: \`${branch.prop}\` selects this row instead of the one above.`,
                surface,
            ),
        );
    }
    return [
        '<!-- GENERATED by scripts/generate-exports.mjs — do not edit. -->',
        '',
        '# What `@gjsify/react-native` does with each prop',
        '',
        'One section per primitive, generated from `src/primitives/table.ts` — the same data the',
        'renderer executes and `@gjsify/react-native/prop-table` publishes, so this document cannot',
        'disagree with what a render does.',
        '',
        "The **answer** column is `acceptsProp()`'s: `property`, `event`, `style`, `file`, `gesture` and",
        '`announcement` reach GTK; `ignored` is a DECLARED no-op, which is an answer and not a refusal;',
        '`refused` throws a `PrimitiveError` at render time. A prop that appears in no row throws too,',
        'naming the ones that are here.',
        '',
        'Ask this from a test rather than reading it: `acceptsProp("Text", "onPress")` is `false` and',
        '`explainProp("Text", "onPress")` is the sentence a render would have thrown (ADR 0037).',
        '',
        ...sections,
    ].join('\n');
}

/** The table as data, from source — statuses, tiers, gtk and reasons. */
export function readTable(source, declaration = 'SUPPORT_TABLE') {
    const body = tableBody(source, declaration);
    const table = {};
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const key = /^ {4}([A-Za-z_$][A-Za-z0-9_$]*):\s*\{/.exec(lines[i]);
        if (!key) continue;
        let block = lines[i];
        for (let j = i + 1; j < lines.length; j++) {
            if (/^ {4}[A-Za-z_$][A-Za-z0-9_$]*:\s*\{/.test(lines[j])) break;
            block += '\n' + lines[j];
        }
        const pick = (field) => {
            const m = new RegExp(`${field}:\\s*'((?:[^'\\\\]|\\\\.)*)'`).exec(block);
            return m ? m[1].replace(/\\'/g, "'").replace(/\\n/g, ' ') : undefined;
        };
        table[key[1]] = { status: pick('status'), tier: pick('tier'), gtk: pick('gtk'), reason: pick('reason') };
    }
    return table;
}

// --- the layer's OWN exports ---------------------------------------------------
//
// `@gjsify/react-native` exports more than react-native does. `configureStyle` and
// its two siblings carry ADR 0032 § 3's token scales, `primitives` is L2, and the
// table plus its two readers are public so a consumer's own tooling can ask what the
// gate asks. None of those is a React Native name, so none of them has a support
// table entry — nor should have one, because `check-rn-surface.mjs` holds that key
// set equal to react-native's own export list.
//
// THE BUILD GATE NEEDS THAT SECOND SET, and its absence was a real defect: ADR 0032
// § 8's gate refuses every imported name the table does not call importable, so it
// refused `import { configureStyle } from '@gjsify/react-native'` — the line the
// package README and the website's React Native page both tell a reader to write,
// on the page that also tells them to turn the gate on.
//
// DERIVED, NEVER LISTED BY HAND. A second list beside the export statements is the
// drift this generator exists to remove, and here it would be the worse defect in
// the other direction too: a stale entry is a name the gate lets through for good.
//
// THE DIRECTION IS: the module's own export list MINUS the names a support table
// judges. Not "everything the table has never heard of" — that is the complement of
// a finite set, and it would make a typo importable. Subtracting this way is safe
// because a name that is both react-native's and ours stays with the TABLE, and
// `isImportable` asks the table first, so nothing derived here can promote a
// `planned` React Native name.

/**
 * `source` with every comment and every string's CONTENT replaced by spaces.
 *
 * Length-preserving, which is what lets the star-re-export specifier be read back out
 * of the ORIGINAL text by index: the quotes stay where they were and only what is
 * between them is blanked.
 *
 * Blanking rather than deleting is the point. A template literal holding
 * `export { Ghost } from './x.js'` is documentation, not an export — the sibling gate
 * in `react-native-gate.spec.ts` pins the same case for imports — and a scan that
 * removed only comments still reported `Ghost`. That was this function's first
 * version, and the self-test caught it.
 *
 * Regex literals are NOT tokenised: a `//` inside one would read as a comment. The
 * blind spot is bounded — this runs over `src/index.ts` and the generated modules,
 * neither of which holds a regex — and `support-table.spec.ts` holds the derived list
 * against the module namespace object at runtime, which is where a mis-parse in
 * either direction surfaces.
 */
export function maskSource(source) {
    const out = [];
    const blank = (text) => {
        for (const char of text) out.push(char === '\n' ? '\n' : ' ');
    };
    for (let i = 0; i < source.length;) {
        const two = source.slice(i, i + 2);
        if (two === '//') {
            const end = source.indexOf('\n', i);
            const stop = end === -1 ? source.length : end;
            blank(source.slice(i, stop));
            i = stop;
            continue;
        }
        if (two === '/*') {
            const end = source.indexOf('*/', i + 2);
            const stop = end === -1 ? source.length : end + 2;
            blank(source.slice(i, stop));
            i = stop;
            continue;
        }
        const char = source[i];
        if (char === "'" || char === '"' || char === '`') {
            out.push(char);
            i++;
            while (i < source.length && source[i] !== char) {
                if (source[i] === '\\') {
                    blank(source.slice(i, i + 2));
                    i += 2;
                    continue;
                }
                blank(source[i]);
                i++;
            }
            if (i < source.length) {
                out.push(char);
                i++;
            }
            continue;
        }
        out.push(char);
        i++;
    }
    return out.join('');
}

/**
 * The VALUE names a module exports, following relative `export * from` chains.
 *
 * Types are skipped in both spellings (`export type { … }` and an inline `type`
 * specifier): a type erases before anything runs, which is the same reason the build
 * gate does not judge one.
 *
 * `resolveStar(specifier, from)` returns `{ file, source }` for a star re-export and
 * is expected to THROW for one it cannot follow. An export list that quietly omitted a
 * re-exported name would refuse a build for a name the package really exports — loud,
 * but wrong, and the reader would have nothing to go on.
 */
export function readModuleExports(source, file, resolveStar, seen = new Set()) {
    if (seen.has(file)) return [];
    seen.add(file);
    const mask = maskSource(source);
    const names = new Set();

    for (const match of mask.matchAll(/export\s+(type\s+)?\{([^}]*)\}/g)) {
        if (match[1] !== undefined) continue;
        for (const raw of match[2].split(',')) {
            const specifier = raw.trim();
            if (specifier === '' || /^type\s/.test(specifier)) continue;
            const parts = specifier.split(/\s+as\s+/);
            names.add((parts[1] ?? parts[0]).trim());
        }
    }
    for (const match of mask.matchAll(
        /^export\s+(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm,
    )) {
        names.add(match[1]);
    }
    for (const match of mask.matchAll(/export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from/g)) {
        names.add(match[1]);
    }
    for (const match of mask.matchAll(/export\s+\*\s+from\s*(['"])/g)) {
        const open = match.index + match[0].length - 1;
        const close = mask.indexOf(match[1], open + 1);
        if (close === -1) throw new Error(`generate-exports: unterminated \`export * from\` specifier in ${file}`);
        const target = resolveStar(source.slice(open + 1, close), file);
        for (const name of readModuleExports(target.source, target.file, resolveStar, seen)) names.add(name);
    }
    return [...names];
}

/** A relative `export * from` target, read off disk. `.js` is TypeScript's ESM spelling of `.ts`. */
export function resolveStarFromDisk(specifier, from) {
    if (!specifier.startsWith('.')) {
        throw new Error(
            `generate-exports: cannot follow \`export * from '${specifier}'\` in ${from} — the own-export ` +
                'derivation only reads this package, and a bare specifier is another package’s surface.',
        );
    }
    const file = join(dirname(from), specifier.replace(/\.js$/, '.ts'));
    return { file, source: readFileSync(file, 'utf8') };
}

/** The module's own additions: everything it exports that no support table judges. */
export function readOwnExports(indexSource, indexFile, judged, resolveStar = resolveStarFromDisk) {
    const exported = readModuleExports(indexSource, indexFile, resolveStar);
    return exported.filter((name) => !judged.includes(name)).sort();
}

/** The names back out of the generated module, for the staleness comparison. */
export function readOwnExportNames(source) {
    const start = source.indexOf('export const OWN_EXPORT_NAMES');
    if (start === -1) throw new Error('OWN_EXPORT_NAMES declaration not found');
    const end = source.indexOf('];', start);
    if (end === -1) throw new Error('OWN_EXPORT_NAMES literal is not terminated');
    return [...source.slice(start, end).matchAll(/'([A-Za-z_$][\w$]*)'/g)].map((match) => match[1]);
}

export function renderOwnExports(names) {
    const lines = [
        '// GENERATED by scripts/generate-exports.mjs — do not edit.',
        '//',
        '// The names this layer adds ON TOP of React Native’s surface: every value',
        '// `src/index.ts` exports that no support table judges. `isImportable` reads it, which',
        '// is what stops the ADR 0032 § 8 build gate refusing the package’s own API.',
        '//',
        '// Derived from the export statements themselves rather than listed, so it cannot drift',
        '// from them — which is why it also contains the two names the mechanism itself adds:',
        '// they are exports of the module like any other.',
        '//',
        '// The ROOT module only. `@gjsify/react-native/router` is a second entry point that the',
        '// gate does not watch, and folding its names in here would let',
        "// `import { RouterRoot } from 'react-native'` past a gate that names it today.",
        '',
        'export const OWN_EXPORT_NAMES: readonly string[] = [',
    ];
    for (const name of names) lines.push(`    '${name}',`);
    lines.push('];', '');
    return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const source = readFileSync(TABLE, 'utf8');
    const surfaces = readSurfaces(source);
    const sections = [];
    for (const surface of surfaces) {
        const entries = readEntries(source, surface.declaration);
        const output = render(entries, surface.label, surface.module);
        mkdirSync(dirname(surface.out), { recursive: true });
        writeFileSync(surface.out, output);
        const refused = output.split('\n').filter((line) => line.startsWith('export const')).length;
        sections.push(renderSurfaceSection(surface, entries, readTable(source, surface.declaration)));
        console.log(
            `generate-exports: ${refused} refusing export(s) of ${entries.length} ${surface.label} name(s) → ${surface.out.slice(surface.out.indexOf('src/'))}`,
        );
    }
    writeFileSync(SUPPORT_DOC, renderSupportDoc(sections));
    console.log(`generate-exports: ${surfaces.length} surface section(s) → SUPPORT.md`);

    const propSurface = await readPropSurface();
    const propDoc = renderPropDoc(propSurface);
    writeFileSync(PROP_DOC, propDoc);
    console.log(
        `generate-exports: ${propDoc.split('\n').filter((line) => line.startsWith('| `')).length} prop row(s) → PROPS.md`,
    );

    // THE ROOT SURFACE'S TABLE, not all eighteen. `src/index.ts` is the ROOT module, so
    // the only table that can judge one of its exports is react-native's — and
    // subtracting the other seventeen made a name they hold DISAPPEAR from this list
    // instead of being reported. `styled` is nativewind's and `parse` is
    // expo-linking's: an export of either name here would be dropped silently, and the
    // § 8 gate would then refuse `import { styled } from 'react-native'` for a name the
    // package really exports — the defect this derivation exists to remove, in the
    // direction that is hardest to notice.
    //
    // Narrowing it moves that collision into `check-rn-surface.mjs`' own-versus-judged
    // comparison, which fails LOUDLY and by name. Loud beats silent; that is the whole
    // reason to prefer this shape.
    const root = surfaces.find((surface) => surface.target === PACKAGE);
    if (root === undefined) throw new Error('SURFACES has no row whose target is the package itself');
    const judged = readEntries(source, root.declaration).map((entry) => entry.name);
    const own = readOwnExports(readFileSync(INDEX, 'utf8'), INDEX, judged);
    writeFileSync(OWN_OUT, renderOwnExports(own));
    console.log(
        `generate-exports: ${own.length} own export(s) beyond the ${judged.length} ${root.label} name(s) → ${OWN_OUT.slice(OWN_OUT.indexOf('src/'))}`,
    );
}
