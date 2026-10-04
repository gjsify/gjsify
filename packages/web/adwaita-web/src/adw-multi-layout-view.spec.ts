// DOM-level tests for `<adw-multi-layout-view>` and the `<adw-layout-slot>` holes its
// layouts are built from.
//
// The behaviour under test is the pairing the C describes in one paragraph: every child
// has an ID, every layout has slots with IDs, and switching layouts re-inserts each
// child into the slot of the SAME id — plus the three rules around it that are easy to
// miss. `adw_multi_layout_view_add_layout` makes the FIRST layout current rather than
// waiting for a `layout-name` (:553); a `layout-name` no layout carries is a
// `g_critical` that leaves the current layout alone (:520); and `visible` is bound ONE
// way, child to slot, so hiding the child hides the hole (:151).
import { describe, expect, it } from '@gjsify/unit';

import type { AdwLayoutSlot } from './elements/adw-layout-slot.js';
import type { AdwMultiLayoutView } from './elements/adw-multi-layout-view.js';

/** Two frame callbacks — where a `ResizeObserver` delivery and a MutationObserver land. */
function settle(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

/**
 * Two layouts over the same two children, as the C's own documentation spells it: a
 * secondary pane that is a sidebar in one and the content in the other.
 */
function markup(): string {
    return (
        '<adw-multi-layout-view layout-name="sidebar">' +
        '<adw-navigation-split-view name="sidebar">' +
        '<adw-layout-slot id="secondary" slot="sidebar"></adw-layout-slot>' +
        '<adw-layout-slot id="primary" slot="content"></adw-layout-slot>' +
        '</adw-navigation-split-view>' +
        '<adw-navigation-split-view name="stacked" collapsed>' +
        '<adw-layout-slot id="secondary" slot="content"></adw-layout-slot>' +
        '<adw-layout-slot id="primary" slot="content"></adw-layout-slot>' +
        '</adw-navigation-split-view>' +
        '<adw-navigation-page slot="primary" tag="inbox" title="Inbox"></adw-navigation-page>' +
        '<adw-navigation-page slot="secondary" tag="about" title="About"></adw-navigation-page>' +
        '</adw-multi-layout-view>'
    );
}

function mount(body: string): { view: AdwMultiLayoutView; host: HTMLElement } {
    const host = document.createElement('div');
    host.style.width = '800px';
    host.style.height = '600px';
    document.body.appendChild(host);
    host.innerHTML = body;
    return { view: host.querySelector('adw-multi-layout-view') as AdwMultiLayoutView, host };
}

/** Where each id's child landed in the mounted layout, `id -> slot id`. */
function placement(view: AdwMultiLayoutView): string[] {
    const found: string[] = [];
    for (const slot of view.querySelectorAll('adw-layout-slot')) {
        for (const child of slot.children) {
            found.push(`${slot.id}←${child.getAttribute('slot')}`);
        }
    }
    return found.sort();
}

export const AdwMultiLayoutViewTest = async () => {
    await describe('<adw-multi-layout-view> switching layouts', async () => {
        await it('starts on the layout `layout-name` names', () => {
            const { view, host } = mount(markup());
            const report = `layout:${view.layoutName} parent:${view.layout?.getAttribute('name')}`;
            host.remove();
            expect(report).toBe('layout:sidebar parent:sidebar');
        });

        await it('moves each child into the slot of the SAME id', () => {
            const { view, host } = mount(markup());
            const before = placement(view).join(' ');
            view.layoutName = 'stacked';
            const after = placement(view).join(' ');
            host.remove();
            expect(`sidebar:${before} → stacked:${after}`).toBe(
                'sidebar:primary←primary secondary←secondary → stacked:primary←primary secondary←secondary',
            );
        });

        await it('notifies BOTH properties on a switch, as `set_layout` does', () => {
            const { view, host } = mount(markup());
            const log: string[] = [];
            view.addEventListener('notify::layout', () => log.push(`layout:${view.layoutName}`));
            view.addEventListener('notify::layout-name', () => log.push(`name:${view.layoutName}`));
            view.layoutName = 'stacked';
            view.layoutName = 'stacked';
            host.remove();
            // Once for the change and NOT for the repeat: `set_layout` returns early when
            // the layout is unchanged (adw-multi-layout-view.c:255).
            expect(log.join(' | ')).toBe('layout:stacked | name:stacked');
        });

        await it('leaves the current layout alone for a name no layout carries', () => {
            const { view, host } = mount(markup());
            view.layoutName = 'nowhere';
            const report = `layout:${view.layoutName} mounted:${view.layout?.getAttribute('name')}`;
            host.remove();
            expect(report).toBe('layout:sidebar mounted:sidebar');
        });

        await it('is driven by a breakpoint through the bin, and keeps the layout when it unwinds', async () => {
            const host = document.createElement('div');
            host.style.width = '900px';
            host.style.height = '600px';
            document.body.appendChild(host);
            host.innerHTML =
                '<adw-breakpoint-bin breakpoints=\'[{"condition":"max-width: 720px","setters":' +
                '[{"target":"#view","property":"layout-name","value":"stacked"}]}]\'>' +
                '<adw-multi-layout-view id="view">' +
                '<adw-navigation-split-view name="sidebar">' +
                '<adw-layout-slot id="primary" slot="content"></adw-layout-slot>' +
                '</adw-navigation-split-view>' +
                '<adw-navigation-split-view name="stacked" collapsed>' +
                '<adw-layout-slot id="primary" slot="content"></adw-layout-slot>' +
                '</adw-navigation-split-view>' +
                '<adw-navigation-page slot="primary" title="Inbox"></adw-navigation-page>' +
                '</adw-multi-layout-view>' +
                '</adw-breakpoint-bin>';
            const view = host.querySelector('adw-multi-layout-view') as AdwMultiLayoutView;
            await settle();
            const wide = view.layoutName;
            host.style.width = '500px';
            await settle();
            const narrow = view.layoutName;
            host.style.width = '900px';
            await settle();
            const wideAgain = view.layoutName;
            host.remove();
            // The restore writes `layout-name` back to what it was — which was NOTHING,
            // because the markup declared no name — and `set_layout_name(NULL)` RETURNS
            // without switching (adw-multi-layout-view.c:514). So the view stays on the
            // layout the breakpoint put it on, exactly as it does on GTK. Restoring the
            // ORIGINAL is right and it is not the same as reverting the switch.
            expect(`900:${wide} → 500:${narrow} → 900:${wideAgain}`).toBe('900:sidebar → 500:stacked → 900:stacked');
        });
    });

    await describe('<adw-multi-layout-view> children and slots', async () => {
        await it('binds the slot’s visibility to the child’s, one way', async () => {
            const { view, host } = mount(markup());
            const child = view.getChild('primary');
            const slot = view.querySelector('adw-layout-slot#primary') as HTMLElement;
            const before = slot.hidden;
            child?.setAttribute('hidden', '');
            // The binding is a MutationObserver, so it lands a microtask later.
            await settle();
            const hiddenChild = slot.hidden;
            (child as HTMLElement).hidden = false;
            await settle();
            const shownAgain = slot.hidden;
            host.remove();
            expect(`start:${before} child hidden:${hiddenChild} child shown:${shownAgain}`).toBe(
                'start:false child hidden:true child shown:false',
            );
        });

        await it('reports a child by id and a layout by name', () => {
            const { view, host } = mount(markup());
            const report = [
                `child:${view.getChild('secondary')?.getAttribute('tag')}`,
                `missing:${view.getChild('nowhere') === null}`,
                `layout:${view.getLayoutByName('stacked')?.getAttribute('name')}`,
                `layoutless:${view.getLayoutByName('nowhere') === null}`,
            ].join(' | ');
            host.remove();
            expect(report).toBe('child:about | missing:true | layout:stacked | layoutless:true');
        });

        await it('picks a child appended after connect', async () => {
            const { view, host } = mount(
                '<adw-multi-layout-view layout-name="sidebar">' +
                    '<adw-navigation-split-view name="sidebar">' +
                    '<adw-layout-slot id="late" slot="content"></adw-layout-slot>' +
                    '</adw-navigation-split-view>' +
                    '</adw-multi-layout-view>',
            );
            const child = document.createElement('adw-navigation-page');
            child.setAttribute('slot', 'late');
            view.appendChild(child);
            await settle();
            const slot = view.querySelector('adw-layout-slot#late') as HTMLElement;
            const landed = slot.contains(child);
            host.remove();
            expect(`late child landed:${landed}`).toBe('late child landed:true');
        });

        await it('keeps the child in place when the layout has no slot for its id', () => {
            const { view, host } = mount(
                '<adw-multi-layout-view layout-name="sidebar">' +
                    '<adw-navigation-split-view name="sidebar">' +
                    '<adw-layout-slot id="primary" slot="content"></adw-layout-slot>' +
                    '</adw-navigation-split-view>' +
                    '<adw-navigation-page slot="orphan" title="Nowhere"></adw-navigation-page>' +
                    '</adw-multi-layout-view>',
            );
            // `parent_child` returns on an unmatched id (adw-multi-layout-view.c:143), and
            // `unparent_child` returns on one the layout has no slot for (:175) — so the
            // child is neither inserted nor destroyed upstream: it rides out with the
            // content and is left. Here that is a detached node, still reachable through
            // `getChild`, and C is silent about it, so this port is too.
            const orphan = view.getChild('orphan');
            const parent = orphan?.parentElement?.localName ?? 'none';
            host.remove();
            expect(`orphan parent:${parent} known:${view.getChild('orphan') !== null}`).toBe(
                'orphan parent:none known:true',
            );
        });
    });

    await describe('<adw-layout-slot>', async () => {
        await it('has the group role and takes no box of its own', () => {
            const { view, host } = mount(markup());
            const slot = view.querySelector('adw-layout-slot') as AdwLayoutSlot;
            const report = `role:${slot.getAttribute('role')} display:${slot.style.display} id:${slot.slotId}`;
            host.remove();
            expect(report).toBe('role:group display:contents id:secondary');
        });

        await it('refuses to be built without an id, as `g_error` does', () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            host.innerHTML = '<adw-multi-layout-view><adw-layout-slot></adw-layout-slot></adw-multi-layout-view>';
            const view = host.querySelector('adw-multi-layout-view') as AdwMultiLayoutView;
            const registered = (view as unknown as { _slots: Map<string, unknown> })._slots.size;
            host.remove();
            expect(`registered:${registered}`).toBe('registered:0');
        });

        await it('is not a layout slot outside a view, so nothing claims it', () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            host.innerHTML = '<adw-layout-slot id="orphan"></adw-layout-slot>';
            const slot = host.querySelector('adw-layout-slot') as AdwLayoutSlot;
            const report = `id:${slot.slotId} parent:${slot.parentElement?.localName}`;
            host.remove();
            expect(report).toBe('id:orphan parent:div');
        });
    });
};
