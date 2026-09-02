/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwViewStack` on GTK — the real `Adw.ViewStack`. (On the pragma, see `bin.gtk.tsx`.)
//
// `ViewStackState` IS NOT USED HERE, for the reason `clamp.gtk.tsx` gives about
// `clampAllocate`: the core's port of the selection guards is for a renderer with no
// libadwaita, and this half has the original. What the core still owns on BOTH paths is
// the page RECORD — `AdwViewStackPageSpec`'s eight fields are the eight properties set
// below, in the same order and with the same defaults.
//
// THE NAME TRAVELS AS `slot` AND THE OTHER SEVEN PROPERTIES DO NOT TRAVEL AT ALL, which
// is what `useViewStackPageProperties` exists for. gtk-host's `keyed` policy calls
// `add_titled(child, name, title)` and reads the name from `child.layout?.name ??
// child.slot` (`policies.ts`) — `slot` is the spelling this host's React surface types,
// since `layout` is not one of the per-element attributes `ReactWidgetAttributes`
// declares. Everything else a page carries lives on `Adw.ViewStackPage`, a GObject the
// stack hands back from `get_page (child)` — NOT a widget, so it can be neither a JSX
// child nor a prop of one. The effect below is the only way to reach it, and it is why
// `AdwViewStackPageProps` is a prop object rather than a component.
//
// THE TITLE IS WRITTEN TWICE ON PURPOSE. `add_titled` receives the NAME as the title
// (the policy's `title ?? name ?? ''` fallback), and the effect then writes the authored
// one. An omitted `title` therefore settles on the name — which is exactly
// `resolvePageTitle`'s deviation from C, so both halves of this package answer alike
// where libadwaita alone would leave the title NULL and draw no label.

import type Adw from 'gi://Adw?version=1';
import { useEffect, useState, type ReactElement } from 'react';

import type { AdwViewStackPageProps, AdwViewStackProps } from '../props.js';

/**
 * The page bodies, as children of an `<adw-view-stack>`.
 *
 * Exported because `view-switcher.gtk.tsx` builds the same stack; `parity.spec.ts`
 * allows a platform-only export beside the widget, and the second copy is where a
 * `slot`-versus-`layout` decision would drift.
 *
 * Each body gets its own `GtkBox` rather than being handed to `add_titled` directly:
 * `child` is an arbitrary `ReactNode` with nothing to write a `slot` on, the same wall
 * `header-bar.gtk.tsx` documents.
 */
export function viewStackChildren(pages: readonly AdwViewStackPageProps[]): ReactElement[] {
    return pages.map((page) => (
        <gtk-box key={page.name} slot={page.name} orientation="vertical">
            {page.child}
        </gtk-box>
    ));
}

/**
 * Write the seven `Adw.ViewStackPage` properties `add_titled` cannot carry.
 *
 * IT RUNS AFTER EVERY COMMIT, WITH NO DEPENDENCY LIST, and that is deliberate: the page
 * list is a prop array whose identity a caller has no reason to keep stable, so a
 * dependency list over its contents would be a second hand-maintained copy of the same
 * record. A redundant `g_object_set` with an unchanged value emits no `notify` and
 * nothing else, so the cost is a property read per page per commit.
 *
 * AN OMITTED PROP IS LEFT ALONE rather than written as libadwaita's default — the rule
 * `clamp.gtk.tsx` states — so the installed libadwaita stays the authority for its own
 * defaults and a drift against `@gjsify/adwaita-core`'s transcription of them is visible
 * instead of silent.
 */
export function useViewStackPageProperties(stack: Adw.ViewStack | null, pages: readonly AdwViewStackPageProps[]): void {
    useEffect(() => {
        if (stack === null) return;
        for (const page of pages) {
            const child = stack.get_child_by_name(page.name);
            // A page whose body has not been adopted yet is not an error: the effect
            // runs again on the commit that adopts it.
            if (child === null) continue;
            const stackPage = stack.get_page(child);
            if (page.title !== undefined) stackPage.title = page.title;
            if (page.iconName !== undefined) stackPage.iconName = page.iconName;
            if (page.visible !== undefined) stackPage.visible = page.visible;
            if (page.badgeNumber !== undefined) stackPage.badgeNumber = page.badgeNumber;
            if (page.needsAttention !== undefined) stackPage.needsAttention = page.needsAttention;
            if (page.useUnderline !== undefined) stackPage.useUnderline = page.useUnderline;
        }
    });
}

/**
 * The `notify::visible-child` handler both stack-owning components install.
 *
 * IT REPORTS NOTHING UNTIL THE WIDGET IS READABLE. libadwaita's auto-pick notifies from
 * inside `adw_view_stack_add_titled` — child insertion is deliberately OUTSIDE gtk-host's
 * host-write window, so the notify is delivered — and at that moment React has not yet
 * committed the `ref`, so there is no stack to read the settled name off. Measured, the
 * inline `stack?.visibleChildName ?? ''` this replaces reported `''` at mount: a name no
 * page carries, on a callback whose whole contract is to name the page that is showing.
 * The React Native half reports nothing there, because its subscription is installed in
 * an effect after the pages are filled in.
 *
 * A change the CALLER made does not come back through here either — gtk-host drops the
 * notify raised inside its own property write, the same rule `AdwExpanderRowProps`
 * records for `onNotifyExpanded`. That one IS a divergence from the React Native half,
 * which re-applies `visibleChildName` through `selectName` and reports what it settled
 * on; the README names it. What both halves report is a change the USER made.
 */
export function visibleChildNotifier(
    stack: Adw.ViewStack | null,
    notify: ((name: string) => void) | undefined,
): (() => void) | undefined {
    if (notify === undefined) return undefined;
    return () => {
        if (stack === null) return;
        notify(stack.visibleChildName ?? '');
    };
}

/** {@link import('./view-stack.js').AdwViewStack} on GTK. */
export function AdwViewStack({
    pages,
    visibleChildName,
    onNotifyVisibleChild,
}: AdwViewStackProps): ReactElement | null {
    // A `useState` callback ref rather than a `useRef`: `view-switcher.gtk.tsx` needs
    // the same widget as a PROP VALUE, which only a render-visible binding can be, and
    // the two files stay one shape.
    const [stack, setStack] = useState<Adw.ViewStack | null>(null);
    useViewStackPageProperties(stack, pages ?? []);

    return (
        <adw-view-stack
            ref={setStack}
            visible-child-name={visibleChildName}
            onNotifyVisibleChild={visibleChildNotifier(stack, onNotifyVisibleChild)}
        >
            {viewStackChildren(pages ?? [])}
        </adw-view-stack>
    );
}
