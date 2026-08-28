// The probe. Loads every generated gallery template through NativeScript's own XML
// Builder on a real device, and asserts the view tree the Builder BUILT — not that
// the file parsed.
//
// WHY THE ASSERTION IS THE POINT
//
// NativeScript inflates XML through two doors, and both of them fail silently:
//
//   · An ATTRIBUTE arrives at a plain accessor as the raw STRING.
//     `component-builder`'s `setPropertyValue` ends in `instance[name] = value` with
//     no conversion — only NativeScript `Property` objects carry a `valueConverter`,
//     and these widgets are plain classes. So `size="48"` can leave a widget at its
//     default and `revealed="false"` can read as TRUE, with the app rendering
//     perfectly at exit 0.
//   · A CHILD arrives at `_addChildFromBuilder(name, view)`, and `LayoutBase`'s
//     inherited implementation IGNORES the name and calls `addChild`. A composed
//     widget builds its own internal boxes in its constructor, so that default drops
//     the child into the layout's first cell — on top of whatever is already there.
//     Also renders.
//
// So the probe reads every declared property BACK off the widget and compares the
// VALUE AND ITS TYPE, and it resolves every child through the parent's OWN accessor
// (`clamp.child`, `headerBar.titleWidget`, `group.listbox`) rather than searching the
// subtree — a child found "somewhere below the parent" is exactly what the broken
// default produces.
//
// The verdict is the `__GJSIFY_NS__` marker grammar in logcat, which
// `scripts/run-on-device.mjs` parses; the Label on screen is a fallback for a human.

import { Builder, LayoutBase } from '@nativescript/core';
import type { ContentView, Label, NavigatedData, Page, View } from '@nativescript/core';

import {
    AdwActionRow,
    AdwBottomSheet,
    AdwCarousel,
    AdwClamp,
    AdwExpanderRow,
    AdwHeaderBar,
    AdwNavigationView,
    AdwPreferencesDialog,
    AdwPreferencesGroup,
    AdwPreferencesPage,
    AdwSplitViewBase,
    AdwStatusPage,
    AdwToolbarView,
} from '@gjsify/adwaita-nativescript';

import { begin, describe, it, summary } from './reporter';
import { ELEMENT_CLASSES, EXPECTED, type ExpectNode } from './expected';

const RUN_ID = 'adwaita-gallery-xml';

/**
 * Where a child DECLARED in the template must have landed.
 *
 * `exact` is a slot the parent holds as ONE view and hands back; `views` is the
 * ordered list a repeatable placement reads back as. Both are the parent's OWN
 * accessors, and that is the point: `null` means the widget exposes none for that
 * placement, and the caller records THAT as a failure rather than falling back to a
 * subtree search. A search cannot tell a placed child from one the inherited
 * `_addChildFromBuilder` dropped into the layout, which is the defect this exists to
 * catch — and a widget with a write-only slot cannot be asserted at all.
 */
interface Placement {
    exact?: View | null;
    views?: readonly View[];
}

function placementOf(parent: View, slot: string | undefined): Placement | null {
    // Order matters where the classes nest: an expander row IS an action row, and a
    // split view's two concrete subclasses share one base.
    if (parent instanceof AdwClamp) return slot === undefined ? { exact: parent.child } : null;
    if (parent instanceof AdwStatusPage) return slot === undefined ? { exact: parent.child } : null;
    if (parent instanceof AdwPreferencesGroup) {
        if (slot === undefined) return { views: childrenOf(parent.listbox) };
        if (slot === 'headerSuffix') return { exact: parent.headerSuffix };
        return null;
    }
    if (parent instanceof AdwHeaderBar) {
        if (slot === 'titleWidget') return { exact: parent.titleWidget };
        if (slot === 'startBox') return { views: childrenOf(parent.startBox) };
        if (slot === 'endBox') return { views: childrenOf(parent.endBox) };
        return null;
    }
    if (parent instanceof AdwToolbarView) {
        if (slot === 'content') return { exact: parent.content };
        if (slot === 'topBar') return { views: childrenOf(parent.topBar) };
        if (slot === 'bottomBar') return { views: childrenOf(parent.bottomBar) };
        return null;
    }
    if (parent instanceof AdwExpanderRow) {
        if (slot === undefined) return { views: [...parent.rows] };
        if (slot === 'prefix') return { exact: parent.prefix };
        if (slot === 'suffix') return { exact: parent.suffix };
        return null;
    }
    if (parent instanceof AdwActionRow) {
        if (slot === 'prefix') return { exact: parent.prefix };
        if (slot === undefined || slot === 'suffix') return { exact: parent.suffix };
        return null;
    }
    if (parent instanceof AdwCarousel) return slot === undefined ? { views: [...parent.pages] } : null;
    if (parent instanceof AdwNavigationView) return slot === undefined ? { views: [...parent.pages] } : null;
    if (parent instanceof AdwSplitViewBase) {
        if (slot === 'sidebar') return { exact: parent.sidebar };
        if (slot === undefined || slot === 'content') return { exact: parent.content };
        return null;
    }
    if (parent instanceof AdwBottomSheet) {
        if (slot === 'sheet') return { exact: parent.sheet };
        if (slot === undefined || slot === 'content') return { exact: parent.content };
        return null;
    }
    if (parent instanceof AdwPreferencesDialog) {
        return slot === undefined ? { views: childrenOf(parent.body) } : null;
    }
    if (parent instanceof AdwPreferencesPage) return slot === undefined ? { views: childrenOf(parent.groups) } : null;
    // A plain NativeScript layout — `StackLayout`, and `AdwWrapBox`, whose
    // `_addChildFromBuilder` deliberately ends at its own `addChild`.
    if (parent instanceof LayoutBase) return slot === undefined ? { views: childrenOf(parent) } : null;
    return null;
}

