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
//      pillar actually registers AND observes something — or sits in
//      {@link NO_ATTRIBUTE_PANE} with the reason
//      its widget has none.
//   3. Nothing in {@link NO_ATTRIBUTE_PANE} names a title that DOES get a pane, so a stale
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
//   5b. Every `uncurated-placement` refusal is TRUE (its GType still has no curated
//      descriptor) and is actually PROBED, and every placement the probe measures is
//      either a gallery refusal or ledgered in the probe itself. Nothing held the two
//      lists against each other, so a stale claim and an unmeasured one both read green.
//   6. Every snippet the website ships occurs, line for line, in the probe showcase
//      that COMPILES AND RUNS it. Both come from one generator run, so today they
//      cannot disagree — and that is exactly why it is worth asserting: the day a
//      hand edits one of the two generated files, or an emitter grows a branch that
//      only the website takes, the site would publish markup nothing ever ran. That
//      is the claim the whole arrangement rests on, so it is the one to hold.
//   7. Every gallery block reaches the NativeScript template source too: a template
//      in `adwaita-gallery-ns-templates.mjs` or a REFUSAL naming why it has none.
//      Same partition as (4), one port over.
//   8. Every element, property and slot in those templates is one
//      `@gjsify/adwaita-nativescript` actually has — read out of the widget sources.
//      And, because NativeScript's Builder assigns an attribute VERBATIM, every
//      non-string property must go through `xmlNumber`/`xmlBoolean` in its setter,
//      and every child must land in a widget that OVERRIDES `_addChildFromBuilder`.
//      Both were measured failing on device before this arm existed: `open="false"`
//      opened a dialog, and a header bar declared as a toolbar view's top bar painted
//      over the content.
//   9. Every template the website ships is BYTE-IDENTICAL to the view file the probe
//      loads. Same claim as (6), and the stronger one here — a template nobody
//      inflated is not a snippet nobody compiled, it is markup that renders SOMETHING
//      either way.
//  10. Every generated output is still EXEMPT in `.oxfmtrc.json`. The generator
//      emits its final bytes itself and nothing formats them — it used to shell out
//      to `node_modules/.bin/oxfmt`, which does not exist in this job or in
//      `Manifest checks (Windows)`, because both are `checkout` + `setup-node` and
//      nothing else. If an exemption is dropped, `yarn format` rewrites a generated
//      file, arm 1 then reports drift that is not drift, and the repair is to
//      re-add the exemption rather than to re-run the generator — so the failure
//      has to say which of the two it is.
//  11. The two authored trees describe the SAME UI, or say why they do not. Every
//      block drawn by both renderers is either authored ONCE in
//      `adwaita-gallery-shared-trees.mjs` or ledgered in that file's
//      `ADWAITA_GALLERY_TREE_DIVERGENCES`, never both and never neither, and a
//      ledgered block whose two trees have BECOME identical fails, the same
//      self-retiring shape as (5b). (4)-(9) each hold ONE tree against ONE renderer,
//      which is why they were all green while one block drew two different widgets.
//
// Plain Node over the repo's own files — no install, no build, no astro render.
//
// Usage: node scripts/check-generated-website-data.mjs [--root <dir>]

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { galleryElementTag } from '../website/src/components/attr-sample.mjs';
import { observedAttributes } from './adwaita-elements.mjs';
import { ADWAITA_GALLERY_NS_REFUSALS, ADWAITA_GALLERY_NS_TEMPLATES } from './adwaita-gallery-ns-templates.mjs';
import {
    ADWAITA_GALLERY_SHARED_TREES,
    ADWAITA_GALLERY_TREE_DIVERGENCES,
    hostTagOf,
} from './adwaita-gallery-shared-trees.mjs';
import { ADWAITA_GALLERY_REFUSALS, ADWAITA_GALLERY_TREES } from './adwaita-gallery-trees.mjs';
import {
    gtypeOfTag,
    OXFMT_EXEMPT_OUTPUTS,
    PROBE_SOURCES,
    snippetLines,
} from './generate-adwaita-framework-snippets.mjs';
import {
    NS_GENERATED,
    NS_OXFMT_EXEMPT_OUTPUTS,
    templateFor,
    viewNameOf,
} from './generate-adwaita-nativescript-templates.mjs';
// The SAME reader `check-nativescript-xml-doors.mjs` holds the whole package with. Two
// parsers over one source would be two truths about it, and the narrower corpus here is
// the point: that gate says every setter is safe, this one says every template is honest
// about the setter it names.
import {
    attributeKind,
    chainOf,
    coerces,
    doorFor,
    membersOf,
    readElements,
    readNamespaceSpellings,
    readTypeSources,
    readWidgets,
    setterOf,
    WIDGET_CLASS,
} from './nativescript-xml-doors.mjs';

// A class NAMED IN PROSE: the library prefix plus a capital, so `GtkDropDown` in a
// refusal reason is a mention and `Gtk.DropDown` — the gallery block's title, sitting in
// the same sentence — is not.
const CLASS_MENTION = /\b((?:Adw|Gtk)[A-Z]\w*)(?:\.(\w+))?/g;

const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : process.argv[rootFlag + 1];

/**
 * The gallery's section directories, one per widget library. Two since ADR 0034 § 1
 * put `Gtk` beside `Adwaita`; arm 4 below counts BLOCKS, so reading one directory
 * would report a smaller gallery than the site ships and call it complete.
 */
