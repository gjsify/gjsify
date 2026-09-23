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

import { parseBlueprint, projectToSharedNode } from '@gjsify/blueprint';
import {
    ADJUSTMENT_AUTHORED_VECTORS,
    authoredTags,
    sharedTreeExpectations,
    sharedTreePlacements,
    subjectIndexOf,
    TOGGLE_ACTIVE_NAME_VECTORS,
    withoutPlacements,
    type SharedTreeExpectation,
    type SharedTreeNode,
} from '@gjsify/adwaita-core/conformance';
import { attributeOf, hostTagOf } from '@gjsify/adwaita-core/tags';

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

/**
 * A Blueprint source as the `?shared-tree` door hands it over: projected by the one
 * projection `@gjsify/vite-plugin-blueprint` serves, and refused when it dropped anything,
 * as that door refuses it. Projected here rather than imported as a `.blp` file so these
 * fixtures stay out of ADR 0053's census of shipped `.blp` files. The NativeScript driver
 * (`packages/nativescript-bridge/adwaita/src/shared-trees.spec.ts`) builds the same sources.
 */
function blueprintTree(body: string): SharedTreeNode {
    const { node, lost } = projectToSharedNode(
        parseBlueprint(`using Gtk 4.0;\nusing Adw 1;\n\n${body}\n`, 'shared-trees.spec.blp'),
    );
    if (lost.length > 0) {
        throw new Error(`the projection dropped ${lost.map((loss) => `${loss.kind} at line ${loss.line}`).join(', ')}`);
    }
    return node as SharedTreeNode;
}

