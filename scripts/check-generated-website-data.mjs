#!/usr/bin/env node
// The website's generated data files are current, and every gallery block reaches one.
//
// THE INCIDENT
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
// WHAT IT CHECKS
//
//   1. Every generator listed in {@link GENERATORS} reproduces its committed
//      output. Run with no argument they WRITE; `--check` compares and exits 1.
//
//      Arms 2 and 3 were the attribute pane's join — every `<AdwWidget title="…">`
//      derives a tag the web pillar registers AND observes something, or is ledgered
//      with the reason it has none — and they retired with the pane. The numbers they
//      were carrying, and the "a generated surface still has two ways to be empty"
//      finding that produced the second half of arm 2, are in
//      docs/code-anti-patterns.md § "A documentation surface written by hand, once per
//      page". The arm NUMBERS below are unchanged on purpose: they are cited from four
//      other files, and renumbering would silently repoint every citation.
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
//   5c. Every refusal that names a GType names one the ParamSpec seam does NOT convert —
//      read out of `coerce` in `gtk-host/src/props.ts`, the other file a refusal can go
//      stale against. Three refusals stood for a release after ADR 0046/0047 gave their
//      values a portable form, because 5b watches the descriptor table and nothing
//      watched the seam.
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
//  12. Every preview fence carries exactly the attribute gloss
//      `scripts/adwaita-attribute-meanings.mjs` says it carries, and every attribute
//      a fence sets is decided in exactly one place — glossed, name-suffices,
//      ledgered as a GIR divergence, or ledgered as authored. This is the half of
//      that mechanism a job with NO GIR can hold, and it is the half that catches a
//      hand: `generate-adwaita-attribute-comments.mjs --check` re-derives the text
//      from the GIR and runs only in `main.yml`'s `tree-checks` image, while THIS
//      check runs on `checkout` + `setup-node` on Linux and Windows for every PR.
//      Without it, deleting a comment line from an `.mdx` would be green here and
//      red only in the one job that has `libadwaita-devel`.
//  11. The two authored trees describe the SAME UI, or say why they do not. Every
//      block drawn by both renderers is either authored ONCE in
//      `adwaita-gallery-shared-trees.mjs` or ledgered in that file's
//      `ADWAITA_GALLERY_TREE_DIVERGENCES`, never both and never neither, and a
//      ledgered block whose two trees have BECOME identical fails, the same
//      self-retiring shape as (5b). (4)-(9) each hold ONE tree against ONE renderer,
//      which is why they were all green while one block drew two different widgets.
//  13. Every node of a shared tree occurs in that block's `preview` fence — same
//      element, same attributes, same values, in the same order. (11) compares the two
//      authored trees to EACH OTHER, and they can agree while both describe a UI the
//      block stopped showing; the fence is what a reader copies, and the divergence
//      ledger already calls it the authority. CONTAINMENT and not equality: the corpus
//      admits a block only when its two trees need no alias, so what the renderers
//      disagree about is exactly what it cannot carry — and the docs are entitled to
//      teach that. ADR 0051 § Amendment 2 is the measurement behind the direction.
//
// Plain Node over the repo's own files — no install, no build, no astro render.
//
// Usage: node scripts/check-generated-website-data.mjs [--root <dir>]

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADWAITA_GALLERY_NS_REFUSALS, ADWAITA_GALLERY_NS_TEMPLATES } from './adwaita-gallery-ns-templates.mjs';
import {
    ADWAITA_GALLERY_SHARED_TREES,
    ADWAITA_GALLERY_TREE_DIVERGENCES,
    hostTagOf,
} from './adwaita-gallery-shared-trees.mjs';
import { ADWAITA_GALLERY_REFUSALS, ADWAITA_GALLERY_TREES } from './adwaita-gallery-trees.mjs';
import { ADWAITA_ATTRIBUTE_MEANING_COUNTS, ADWAITA_ATTRIBUTE_MEANINGS } from './adwaita-attribute-meanings.mjs';
import {
    applyMeanings,
    ATTRIBUTE_MEANING_LEDGER,
    ATTRIBUTE_OXFMT_EXEMPT_OUTPUTS,
    AUTHORED_MEANINGS,
    markupElements,
    MEANINGS_MODULE,
    meaningCounts,
} from './generate-adwaita-attribute-comments.mjs';
import {
    gtypeOfTag,
    HOST_WIDGET_ROWS,
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

const failures = [];
const notes = [];

// Before anything reads anything: a missing root is "could not look", not "found
// nothing". Checked here rather than beside its use because the element reader below
// throws first, and a Node stack trace reads like a broken gate instead of a bad
// argument.
for (const [label, path] of DOCS_SECTIONS.map((section) => [`the ${section} gallery pages`, docsDir(section)])) {
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
// the gallery's own blocks, which arms 4, 7 and 11 are all about
// ---------------------------------------------------------------------------

const seenTitles = new Set();
let blocks = 0;

for (const { file } of DOCS_SECTIONS.flatMap((section) =>
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
    // ---------------------------------------------------------------------------
    // 5c. a refusal naming a GType the ParamSpec seam converts is stale
    // ---------------------------------------------------------------------------
    //
    // The third kind of refusal reason, after `uncurated-placement` (5b) and the
    // NativeScript member reasons (8): "its model is a Gio.ListModel, and nothing turns
    // the portable list form into one at the ParamSpec seam" — a claim about `coerce` in
    // `gtk-host/src/props.ts`, a different file from the descriptor table, moving on a
    // different schedule. ADR 0042 gave the menu its branch and the two menu refusals
    // were retired BY HAND; ADR 0046 and 0047 gave the list and the adjustment their
    // values, their three refusals stood for a release with half their reason gone, and
    // nothing read them.
    //
    // THE A/B THAT WROTE THIS ARM: with the list and adjustment branches in `coerce` and
    // the three refusals still in the ledger, this arm printed three failures — one per
    // block — before the trees replacing them existed. That is the shape a stale refusal
    // takes, and the one 5b already refuses for the descriptor table.
    //
    // A GType `coerce` converts is one that appears in a `type_is_a` test there, in
    // either position: the property's type (`type_is_a(valueType, Gio.ListModel.$gtype)`)
    // or the type the branch BUILDS (`type_is_a(Gtk.StringList.$gtype, valueType)`). Both
    // are the seam knowing the type, so a refusal naming either is one the seam answers.
    // Plain Node cannot ask a typelib whether `Gtk.StringList` IS a `Gio.ListModel`, which
    // is why the built type counts too — the DropDown refusal named the built type and
    // the ComboRow refusal the property's, and one predicate has to catch both.
    const coerceSrc = readOr('props.ts');
    if (coerceSrc === null) {
        failures.push('gtk-host/src/props.ts is unreadable — arm 5c would pass vacuously');
    } else {
        const converted = new Set(
            [...coerceSrc.matchAll(/type_is_a\(\s*(?:valueType,\s*)?(Gio|Gtk|Adw|GObject)\.(\w+)\.\$gtype/g)].map(
                (m) => `${m[1]}.${m[2]}`,
            ),
        );
        if (converted.size === 0) {
            failures.push(
                'coerce in gtk-host/src/props.ts reads as converting NO GType — the branch shape changed and arm 5c is blind',
            );
        }
        // A dotted GType in prose — `Gio.ListModel`, `Gtk.Adjustment`. The block's own title
        // (`Adw.ComboRow`) has the same shape and is not a claim about a value, so it is
        // filtered out by name rather than by a looser pattern.
        const GTYPE_MENTION = /\b(Gio|Gtk|Adw|GObject)\.([A-Z]\w+)\b/g;
        for (const [widget, reason] of Object.entries(ADWAITA_GALLERY_REFUSALS)) {
            const named = [...reason.matchAll(GTYPE_MENTION)]
                .map((m) => `${m[1]}.${m[2]}`)
                .filter((name) => name !== widget);
            if (/ParamSpec seam/.test(reason) && named.length === 0) {
                failures.push(
                    `"${widget}" blames the ParamSpec seam and names no GType, so nothing can hold the claim. ` +
                        'Name the type the seam lacks a branch for.',
                );
            }
            for (const gtype of named) {
                if (!converted.has(gtype)) continue;
                failures.push(
                    `"${widget}" is refused because its value is a ${gtype} with no literal spelling, and coerce in ` +
                        `packages/framework/gtk-host/src/props.ts converts a ${gtype} now. The refusal is stale — ` +
                        'that block can have a tree.',
                );
            }
        }
        notes.push(`${converted.size} GType(s) the ParamSpec seam converts, held against every refusal reason`);
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
 * Checked back: an entry whose widget later grows a setter of its own fails here, so
 * the list cannot quietly outlive its reason. These
 * are `Property` objects on NativeScript's own base classes, which DO carry a
 * `valueConverter` — which is why arm 8 does not demand `xmlNumber`/`xmlBoolean` of
 * them.
 */
const NS_CORE_PROPS = {
    id: 'ViewBase.id — the handle a code-behind reaches a template child by.',
    orientation:
        'LayoutBase orientation, inherited by Gtk.Box from StackLayout — the same two nicks Gtk.Orientation has, which is why the box does not re-declare it.',
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
        for (const rel of [...OXFMT_EXEMPT_OUTPUTS, ...NS_OXFMT_EXEMPT_OUTPUTS, ...ATTRIBUTE_OXFMT_EXEMPT_OUTPUTS]) {
            if (ignored.includes(rel)) continue;
            failures.push(
                `${OXFMT_CONFIG} no longer exempts ${rel}. It is GENERATED — its bytes come from a generator ` +
                    'that formats nothing, because the jobs running this check have no node_modules. Re-add ' +
                    'the exemption; do not reformat the file.',
            );
        }
        notes.push(
            `${OXFMT_EXEMPT_OUTPUTS.length + NS_OXFMT_EXEMPT_OUTPUTS.length + ATTRIBUTE_OXFMT_EXEMPT_OUTPUTS.length} ` +
                `generated output(s) exempt from ${OXFMT_CONFIG}`,
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

/**
 * A node as a comparable string, tags normalised to the GIR class name.
 *
 * The properties are SORTED, and that is what the arm is asking: two trees describe
 * the same UI or they do not, and the order two authors happened to type `title` and
 * `subtitle` in is not part of the UI. Compared as written, a parity branch that
 * closes a `property` divergence by adding the missing props in a different order
 * would leave its ledger entry standing with nothing to notice — the self-retiring
 * half would have been the half that silently passes. (Measured over every pair when
 * the sort landed: no divergence was order-only, so it changed no verdict and closed
 * the hole. The pair count is printed below, never written here — this comment carried
 * one and it was behind the tree within two merges.)
 */
const shapeOf = (node, tagOf) =>
    JSON.stringify({
        tag: tagOf(node.tag),
        slot: node.slot ?? null,
        props: Object.entries(node.props ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)),
        children: (node.children ?? []).map((child) => shapeOf(child, tagOf)),
    });
// The framework trees speak `gtk-host` tags, the NativeScript ones GIR class names,
// so only ONE side is transformed — by `gtk-host`'s own generated table, which is
// what `gtypeOfTag` reads.
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

// `hostTagOf` is a RULE and gtk-host's generated table is what the rule has to
// reproduce, so it is held against the whole table and not against the seven tags the
// shared trees happen to use today. The first version of this loop walked only those
// seven and read green while the rule was already wrong: `GtkGLArea` came out
// `gtk-glarea` where gtk-host stamps `gtk-gl-area`, and the gallery would have shipped
// a tag nothing renders on the first block that drew one. A rule asserted over the
// corpus it is allowed to be used on is the only version of this check worth having.
//
// Only this direction is a rule. `gtypeOfTag` is that same table read backwards
// (`tagOf` collapses an acronym run, so no case rule recovers `GtkGLArea` from
// `gtk-gl-area`), which is why there is nothing here to assert about it.
if (HOST_WIDGET_ROWS.length === 0) {
    failures.push("gtk-host's gtype/tag rows read as empty — hostTagOf would be asserted against nothing");
}
for (const [gtype, tag] of HOST_WIDGET_ROWS) {
    let produced;
    try {
        produced = hostTagOf(gtype);
    } catch (error) {
        // Every row is a class hostTagOf must be able to name; refusing one is the
        // same defect as spelling it wrong, and the message has to say which row.
        failures.push(`hostTagOf(${gtype}) threw (${error.message}) — gtk-host's table says its tag is ${tag}.`);
        continue;
    }
    if (produced !== tag) {
        failures.push(
            `hostTagOf(${gtype}) is ${produced}, and gtk-host's generated table stamps ${tag}. The shared trees ` +
                "would emit a tag nothing renders — the rule is gtk-host's tagOf, in gtk-host/src/tags.ts.",
        );
    }
}

// An EMPTY shared source is deliberately not a failure — it is the honest state of a
// gallery where nothing agrees yet, and the arm still compares every pair. What
// would be vacuous is having no pair to compare at all. (An emptied shared source is
// loud anyway: both generators call `gtkHostTree`/`nativeScriptTree` by name, and
// `entryFor` throws that name.)
if (paired.length === 0) failures.push('no gallery block has a tree on both renderers — arm 11 proved nothing');

notes.push(
    `${paired.length} block(s) drawn by both renderers — ${sharedByWidget.size} from one authored tree, ` +
        `${Object.keys(ADWAITA_GALLERY_TREE_DIVERGENCES).length} ledgered as divergent; ${convergedBlocks} agree today`,
);

// ---------------------------------------------------------------------------
// 12. every fence carries the gloss the generated module says it carries
// ---------------------------------------------------------------------------

/**
 * The GIR-free half of the attribute-gloss mechanism.
 *
 * `applyMeanings` is the SAME placement code the generator writes the fences with, run
 * here against the COMMITTED sentences instead of freshly-read GIR ones. A second
 * placement implementation would check a rule the fences were not written with; one
 * implementation and two inputs is what makes this comparable.
 *
 * WHY IT IS NOT ENOUGH TO LET THE GENERATOR'S OWN `--check` DO IT. That check needs
 * `Adw-1.gir` and `Gtk-4.0.gir`, which exist in `main.yml`'s `tree-checks` image
 * (`gtk4-devel` + `libadwaita-devel`) and in NEITHER job that runs this file — both are
 * `checkout` + `setup-node` and nothing else. So a comment line deleted from an `.mdx`
 * would pass on every PR leg that could see the file and fail only in the one leg that
 * can see the GIR. With the committed module in between, the deletion is red here too,
 * and the two checks cannot both be green while either half is wrong.
 */
const applied = applyMeanings(ROOT, ADWAITA_ATTRIBUTE_MEANINGS);
for (const problem of applied.problems) failures.push(problem);

for (const [rel, expected] of applied.files) {
    if (readFileSync(join(ROOT, rel), 'utf8') === expected) continue;
    failures.push(
        `${rel}: its preview fences are not the attribute gloss ${MEANINGS_MODULE} says they carry. A gloss ` +
            'was edited, moved or deleted by hand — the fences are generated. Re-run ' +
            '`node scripts/generate-adwaita-attribute-comments.mjs` (it needs a GIR), or restore the line.',
    );
}

// The counts the module publishes are the measurement the line between "glossed" and
// "the name says it" rests on, so a hand-edited number is a hand-edited claim.
const measuredCounts = meaningCounts(ADWAITA_ATTRIBUTE_MEANINGS, applied);
for (const [key, measured] of Object.entries(measuredCounts)) {
    const committed = ADWAITA_ATTRIBUTE_MEANING_COUNTS[key];
    if (committed === measured) continue;
    failures.push(
        `${MEANINGS_MODULE}: ADWAITA_ATTRIBUTE_MEANING_COUNTS.${key} says ${committed} and this tree measures ` +
            `${measured}. The counts are the published measurement, not a comment.`,
    );
}

// An empty module would make every comparison above vacuous, and it is exactly what a
// broken emitter produces.
if (Object.keys(ADWAITA_ATTRIBUTE_MEANINGS).length === 0) {
    failures.push(`${MEANINGS_MODULE} glosses no element at all — arm 12 proved nothing`);
}
if (measuredCounts.glossed === 0) {
    failures.push(`${MEANINGS_MODULE} carries no gloss at all — arm 12 would pass against a fence with none`);
}

notes.push(
    `${measuredCounts.set} attribute(s) set by ${applied.fences.length} fence(s) — ${measuredCounts.glossed} ` +
        `glossed from the GIR, ${measuredCounts.nameSuffices} where the name suffices, ` +
        `${Object.keys(ATTRIBUTE_MEANING_LEDGER).length} with no GIR property, ` +
        `${Object.keys(AUTHORED_MEANINGS).length} authored; ${measuredCounts.commentLines} comment line(s)`,
);

// ---------------------------------------------------------------------------
// 13. the shared corpus is a SUBSET of the UI its block documents
// ---------------------------------------------------------------------------

/**
 * Every node of a shared tree occurs in that block's `preview` fence, same element,
 * same attributes, same values, in the same order.
 *
 * WHY CONTAINMENT AND NOT EQUALITY, which is the direction ADR 0051 § 5 proposed and
 * this arm is the measured answer to. The fence is the RICHER artifact and the ledger
 * in `adwaita-gallery-shared-trees.mjs` already calls it the authority. The corpus is
 * a deliberately narrow subset: a block joins it only when its two authored trees need
 * no alias, so everything the two renderers disagree about is exactly what the corpus
 * cannot carry — and that is content the DOCS are entitled to teach. Measured over the
 * shared blocks, emitting the fence from the corpus would delete a `slot=` child and a
 * `Gio.ListModel` row from one block and all but one of the examples from another. The
 * corpus is a subset of the documentation; asserting that is a claim that can be true.
 *
 * THE MATCH IS GREEDY on the element name, in document order, and a matched element
 * must then agree on every authored value. Searching on for a later instance that fits
 * would turn a drifted value into a silent re-anchor — the fence draws five
 * `<adw-shortcut-label>`s, so "found one that matches" is available and worthless.
 *
 * WHAT IT CATCHES that arm 11 cannot. Arm 11 compares the two authored TREES to each
 * other; both can agree and both be a description of a UI the block no longer shows.
 * The ledger records that exact drift having happened once already in the other
 * direction, block by block, found by hand.
 */
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/**
 * A fence value in the vocabulary the corpus is authored in.
 *
 * An unknown entity FAILS rather than passing through: `&nbsp;` compared as its own
 * bytes would report a value mismatch naming two strings that look identical, which is
 * a worse failure than the missing entity it really is.
 */
const decodeEntities = (value, onUnknown) =>
    value.replace(/&[^;\s]+;/g, (entity) => {
        const name = entity.slice(1, -1);
        if (Object.hasOwn(ENTITIES, name)) return ENTITIES[name];
        onUnknown(entity);
        return entity;
    });

/** The authored nodes depth-first — the order both tree drivers assert the DOM in. */
const depthFirst = (node, out = []) => {
    out.push(node);
    for (const child of node.children ?? []) depthFirst(child, out);
    return out;
};

const fenceByTitle = new Map(applied.fences.map((fence) => [fence.title, fence]));
let containedNodes = 0;
let comparedValues = 0;
let fenceElements = 0;
for (const tree of ADWAITA_GALLERY_SHARED_TREES) {
    const fence = fenceByTitle.get(tree.widget);
    if (fence === undefined) {
        failures.push(
            `${tree.widget} is a shared tree with no preview fence on any gallery page, so the corpus describes ` +
                'a UI the site does not show. Either the block was renamed or it was removed from the gallery ' +
                'while its tree stayed in the shared source.',
        );
        continue;
    }
    const elements = markupElements(fence.body);
    fenceElements += elements.length;
    let cursor = 0;
    for (const [index, node] of depthFirst(tree.root).entries()) {
        const wanted = hostTagOf(node.tag);
        while (cursor < elements.length && elements[cursor].tag !== wanted) cursor += 1;
        if (cursor === elements.length) {
            failures.push(
                `${tree.widget}: authored node ${index} <${wanted}> has no matching element left in the ` +
                    `${fence.slot} fence of ${fence.rel}. The shared corpus is supposed to be a subset of what ` +
                    'the block documents — one of the two was edited without the other.',
            );
            break;
        }
        const element = elements[cursor];
        cursor += 1;
        containedNodes += 1;
        for (const [prop, value] of Object.entries(node.props ?? {})) {
            const attribute = prop.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`);
            const present = element.values.has(attribute);
            comparedValues += 1;
            // A BOOLEAN IS THE ATTRIBUTE'S PRESENCE, which is the rule `adwaita-web`'s
            // driver builds with (`toggleAttribute`) and the elements read back with
            // `hasAttribute`. So `false` is the attribute being ABSENT, and the test
            // belongs BEFORE the not-set failure below — which is a claim about a
            // VALUE, and a false boolean has none. Both directions were wrong without
            // it: a fence that correctly omitted `active` failed against a node
            // authoring `active: false`, and a fence that spelled it while the node
            // said false — a real disagreement — passed in silence.
            if (typeof value === 'boolean') {
                if (value !== present) {
                    failures.push(
                        `${tree.widget}: authored node ${index} <${wanted}> sets ${prop} to ${value}, and the ` +
                            `${fence.slot} fence of ${fence.rel} ${present ? 'sets' : 'does not set'} ${attribute} ` +
                            'on it. A boolean is the attribute being there: present is true, absent is false.',
                    );
                    continue;
                }
                const raw = element.values.get(attribute);
                if (value && raw !== null && raw !== '') {
                    failures.push(
                        `${tree.widget}: <${wanted}> ${attribute} is authored as a boolean, and ${fence.rel} ` +
                            `spells it "${raw}". The elements read it with hasAttribute(), so a value there is ` +
                            'read as true whatever it says.',
                    );
                }
                continue;
            }
            if (!present) {
                failures.push(
                    `${tree.widget}: authored node ${index} <${wanted}> sets ${prop}, and the ${fence.slot} fence ` +
                        `of ${fence.rel} sets no ${attribute} on it. Both tree drivers assert that value; the ` +
                        'page a reader copies does not carry it.',
                );
                continue;
            }
            const raw = element.values.get(attribute);
            const got = decodeEntities(raw ?? '', (entity) =>
                failures.push(
                    `${fence.rel}: <${wanted} ${attribute}> carries the entity ${entity}, which arm 13 cannot ` +
                        `decode. Add it to the ${Object.keys(ENTITIES).length} already in ENTITIES — comparing it ` +
                        'undecoded reports a mismatch between two strings that render the same.',
                ),
            );
            if (got === String(value)) continue;
            failures.push(
                `${tree.widget}: <${wanted}> ${prop} is authored "${value}" and the ${fence.slot} fence of ` +
                    `${fence.rel} shows "${got}". The corpus two renderers are tested against and the markup a ` +
                    'reader copies describe different UIs.',
            );
        }
    }
}

// The corpus can legitimately be empty (arm 11 says why), but an arm that walked no
// node proved nothing, and the fences are what would have gone missing.
if (ADWAITA_GALLERY_SHARED_TREES.length > 0 && containedNodes === 0) {
    failures.push('no shared node was matched against a preview fence at all — arm 13 proved nothing');
}
// MATCHING A NODE IS NOT COMPARING A VALUE, and the node count cannot tell the two
// apart: with the property loop neutered, every node still matches, the note still
// prints the same figure and the arm is green having compared nothing. Measured by
// doing exactly that, which is the only way to learn what a guard does not cover.
if (containedNodes > 0 && comparedValues === 0) {
    failures.push('arm 13 matched shared nodes but compared no authored value — it proved only that tags line up');
}

notes.push(
    `${containedNodes} shared node(s) and ${comparedValues} authored value(s) from ` +
        `${ADWAITA_GALLERY_SHARED_TREES.length} tree(s) found in ${fenceElements} preview element(s) — the corpus ` +
        'is that far inside what the gallery documents',
);

// A scan whose corpus is empty reports green while proving nothing.
if (blocks === 0) failures.push('no <AdwWidget> block found on any gallery page — the reader is broken');
if (ADWAITA_GALLERY_TREES.length === 0) failures.push('no framework tree at all — arms 4 and 5 proved nothing');

notes.push(`${blocks} gallery block(s) across ${DOCS_SECTIONS.length} section(s)`);

for (const note of notes) console.log(`check-generated-website-data: ${note}`);

if (failures.length > 0) {
    console.error(`\ncheck-generated-website-data: ${failures.length} problem(s):\n`);
    for (const line of failures) console.error(`  ${line}`);
    process.exit(1);
}

console.log('check-generated-website-data: OK.');
