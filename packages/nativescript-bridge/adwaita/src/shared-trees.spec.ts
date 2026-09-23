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
// here first. It buys the port's TREE: which class an element name resolves to, that every
// authored child reaches that tree at all and in the authored ORDER, and what the setter an
// authored attribute lands on makes of the string it is handed. It does not buy NativeScript:
// no layout pass, no CSS engine, no native view, no rasterised icon runs. A row that depends
// on the platform's own arithmetic is not reachable here and must not be claimed.
//
// AND IT DOES NOT BUY WHICH SLOT A CHILD LANDS IN — measured, not assumed, because an earlier
// revision of this header claimed it. The walks below filter the realised tree down to the
// AUTHORED classes, so a row placed beside the boxed list instead of inside it, and an
// expander's rows placed in its header instead of its disclosure, both keep every authored
// node in every authored position: both mutations were applied to the port and both stayed
// GREEN. Door 2 of `docs/nativescript-xml.md` is the door those defects come through, and
// `check-nativescript-xml-doors.mjs` is still the only thing that holds it. Nothing here does.
//
// The remaining coercion bound is the corpus's, not the driver's: every boolean the seven
// blocks author is `true`, which `Boolean('true')` also gets right, so the `'false'` half of
// `widgets/xml-values.ts` — the one that regression exists for — is not exercised on this
// corpus. Dropping `xmlBoolean` from `AdwSwitchRow.active` stays green today.
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
// screen is wrong. On this port that distinction is not academic, and {@link inner} carries
// the two measurements it cost.
//
// WHAT IS NOT HERE is everything that is not about this renderer. Which tables the corpus
// reaches, which block is declared to reach none, whether an expectation's address exists at
// all: those are facts about the CORPUS, asserted once in `adwaita-core`'s own suite.

import { describe, expect, it } from '@gjsify/unit';

import { parseBlueprint, projectToSharedNode } from '@gjsify/blueprint';
import {
    ADJUSTMENT_AUTHORED_VECTORS,
    authoredTags,
    PROPERTY_OF_VECTORS,
    sharedTreeExpectations,
    sharedTreePlacements,
    subjectIndexOf,
    TOGGLE_ACTIVE_NAME_VECTORS,
    withoutPlacements,
    type SharedTreeExpectation,
    type SharedTreeNode,
} from '@gjsify/adwaita-core/conformance';
import { attributeOf } from '@gjsify/adwaita-core/tags';
// The core's OWN character count, applied to text taken off the tree. Counting here
// instead would be a second `g_utf8_strlen` for the driver to agree with itself about.
import { entryTextLength } from '@gjsify/adwaita-core';

import { ADWAITA_GALLERY_SHARED_TREES, nativeScriptTree } from '../../../../scripts/adwaita-gallery-shared-trees.mjs';

// `elementFor`/`build` are the shipped `xmlns`-barrel interpreter, not test code — moved to
// `./builder/index.ts` (the NativeScript half of PR #1726's gtk-host move) so this spec stays
// free of the widget-class imports its OWN header explains the package normally forbids: the
// barrels those two functions reach are what put every widget module's `@nativescript/core`
// import in the build graph, and that module's own header carries the reachability rule.
import { build, elementFor } from './builder/index.js';

import { Button, Label, LayoutBase, ScrollView, Switch, TextField } from './testing/ns-core.mjs';

/**
 * THE ONE SEAM WHERE SHIPPED CODE MEETS THIS DOUBLE — deliberately typed as neither `View`.
 *
 * `build()` is shipped, production code (`builder/index.ts`'s own header): it is typed
 * `type`-only against the REAL `@nativescript/core` `View` on purpose, so it carries no
 * dependency on this double's directory layout. This driver's walk, below, is typed against
 * THIS double's own `LayoutBase`/`Button`/`Switch`/`TextField` on purpose too, because those
 * are the concrete classes an `instanceof` check narrows to and reads from. Before this
 * builder shipped, both sides were the SAME file and there was no seam to name; ADR 0051's
 * tree driver used to construct its own tree inline, against its own `View`.
 *
 * A plain alias to either concrete `View` does not survive the walk. `ns-core.d.ts`'s
 * ambient `View` carries its own `private _measuredWidth` guard (its header: so a widget
 * cannot shadow a real NativeScript field unseen) and this double's `View` carries its own
 * `private _className` backing field — and TypeScript seals a class against being assigned
 * to or from anything but itself the moment EITHER side declares a private member of its
 * own, independent of how the public shape lines up. It is not just the top-level `View`,
 * either: `LayoutBase.getChildAt` returns THIS double's `View`, which the walk below feeds
 * straight back into itself, so `View.animate`'s own `AnimationDefinition.target?: View`
 * drags the ambient guard back into the SAME comparison — measured, not assumed: typing this
 * walk against the ambient `View` directly still failed, one recursion level down, on that
 * `target` field.
 *
 * `TreeNode` is what both `View`s were always going to satisfy, because it asks nothing of
 * either: everything this walk actually reads happens AFTER narrowing to one of this
 * double's own concrete classes below, never on the unnarrowed node.
 */
