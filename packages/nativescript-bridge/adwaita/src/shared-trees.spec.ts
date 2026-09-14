// ONE AUTHORED TREE, BUILT BY THIS RENDERER — ADR 0051's THIRD driver, on the surface its
// § Amendment 1 withdrew.
//
// The siblings are `packages/framework/gtk-host/src/shared-trees.spec.ts` and
// `packages/web/adwaita-web/src/shared-trees.spec.ts`. One corpus —
// `scripts/adwaita-gallery-shared-trees.mjs`, READ here and never transcribed — one set of
// expectations, a driver per renderer: so a green-here / red-there diff is attributable to
// the RENDERER rather than to three suites disagreeing about what they test.
//
// WHY THIS EXISTS NOW, WHEN THE ADR SAID IT COULD NOT. Amendment 1 measured, correctly, that
// a widget of this package cannot be imported off a device: every widget module EXTENDS an
// `@nativescript/core` view, and that package ships no platform-neutral module for one. What
// it did not consider is that the port already carries a hand-written CONTRACT with that
// platform — the ambient `src/ns-core.d.ts`, which `gjsify tsc` holds every widget against
// on every run and which wins even over a real installed `@nativescript/core`.
// `./testing/ns-core.mjs` is the runtime half of that same declaration, aliased over the
// specifier for THIS suite's bundles only. So the thing under test is the port's own
// composition, and the thing supplied is the platform the port was already declared against.
//
// WHAT THAT DOES AND DOES NOT BUY, stated here because a reader of a green run will look
// here first. It buys the port's TREE: which class an element name resolves to, which child
// lands in which slot, which value survives the setter it was written through. It does not
// buy NativeScript: no layout pass, no CSS engine, no native view, no rasterised icon runs.
// A row that depends on the platform's own arithmetic is not reachable here and must not be
// claimed — which is why the reads below are all of the port's own output.
//
// THE DOOR IS THE `xmlns` BARREL, `<adw:SwitchRow>` over `~/adw`, and not the flat
// `registerElement` dialect `<AdwSwitchRow>`. Both exist, both spell a widget differently
// and both fail SILENTLY (docs/nativescript-xml.md). The barrel is the one a plain app
// HAS: `registerElement` is a global a framework integration supplies, so in a plain
// Vite-built app `registerAdwaitaElements()` is a no-op, and it is the barrel the gallery's
// own generated templates go through. It is also the door that carries a LIBRARY — the
// prefix is the only thing in this dialect that says which of the two a widget belongs to —
// so a wrong resolution is a load failure here rather than the right-shaped wrong widget.
//
// ONE DECLARED TRANSFORM ON THE WAY IN, and no second: {@link elementFor}, the GIR class
// name a block is authored in as the `{prefix, member}` this dialect spells it with. The
// attribute names need none — NativeScript's XML attributes ARE the property names, which
// is why the corpus's own `nativeScriptTree` is the identity. A `switch` on a widget name
// here would be the per-surface branch ADR 0027 § 9 forbids, and there is none.
//
// The readers go through the REAL VIEW TREE the port built — `LayoutBase`'s own child list,
// walked in the order the port put them in — never a state object a widget keeps about
// itself: a renderer asserting against its own bookkeeping agrees with itself while the
// screen is wrong.
//
// WHAT IS NOT HERE is everything that is not about this renderer. Which tables the corpus
// reaches, which block is declared to reach none, whether an expectation's address exists at
// all: those are facts about the CORPUS, asserted once in `adwaita-core`'s own suite.

import { describe, expect, it } from '@gjsify/unit';

import {
    authoredTags,
    sharedTreeExpectations,
    subjectIndexOf,
    type SharedTreeExpectation,
    type SharedTreeNode,
} from '@gjsify/adwaita-core/conformance';

import { ADWAITA_GALLERY_SHARED_TREES, nativeScriptTree } from '../../../../scripts/adwaita-gallery-shared-trees.mjs';

// The two `xmlns` barrels an app declares, one module per library (ADR 0034 § Amendment 9).
// Imported as MODULE NAMESPACES because that is literally what this door is:
// `component-builder`'s `createComponentInstance` ends in `instanceModule[elementName]`, and
// the prefix selects the module. Importing the widget classes by name instead would be a
// per-widget table and would skip the door entirely.
import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';

import { Button, LayoutBase, type View } from './testing/ns-core.mjs';

/** A class the barrel offers as an element — NativeScript builds one with NO arguments. */
type ElementClass = new () => View;

/** `AdwSwitchRow` -> `<adw:SwitchRow>`: the element name, and the class behind it. */
interface Element {
    /** The XML name this dialect spells, which is also what an XML child arrives under. */
    xmlName: string;
    ctor: ElementClass;
}

const BARRELS: Readonly<Record<string, object>> = { adw: Adw, gtk: Gtk };

