// ONE AUTHORED TREE, BUILT BY THIS RENDERER — ADR 0051, and the renderer ADR 0027 § 9
// names by name: "the same authored tree, rendered through this host and through
// `adwaita-web`, satisfies the same `@gjsify/adwaita-core/conformance` vectors with no
// per-surface markup branch".
//
// The sibling driver is `packages/framework/gtk-host/src/shared-trees.spec.ts`. One corpus
// — `scripts/adwaita-gallery-shared-trees.mjs`, read here and not transcribed — one set of
// expectations, a driver per renderer: ADR 0030's shape one level up, so a green-here /
// red-there diff is attributable to the RENDERER and not to two suites disagreeing about
// what they test.
//
// TWO DECLARED TRANSFORMS ON THE WAY IN, and no third. `hostTagOf` turns the authored GIR
// class name into the element name, which is the same case rule `gtk-host` stamps its tags
// with; and an authored property name becomes its kebab-case ATTRIBUTE, because this
// renderer's door is markup. Both are total functions over the corpus with no tag list and
// no per-block case — a `switch` on a widget name here would be the per-surface branch
// § 9 forbids, and the reason the corpus admits a block only when it needs no alias.
//
// The readers below go through the REAL DOM the element rendered, never a state object of
// its own: an element asserting against its own bookkeeping agrees with itself while the
// page is wrong.

import { describe, expect, it } from '@gjsify/unit';

import {
    SHARED_TREE_BLOCKS_WITHOUT_VECTORS,
    SHARED_TREE_TABLES,
    authoredNodes,
    reachedTables,
    sharedTreeExpectations,
    type SharedTreeExpectation,
    type SharedTreeNode,
} from '@gjsify/adwaita-core/conformance';

import { ADWAITA_GALLERY_SHARED_TREES, hostTagOf } from '../../../../scripts/adwaita-gallery-shared-trees.mjs';

import '@gjsify/adwaita-web';

/** `buttonLabel` -> `button-label`. The authored spelling is camelCase for every surface. */
const attributeOf = (prop: string) => prop.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`);

/**
 * The whole renderer-specific half of this driver: an element, its authored properties as
 * attributes, its children, in that order.
 *
 * A boolean is the ATTRIBUTE'S PRESENCE, which is what every element here reads
 * (`hasAttribute('revealed')`, `hasAttribute('expanded')`) — spelling `"true"` would set a
 * present attribute for `false` as well.
 */
function build(node: SharedTreeNode): HTMLElement {
    const el = document.createElement(hostTagOf(node.tag));
    for (const [prop, value] of Object.entries(node.props ?? {})) {
        if (typeof value === 'boolean') el.toggleAttribute(attributeOf(prop), value);
        else el.setAttribute(attributeOf(prop), String(value));
    }
    for (const child of node.children ?? []) el.append(build(child));
    return el;
}

/** The element the authored root becomes, connected — these elements build on connect. */
function mount(node: SharedTreeNode): { root: HTMLElement; host: HTMLElement } {
    const host = document.createElement('div');
    const root = build(node);
    host.append(root);
    document.body.append(host);
    return { root, host };
}

const bannerButton = (banner: Element) => banner.querySelector<HTMLButtonElement>('.adw-banner-button');

/**
 * Read one observable off the element this renderer built.
 *
 * The ONE seam between the shared expectations and this renderer, and the mirror of
 * `read()` in the gtk-host driver. Everything above it is renderer-free.
 */
function read(expectation: SharedTreeExpectation, el: Element): string | number | boolean {
    switch (expectation.observable) {
        case 'entry-text-length':
            return (el as unknown as { textLength: number }).textLength;
        case 'switch-row-active':
            return (el as unknown as { active: boolean }).active;
        case 'banner-button-visible':
            return bannerButton(el) ? !bannerButton(el)!.hidden : false;
        case 'banner-button-text':
            return bannerButton(el)?.textContent ?? '';
    }
}

/** Depth-first, root first — the DOM's own document order, the same walk GTK's is. */
function descendants(root: Element): Element[] {
    return [root, ...[...root.children].flatMap((child) => descendants(child))];
}

export const AdwSharedTreesTest = async () => {
    const authored = ADWAITA_GALLERY_SHARED_TREES;

    await describe('the shared corpus builds through adwaita-web', async () => {
        for (const block of authored) {
            await it(`${block.widget} builds, and the REAL DOM carries the authored nodes in order`, () => {
                const { root, host } = mount(block.root);

                const wanted = authoredNodes(block.root).map(({ node }) => hostTagOf(node.tag));
                const set = new Set(wanted);
                // Filtered to the authored element names: the parts an element renders for
                // itself (a listbox, a revealer, a title span) are not the renderer's
                // promise; the ORDER and the NESTING of what was authored is.
                const built = descendants(root)
                    .map((el) => el.tagName.toLowerCase())
                    .filter((name) => set.has(name));

                expect(built).toStrictEqual(wanted);
                host.remove();
            });
        }
    });

    await describe('the shared corpus against the adwaita-core vectors it reaches', async () => {
        for (const block of authored) {
            const expectations = sharedTreeExpectations(block.root);

            for (const expectation of expectations) {
                await it(`${block.widget} — ${expectation.path}: ${expectation.table} — ${expectation.rule}`, () => {
                    const { root, host } = mount(block.root);
                    const nodes = authoredNodes(block.root);
                    const set = new Set(nodes.map(({ node }) => hostTagOf(node.tag)));
                    const built = descendants(root).filter((el) => set.has(el.tagName.toLowerCase()));
                    const subject = built[nodes.findIndex(({ path }) => path === expectation.path)]!;
                    expect(subject.tagName.toLowerCase()).toBe(hostTagOf(expectation.gtype));

                    expect(read(expectation, subject)).toBe(expectation.expected);
                    host.remove();
                });
            }

            const declared = Object.hasOwn(SHARED_TREE_BLOCKS_WITHOUT_VECTORS, block.widget);
            if (expectations.length === 0) {
                // ADR 0051 § 4: a block that proves nothing has to SAY so.
                await it(`${block.widget} reaches no vector, and says why`, () => {
                    expect(declared).toBe(true);
                });
            } else if (declared) {
                // Self-retiring: a declaration that has stopped being true fails.
                await it(`${block.widget} is declared vector-free, and is not`, () => {
                    expect(expectations.map((one) => one.table)).toStrictEqual([]);
                });
            }
        }
    });

    await describe('the tree driver claims no table the corpus misses', async () => {
        await it('SHARED_TREE_TABLES is exactly what the corpus reaches', () => {
            expect(reachedTables(authored.map((block) => block.root))).toStrictEqual([...SHARED_TREE_TABLES]);
        });
    });
};
