#!/usr/bin/env node
// The website's generated data files are current, and every gallery block reaches one.
//
// THE INCIDENT, TWICE
//
// `generate-theming-tokens.mjs`'s own header states the rule this repo keeps
// paying for: "a contract TYPED OUT on the website is the drift this repo keeps
// paying for". It then emits `src/data/adwaita-tokens.ts` — and NOTHING ran it
// again. The generator is a `website` npm script, absent from every workflow, so
// the committed data could disagree with the stylesheet indefinitely and the
// `theming.mdx` sentence built on it ("68 tokens in 18 groups") had no mechanism
// behind it at all. Generating a fact and then not holding the generation is the
// same drift one step removed.
//
// The second half is what a MISS looks like. `AdwWidget` renders a widget's
// attribute table by deriving the element tag from its `title`. A title that
// resolves gets a table; a title that does not gets NOTHING — and "this widget has
// no attributes" and "I could not find this widget" render identically. `Adw.Toast`
// is legitimately in the second group (it is a plain class, not a custom element);
// a renamed element or a typo'd title would join it, silently, and the page would
// keep looking documented.
//
// WHAT IT CHECKS
//
//   1. Every generator listed in {@link GENERATORS} reproduces its committed
//      output. Run with no argument they WRITE; `--check` compares and exits 1.
//   2. Every `<AdwWidget title="…">` on a gallery page derives a tag that the web
//      pillar actually registers — or sits in {@link NO_ELEMENT} with the reason
//      its widget has none.
//   3. Nothing in {@link NO_ELEMENT} names a title that DOES resolve, so a stale
//      exemption cannot read as considered when it is merely forgotten.
//   4. Every gallery block reaches the framework-snippet source: either a tree in
//      `adwaita-gallery-trees.mjs` or a REFUSAL naming why it has none, never both
//      and never neither. A block with no snippet and no refusal is a tab that
//      silently does not exist, which is the same shape as (2) one pillar over.
//   5. Every tag, prop and slot in those trees is one `@gjsify/gtk-host` actually
//      has — read out of its generated tables and its curated descriptors. The
//      trees are hand-written, and this is what keeps them from being a second,
//      unheld vocabulary: a tag that stops existing, a prop that was never a prop,
//      or a slot no descriptor declares fails here rather than at render time in
//      three showcases.
//   6. Every snippet the website ships occurs, line for line, in the probe showcase
//      that COMPILES AND RUNS it. Both come from one generator run, so today they
//      cannot disagree — and that is exactly why it is worth asserting: the day a
//      hand edits one of the two generated files, or an emitter grows a branch that
//      only the website takes, the site would publish markup nothing ever ran. That
//      is the claim the whole arrangement rests on, so it is the one to hold.
//   7. Every generated output is still EXEMPT in `.oxfmtrc.json`. The generator
//      emits its final bytes itself and nothing formats them — it used to shell out
//      to `node_modules/.bin/oxfmt`, which does not exist in this job or in
//      `Manifest checks (Windows)`, because both are `checkout` + `setup-node` and
//      nothing else. If an exemption is dropped, `yarn format` rewrites a generated
//      file, arm 1 then reports drift that is not drift, and the repair is to
//      re-add the exemption rather than to re-run the generator — so the failure
//      has to say which of the two it is.
//
// Plain Node over the repo's own files — no install, no build, no astro render.
//
// Usage: node scripts/check-generated-website-data.mjs [--root <dir>]

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { observedAttributes } from './adwaita-elements.mjs';
import { ADWAITA_GALLERY_REFUSALS, ADWAITA_GALLERY_TREES } from './adwaita-gallery-trees.mjs';
import {
    gtypeOfTag,
    OXFMT_EXEMPT_OUTPUTS,
    PROBE_SOURCES,
    snippetLines,
} from './generate-adwaita-framework-snippets.mjs';

const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : process.argv[rootFlag + 1];

