// Arrow-key movement for the composites that hand out a roving tabindex.
//
// THE INCIDENT
//
// `<adw-view-switcher>`, `<adw-view-switcher-bar>`, `<adw-inline-view-switcher>` and
// `<adw-sidebar>` each declared `role="tablist"` or `role="listbox"`, then set
// `tabIndex = -1` on every item except the selected one — the roving tabindex — and
// registered no keydown listener at all. Measured in Firefox: three items, tabIndex
// `[0, -1, -1]`, and ArrowRight, ArrowLeft, ArrowDown, Home and End all left
// `document.activeElement` exactly where it was. The two unselected items were reachable
// by NO key: the roving tabindex had taken them out of the Tab order and nothing had put
// them back. That is strictly worse than the plain tab stops they replaced — the widget
// went from clumsy to unusable by adding an accessibility feature half of it.
//
// The rule this module implements is the one `<adw-tab-view>` already states in its own
// header: "the roving tabindex must keep moving: under `role=tablist` a frozen one leaves
// every inactive tab keyboard-unreachable". `<adw-tab-view>` keeps its own handler — it
// also owns Ctrl+Tab, Ctrl+Page-Up/Down and Alt+digit from `Adw.TabView`'s shortcut table,
// plus a strip-local scroll a shared helper has no business knowing about.
//
// WHAT THE KEYS DO, and where each behaviour comes from
//
// Arrows MOVE THE SELECTION and take focus with it, rather than moving focus alone:
//   - `refs/libadwaita/src/adw-toggle-group.c:1045` (`adw_toggle_group_focus`) — Tab
//     forward/backward is PROPAGATED, i.e. focus leaves the group, and every other
//     direction goes to `adw_widget_focus_child`, i.e. moves within it. That is the
//     roving-tabindex contract: Tab enters and leaves at the active item, arrows travel
//     inside. `AdwInlineViewSwitcher` builds exactly this widget with
//     `accessible-role: GTK_ACCESSIBLE_ROLE_TAB_LIST` (adw-inline-view-switcher.c:702).
//   - `refs/libadwaita/src/adw-sidebar.c:2167` — the sidebar's list is a `GtkListBox` in
//     `GTK_SELECTION_SINGLE`, where moving the cursor with an unmodified arrow key selects
//     the row it lands on. The WAI-ARIA listbox practice for a single-select listbox says
//     the same: selection follows focus.
//   - `refs/libadwaita/src/adw-view-switcher.c:467` and `adw-view-switcher-button.c:337`
//     declare `TAB_LIST` / `TAB`, and the WAI-ARIA tabs practice's automatic-activation
//     pattern is the one `<adw-tab-view>` already follows here.
//
// SELECTION IS NOT ACTIVATION. `<adw-sidebar>` emits `activated` — the documented way to
// reveal a split view's content pane — and an arrow key must not fire it, or every press
// navigates. `GtkListBox` splits the same two: an arrow key emits `row-selected`, and only
// Enter/Space/click emit `row-activated`. So the callback below is a SELECT, and Enter and
// Space stay the browser's own activation of the `<button>` the item already is.
//
// No wrap at the ends, following `<adw-tab-view>`, whose arrows use the non-wrapping
// `selectPreviousPage`/`selectNextPage` (the wrapping pair is Ctrl+Tab's), and GTK, whose
// `adw_widget_focus_child` stops at the last child.

/** Which axis the items are laid out along — it decides which arrow keys move. */
export type AdwRovingOrientation = 'horizontal' | 'vertical';

export interface AdwRovingFocusInit {
    /**
     * The element the listener sits on — the custom element itself, so items rebuilt at
     * any time are still covered.
     */
    host: HTMLElement;
    orientation: AdwRovingOrientation;
    /**
     * The items a key may land on, in visual order. The widget filters: a `hidden` or
     * `disabled` item is not navigable, and leaving one in would strand the user on a
     * `focus()` the browser refuses.
     */
    items: () => readonly HTMLElement[];
    /** Select `item`. @returns whether the selection actually moved. */
    select: (item: HTMLElement) => boolean;
}

/** The arrow pair that moves along each axis. */
const AXIS_KEYS: Record<AdwRovingOrientation, { previous: string; next: string }> = {
    horizontal: { previous: 'ArrowLeft', next: 'ArrowRight' },
    vertical: { previous: 'ArrowUp', next: 'ArrowDown' },
};

/**
 * Make a roving tabindex navigable: arrows step, Home/End jump, and focus travels with
 * the selection so the next keypress has somewhere to start from.
 */
export function attachRovingFocus(init: AdwRovingFocusInit): void {
    const { previous, next } = AXIS_KEYS[init.orientation];

    init.host.addEventListener('keydown', (event) => {
        // A modifier makes it someone else's shortcut: Ctrl+Home is "top of the document",
        // and `Adw.TabView`'s table is full of Ctrl/Alt combinations.
        if (event.altKey || event.ctrlKey || event.metaKey) return;

        const items = init.items();
        // `contains`, not identity: an item is a button holding an icon, a label and a
        // badge, and a key pressed while one of those is the event target still belongs
        // to the item.
        const from = items.findIndex((item) => item === event.target || item.contains(event.target as Node));
        if (from < 0) return;

        let to: number;
        switch (event.key) {
            case previous:
                to = from - 1;
                break;
            case next:
                to = from + 1;
                break;
            case 'Home':
                to = 0;
                break;
            case 'End':
                to = items.length - 1;
                break;
            default:
                return;
        }

        // Claimed even at the ends: an ArrowDown at the last row that fell through to the
        // browser would scroll the page out from under a user who is inside the widget.
        event.preventDefault();
        const target = items[to];
        if (target === undefined || target === items[from]) return;
        if (!init.select(target)) return;

        // Focus travels with the roving tabindex or the next keypress goes nowhere — the
        // rule `<adw-tab-view>` states. Plain `focus()`, deliberately: `<adw-tab-view>`
        // passes `preventScroll` because it scrolls its own strip instead, and none of
        // these widgets do, so the browser scrolling the newly focused item into view is
        // the behaviour a keyboard user needs.
        init.items()[to]?.focus();
    });
}