/** The direct children of a box, in order. */
function childrenOf(host: View): View[] {
    const out: View[] = [];
    host.eachChildView((child) => {
        out.push(child);
        return true;
    });
    return out;
}

/**
 * `class` in a template is NativeScript's CSS class attribute, which the runtime
 * keeps on `className`. Every other attribute is read back under its own name.
 */
const readBack = (view: View, name: string): unknown =>
    name === 'class'
        ? (view as unknown as { className?: string }).className
        : (view as unknown as Record<string, unknown>)[name];

const describeValue = (value: unknown): string => `${typeof value} ${JSON.stringify(value) ?? String(value)}`;

/** Walk one declared node against the view the Builder actually made. */
async function assertNode(expect: ExpectNode, view: View, label: string): Promise<void> {
    const Class = ELEMENT_CLASSES[expect.tag];
    await it(`${label}: is ${expect.tag}`, () => {
        if (Class === undefined) throw new Error(`no class registered for <${expect.tag}>`);
        if (!(view instanceof Class)) throw new Error(`built a ${view.constructor?.name ?? '?'}`);
    });

    for (const [name, wanted] of Object.entries(expect.props ?? {})) {
        await it(`${label}: ${name} reached the widget`, () => {
            const actual = readBack(view, name);
            if (actual !== wanted) {
                throw new Error(`read back ${describeValue(actual)}, template declares ${describeValue(wanted)}`);
            }
        });
    }

    for (const child of expect.children ?? []) {
        const where = child.slot === undefined ? 'the default slot' : `slot "${child.slot}"`;
        const placement = placementOf(view, child.slot);
        const childLabel = `${label} > ${child.tag}`;
        if (placement === null) {
            await it(`${childLabel}: ${where} is readable`, () => {
                throw new Error(`<${expect.tag}> exposes no accessor for ${where} — the probe cannot judge it`);
            });
            continue;
        }

        let found: View | null = null;
        if (placement.exact !== undefined) {
            found = placement.exact;
            await it(`${childLabel}: ${where} holds it`, () => {
                if (found === null) throw new Error(`<${expect.tag}>'s ${where} is empty`);
            });
        } else {
            const Wanted = ELEMENT_CLASSES[child.tag];
            // The FIRST unclaimed view of the wanted class. Claiming matters because a
            // template may declare several children of one class in one place — six
            // pill buttons in a wrap box — and "one of them exists" is not what it says.
            found =
                (placement.views ?? []).find((c) => Wanted !== undefined && c instanceof Wanted && !claimed.has(c)) ??
                null;
            if (found !== null) claimed.add(found);
            await it(`${childLabel}: ${where} holds it`, () => {
                if (found === null) throw new Error(`<${expect.tag}>'s ${where} has no unclaimed ${child.tag}`);
            });
        }
        if (found === null) continue;
        await assertNode(child, found, childLabel);
    }
}

/** The views already matched by a declared child, so no two declarations share one. */
let claimed = new Set<View>();

export async function onNavigatingTo(args: NavigatedData): Promise<void> {
    const page = args.object as Page;
    const host = page.getViewById<ContentView>('host');
    const verdict = page.getViewById<Label>('verdict');

    begin(RUN_ID);

    for (const entry of EXPECTED) {
        claimed = new Set<View>();
        await describe(entry.widget, async () => {
            let root: View | null = null;
            await it(`${entry.view}.xml: inflates`, () => {
                root = Builder.load({ path: '~/views', name: entry.view }) as View;
                if (!root) throw new Error('Builder.load returned nothing');
            });
            if (root === null) return;
            // Mounted, so the widget's own layout-time work runs against a real
            // parent rather than against nothing.
            if (host) host.content = root;
            await assertNode(entry.root, root, entry.widget);
        });
    }

    const result = summary(RUN_ID);
    if (verdict) {
        verdict.text = `${result.failed === 0 ? 'PASS' : 'FAIL'} ${result.passed}/${result.total}`;
    }
}