const DOCS_DIR = join(ROOT, 'website/src/content/docs/adwaita');

/**
 * The generators whose output is committed, each with the `--check` mode that
 * compares instead of writing.
 *
 * `generate-theming-tokens.mjs` had no such mode; it grew one with this check,
 * because a generator nothing verifies is a generator nothing runs.
 */
/**
 * The generators whose output is committed. Each has a `--check` that compares
 * instead of writing; none of them had one before this file existed, and none of
 * them ran in any workflow — a generator nothing verifies is a generator nothing
 * runs.
 *
 * `generate-coverage.mjs` is here because building the site FOUND it: `run build`
 * left that tracked file dirty, and the committed numbers said 16 where the tree
 * held 17. The website was publishing coverage the repo no longer had.
 */
const GENERATORS = [
    'website/scripts/generate-adwaita-attributes.mjs',
    // Not under `website/` any more, and the move is the point: it emits the website's
    // grouped shape AND `@gjsify/adwaita-core`'s light+dark map from ONE read of the
    // stylesheet. A second reader of one source is a second truth, and this tree already
    // carries the same Adwaita values in nine registers and four notations.
    'scripts/generate-adwaita-tokens.mjs',
    'website/scripts/generate-coverage.mjs',
    // Emits the Solid/Vue/React snippets AND the three probe showcases that compile
    // and run them, from one tree per widget. Both outputs are committed, so both
    // can drift from the source and from each other.
    'scripts/generate-adwaita-framework-snippets.mjs',
];

/**
 * Gallery titles whose widget is not a custom element, with the reason.
 *
 * Not a convenience list: each entry is a claim that gets checked back, so an
 * element that later gains a tag turns this into a failure rather than a
 * permanently silent block.
 */
const NO_ELEMENT = {
    'Adw.Toast': `A toast is not an element — \`AdwToast\` is a plain class the overlay takes, so its surface is constructor options (\`timeout\`, \`buttonLabel\`) rather than attributes. \`<adw-toast-overlay>\` IS an element and is documented on the same page; it observes nothing of its own.`,
};

const failures = [];
const notes = [];

// Before anything reads anything: a missing root is "could not look", not "found
// nothing". Checked here rather than beside its use because the element reader below
// throws first, and a Node stack trace reads like a broken gate instead of a bad
// argument.
for (const [label, path] of [
    ['the Adwaita gallery pages', DOCS_DIR],
    ['the element reader', join(ROOT, 'scripts/adwaita-elements.mjs')],
]) {
    if (!existsSync(path)) {
        console.error(`check-generated-website-data: cannot look — ${label} is not at ${path}. Wrong --root?`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// 1. every generator reproduces its committed output
// ---------------------------------------------------------------------------

for (const rel of GENERATORS) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) {
        failures.push(`${rel}: listed as a generator and not present`);
        continue;
    }
    const proc = spawnSync(process.execPath, [abs, '--check'], { cwd: ROOT, encoding: 'utf8' });
    if (proc.status === 0) {
        notes.push(`${rel} — output current`);
        continue;
    }
    const said = `${proc.stderr ?? ''}${proc.stdout ?? ''}`.trim().split('\n').slice(0, 4).join('\n    ');
    // Each generator's `--check` compares the DATA it emitted — token pairs, tag
    // rows — not the file's bytes, so it needs no formatter and cannot fail for want
    // of one, and reformatting is not mistaken for drift. A non-zero exit here is the
    // data really having changed; the generator's own message says which file.
    failures.push(`${rel}: its committed output no longer matches its source.\n    ${said}`);
}

// ---------------------------------------------------------------------------
// 2 + 3. every gallery block reaches an element, and no exemption is stale
// ---------------------------------------------------------------------------

const { byTag, unreadable } = observedAttributes(ROOT);
if (unreadable.length > 0) {
    failures.push(
        `${unreadable.length} element(s) declare an observedAttributes the reader cannot resolve — ` +
            `an unreadable one renders an EMPTY table: ${unreadable.join(', ')}`,
    );
}

const toTag = (title) =>
    `adw-${title
        .replace(/^(?:Adw|Gtk)\./, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase()}`;

const seenTitles = new Set();
let blocks = 0;
let tabled = 0;

for (const page of readdirSync(DOCS_DIR).filter((f) => f.endsWith('.mdx'))) {
    const text = readFileSync(join(DOCS_DIR, page), 'utf8');
    for (const [, title] of text.matchAll(/<AdwWidget\s+title="([^"]+)"/g)) {
        blocks++;
        seenTitles.add(title);
        const tag = toTag(title);
        if (byTag.has(tag)) {
            if (byTag.get(tag).length > 0) tabled++;
            if (NO_ELEMENT[title]) {
                failures.push(
                    `${page}: "${title}" is exempted in NO_ELEMENT and DOES resolve, to <${tag}>. ` +
                        'Drop the exemption — a stale one reads as considered.',
                );
            }
            continue;
        }
        if (NO_ELEMENT[title]) continue;
        failures.push(
            `${page}: "${title}" derives <${tag}>, which the web pillar does not register, so its\n` +
                '    block renders no attribute table and looks documented anyway. Either the title or\n' +
                '    the element name is wrong, or the widget has no element — say so in NO_ELEMENT.',
        );
    }
}

