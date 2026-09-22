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
// `mountSharedTree` is SHIPPED code, not this driver's own — the renderer-specific half of
// ADR 0051 that any consumer of this package may need (the same move #1726 made for
// `gtk-host`), so it lives in `./shared-tree-builder.ts` rather than here. Its header
// explains why THIS renderer needs a mount step the other two do not: these elements build
// on connect.
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
    sharedTreePlacements,
    subjectIndexOf,
    withoutPlacements,
    type SharedTreeExpectation,
    type SharedTreeNode,
} from '@gjsify/adwaita-core/conformance';
import { hostTagOf } from '@gjsify/adwaita-core/tags';

// The corpus data itself, not the transforms: `scripts/` still owns the ONE gallery corpus
// (ADR 0051), and this driver reads it here rather than transcribing it, the same as the
// GTK and NativeScript drivers do.
import { ADWAITA_GALLERY_SHARED_TREES } from '../../../../scripts/adwaita-gallery-shared-trees.mjs';

import '@gjsify/adwaita-web';

import { mountSharedTree } from './shared-tree-builder.js';

/**
 * Connect the authored root — these elements build on connect — run, and take it down again.
 *
 * The teardown is in a `finally` because a RED test must not leave a mounted tree behind:
 * the next test would then be reading a document two blocks deep, and the failure it
 * reported would name the wrong renderer. `mountSharedTree` is the shipped instantiation
 * half; the `finally` around it is this suite's own isolation POLICY, not part of it.
 */
function mounted<T>(node: SharedTreeNode, use: (root: Element) => T): T {
    const { root, unmount } = mountSharedTree(node);
    try {
        return use(root);
    } finally {
        unmount();
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

    await describe('the shared corpus is placed where it says', async () => {
        // A CONTROL, not a table of where each slot lands. `withoutPlacements` is the tree a
        // builder that never read `slot` hands this renderer — which is what all three
        // builders did — so the two realised DOMs being identical is exactly that
        // regression. NESTING AND ELEMENT NAME ONLY, because the `slot=` attribute is itself
        // part of what the placed build writes: comparing markup would differ on the
        // attribute alone and pass while the widget sat beside its destination.
        const structure = (el: Element): string => `${el.localName}[${Array.from(el.children, structure).join(',')}]`;

        for (const block of ADWAITA_GALLERY_SHARED_TREES) {
            const placements = sharedTreePlacements(block.root);
            if (placements.length === 0) continue;
            const named = placements.map(({ path, slot }) => `${path} -> ${slot}`).join(', ');
            await it(`${block.widget} — ${named}: the mounted DOM is not the unplaced one`, () => {
                const placed = mounted(block.root, structure);
                const unplaced = mounted(withoutPlacements(block.root), structure);

                expect(placed === unplaced).toBe(false);
            });
        }

        // Otherwise the loop above is green from emptiness — the corpus authored no slot at
        // all until a `.blp` forced the question.
        await it('the corpus authors a placement at all', () => {
            expect(ADWAITA_GALLERY_SHARED_TREES.some((block) => sharedTreePlacements(block.root).length > 0)).toBe(
                true,
            );
        });

        // THE OTHER HALF OF READING A SLOT, and the corpus cannot carry it: a name this
        // renderer has no destination for. `bindSlottedChildren` copies the NATIVE rule — an
        // unmatched name is assigned nowhere and the child stays put — which is right for
        // hand-written markup and says nothing to a builder realising an authored tree.
        await it('a placement this renderer has no destination for is refused BY NAME', () => {
            expect(() =>
                mountSharedTree({ tag: 'AdwToolbarView', children: [{ tag: 'AdwBanner', slot: 'middle' }] }),
            ).toThrow('has no slot "middle"');
        });

        // `child: Gtk.Label {…}` in a `.blp` authors `slot: 'child'` — the widget's own
        // GObject property name — for every single-child widget the corpus never places
        // one on. `<adw-clamp>` has no separate box to route into (every child is already
        // the placement, clamped in place), which is why it took no `bindSlottedChildren`
        // call at all until this slot needed one — and why it stayed unnoticed: the corpus
        // above authors zero placements on it.
        await it("AdwClamp accepts its GIR child property, 'child', as a named slot", () => {
            mounted(
                { tag: 'AdwClamp', children: [{ tag: 'GtkLabel', slot: 'child', props: { label: 'Clamped' } }] },
                (root) => {
                    expect(root.querySelector('gtk-label')?.getAttribute('label')).toBe('Clamped');
                },
            );
        });

        await it("AdwStatusPage accepts its GIR child property, 'child', as a named slot", () => {
            mounted(
                { tag: 'AdwStatusPage', children: [{ tag: 'GtkButton', slot: 'child', props: { label: 'Retry' } }] },
                (root) => {
                    expect(root.querySelector('.adw-status-page-child gtk-button')?.getAttribute('label')).toBe(
                        'Retry',
                    );
                },
            );
        });

        await it('the PROPERTY spelling of the title slot reaches the centre', () => {
            // `title-widget:` is what a Blueprint source writes the centre at, and this
            // element spells its own centre `center`; naming both is the element's own
            // declaration, not a table in the builder.
            //
            // READ BY THE AUTHORED VALUE, not by the tag: an unrouted child is destroyed by
            // the bar's own `replaceChildren`, and the bar then DERIVES an `<adw-window-title>`
            // into the same centre — so a test asking only where an `<adw-window-title>` sits
            // passed against the derived one with the authored one gone. Measured, by dropping
            // the builder's `slot=` write: green.
            const authored = { tag: 'AdwWindowTitle', slot: 'title-widget', props: { title: 'Placed' } };
            mounted({ tag: 'AdwHeaderBar', children: [authored] }, (root) => {
                const title = root.querySelector('adw-window-title[title="Placed"]');

                expect(title?.parentElement?.className).toBe('adw-header-bar-center');
            });
        });
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