const DOCS_SECTIONS = ['adwaita', 'gtk'];
const docsDir = (section) => join(ROOT, 'website/src/content/docs', section);

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
    // Emits the NativeScript XML template for every block that has one, AND the
    // `app/views/*.xml` the probe showcase inflates plus the barrel and expected tree
    // it reads them through. Four committed outputs, four ways to drift.
    'scripts/generate-adwaita-nativescript-templates.mjs',
];

/**
 * Gallery titles whose block renders NO attribute pane, with the reason.
 *
 * Not a convenience list: each entry is a claim that gets checked back, so a title
 * that later gains an observing element turns this into a failure rather than a
 * permanently silent block.
 *
 * TWO ways to have no pane and only one used to be checked. A title that resolves to
 * no element failed here; a title that resolved to an element observing NOTHING was
 * counted and waved through, and this check printed its own contradiction — "40
 * gallery block(s), 38 rendering a generated attribute table, 1 exemption(s)" — at
 * exit 0. `<adw-wrap-box>` was the second: 14 attributes its own
 * `attributeChangedCallback` serves, read as none because the reader could not see a
 * `return [...PROPERTY_ATTRIBUTES];`, and one gallery block silently without a pane.
 */
const NO_ATTRIBUTE_PANE = {
    'Adw.Toast': `A toast is not an element — \`AdwToast\` is a plain class the overlay takes, so its surface is constructor options (\`timeout\`, \`buttonLabel\`) rather than attributes. \`<adw-toast-overlay>\` IS an element and is documented on the same page; it observes nothing of its own.`,
};

const failures = [];
const notes = [];