for (const title of Object.keys(NO_ELEMENT)) {
    if (!seenTitles.has(title)) {
        failures.push(`NO_ELEMENT names "${title}", which no gallery page uses. Drop the entry.`);
    }
}

// ---------------------------------------------------------------------------
// 4. every gallery block reaches the framework-snippet source
// ---------------------------------------------------------------------------

const treed = new Map(ADWAITA_GALLERY_TREES.map((tree) => [tree.widget, tree]));
for (const title of seenTitles) {
    const hasTree = treed.has(title);
    const hasRefusal = Object.hasOwn(ADWAITA_GALLERY_REFUSALS, title);
    if (hasTree && hasRefusal) {
        failures.push(
            `"${title}" has BOTH a tree and a refusal in adwaita-gallery-trees.mjs. ` +
                'One of them is wrong, and the snippet the page shows does not say which.',
        );
    } else if (!hasTree && !hasRefusal) {
        failures.push(
            `"${title}" has neither a tree nor a refusal in adwaita-gallery-trees.mjs, so its ` +
                'framework tabs are silently absent — indistinguishable from a widget that cannot have them.',
        );
    }
}
for (const title of [...treed.keys(), ...Object.keys(ADWAITA_GALLERY_REFUSALS)]) {
    if (!seenTitles.has(title)) {
        failures.push(`adwaita-gallery-trees.mjs names "${title}", which no gallery page has a block for.`);
    }
}

// ---------------------------------------------------------------------------
// 5. every tag, prop and slot in those trees is one gtk-host has
// ---------------------------------------------------------------------------

const HOST_SRC = join(ROOT, 'packages/framework/gtk-host/src');
const readOr = (rel) => {
    try {
        return readFileSync(join(HOST_SRC, rel), 'utf8');
    } catch {
        return null;
    }
};
const widgetsSrc = readOr('generated/widgets.ts');
const propsSrc = readOr('generated/props.ts');
const descriptorFiles = ['descriptors/adw.ts', 'descriptors/gtk.ts'].map(readOr);
// `.join()` and then a search for "null" was the first version, and it fired on the
// real source: `wrap: null` is a descriptor field. A reader whose "unreadable"
// signal is a word the file legitimately contains is a gate that reports itself.
const descriptorSrc = descriptorFiles.join('\n');

