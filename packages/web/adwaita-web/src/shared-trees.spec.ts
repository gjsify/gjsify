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
//
// What is NOT here is everything that is not about this renderer — which tables the corpus
// reaches, which block is declared to reach none, whether an expectation's address exists.
// Those are facts about the CORPUS and are asserted once, in `adwaita-core`'s own suite,
// which runs on Node as well as in a browser.

import { describe, expect, it } from '@gjsify/unit';

import {
    authoredTags,
    sharedTreeExpectations,
    subjectIndexOf,
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

/**
 * Connect the authored root — these elements build on connect — run, and take it down again.
 *
 * The teardown is in a `finally` because a RED test must not leave a mounted tree behind:
 * the next test would then be reading a document two blocks deep, and the failure it
 * reported would name the wrong renderer.
 */
function mounted<T>(node: SharedTreeNode, use: (root: Element) => T): T {
    const host = document.createElement('div');
    host.append(build(node));
    document.body.append(host);
    try {
        return use(host.firstElementChild!);
    } finally {
        host.remove();
    }
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
        case 'banner-button-visible': {
            const button = bannerButton(el);
            return button ? !button.hidden : false;
        }
        case 'banner-button-text':
            return bannerButton(el)?.textContent ?? '';
    }
}

/**
 * The realised tree, depth-first in document order and filtered to the authored element
 * names: the parts an element renders for itself (a listbox, a revealer, a title span) are
 * not the renderer's promise; the ORDER and the NESTING of what was authored is.
 */
function realised(root: Element, wanted: readonly string[]): Element[] {
    const set = new Set(wanted);
    return [root, ...root.querySelectorAll('*')].filter((el) => set.has(el.tagName.toLowerCase()));
}

export const AdwSharedTreesTest = async () => {
    await describe('the shared corpus builds through adwaita-web', async () => {
        for (const block of ADWAITA_GALLERY_SHARED_TREES) {
            await it(`${block.widget} builds, and the REAL DOM carries the authored nodes in order`, () => {
                const wanted = authoredTags(block.root, hostTagOf);

                mounted(block.root, (root) => {
                    const built = realised(root, wanted).map((el) => el.tagName.toLowerCase());
                    expect(built).toStrictEqual(wanted);
                });
            });
        }
    });

    await describe('the shared corpus against the adwaita-core vectors it reaches', async () => {
        for (const block of ADWAITA_GALLERY_SHARED_TREES) {
            for (const expectation of sharedTreeExpectations(block.root)) {
                await it(`${block.widget} — ${expectation.path}: ${expectation.table} — ${expectation.rule}`, () => {
                    mounted(block.root, (root) => {
                        // The SAME filtered walk the shape test asserts, so the element an
                        // expectation is read off is the one at the authored ADDRESS rather
                        // than the first of its name the DOM happens to contain.
                        const built = realised(root, authoredTags(block.root, hostTagOf));
                        const subject = built[subjectIndexOf(block.root, expectation.path)]!;
                        expect(subject.tagName.toLowerCase()).toBe(hostTagOf(expectation.gtype));

                        expect(read(expectation, subject)).toBe(expectation.expected);
                    });
                });
            }
        }
    });
};