type TreeNode = object;

/**
 * Depth-first over the REAL child lists the port filled, in the order it filled them. A
 * `ScrollView` holds its one child as `content` rather than in a child list, and
 * `Adw.Sidebar` is one, so its rows are reached through that.
 */
function descendants(root: TreeNode, into: TreeNode[] = []): TreeNode[] {
    into.push(root);
    if (root instanceof LayoutBase) {
        for (let index = 0; index < root.getChildrenCount(); index++) descendants(root.getChildAt(index), into);
    } else if (root instanceof ScrollView && root.content !== null) {
        descendants(root.content, into);
    }
    return into;
}

const findDescendant = (root: TreeNode, match: (view: TreeNode) => boolean): TreeNode | null =>
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
function realised(root: TreeNode, wanted: readonly string[]): { view: TreeNode; tag: string }[] {
    const byClass = new Map<unknown, string>(wanted.map((tag) => [elementFor(tag).ctor, tag]));
    const found: { view: TreeNode; tag: string }[] = [];
    for (const view of descendants(root)) {
        const tag = byClass.get(view.constructor);
        if (tag !== undefined) found.push({ view, tag });
    }
    return found;
}

/**
 * The banner's action button — a REAL `Button` in the tree, which is how the port adds it.
 *
 * Nullable where {@link inner} throws, and deliberately: this port makes the button's absence
 * the MECHANISM for "no button", so both vectors below have a row whose expected answer is
 * exactly that. A slider or a field is never absent by design.
 */
const bannerButton = (banner: TreeNode) => findDescendant(banner, (view) => view instanceof Button) as Button | null;

/**
 * The platform control a composed row installed in its constructor, found in the TREE.
 *
 * WHY EVERY READ BELOW GOES THROUGH THIS. Two of this port's observables are served by a
 * headless `@gjsify/adwaita-core` state object — `AdwSwitchRow.active` returns
 * `SwitchRowState.active`, `AdwEntryRow.textLength` returns `EntryRowState.textLength` —
 * and that object is written by the SETTER, not by the render. Reading it would be the
 * renderer agreeing with its own bookkeeping while the control on screen is untouched.
 * Measured, twice: deleting `this._switch.checked = …` from `AdwSwitchRow._apply`, and
 * `views.field.text = state.text` from `applyEntryRowState`, both left this suite GREEN
 * while the row rendered an off switch and an empty field.
 *
 * A missing control is a FAILURE and not a `null` read: a row with no slider and a row whose
 * slider says `false` are different findings and must not report the same value.
 */
function inner<T extends TreeNode>(row: TreeNode, ctor: new () => T, what: string): T {
    const found = findDescendant(row, (view) => view instanceof ctor);
    if (found === null) {
        throw new Error(
            `the tree under \`${row.constructor.name}\` carries no ${what}, so this row has nothing on ` +
                'screen for the vector to be about — the port composes one in its constructor.',
        );
    }
    return found as T;
}

/**
 * Read one observable off the view this renderer built.
 *
 * The ONE seam between the shared expectations and this renderer, and the mirror of `read()`
 * in the two sibling drivers. Everything above it is renderer-free; a case that grew a block
 * name would be the per-surface branch § 9 forbids.
 */