if (widgetsSrc === null || propsSrc === null || descriptorFiles.some((f) => f === null)) {
    failures.push('gtk-host sources are not readable — arm 5 would pass vacuously, which is worse than red');
} else {
    const hostTags = new Set([...widgetsSrc.matchAll(/tag:\s*'([^']+)'/g)].map((m) => m[1]));
    // A reader that found nothing makes every set difference empty.
    if (hostTags.size === 0) failures.push("gtk-host's tag table read as empty — the generated shape changed");

    const byTagStart = propsSrc.indexOf('export interface WidgetPropsByTag {');
    const byTagBody = propsSrc.slice(byTagStart, propsSrc.indexOf('\n}', byTagStart));
    const propsIface = new Map([...byTagBody.matchAll(/'([^']+)':\s*([A-Za-z0-9_]+);/g)].map((m) => [m[1], m[2]]));
    const propCache = new Map();
    /** Every prop name an interface declares, its `extends` chain included. */
    const propNames = (name, seen = new Set()) => {
        if (!name || seen.has(name)) return new Set();
        seen.add(name);
        // `export interface X` may be followed by a NEWLINE before `extends` —
        // matching `'export interface ' + name + ' '` finds nothing for exactly the
        // interfaces that extend something, which is all of them. Measured while
        // writing this: the first version reported 0 of 194 attributes as known.
        const at = propsSrc.search(new RegExp(`export interface ${name}\\b`));
        if (at < 0) return new Set();
        const open = propsSrc.indexOf('{', at);
        const close = propsSrc.indexOf('\n}', open);
        const out = new Set(
            [...propsSrc.slice(open, close).matchAll(/^\s+'?([A-Za-z_$][-\w$]*)'?\??:/gm)].map((m) => m[1]),
        );
        const ext = /extends\s+([^{]+)/.exec(propsSrc.slice(at, open));
        if (ext) for (const parent of ext[1].split(',')) for (const q of propNames(parent.trim(), seen)) out.add(q);
        return out;
    };
    const propsOf = (tag) => {
        if (!propCache.has(tag)) propCache.set(tag, propNames(propsIface.get(tag)));
        return propCache.get(tag);
    };

    /** GType -> the slot names its CURATED descriptor declares, or null for none. */
    const curatedSlots = new Map();
    for (const block of descriptorSrc.split(/\n    \{\n/).slice(1)) {
        const gtype = /gtype:\s*'([^']+)'/.exec(block)?.[1];
        if (!gtype) continue;
        const slots = /slots:\s*\{([^}]*)\}/.exec(block)?.[1];
        curatedSlots.set(gtype, slots === undefined ? null : [...slots.matchAll(/(\w+):/g)].map((m) => m[1]));
    }
    if (curatedSlots.size === 0) failures.push('no curated descriptor was read — arm 5 cannot judge a slot');

    const walk = (node, widget, parent) => {
        if (!hostTags.has(node.tag)) {
            failures.push(`${widget}: <${node.tag}> is not a gtk-host tag, so nothing can render it.`);
            return;
        }
        const known = propsOf(node.tag);
        for (const name of Object.keys(node.props ?? {})) {
            if (!known.has(name)) {
                failures.push(`${widget}: <${node.tag}> has no prop "${name}" in gtk-host's generated table.`);
            }
        }
        if (parent !== null) {
            const parentGType = gtypeOfTag(parent.tag);
            if (!curatedSlots.has(parentGType)) {
                failures.push(
                    `${widget}: <${parent.tag}> has no curated descriptor, so <${node.tag}> inside it is ` +
                        'the uncurated-placement refusal — it belongs in ADWAITA_GALLERY_REFUSALS, not in a tree.',
                );
            } else if (node.slot !== undefined) {
                const slots = curatedSlots.get(parentGType);
                if (slots === null || !slots.includes(node.slot)) {
                    failures.push(
                        `${widget}: <${parent.tag}> declares no slot "${node.slot}" ` +
                            `(known: ${slots === null ? 'none — it is not a slotted parent' : slots.join(', ')}).`,
                    );
                }
            }
        }
        for (const child of node.children ?? []) walk(child, widget, node);
    };
    for (const tree of ADWAITA_GALLERY_TREES) walk(tree.root, tree.widget, null);
    notes.push(
        `${ADWAITA_GALLERY_TREES.length} framework tree(s), ` +
            `${Object.keys(ADWAITA_GALLERY_REFUSALS).length} refusal(s), against ${hostTags.size} gtk-host tag(s)`,
    );
}

// ---------------------------------------------------------------------------
// 6. every shipped snippet occurs in the probe that runs it
// ---------------------------------------------------------------------------

let checkedSnippets = 0;
for (const [dialect, rel] of Object.entries(PROBE_SOURCES)) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) {
        failures.push(`${rel}: the ${dialect} probe is missing, so its snippets ran nowhere`);
        continue;
    }
    const probe = readFileSync(abs, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
    const joined = `\n${probe.join('\n')}\n`;
    for (const tree of ADWAITA_GALLERY_TREES) {
        const lines = snippetLines(tree, dialect);
        // An empty region matches everything, which is the vacuous shape this arm is
        // most exposed to — it happened while writing it, to six leaf widgets at once.
        if (lines.length === 0) {
            failures.push(`${tree.widget}: its ${dialect} snippet has no comparable region — arm 6 cannot judge it`);
            continue;
        }
        const wanted = `\n${lines.join('\n')}\n`;
        if (joined.includes(wanted)) {
            checkedSnippets += 1;
            continue;
        }
        failures.push(
            `${tree.widget}: its ${dialect} snippet does not occur in ${rel}, so the website would ` +
                'publish markup that nothing compiled. Re-run the generator.',
        );
    }
}
notes.push(`${checkedSnippets} snippet(s) found verbatim in the showcase that compiles them`);
if (checkedSnippets === 0) failures.push('no snippet was matched against a probe — arm 6 proved nothing');