/** The ids of an element's children, in DOM order. */
const childIds = (el: Element | null): string[] => Array.from(el?.children ?? [], (child) => child.id);

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

    // THE TAGS A REAL `.blp` WRITES, through the real projection — the same sources the
    // NativeScript driver builds, so the two renderers answer the same trees.
    await describe('a .blp tree with the tags the builders learned', async () => {
        await it('Gtk.Adjustment at `adjustment:` becomes the spin row range, and the value the row shows', () => {
            const tree = blueprintTree(
                'Adw.SpinRow { title: "Size"; adjustment: Adjustment { lower: 2; upper: 10; value: 4; step-increment: 2; }; }',
            );
            mounted(tree, (root) => {
                expect((root as unknown as { adjustment: unknown }).adjustment).toStrictEqual({
                    value: 4,
                    lower: 2,
                    upper: 10,
                    stepIncrement: 2,
                    pageIncrement: 2,
                    pageSize: 0,
                });
                expect(root.querySelector('input')?.value).toBe('4');
                // Consumed as data, as GtkBuilder leaves no adjustment in the widget tree.
                expect(root.querySelector('gtk-adjustment')).toBe(null);
            });
        });

        for (const vector of ADJUSTMENT_AUTHORED_VECTORS) {
            await it(`ADJUSTMENT_AUTHORED_VECTORS through a .blp — ${vector.rule}`, () => {
                const fields = Object.entries(vector.input)
                    .map(([field, value]) => `${attributeOf(field)}: ${String(value)};`)
                    .join(' ');
                mounted(blueprintTree(`Adw.SpinRow { adjustment: Adjustment { ${fields} }; }`), (root) => {
                    expect((root as unknown as { adjustment: unknown }).adjustment).toStrictEqual(vector.adjustment);
                });
            });
        }

        for (const vector of TOGGLE_ACTIVE_NAME_VECTORS) {
            await it(`TOGGLE_ACTIVE_NAME_VECTORS — ${vector.rule}`, () => {
                const toggles = vector.names
                    .map(
                        (name, index) =>
                            `Adw.Toggle { ${name === null ? '' : `name: "${name}"; `}label: "T${index}"; }`,
                    )
                    .join(' ');
                const tree = blueprintTree(`Adw.ToggleGroup { active-name: "${vector.activeName}"; ${toggles} }`);
                mounted(tree, (root) => {
                    // The ACTIVE BUTTON, read off the DOM — not the element's index.
                    const buttons = Array.from(root.querySelectorAll('button.adw-toggle'));
                    expect(buttons.length).toBe(vector.kept);
                    expect(buttons.findIndex((button) => button.classList.contains('active'))).toBe(vector.active);
                });
            });
        }

        await it('Adw.Toggle carries its label into the button it becomes', () => {
            const tree = blueprintTree(
                'Adw.ToggleGroup { active: 1; Adw.Toggle { label: "List"; icon-name: "view-list-symbolic"; } Adw.Toggle { label: "Grid"; } }',
            );
            mounted(tree, (root) => {
                const buttons = Array.from(root.querySelectorAll('button.adw-toggle'));
                expect(buttons.map((button) => button.textContent)).toStrictEqual(['List', 'Grid']);
                expect(buttons[1]?.classList.contains('active')).toBe(true);
                expect(root.querySelector('gtk-image') !== null).toBe(true);
            });
        });

        await it('Adw.NavigationPage brings its tag, title, can-pop and child into the navigation view', () => {
            const tree = blueprintTree(`Adw.NavigationView {
                Adw.NavigationPage { tag: "home"; title: "Home"; child: Gtk.Label { label: "Welcome"; }; }
                Adw.NavigationPage { tag: "details"; title: "Details"; can-pop: false; child: Gtk.Label { label: "More"; }; }
            }`);
            mounted(tree, (root) => {
                const view = root as unknown as {
                    pages: readonly Element[];
                    visiblePageTag: string | null;
                    pushByTag(tag: string): boolean;
                    canGoBack: boolean;
                };
                expect(view.pages.length).toBe(2);
                expect(view.visiblePageTag).toBe('home');
                expect(view.pages[0]?.querySelector('gtk-label')?.getAttribute('label')).toBe('Welcome');
                expect(view.pushByTag('details')).toBe(true);
                expect(view.visiblePageTag).toBe('details');
                // `can-pop: false` is a GTK default of TRUE authored false — the case
                // absence cannot spell, so the builder writes it through `canPop`.
                expect(view.canGoBack).toBe(false);
            });
        });

        await it('Adw.SidebarSection and Adw.SidebarItem become the sidebar model and its rows', () => {
            const tree = blueprintTree(`Adw.Sidebar {
                Adw.SidebarSection { title: "Places"; Adw.SidebarItem { title: "Home"; icon-name: "go-home-symbolic"; } Adw.SidebarItem { title: "Trash"; enabled: false; } }
                Adw.SidebarSection { Adw.SidebarItem { title: "Hidden"; visible: false; } Adw.SidebarItem { title: "Music"; subtitle: "Library"; } }
            }`);
            mounted(tree, (root) => {
                const sections = (
                    root as unknown as {
                        sections: readonly {
                            title?: string;
                            items: readonly { title: string; enabled?: boolean; visible?: boolean }[];
                        }[];
                    }
                ).sections;
                expect(sections.map((section) => section.title)).toStrictEqual(['Places', '']);
                expect(sections.flatMap((section) => section.items.map((item) => item.title))).toStrictEqual([
                    'Home',
                    'Trash',
                    'Hidden',
                    'Music',
                ]);
                expect(sections[0]?.items[1]?.enabled).toBe(false);
                expect(sections[1]?.items[0]?.visible).toBe(false);
                // The ROWS: the hidden item's row is hidden, the disabled one insensitive.
                const rows = Array.from(root.querySelectorAll<HTMLButtonElement>('button.adw-sidebar-item'));
                expect(rows.map((row) => row.querySelector('.adw-sidebar-item-title')?.textContent)).toStrictEqual([
                    'Home',
                    'Trash',
                    'Hidden',
                    'Music',
                ]);
                expect(rows.map((row) => row.hidden)).toStrictEqual([false, false, true, false]);
                expect(rows.map((row) => row.disabled)).toStrictEqual([false, true, false, false]);
            });
        });

        await it('Adw.TabPage becomes a titled page around its child; a bare widget an untitled one', () => {
            const tree = blueprintTree(`Adw.TabView {
                Adw.TabPage { title: "Inbox"; child: Gtk.Label inbox { label: "3 new"; }; }
                Adw.TabPage { title: "Drafts"; child: Gtk.Label drafts { label: "None"; }; }
                Gtk.Label bare { label: "Loose"; }
            }`);
            mounted(tree, (root) => {
                const pages = (root as unknown as { pages: readonly { title: string; content?: Element }[] }).pages;
                expect(pages.map((page) => page.title)).toStrictEqual(['Inbox', 'Drafts', '']);
                expect(
                    pages.map((page) => page.content?.querySelector('gtk-label')?.id ?? page.content?.id),
                ).toStrictEqual(['inbox', 'drafts', 'bare']);
            });
        });

        await it('Gtk.ActionBar packs [start], [end], [center] and an untyped child as GtkBuildable does', () => {
            const tree = blueprintTree(`Gtk.ActionBar {
                revealed: false;
                [start] Gtk.Button a {}
                [end] Gtk.Button c {}
                [start] Gtk.Button b {}
                [end] Gtk.Button d {}
                Gtk.Button e {}
                [center] Gtk.Label centre { label: "Centre"; }
            }`);
            mounted(tree, (root) => {
                expect(childIds(root.querySelector('.adw-action-bar-start'))).toStrictEqual(['a', 'b', 'e']);
                expect(childIds(root.querySelector('.adw-action-bar-end'))).toStrictEqual(['d', 'c']);
                expect(childIds(root.querySelector('.adw-action-bar-center'))).toStrictEqual(['centre']);
                expect((root as HTMLElement).hidden).toBe(true);
            });
        });

        await it('an authored false on a getter-only property keeps the presence rule instead of throwing', () => {
            // `<adw-split-button>` exposes `active` as a read-only getter; assigning through it
            // threw a bare TypeError out of the builder before the writability check.
            mounted({ tag: 'AdwSplitButton', props: { active: false } }, (root) => {
                expect(root.hasAttribute('active')).toBe(false);
            });
        });

        await it('`center-widget:` is refused — GTK has no such property, so Gtk.Builder refuses it too', () => {
            expect(() => mountSharedTree(blueprintTree('Gtk.ActionBar { center-widget: Gtk.Label {}; }'))).toThrow(
                'has no slot "center-widget"',
            );
        });
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