/**
 * The element a GIR class name is, in the `xmlns` barrel dialect.
 *
 * THE WHOLE TRANSFORM, and it is a split rather than a table: the prefix names the library,
 * the member is the rest. What makes it safe is that the member is then READ OFF THE BARREL
 * — the same module NativeScript would read — so a placement this split gets wrong is a
 * missing member and throws, never another library's widget under this prefix. That is the
 * measured hazard `generate-adwaita-nativescript-templates.mjs` records as the
 * prefix-as-membership-test defect: the defect was deciding placement from the name ALONE.
 *
 * The class the barrel hands back must be the class the corpus NAMED, which is ADR 0034
 * clause 1 — a widget is named after the library owning its GType — held at runtime instead
 * of taken on trust. (This suite's bundles are built `--no-minify` so a class name is the
 * one the source declares; a mangled one fails here rather than resolving to a stranger.)
 */
function elementFor(tag: string): Element {
    for (const [prefix, barrel] of Object.entries(BARRELS)) {
        const library = `${prefix[0]!.toUpperCase()}${prefix.slice(1)}`;
        if (!tag.startsWith(library)) continue;
        const member = tag.slice(library.length);
        const exported = (barrel as Record<string, unknown>)[member];
        if (typeof exported !== 'function') {
            throw new Error(
                `Module '~/${prefix}' has no member for element '${prefix}:${member}' — the name ` +
                    `\`${tag}\` is authored in the shared corpus and this dialect cannot spell it. Give the ` +
                    'widget a namespace member (ADR 0034 clause 2), or ledger the block as divergent.',
            );
        }
        if (exported.name !== tag) {
            throw new Error(
                `'${prefix}:${member}' resolves to class \`${exported.name}\`, not \`${tag}\`. The corpus is ` +
                    'authored in GIR class names and ADR 0034 clause 1 says a widget carries that name, so a ' +
                    'barrel member bound to another class would build the wrong widget at exit 0.',
            );
        }
        return { xmlName: `${prefix}:${member}`, ctor: exported as ElementClass };
    }
    throw new Error(
        `\`${tag}\` starts with no library this dialect has a barrel for (${Object.keys(BARRELS).join(', ')}).`,
    );
}

/** What a parent must be for an XML child to reach a slot rather than the first cell. */
interface BuilderParent {
    _addChildFromBuilder(name: string, view: View): void;
}

/**
 * Build one authored node the way NativeScript's XML builder does: construct with no
 * arguments, write the attributes, then hand each child to the parent's own child door.
 *
 * AN ATTRIBUTE IS ALWAYS A STRING, and that is the door rather than a choice of this
 * driver: `setPropertyValue` ends in `instance[name] = value` with no conversion at all for
 * a plain accessor, so a setter declared `boolean` is handed `'true'`. Writing the authored
 * boolean instead would drive the construct-props bag — a different door — and would leave
 * the coercion `widgets/xml-values.ts` exists for untested on the trees the website ships.
 *
 * AN ATTRIBUTE THAT LANDS NOWHERE IS REFUSED HERE. `instance[name] = value` on a name
 * nothing declares adds a dead own-property and returns, at exit 0 — this surface's own
 * silent drop. The membership test runs BEFORE the write, because afterwards the dead
 * property answers it.
 */
function build(node: SharedTreeNode): View {
    const element = elementFor(node.tag);
    const view = new element.ctor();
    for (const [prop, value] of Object.entries(node.props ?? {})) {
        if (!(prop in view)) {
            throw new Error(
                `<${element.xmlName} ${prop}="${value}"> reaches nothing: \`${node.tag}\` declares no ` +
                    `'${prop}'. NativeScript's builder assigns it anyway, as a dead own-property at exit 0, ` +
                    'so the attribute door cannot report this and the tree would render without it.',
            );
        }
        (view as unknown as Record<string, unknown>)[prop] = String(value);
    }
    for (const child of node.children ?? []) {
        const parent = view as unknown as Partial<BuilderParent>;
        if (typeof parent._addChildFromBuilder !== 'function') {
            throw new Error(
                `<${element.xmlName}> takes no XML child: \`${node.tag}\` has no \`_addChildFromBuilder\`, so ` +
                    'the corpus nests a node this element cannot hold.',
            );
        }
        parent._addChildFromBuilder(elementFor(child.tag).xmlName, build(child));
    }
    return view;
}

/** Depth-first over the REAL child lists the port filled, in the order it filled them. */
function descendants(root: View, into: View[] = []): View[] {
    into.push(root);
    if (root instanceof LayoutBase) {
        for (let index = 0; index < root.getChildrenCount(); index++) descendants(root.getChildAt(index), into);
    }
    return into;
}

const findDescendant = (root: View, match: (view: View) => boolean): View | null =>
    descendants(root).find((view) => match(view)) ?? null;