// ---------------------------------------------------------------------------
// 7. the formatter still leaves the generated outputs alone
// ---------------------------------------------------------------------------

const OXFMT_CONFIG = '.oxfmtrc.json';
try {
    const ignored = JSON.parse(readFileSync(join(ROOT, OXFMT_CONFIG), 'utf8')).ignorePatterns;
    if (!Array.isArray(ignored) || ignored.length === 0) {
        failures.push(`${OXFMT_CONFIG}: no ignorePatterns array — arm 7 cannot judge anything`);
    } else {
        for (const rel of OXFMT_EXEMPT_OUTPUTS) {
            if (ignored.includes(rel)) continue;
            failures.push(
                `${OXFMT_CONFIG} no longer exempts ${rel}. It is GENERATED — its bytes come from ` +
                    'generate-adwaita-framework-snippets.mjs, which formats nothing because the jobs ' +
                    'running this check have no node_modules. Re-add the exemption; do not reformat the file.',
            );
        }
        notes.push(`${OXFMT_EXEMPT_OUTPUTS.length} generated output(s) exempt from ${OXFMT_CONFIG}`);
    }
} catch (error) {
    failures.push(`${OXFMT_CONFIG} is unreadable (${error.message}) — arm 7 would pass vacuously`);
}

// A scan whose corpus is empty reports green while proving nothing.
if (blocks === 0) failures.push('no <AdwWidget> block found on any gallery page — the reader is broken');
if (ADWAITA_GALLERY_TREES.length === 0) failures.push('no framework tree at all — arms 4 and 5 proved nothing');

notes.push(
    `${blocks} gallery block(s), ${tabled} rendering a generated attribute table, ` +
        `${byTag.size} registered element(s), ${Object.keys(NO_ELEMENT).length} exemption(s)`,
);

for (const note of notes) console.log(`check-generated-website-data: ${note}`);

if (failures.length > 0) {
    console.error(`\ncheck-generated-website-data: ${failures.length} problem(s):\n`);
    for (const line of failures) console.error(`  ${line}`);
    process.exit(1);
}

console.log('check-generated-website-data: OK.');