// Before anything reads anything: a missing root is "could not look", not "found
// nothing". Checked here rather than beside its use because the element reader below
// throws first, and a Node stack trace reads like a broken gate instead of a bad
// argument.
for (const [label, path] of [
    ...DOCS_SECTIONS.map((section) => [`the ${section} gallery pages`, docsDir(section)]),
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

const seenTitles = new Set();
let blocks = 0;
let tabled = 0;

for (const { page, file } of DOCS_SECTIONS.flatMap((section) =>
    readdirSync(docsDir(section))
        .filter((f) => f.endsWith('.mdx'))
        // `buttons.mdx` now exists in both sections, so a bare filename in a failure
        // no longer says which page it is.
        .map((f) => ({ page: `${section}/${f}`, file: join(docsDir(section), f) })),
)) {
    const text = readFileSync(file, 'utf8');
    for (const [, title] of text.matchAll(/<AdwWidget\s+title="([^"]+)"/g)) {
        blocks++;
        seenTitles.add(title);
        const tag = galleryElementTag(title);
        if (byTag.has(tag)) {
            const observed = byTag.get(tag).length;
            if (observed > 0) tabled++;
            if (NO_ATTRIBUTE_PANE[title] && observed > 0) {
                failures.push(
                    `${page}: "${title}" is exempted in NO_ATTRIBUTE_PANE and DOES get a pane, from ` +
                        `<${tag}>. Drop the exemption — a stale one reads as considered.`,
                );
            } else if (observed === 0 && !NO_ATTRIBUTE_PANE[title]) {
                failures.push(
                    `${page}: "${title}" derives <${tag}>, which the pillar registers but which this\n` +
                        '    reader says observes NOTHING, so its block renders no attribute pane and looks\n' +
                        '    documented anyway. Either the reader cannot see the declaration (teach\n' +
                        '    scripts/adwaita-elements.mjs the shape) or the element really has none — say\n' +
                        '    so in NO_ATTRIBUTE_PANE.',
                );
            }
            continue;
        }
        if (NO_ATTRIBUTE_PANE[title]) continue;
        failures.push(
            `${page}: "${title}" derives <${tag}>, which the web pillar does not register, so its\n` +
                '    block renders no attribute pane and looks documented anyway. Either the title or\n' +
                '    the element name is wrong, or the widget has no element — say so in\n' +
                '    NO_ATTRIBUTE_PANE.',
        );
    }
}

for (const title of Object.keys(NO_ATTRIBUTE_PANE)) {
    if (!seenTitles.has(title)) {
        failures.push(`NO_ATTRIBUTE_PANE names "${title}", which no gallery page uses. Drop the entry.`);
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

    /**
     * GType -> the slot names its CURATED CHILD POLICY declares, or null for none.
     *
     * KEYED ON THE POLICY, NOT ON TABLE MEMBERSHIP, and the difference is measured
     * rather than pedantic. Both readers below ask one question — *can a child go
     * inside this widget?* — and "the gtype appears in `descriptors/*.ts`" was a
     * proxy for it that held only while every curated row was curated for its
     * CHILDREN. ADR 0045 broke that: a descriptor can now be curated for its
     * PLACEMENT alone (`AdwAlertDialog` and its three siblings are portals whose
     * child policy is still `uncurated`, because each builds its own template and
     * inherits a `set_child` that would replace it). Read as membership, this file
     * then called a perfectly live `uncurated-placement` refusal stale.
     *
     * So a block declaring `children: { kind: 'uncurated' }` is skipped, which puts
     * it back where it was before it was curated at all — the honest state, and the
     * one `gtk-host` itself reports.
     */
    const curatedSlots = new Map();
    for (const block of descriptorSrc.split(/\n    \{\n/).slice(1)) {
        const gtype = /gtype:\s*'([^']+)'/.exec(block)?.[1];
        if (!gtype) continue;
        if (/children:\s*\{[\s\S]*?kind:\s*'uncurated'/.test(block)) continue;
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

    // ---------------------------------------------------------------------------
    // 5b. the uncurated-placement claims, and the probe that is supposed to measure
    // ---------------------------------------------------------------------------
    //
    // The SAME rule as the NativeScript refusal arm below — a refusal reason is a
    // CLAIM, and a claim nothing reads is prose — but a different predicate, because
    // the two ports refuse for different mechanical reasons. NativeScript's reasons
    // name a widget MEMBER (an array property, a missing `_addChildFromBuilder`), so
    // they are checked against the widget classes. These name `uncurated-placement`,
    // which is `gtk-host`'s own refusal for a child placed into a widget whose
    // descriptor declares no child policy — a property of the DESCRIPTOR TABLE, which
    // moves when the table does. One predicate over both would have to be so loose it
    // checked neither.
    //
    // Both directions, because both have gone wrong here before: #1368 curated five
    // containers and three refusals became stale overnight — `probe:refusals` is what
    // said so — and the reverse, a reason claiming a placement nothing probes, had
    // nothing looking at all.
    const PROBE_REFUSALS = 'showcases/gtk/adwaita-gallery-solid/src/refusals.ts';
    let probeText = null;
    try {
        probeText = readFileSync(join(ROOT, PROBE_REFUSALS), 'utf8');
    } catch {
        probeText = null;
    }
    if (probeText === null) {
        failures.push(`${PROBE_REFUSALS} is unreadable — arm 5b would pass vacuously`);
    } else {
        const list = /const PLACEMENTS: readonly \[parent: string, child: string\]\[\] = \[([\s\S]*?)\n\];/.exec(
            probeText,
        );
        const probed = new Map(
            list === null ? [] : [...list[1].matchAll(/\['([^']+)',\s*'([^']+)'\]/g)].map((m) => [m[1], m[2]]),
        );
        const ledgerBlock = /PLACEMENTS_NOT_IN_THE_GALLERY: Record<string, string> = \{([\s\S]*?)\n\};/.exec(probeText);
        const notInGallery = new Set(
            ledgerBlock === null ? [] : [...ledgerBlock[1].matchAll(/^\s{4}'([^']+)':/gm)].map((m) => m[1]),
        );

        if (probed.size === 0)
            failures.push(`${PROBE_REFUSALS}: its PLACEMENTS list read as empty — arm 5b proved nothing`);

        /** `adw-wrap-box` -> `Adw.WrapBox`, the gallery title a placement refuses for. */
        const titleOfTag = (tag) => {
            const gtype = gtypeOfTag(tag);
            return `${gtype.slice(0, 3)}.${gtype.slice(3)}`;
        };

        for (const [widget, reason] of Object.entries(ADWAITA_GALLERY_REFUSALS)) {
            if (!reason.includes('uncurated-placement')) continue;
            const gtype = widget.replace('.', '');
            if (curatedSlots.has(gtype)) {
                failures.push(
                    `"${widget}" is refused as uncurated-placement, but ${gtype} HAS a curated descriptor now. ` +
                        'The refusal is stale — that block can have a tree. (#1368 turned three of these green ' +
                        'at once, and only the probe noticed.)',
                );
            }
            const tag = [...probed.keys()].find((t) => titleOfTag(t) === widget);
            if (tag === undefined) {
                failures.push(
                    `"${widget}" claims uncurated-placement and ${PROBE_REFUSALS} probes no placement into it, ` +
                        'so the claim is never measured. Add the parent/child pair to PLACEMENTS.',
                );
            }
        }

        for (const parent of probed.keys()) {
            if (notInGallery.has(parent)) continue;
            const widget = titleOfTag(parent);
            if (!Object.hasOwn(ADWAITA_GALLERY_REFUSALS, widget)) {
                failures.push(
                    `${PROBE_REFUSALS} probes <${parent}>, which is neither a refusal in the gallery ledger ` +
                        `(as "${widget}") nor an entry in its own PLACEMENTS_NOT_IN_THE_GALLERY. A probe measuring ` +
                        'something nothing claims is a pass about nothing.',
                );
            }
        }

        for (const parent of notInGallery) {
            if (!probed.has(parent)) {
                failures.push(
                    `${PROBE_REFUSALS}: PLACEMENTS_NOT_IN_THE_GALLERY names <${parent}>, which PLACEMENTS does ` +
                        'not probe. Drop the entry — a stale exemption reads as considered.',
                );
            }
        }
        notes.push(
            `${probed.size} probed placement(s), ${notInGallery.size} ledgered as not-a-gallery-block, ` +
                'each uncurated-placement refusal measured',
        );
    }
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
// 7 + 8 + 9. the NativeScript XML templates
// ---------------------------------------------------------------------------

/**
 * NativeScript-core properties a template may name that no widget source declares.
 *
 * Checked back like {@link NO_ATTRIBUTE_PANE}: an entry whose widget later grows a
 * setter of its own fails here, so the list cannot quietly outlive its reason. These
 * are `Property` objects on NativeScript's own base classes, which DO carry a
 * `valueConverter` — which is why arm 8 does not demand `xmlNumber`/`xmlBoolean` of
 * them.
 */
const NS_CORE_PROPS = {
    id: 'ViewBase.id — the handle a code-behind reaches a template child by.',
    class: 'ViewBase.className, spelled `class` in markup.',
    text: 'TextBase.text — GtkButton extends NativeScript Button, whose label IS `text`.',
    textWrap: 'TextBase.textWrap.',
    orientation: 'LayoutBase orientation on StackLayout.',
};

let nsSources = new Map();
let nsFiles = new Map();
let nsTypes = [];
let nsElements = new Set();
try {
    ({ sources: nsSources, files: nsFiles } = readWidgets(ROOT));
    nsTypes = readTypeSources(ROOT);
    nsElements = readElements(ROOT);
} catch {
    // Reported below: an empty index would make arm 8 pass vacuously.
}

/**
 * Every class the widget files declare, read with NO prefix rule at all.
 *
 * `nsSources` cannot answer this: its index is built with `WIDGET_CLASS`, so a class
 * the pattern does not recognise is missing from BOTH sides of any comparison against
 * it and the disagreement cancels out. This one reads `export class <anything>`, which
 * is why it can contradict the pattern.
 */
const nsDeclaredClasses = new Set(
    [...nsFiles.values()].flatMap((text) => [...text.matchAll(/export (?:abstract )?class (\w+)/g)].map((m) => m[1])),
);

if (nsSources.size === 0) {
    failures.push('no @gjsify/adwaita-nativescript widget source was readable — arm 8 would prove nothing');
} else {
    if (nsElements.size === 0) {
        failures.push("the widgets barrel's ELEMENTS map read as empty — arm 8 cannot judge a tag");
    }

    /**
     * The XML slots a class declares, and whether it can place a child at all.
     *
     * TWO ways to take one, and only one of them can hear a slot NAME.
     * `_addChildFromBuilder(name, view)` is the named door. Overriding `addChild` is
     * the other: `AdwWrapBox` does exactly that and says so — the inflation "ends
     * here" because a wrap box has one destination — so demanding the named door of
     * it would report a working widget as broken. A SLOTTED child still needs the
     * named one, because `addChild` never sees which slot was asked for.
     */
    const slotsOf = (tag) => {
        const slots = new Set();
        let named = false;
        let anyChild = false;
        for (const text of chainOf(nsSources, tag)) {
            if (/^\s{4}_addChildFromBuilder\(/m.test(text)) {
                named = true;
                anyChild = true;
            }
            if (/^\s{4}addChild\(/m.test(text)) anyChild = true;
            for (const [, body] of text.matchAll(/const \w*_SLOTS = \[([^\]]*)\]/g)) {
                for (const [, slot] of body.matchAll(/'([^']+)'/g)) slots.add(slot);
            }
        }
        return { slots, named, anyChild };
    };

    /**
     * What a template literal is, in the vocabulary `attributeKind` answers in.
     *
     * A JSON DOOR is a string in the template and `json` to the classifier, so the spelling
     * alone cannot tell the two apart — the CONTENT does: a string that parses to a plain
     * object is the door's, any other string is a plain `string` attribute. That is a real
     * test rather than a widening, and it is the one a reader of the template needs: an
     * `adjustment='{"lower":1}'` that stopped being JSON would author nothing at all, in
     * silence, because the door is total by construction.
     */
    const parsesToObject = (value) => {
        if (typeof value !== 'string') return false;
        try {
            const parsed = JSON.parse(value);
            return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
        } catch {
            return false;
        }
    };
    const literalKind = (value) =>
        typeof value === 'number'
            ? 'number'
            : typeof value === 'boolean'
              ? 'boolean'
              : parsesToObject(value)
                ? 'json'
                : 'string';

    // A class THIS package declares, told from a NativeScript-core one by its library
    // prefix. `Adw` alone was the test until ADR 0034 clause 1 renamed four widgets to
    // `Gtk*`: those then read as core classes, so no setter was looked up for them and
    // every attribute they carry fell through to NS_CORE_PROPS as an unexplained one.
    const OWN_CLASS = new RegExp(`^${WIDGET_CLASS}$`);
    const walkNs = (node, widget, parent) => {
        const own = OWN_CLASS.test(node.tag);
        if (own && !nsSources.has(node.tag)) {
            failures.push(`${widget}: <${node.tag}> is not a widget class in @gjsify/adwaita-nativescript.`);
            return;
        }
        if (own && nsElements.size > 0 && !nsElements.has(node.tag)) {
            failures.push(
                `${widget}: <${node.tag}> is not in the widgets barrel's ELEMENTS map, so it is not an ` +
                    'element the port offers for XML use.',
            );
        }
        for (const [name, value] of Object.entries(node.props ?? {})) {
            const setter = own ? setterOf(nsSources, node.tag, name) : null;
            if (setter === null) {
                if (!Object.hasOwn(NS_CORE_PROPS, name)) {
                    failures.push(
                        `${widget}: <${node.tag}> has no setter "${name}" in @gjsify/adwaita-nativescript, and ` +
                            'it is not a NativeScript-core property — say which in NS_CORE_PROPS.',
                    );
                }
                continue;
            }
            // The WIDGET's declared type decides, never the JS literal in the source.
            // Keying on the literal was a hole big enough to drive the whole defect
            // through: `{ flat: 'false' }` and `{ flat: false }` emit byte-identical
            // XML, and only the second was checked — so the evadable spelling was the
            // one that could ship an uncoerced boolean.
            const kind = attributeKind(nsTypes, setter.annotation);
            if (kind === null) {
                failures.push(
                    `${widget}: <${node.tag}> declares ${name} as \`${setter.annotation}\`, which an XML ` +
                        'attribute cannot carry — it arrives as a string. This block belongs in ' +
                        'ADWAITA_GALLERY_NS_REFUSALS.',
                );
                continue;
            }
            if (literalKind(value) !== kind) {
                failures.push(
                    `${widget}: <${node.tag}> declares ${name} as \`${setter.annotation}\` (${kind}), but the ` +
                        `template writes the ${literalKind(value)} ${JSON.stringify(value)}. Write it as a ` +
                        `${kind} — the two emit the same XML, so the spelling is the only thing that can say ` +
                        'which rule applies.',
                );
            }
            if (!coerces(setter, kind)) {
                failures.push(
                    `${widget}: <${node.tag} ${name}="${value}"> — the setter does not go through ` +
                        `${doorFor(kind)}(). NativeScript assigns an attribute VERBATIM, so the widget would ` +
                        'receive the STRING: a number falls back to the default and "false" is truthy. ' +
                        '(check-nativescript-xml-doors.mjs holds this for the whole package.)',
                );
            }
        }
        if (parent !== null && parent.tag.startsWith('Adw')) {
            const { slots, named, anyChild } = slotsOf(parent.tag);
            if (!anyChild) {
                failures.push(
                    `${widget}: <${parent.tag}> overrides neither _addChildFromBuilder nor addChild, so ` +
                        `<${node.tag}> inside it takes LayoutBase's default and lands in the layout — it belongs ` +
                        'in ADWAITA_GALLERY_NS_REFUSALS, not in a template.',
                );
            } else if (node.slot !== undefined && !named) {
                failures.push(
                    `${widget}: <${parent.tag}> takes a child through addChild, which never sees a slot NAME, ` +
                        `so <${node.tag} slot="${node.slot}"> cannot reach "${node.slot}".`,
                );
            } else if (node.slot !== undefined && !slots.has(node.slot)) {
                failures.push(
                    `${widget}: <${parent.tag}> declares no XML slot "${node.slot}" ` +
                        `(known: ${slots.size === 0 ? 'none — it takes only a default child' : [...slots].join(', ')}).`,
                );
            }
        }
        for (const child of node.children ?? []) walkNs(child, widget, node);
    };

    const templated = new Map(ADWAITA_GALLERY_NS_TEMPLATES.map((t) => [t.widget, t]));
    for (const title of seenTitles) {
        const hasTemplate = templated.has(title);
        const hasRefusal = Object.hasOwn(ADWAITA_GALLERY_NS_REFUSALS, title);
        if (hasTemplate && hasRefusal) {
            failures.push(
                `"${title}" has BOTH a template and a refusal in adwaita-gallery-ns-templates.mjs. ` +
                    'One of them is wrong, and the XML tab the page shows does not say which.',
            );
        } else if (!hasTemplate && !hasRefusal) {
            failures.push(
                `"${title}" has neither a template nor a refusal in adwaita-gallery-ns-templates.mjs, so its ` +
                    'NativeScript XML tab is silently absent — indistinguishable from one that cannot exist.',
            );
        }
    }
    for (const title of [...templated.keys(), ...Object.keys(ADWAITA_GALLERY_NS_REFUSALS)]) {
        if (!seenTitles.has(title)) {
            failures.push(`adwaita-gallery-ns-templates.mjs names "${title}", which no gallery page has a block for.`);
        }
    }
    for (const template of ADWAITA_GALLERY_NS_TEMPLATES) walkNs(template.root, template.widget, null);

    // An exemption earns its place per (element, property) and not per NAME: `text`
    // is `AdwEntryRow`'s own setter AND NativeScript `Button`'s, and testing the name
    // alone reported the entry as stale while `<GtkButton text="Pill">` still needed
    // it. Stale means NO use in the templates falls through to core.
    for (const name of Object.keys(NS_CORE_PROPS)) {
        let uses = 0;
        let fellThrough = 0;
        for (const template of ADWAITA_GALLERY_NS_TEMPLATES) {
            const walk = (node) => {
                if (OWN_CLASS.test(node.tag) && Object.hasOwn(node.props ?? {}, name)) {
                    uses += 1;
                    if (setterOf(nsSources, node.tag, name) === null) fellThrough += 1;
                }
                for (const child of node.children ?? []) walk(child);
            };
            walk(template.root);
        }
        if (uses > 0 && fellThrough === 0) {
            failures.push(
                `NS_CORE_PROPS names "${name}", and every widget using it in the templates declares its OWN ` +
                    'setter. Drop the entry — a stale exemption reads as considered.',
            );
        }
    }

    // A REFUSAL is a claim about the port, and until this arm existed nothing read one.
    // Three of the twelve named something that does not exist: two said a view switcher's
    // `stack` was the blocker when neither class has a `stack` at all (it is `views`),
    // and the toast reason described `AdwToast` — "not a View" — while the block's widget
    // is `AdwToastOverlay`, which IS a View and IS offered for XML use. A true sentence
    // about the wrong object is the most durable kind of wrong, because every reader
    // checks the sentence and not the object.
    for (const [widget, reason] of Object.entries(ADWAITA_GALLERY_NS_REFUSALS)) {
        const mentions = [...reason.matchAll(CLASS_MENTION)];
        if (mentions.length === 0) {
            failures.push(
                `the refusal for "${widget}" names no widget class, so nothing can hold it against the port. ` +
                    'Say which class refuses, and which member is the reason.',
            );
            continue;
        }
        for (const [, tag, member] of mentions) {
            if (!nsSources.has(tag)) {
                failures.push(`the refusal for "${widget}" names ${tag}, which is not a class in the package.`);
                continue;
            }
            if (member === undefined) continue;
            if (!membersOf(nsSources, tag).has(member)) {
                failures.push(
                    `the refusal for "${widget}" names ${tag}.${member}, which ${tag} does not have. ` +
                        'A reason that names the wrong member reads as considered and is not.',
                );
                continue;
            }
            // And where the reason is "an attribute cannot carry this", the setter has
            // to agree — otherwise the refusal is STALE and the block could have a
            // template. This is the same reading arm 8 does, asked the other way round.
            const setter = setterOf(nsSources, tag, member);
            if (setter !== null && attributeKind(nsTypes, setter.annotation) !== null) {
                failures.push(
                    `the refusal for "${widget}" rests on ${tag}.${member}, but its declared type ` +
                        `\`${setter.annotation}\` IS something an XML attribute can carry. The refusal is ` +
                        'stale — this block can have a template.',
                );
            }
        }
        if (reason.includes('_addChildFromBuilder')) {
            const [, tag] = new RegExp(CLASS_MENTION.source).exec(reason) ?? [];
            if (
                tag !== undefined &&
                chainOf(nsSources, tag).some((text) => /^\s{4}_addChildFromBuilder\(/m.test(text))
            ) {
                failures.push(
                    `the refusal for "${widget}" says ${tag} overrides no _addChildFromBuilder, and it does. ` +
                        'The refusal is stale — this block can have a template.',
                );
            }
        }
    }
    notes.push(`${Object.keys(ADWAITA_GALLERY_NS_REFUSALS).length} refusal reason(s) held against the widget classes`);

    // Arm 9: the bytes a reader copies are the bytes the probe inflated.
    //
    // AND, on the same bytes, the two things that decide whether they LOAD. The
    // byte-compare alone cannot ask them: it holds the file against the generator that
    // wrote it, so a generator wrong about which elements are its own is wrong on both
    // sides and stays green — which is how ADR 0034 clause 1's four `Gtk*` renames
    // shipped unprefixed and unexported, out of one `startsWith('Adw')`. These two read
    // the emitted text against `nsDeclaredClasses`, which is `export class <anything>`
    // over the widget files and knows no prefix rule, so a generator cannot agree with
    // itself past them.
    const barrelTexts = Object.fromEntries(
        Object.entries(NS_GENERATED.barrels).map(([prefix, rel]) => [prefix, readFileSync(join(ROOT, rel), 'utf8')]),
    );
    // Class -> the XML name of it, off the package's OWN namespace barrels. That is the
    // independent side: `nsDeclaredClasses` knows every class and no prefix rule, these
    // know the placement and no template, and the generator is what has to agree with
    // both. A lookup and not a transform because the barrel DECIDES the placement; the
    // member that used to show it — `Gtk.Image` binding `AdwIcon` — reads alike since
    // ADR 0034 § Amendment 10, and none is left that does not.
    const nsPlacement = new Map();
    for (const [spelling, klass] of readNamespaceSpellings(ROOT)) {
        const [namespace, member] = spelling.split('.');
        nsPlacement.set(klass, { prefix: namespace.toLowerCase(), member });
    }
    const ownTagsOf = (node, into = new Set()) => {
        if (nsDeclaredClasses.has(node.tag)) into.add(node.tag);
        for (const child of node.children ?? []) ownTagsOf(child, into);
        return into;
    };
    let checkedTemplates = 0;
    for (const template of ADWAITA_GALLERY_NS_TEMPLATES) {
        const rel = `${NS_GENERATED.views}/${viewNameOf(template.widget)}.xml`;
        let have = null;
        try {
            have = readFileSync(join(ROOT, rel), 'utf8');
        } catch {
            failures.push(`${template.widget}: ${rel} is missing, so its template was inflated nowhere.`);
            continue;
        }
        for (const tag of ownTagsOf(template.root)) {
            const place = nsPlacement.get(tag);
            if (place === undefined) {
                failures.push(
                    `${template.widget}: ${rel} names <${tag}>, a class this package declares that has NO member ` +
                        'in either namespace barrel, so the XML dialect has no name for it (ADR 0034 clause 2). ' +
                        'Give it a member, or give this block a refusal.',
                );
                continue;
            }
            if (new RegExp(`</?(?:\\w+:)?${tag}[\\s/>.]`).test(have)) {
                failures.push(
                    `${template.widget}: ${rel} names <${tag}> under its CLASS name. That name left the package ` +
                        `root in ADR 0034 § Amendment 9; the element is <${place.prefix}:${place.member}>, and ` +
                        'an element neither barrel exports resolves to nothing at load.',
                );
            }
            if (!new RegExp(`</?${place.prefix}:${place.member}[\\s/>.]`).test(have)) {
                failures.push(
                    `${template.widget}: ${rel} names ${tag} nowhere as <${place.prefix}:${place.member}>, which ` +
                        'is the one spelling of it this dialect has. NativeScript resolves an element it cannot ' +
                        'place against its OWN components, so Builder finds nothing and renders none of it.',
                );
            }
            if (!new RegExp(`^\\s+${place.member},$`, 'm').test(barrelTexts[place.prefix])) {
                failures.push(
                    `${template.widget}: ${rel} names <${place.prefix}:${place.member}>, which ` +
                        `${NS_GENERATED.barrels[place.prefix]} does not re-export. That barrel IS the module ` +
                        `\`xmlns:${place.prefix}\` points at, so the load fails with \`Module ` +
                        `'${place.member}' not found for element\`.`,
                );
            }
        }
        if (have === templateFor(template.root, template.note)) {
            checkedTemplates += 1;
            continue;
        }
        failures.push(
            `${template.widget}: the shipped template and ${rel} differ, so the website would publish XML ` +
                'that nothing loaded. Re-run the generator.',
        );
    }
    notes.push(`${checkedTemplates} XML template(s) byte-identical to the view the probe app inflates`);
    if (checkedTemplates === 0) failures.push('no XML template was matched against a view file — arm 9 proved nothing');

    notes.push(
        `${ADWAITA_GALLERY_NS_TEMPLATES.length} NativeScript template(s), ` +
            `${Object.keys(ADWAITA_GALLERY_NS_REFUSALS).length} refusal(s), against ${nsSources.size} widget class(es)`,
    );
}

if (ADWAITA_GALLERY_NS_TEMPLATES.length === 0)
    failures.push('no NativeScript template at all — arms 7-9 proved nothing');

// ---------------------------------------------------------------------------
// 10. the formatter still leaves the generated outputs alone
// ---------------------------------------------------------------------------

const OXFMT_CONFIG = '.oxfmtrc.json';
/**
 * `.oxfmtrc.json` is JSONC, not JSON — it carries the reasoning for its patterns,
 * which is the whole point of a rule file in this repository.
 *
 * MEASURED: the first version called `JSON.parse` on it and failed with
 * `Unexpected token '/'` on the comment above its lib-directory pattern. It passed
 * locally and went red in CI, because the comments arrived on `main` in #1372
 * AFTER this branch was cut and CI checks out the MERGE of the two. A gate that
 * only reads its own branch's version of a shared config has not read the file it
 * will be judged against. `check-vocabulary-alignment.mjs` strips comments for the
 * same reason, one file over.
 */
const stripJsonComments = (text) => text.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
try {
    const ignored = JSON.parse(stripJsonComments(readFileSync(join(ROOT, OXFMT_CONFIG), 'utf8'))).ignorePatterns;
    if (!Array.isArray(ignored) || ignored.length === 0) {
        failures.push(`${OXFMT_CONFIG}: no ignorePatterns array — arm 7 cannot judge anything`);
    } else {
        for (const rel of [...OXFMT_EXEMPT_OUTPUTS, ...NS_OXFMT_EXEMPT_OUTPUTS]) {
            if (ignored.includes(rel)) continue;
            failures.push(
                `${OXFMT_CONFIG} no longer exempts ${rel}. It is GENERATED — its bytes come from a generator ` +
                    'that formats nothing, because the jobs running this check have no node_modules. Re-add ' +
                    'the exemption; do not reformat the file.',
            );
        }
        notes.push(
            `${OXFMT_EXEMPT_OUTPUTS.length + NS_OXFMT_EXEMPT_OUTPUTS.length} generated output(s) exempt from ${OXFMT_CONFIG}`,
        );
    }
} catch (error) {
    failures.push(`${OXFMT_CONFIG} is unreadable (${error.message}) — arm 7 would pass vacuously`);
}

// ---------------------------------------------------------------------------
// 11. one authored tree where the two renderers agree, a ledgered reason where not
// ---------------------------------------------------------------------------

/**
 * The two authored trees describe the same UI, or say why they do not — ADR 0027
 * § 9's criterion applied to the gallery.
 *
 * THE INCIDENT. `Adw.ExpanderRow` shipped "Proxy settings" with a host and an
 * authentication toggle on three tabs, and "Advanced" with a developer-mode toggle
 * and an endpoint on the fourth, children in the opposite order, for as long as both
 * source files existed. Every arm was green throughout: each holds ONE tree against
 * ONE renderer, and nothing compared the two to each other.
 *
 * The self-retiring half is the one worth having. A ledgered block whose two trees
 * have BECOME identical fails here, exactly as a stale `uncurated-placement` refusal
 * fails in arm 5b — so the branches closing the renderer gaps one property at a time
 * cannot leave a divergence reason standing after its reason is gone.
 */
const sharedByWidget = new Map(ADWAITA_GALLERY_SHARED_TREES.map((tree) => [tree.widget, tree]));
const gtkByWidget = new Map(ADWAITA_GALLERY_TREES.map((tree) => [tree.widget, tree]));
const nsByWidget = new Map(ADWAITA_GALLERY_NS_TEMPLATES.map((tree) => [tree.widget, tree]));

/** A node as a comparable string, tags normalised to the GIR class name. */
const shapeOf = (node, tagOf) =>
    JSON.stringify({
        tag: tagOf(node.tag),
        slot: node.slot ?? null,
        props: Object.entries(node.props ?? {}),
        children: (node.children ?? []).map((child) => shapeOf(child, tagOf)),
    });
// The framework trees speak `gtk-host` tags, the NativeScript ones GIR class names,
// so only ONE side is transformed — and by the inverse of the rule the shared source
// emits with, asserted below rather than assumed.
const gtkShape = (tree) => shapeOf(tree.root, gtypeOfTag);
const nsShape = (tree) => shapeOf(tree.root, (tag) => tag);

const paired = [...gtkByWidget.keys()].filter((widget) => nsByWidget.has(widget));
let convergedBlocks = 0;
for (const widget of paired) {
    const converged = gtkShape(gtkByWidget.get(widget)) === nsShape(nsByWidget.get(widget));
    if (converged) convergedBlocks += 1;
    const isShared = sharedByWidget.has(widget);
    const ledgered = Object.hasOwn(ADWAITA_GALLERY_TREE_DIVERGENCES, widget);
    if (isShared && ledgered) {
        failures.push(`${widget} is both a shared tree and a ledgered divergence — it cannot be two sources.`);
    } else if (!isShared && !ledgered) {
        failures.push(
            `${widget} has a framework tree AND a NativeScript template, and is neither authored from ` +
                'adwaita-gallery-shared-trees.mjs nor ledgered in ADWAITA_GALLERY_TREE_DIVERGENCES. Two hand-written ' +
                'trees for one gallery block drift without anything noticing, which is what this arm exists to stop.',
        );
    }
    if (isShared && !converged) {
        failures.push(
            `${widget} is authored once in adwaita-gallery-shared-trees.mjs, and the two renderings do not agree. ` +
                'A derivation grew a per-surface branch, or a consumer edited the tree it was handed.',
        );
    }
    if (ledgered && converged) {
        failures.push(
            `${widget} is ledgered as a divergence and its two trees are now IDENTICAL. The reason has been ` +
                'closed — move the block into ADWAITA_GALLERY_SHARED_TREES and delete the ledger entry, so the ' +
                'gallery stops carrying two sources for a widget that needs one.',
        );
    }
}

// The four kinds are a vocabulary, so they are held rather than trusted: they say what
// a reader would have to DO, and the jobs are not interchangeable — a `property` is a
// renderer change, a `content` is a decision about what the block should show.
const DIVERGENCE_KINDS = new Set(['property', 'vocabulary', 'composition', 'content']);
for (const [widget, reason] of Object.entries(ADWAITA_GALLERY_TREE_DIVERGENCES)) {
    const kind = /^([a-z]+):/.exec(reason)?.[1];
    if (kind !== undefined && DIVERGENCE_KINDS.has(kind)) continue;
    failures.push(
        `${widget}: its divergence reason opens with ${kind === undefined ? 'no kind' : `"${kind}"`}, and a reason ` +
            `must open with one of ${[...DIVERGENCE_KINDS].join(', ')} — the kind is what says whether closing it ` +
            'is a renderer change, a rename, or a decision about what the block should show.',
    );
}

for (const widget of Object.keys(ADWAITA_GALLERY_TREE_DIVERGENCES)) {
    if (paired.includes(widget)) continue;
    failures.push(
        `${widget} is ledgered as a tree divergence, but it does not have a tree on both renderers ` +
            `(framework: ${gtkByWidget.has(widget) ? 'yes' : 'no'}, NativeScript: ${nsByWidget.has(widget) ? 'yes' : 'no'}). ` +
            "A block only one renderer draws is a REFUSAL, recorded beside that renderer's own list.",
    );
}

for (const widget of sharedByWidget.keys()) {
    if (gtkByWidget.has(widget) && nsByWidget.has(widget)) continue;
    failures.push(`${widget} is a shared tree that one of the two generators no longer emits.`);
}

// The two case rules are inverses, and nothing but this loop says so: `hostTagOf`
// lives with the shared trees and `gtypeOfTag` with the framework generator, so a
// special case added to one would silently turn the other into a lookup table —
// which is the arrangement both generator headers refuse.
for (const tree of ADWAITA_GALLERY_SHARED_TREES) {
    const walk = (node) => {
        const round = gtypeOfTag(hostTagOf(node.tag));
        if (round !== node.tag) {
            failures.push(
                `${tree.widget}: ${node.tag} -> ${hostTagOf(node.tag)} -> ${round}. hostTagOf and gtypeOfTag have ` +
                    'stopped being inverses, so the shared vocabulary is now a translation.',
            );
        }
        for (const child of node.children ?? []) walk(child);
    };
    walk(tree.root);
}

if (paired.length === 0) failures.push('no gallery block has a tree on both renderers — arm 11 proved nothing');

notes.push(
    `${paired.length} block(s) drawn by both renderers — ${sharedByWidget.size} from one authored tree, ` +
        `${Object.keys(ADWAITA_GALLERY_TREE_DIVERGENCES).length} ledgered as divergent; ${convergedBlocks} agree today`,
);

// A scan whose corpus is empty reports green while proving nothing.
if (blocks === 0) failures.push('no <AdwWidget> block found on any gallery page — the reader is broken');
if (ADWAITA_GALLERY_TREES.length === 0) failures.push('no framework tree at all — arms 4 and 5 proved nothing');

notes.push(
    `${blocks} gallery block(s), ${tabled} rendering a generated attribute table, ` +
        `${byTag.size} registered element(s), ${Object.keys(NO_ATTRIBUTE_PANE).length} exemption(s)`,
);

for (const note of notes) console.log(`check-generated-website-data: ${note}`);

if (failures.length > 0) {
    console.error(`\ncheck-generated-website-data: ${failures.length} problem(s):\n`);
    for (const line of failures) console.error(`  ${line}`);
    process.exit(1);
}

console.log('check-generated-website-data: OK.');