function read(expectation: SharedTreeExpectation, view: TreeNode): string | number | boolean {
    switch (expectation.observable) {
        case 'entry-text-length':
            // The TEXT off the tree, the COUNT from the core: a driver counting characters
            // itself would re-implement the `g_utf8_strlen` the table is about and then
            // assert against its own arithmetic.
            return entryTextLength(inner(view, TextField, 'TextField').text);
        case 'switch-row-active':
            // The SLIDER. The row's `active` is the same fact one indirection earlier, and
            // the vector's own rule is that the programmatic set REACHES the slider.
            return inner(view, Switch, 'Switch').checked;
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

/**
 * A Blueprint source as the `?shared-tree` door hands it to an app: projected by the one
 * projection `@gjsify/vite-plugin-blueprint` serves, and refused when it dropped anything,
 * as that door refuses it. Projected here rather than imported as a `.blp` file so the
 * trees below stay out of ADR 0053's census of shipped `.blp` files — they are fixtures of
 * this driver, not interfaces anything ships.
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

/** The ids of a box's children, in the order the port put them there. */
function childIds(box: TreeNode): (string | undefined)[] {
    const ids: (string | undefined)[] = [];
    if (box instanceof LayoutBase) {
        for (let index = 0; index < box.getChildrenCount(); index++) ids.push(box.getChildAt(index).id);
    }
    return ids;
}

/** Every `Label` text under `root`, in tree order — what a user reads off a built row. */
const labelTexts = (root: TreeNode): string[] =>
    descendants(root)
        .filter((view): view is Label => view instanceof Label)
        .map((label) => label.text);

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

    // The TypeScript beside a `.blp` addresses a view by its Blueprint id, as GTK's
    // `InternalChildren` does; a nested one proves the lookup walks the composed tree.
    await describe('an authored id is how code reaches a view', async () => {
        await it('getViewById finds a nested view by the id the tree gave it', () => {
            const root = build({
                tag: 'AdwToolbarView',
                children: [{ tag: 'AdwHeaderBar', slot: 'topBar', children: [{ tag: 'GtkButton', id: 'save' }] }],
            });
            const found = root.getViewById('save');

            expect(found === undefined).toBe(false);
            expect(found?.id).toBe('save');
            expect(root.getViewById('missing')).toBe(undefined);
        });
    });

    await describe('authored style classes reach the view', async () => {
        await it('a label carries the classes the tree gave it', () => {
            const root = build({ tag: 'GtkLabel', styleClasses: ['title-1', 'dim-label'] });

            expect((root as unknown as { styleClasses: string[] }).styleClasses).toStrictEqual([
                'title-1',
                'dim-label',
            ]);
        });

        await it('a widget without a class list refuses them BY NAME', () => {
            expect(() => build({ tag: 'AdwClamp', styleClasses: ['card'] })).toThrow('takes no style classes');
        });
    });

    // `PROPERTY_OF_VECTORS` (`adwaita-core/conformance/tags.ts`) pins `propertyOf`'s case
    // rule, and until now nothing drove it against a REAL declared member — the gap
    // `build()`'s own fix (`builder/index.ts`) exposed: a projected `.blp` spells a property
    // as GObject does (`maximum-size`), the widget declares it camelCase (`maximumSize`),
    // and only `propertyOf` stands between the two. This is this pillar's own driver,
    // against the real widget each vector names — the shape `adwaita-web/src/tags.spec.ts`
    // already holds `attributeOf` to, against a real DOM element, for its own table.
    await describe('PROPERTY_OF_VECTORS reach the real declared member', async () => {
        const WIDGET_OF: Readonly<Record<string, string>> = {
            'maximum-size': 'AdwClamp',
            'tightening-threshold': 'AdwClamp',
            icon_name: 'GtkImage',
            label: 'GtkLabel',
            maximumSize: 'AdwClamp',
        };

        for (const vector of PROPERTY_OF_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const tag = WIDGET_OF[vector.name];
                if (tag === undefined) throw new Error(`no widget named for vector '${vector.name}'`);

                const value = vector.name.toLowerCase().includes('icon') ? 'list-add-symbolic' : '400';
                const view = build({ tag, props: { [vector.name]: value } }) as unknown as Record<string, unknown>;

                expect(String(view[vector.expected])).toBe(value);
            });
        }
    });

    // THE TAGS A REAL `.blp` WRITES AND THIS BUILDER COULD NOT BUILD. Each tree below is
    // Blueprint source through the real projection, so what is under test is the join a
    // shipped `.blp` goes through, not a hand-written node. Two of the five are VALUE
    // objects in GTK — `Gtk.Adjustment`, and `Adw.Toggle` / `Adw.SidebarSection` /
    // `Adw.SidebarItem` — which `build()` constructs from their construct bag and hands to
    // the parent's child door (`builder/index.ts`).
    await describe('a .blp tree with the tags the builder learned', async () => {
        await it('Gtk.Adjustment at `adjustment:` becomes the spin row range, and the value the row shows', () => {
            const row = build(
                blueprintTree(
                    'Adw.SpinRow { title: "Size"; adjustment: Adjustment { lower: 2; upper: 10; value: 4; step-increment: 2; }; }',
                ),
            );

            expect((row as unknown as { adjustment: unknown }).adjustment).toStrictEqual({
                value: 4,
                lower: 2,
                upper: 10,
                stepIncrement: 2,
                pageIncrement: 2,
                pageSize: 0,
            });
            expect(labelTexts(row).includes('4')).toBe(true);
        });

        // `ADJUSTMENT_AUTHORED_VECTORS` through the tree door: the input spelled as a `.blp`
        // spells it, so the case rule and the value-object bag are on the path too.
        for (const vector of ADJUSTMENT_AUTHORED_VECTORS) {
            await it(`ADJUSTMENT_AUTHORED_VECTORS through a .blp — ${vector.rule}`, () => {
                const fields = Object.entries(vector.input)
                    .map(([field, value]) => `${attributeOf(field)}: ${String(value)};`)
                    .join(' ');
                const row = build(blueprintTree(`Adw.SpinRow { adjustment: Adjustment { ${fields} }; }`));

                expect((row as unknown as { adjustment: unknown }).adjustment).toStrictEqual(vector.adjustment);
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
                const group = build(
                    blueprintTree(`Adw.ToggleGroup { active-name: "${vector.activeName}"; ${toggles} }`),
                );

                // The ACTIVE PILL, read off the segments the port built — not the group's index.
                const segments: TreeNode[] = [];
                if (group instanceof LayoutBase) {
                    for (let index = 0; index < group.getChildrenCount(); index++)
                        segments.push(group.getChildAt(index));
                }
                const active = segments.findIndex((segment) =>
                    ((segment as { className?: string }).className ?? '').split(' ').includes('active'),
                );
                expect(segments.length).toBe(vector.kept);
                expect(active).toBe(vector.active);
            });
        }

        await it('Adw.Toggle carries its label and icon into the segment it becomes', () => {
            const group = build(
                blueprintTree(
                    'Adw.ToggleGroup { active: 1; Adw.Toggle { label: "List"; icon-name: "view-list-symbolic"; } Adw.Toggle { label: "Grid"; } }',
                ),
            );

            expect(labelTexts(group)).toStrictEqual(['List', 'Grid']);
            // `active: 1` is written before the toggles exist, as GtkBuilder writes it; the
            // C holds it back until `parser_finished`, and so must the port.
            expect((group as unknown as { active: number }).active).toBe(1);
            expect(
                descendants(group).some((view) => (view as { iconName?: unknown }).iconName === 'view-list-symbolic'),
            ).toBe(true);
        });

        await it('Adw.NavigationPage brings its tag, title, can-pop and child into the navigation view', () => {
            const view = build(
                blueprintTree(`Adw.NavigationView {
                    Adw.NavigationPage { tag: "home"; title: "Home"; child: Gtk.Label { label: "Welcome"; }; }
                    Adw.NavigationPage details { tag: "details"; title: "Details"; can-pop: false; child: Gtk.Label { label: "More"; }; }
                }`),
            ) as unknown as {
                pages: readonly TreeNode[];
                visiblePageTag: string | null;
                push_by_tag(tag: string): boolean;
                canGoBack(): boolean;
                find_page(tag: string): TreeNode | null;
            };

            expect(view.pages.length).toBe(2);
            expect(view.visiblePageTag).toBe('home');
            expect(labelTexts(view.pages[0]!)).toStrictEqual(['Welcome']);
            // A template-built page is reachable by its tag — it could carry none before.
            expect(view.push_by_tag('details')).toBe(true);
            expect(view.visiblePageTag).toBe('details');
            // `can-pop: false` on the visible page takes the back button away.
            expect(view.canGoBack()).toBe(false);
            // A later write reaches the stack the page is registered in.
            (view.pages[1] as unknown as { tag: string }).tag = 'renamed';
            expect(view.find_page('renamed')).toBe(view.pages[1]!);
        });

        await it('Adw.SidebarSection and Adw.SidebarItem become the sidebar model and its rows', () => {
            const sidebar = build(
                blueprintTree(`Adw.Sidebar {
                    Adw.SidebarSection { title: "Places"; Adw.SidebarItem { title: "Home"; icon-name: "go-home-symbolic"; } Adw.SidebarItem { title: "Trash"; enabled: false; } }
                    Adw.SidebarSection { Adw.SidebarItem { title: "Hidden"; visible: false; } Adw.SidebarItem { title: "Music"; subtitle: "Library"; } }
                }`),
            );
            const sections = (
                sidebar as unknown as { sections: readonly { title?: string; items: readonly object[] }[] }
            ).sections;

            expect(sections.map((section) => section.title)).toStrictEqual(['Places', '']);
            expect(sections.map((section) => section.items.length)).toStrictEqual([2, 2]);
            expect((sections[0]!.items[0] as { iconName: string }).iconName).toBe('go-home-symbolic');
            expect((sections[1]!.items[1] as { subtitle: string }).subtitle).toBe('Library');
            // The ROWS: every item is a row, the hidden one collapsed and the disabled one
            // at the insensitive opacity — read off the views, not the model.
            const rows = descendants(sidebar).filter((view) =>
                ((view as { className?: string }).className ?? '').split(' ').includes('adw-sidebar-row'),
            ) as { visibility: string; opacity: number }[];
            expect(labelTexts(sidebar)).toStrictEqual(['Home', 'Trash', 'Hidden', 'Music']);
            expect(rows.map((row) => row.visibility)).toStrictEqual(['visible', 'visible', 'collapse', 'visible']);
            expect(rows.map((row) => row.opacity)).toStrictEqual([1, 0.5, 1, 1]);
        });

        await it('Gtk.ActionBar packs [start], [end], [center] and an untyped child as GtkBuildable does', () => {
            const bar = build(
                blueprintTree(`Gtk.ActionBar {
                    revealed: false;
                    [start] Gtk.Button a {}
                    [end] Gtk.Button c {}
                    [start] Gtk.Button b {}
                    [end] Gtk.Button d {}
                    Gtk.Button e {}
                    [center] Gtk.Label centre { label: "Centre"; }
                }`),
            ) as unknown as { startBox: TreeNode; endBox: TreeNode; centerWidget: { id?: string }; visibility: string };

            // pack_start appends; an untyped child packs from the start (gtkactionbar.c:233).
            expect(childIds(bar.startBox)).toStrictEqual(['a', 'b', 'e']);
            // pack_end PREPENDS, so the first `[end]` child sits nearest the edge.
            expect(childIds(bar.endBox)).toStrictEqual(['d', 'c']);
            expect(bar.centerWidget.id).toBe('centre');
            expect(bar.visibility).toBe('collapse');
        });

        await it('Adw.TabPage becomes a titled page around its child; a bare widget an untitled one', () => {
            const view = build(
                blueprintTree(`Adw.TabView {
                    Adw.TabPage { title: "Inbox"; child: Gtk.Label inbox { label: "3 new"; }; }
                    Adw.TabPage { title: "Drafts"; child: Gtk.Label drafts { label: "None"; }; }
                    Gtk.Label bare { label: "Loose"; }
                }`),
            ) as unknown as { pages: readonly { title: string; content?: { id?: string } }[] };

            expect(view.pages.map((page) => page.title)).toStrictEqual(['Inbox', 'Drafts', '']);
            expect(view.pages.map((page) => page.content?.id)).toStrictEqual(['inbox', 'drafts', 'bare']);
            // The CHIPS: each titled page's label is on the bar the port drew.
            const texts = labelTexts(view as unknown as TreeNode);
            expect(texts.includes('Inbox') && texts.includes('Drafts')).toBe(true);
        });

        await it('`center-widget:` is refused — GTK has no such property, so Gtk.Builder refuses it too', () => {
            expect(() => build(blueprintTree('Gtk.ActionBar { center-widget: Gtk.Label {}; }'))).toThrow(
                'declares no such builder slot',
            );
        });
    });

    await describe('what the builder still refuses on the new tags', async () => {
        await it('a widget inside a toggle group, which the C refuses with a g_critical', () => {
            expect(() => build(blueprintTree('Adw.ToggleGroup { Gtk.Button {} }'))).toThrow('only Adw.Toggle');
        });

        await it('a toggle property the group does not draw, by name', () => {
            expect(() => build(blueprintTree('Adw.ToggleGroup { Adw.Toggle { tooltip: "Hint"; } }'))).toThrow(
                "declares no 'tooltip'",
            );
        });

        await it('an id on a value object, which getViewById could never find', () => {
            expect(() => build(blueprintTree('Adw.SpinRow { adjustment: Adjustment range { upper: 5; }; }'))).toThrow(
                'is not a view',
            );
        });

        await it('a tab page property the tab view does not draw, by name', () => {
            expect(() =>
                build(blueprintTree('Adw.TabView { Adw.TabPage { needs-attention: true; child: Gtk.Label {}; } }')),
            ).toThrow("declares no 'needsAttention'");
        });

        await it('a tree rooted at a value object', () => {
            expect(() => build(blueprintTree('Adjustment { upper: 5; }'))).toThrow('cannot root at it');
        });
    });

    await describe('the shared corpus is placed where it says', async () => {
        // THE BOUND THIS CLOSES, named where ADR 0051 § Amendment 3 recorded it: this
        // driver's walks filter the realised tree down to the authored classes, so a child
        // placed in the wrong slot of the right parent keeps every authored node in every
        // authored position — two deliberate mis-placements were applied to this port and
        // both stayed GREEN. A CONTROL closes it without a table: `withoutPlacements` is the
        // tree a builder that never read `slot` hands this renderer, and it is what this
        // builder handed it until now, so the two realised trees being identical IS the
        // regression. Nesting and class name only — nothing the authored slot itself writes.
        const structure = (node: TreeNode): string => {
            const children: string[] = [];
            if (node instanceof LayoutBase) {
                for (let index = 0; index < node.getChildrenCount(); index++) {
                    children.push(structure(node.getChildAt(index)));
                }
            }
            return `${node.constructor.name}[${children.join(',')}]`;
        };

        for (const block of blocks) {
            const placements = sharedTreePlacements(block.authored);
            if (placements.length === 0) continue;
            const named = placements.map(({ path, slot }) => `${path} -> ${slot}`).join(', ');
            await it(`${block.widget} — ${named}: the built tree is not the unplaced one`, () => {
                const placed = structure(build(block.ns));
                const unplaced = structure(build(withoutPlacements(block.ns)));

                expect(placed === unplaced).toBe(false);
            });
        }

        // Otherwise the loop above is green from emptiness — the corpus authored no slot at
        // all until a `.blp` forced the question.
        await it('the corpus authors a placement at all', () => {
            expect(blocks.some((block) => sharedTreePlacements(block.authored).length > 0)).toBe(true);
        });

        // THE OTHER HALF OF READING A SLOT, and the corpus cannot carry it: `top` is the
        // name GTK and the web both spell, and this port spells `topBar` — the `vocabulary`
        // divergence the gallery ledger already records, now LOUD instead of a header bar
        // quietly landing in the content cell.
        await it('a placement this dialect does not spell is refused BY NAME', () => {
            expect(() => build({ tag: 'AdwToolbarView', children: [{ tag: 'AdwHeaderBar', slot: 'top' }] })).toThrow(
                'declares no such builder slot',
            );
        });

        await it('the name this dialect DOES spell places the child', () => {
            const placed = build({ tag: 'AdwToolbarView', children: [{ tag: 'AdwHeaderBar', slot: 'topBar' }] });
            const unplaced = build({ tag: 'AdwToolbarView', children: [{ tag: 'AdwHeaderBar' }] });

            expect(structure(placed) === structure(unplaced)).toBe(false);
        });

        // `child: Gtk.Label {…}` in a `.blp` authors `slot: 'child'` — the widget's own
        // GObject property name — for every single-child widget the corpus never places one
        // on, so this went unmeasured until read against a real GTK render. Both widgets'
        // `_addChildFromBuilder` already ignore the name and always set the one child they
        // have; only the `builderSlots` declaration that lets that name THROUGH was missing.
        await it("AdwClamp accepts its GIR child property, 'child', as a named builder slot", () => {
            const root = build({ tag: 'AdwClamp', children: [{ tag: 'GtkLabel', slot: 'child' }] });

            expect(findDescendant(root, (view) => view.constructor === elementFor('GtkLabel').ctor) !== null).toBe(
                true,
            );
        });

        await it("AdwStatusPage accepts its GIR child property, 'child', as a named builder slot", () => {
            const root = build({ tag: 'AdwStatusPage', children: [{ tag: 'GtkButton', slot: 'child' }] });

            expect(findDescendant(root, (view) => view.constructor === elementFor('GtkButton').ctor) !== null).toBe(
                true,
            );
        });
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