/**
 * The realised tree filtered to the authored classes, in the order the port built them.
 *
 * The parts a widget composes for itself — a header grid, a label stack, a disclosure box,
 * the chevron — are not the renderer's promise; the ORDER and the NESTING of what was
 * AUTHORED is. Exact constructor identity, so a subclass cannot stand in: `AdwEntryRow` and
 * `AdwSwitchRow` both extend `AdwActionRow`, and an `instanceof` filter would let either
 * answer for the other.
 */
function realised(root: View, wanted: readonly string[]): { view: View; tag: string }[] {
    const byClass = new Map<unknown, string>(wanted.map((tag) => [elementFor(tag).ctor, tag]));
    const found: { view: View; tag: string }[] = [];
    for (const view of descendants(root)) {
        const tag = byClass.get(view.constructor);
        if (tag !== undefined) found.push({ view, tag });
    }
    return found;
}

/** The banner's action button — a REAL `Button` in the tree, which is how the port adds it. */
const bannerButton = (banner: View) => findDescendant(banner, (view) => view instanceof Button) as Button | null;

/**
 * Read one observable off the view this renderer built.
 *
 * The ONE seam between the shared expectations and this renderer, and the mirror of `read()`
 * in the two sibling drivers. Everything above it is renderer-free; a case that grew a block
 * name would be the per-surface branch § 9 forbids.
 */
function read(expectation: SharedTreeExpectation, view: View): string | number | boolean {
    switch (expectation.observable) {
        case 'entry-text-length':
            return (view as unknown as { textLength: number }).textLength;
        case 'switch-row-active':
            return (view as unknown as { active: boolean }).active;
        case 'banner-button-visible': {
            // The port ADDS the button to the tree for a non-empty label and removes it for
            // an empty one, so "on screen" is presence first and `visibility` second —
            // both read off the tree, neither off the banner's own flags.
            const button = bannerButton(view);
            return button !== null && button.visibility !== 'collapse';
        }
        case 'banner-button-text':
            return bannerButton(view)?.text ?? '';
    }
}

export const AdwSharedTreesNsTest = async () => {
    const blocks = ADWAITA_GALLERY_SHARED_TREES.map((tree) => ({
        widget: tree.widget,
        // `nativeScriptTree` is the corpus's own emitter for this dialect. It is the
        // identity today — the vocabulary the corpus is authored in is already this port's
        // class names — and reading it rather than assuming that is what keeps the driver
        // right on the day it stops being.
        ns: nativeScriptTree(tree.widget).root,
        authored: tree.root,
    }));

    let asserted = 0;

    await describe('the shared corpus builds through the adwaita-nativescript xmlns barrel', async () => {
        for (const block of blocks) {
            await it(`${block.widget} builds, and the REAL view tree carries the authored nodes in order`, () => {
                const root = build(block.ns);
                const wanted = authoredTags(block.authored);

                expect(realised(root, wanted).map(({ tag }) => tag)).toStrictEqual(wanted);
            });
        }
    });

    await describe('the shared corpus against the adwaita-core vectors it reaches', async () => {
        for (const block of blocks) {
            for (const expectation of sharedTreeExpectations(block.authored)) {
                await it(`${block.widget} — ${expectation.path}: ${expectation.table} — ${expectation.rule}`, () => {
                    // Counted before the asserts, so the tally below says how many rows were
                    // DRIVEN rather than how many passed — a failing row is already reported
                    // here, and counting it twice would hide a genuinely skipped one.
                    asserted++;
                    const root = build(block.ns);
                    // The SAME filtered walk the shape test asserts, so the widget an
                    // expectation is read off is the one at the authored ADDRESS rather
                    // than the first of its class the tree happens to contain.
                    const built = realised(root, authoredTags(block.authored));
                    const subject = built[subjectIndexOf(block.authored, expectation.path)]!;
                    expect(subject.tag).toBe(expectation.gtype);

                    expect(read(expectation, subject.view)).toBe(expectation.expected);
                });
            }
        }
    });

    // THE DENOMINATOR, derived and printed in the title rather than written down anywhere.
    // A suite whose denominator is invisible claims more than it measures, and this one's
    // gap is wide: most authored values are not vector inputs, so most of what was just
    // built proves only that it builds. The assertion is the half that is about THIS
    // driver — that every row the corpus reaches was actually driven, so a row cannot be
    // quietly skipped while the block above it still reports a pass.
    const reaching = blocks.filter((block) => sharedTreeExpectations(block.authored).length > 0);
    const rows = blocks.reduce((total, block) => total + sharedTreeExpectations(block.authored).length, 0);
    await describe('what this driver reached', async () => {
        await it(
            `${reaching.length} of ${blocks.length} corpus blocks reach a vector row, ${rows} row(s) in all; ` +
                `${blocks.length - reaching.length} block(s) reach none`,
            () => {
                expect(asserted).toBe(rows);
            },
        );
    });
};

export default AdwSharedTreesNsTest;
