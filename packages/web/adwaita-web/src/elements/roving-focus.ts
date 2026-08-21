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
// The SHAPE — Tab enters and leaves at the active item, arrows travel inside — is what
// the C establishes:
//   - `refs/libadwaita/src/adw-toggle-group.c:1045` (`adw_toggle_group_focus`) — Tab
//     forward/backward is PROPAGATED, i.e. focus leaves the group, and every other
//     direction goes to `adw_widget_focus_child`, i.e. moves within it.
//     `AdwInlineViewSwitcher` builds exactly this widget with
//     `accessible-role: GTK_ACCESSIBLE_ROLE_TAB_LIST` (adw-inline-view-switcher.c:702).
//   - `refs/libadwaita/src/adw-sidebar.c:2168` — `gtk_list_box_set_tab_behavior (…,
//     GTK_LIST_TAB_ITEM)`: Tab moves BETWEEN rows and their contents, i.e. the list is one
//     stop from outside, which is the roving tabindex spelled in GTK's own vocabulary.
//
// That SELECTION follows focus is grounded for the sidebar and conventional for the two
// tab lists, and the difference is worth keeping straight:
//   - `refs/libadwaita/src/adw-sidebar.c:2167` — the sidebar's list is a `GtkListBox` in
//     `GTK_SELECTION_SINGLE`, where moving the cursor with an unmodified arrow key selects
//     the row it lands on. The WAI-ARIA listbox practice for a single-select listbox says
//     the same.
//   - `refs/libadwaita/src/adw-view-switcher.c:467` and `adw-view-switcher-button.c:337`
//     declare `TAB_LIST` / `TAB`, but nothing in `AdwToggleGroup` changes `active` on
//     focus: `set_active_toggle` is reached only from `toggle_active_cb`
//     (adw-toggle-group.c:818), which fires on a real toggle. So GTK arrows those two
//     WITHOUT switching the page — manual activation. Selection-follows-focus here is the
//     WAI-ARIA tabs AUTOMATIC-activation pattern, chosen for consistency with
//     `<adw-tab-view>`, which already behaves that way. Not a claim about the C.
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
    /**
     * Select `item`. Whether the selection actually MOVED is the widget's own business:
     * focus travels with the key either way ({@link attachRovingFocus}).
     */
    select: (item: HTMLElement) => void;
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

        // Claimed even when nothing moves: an ArrowDown at the last row that fell through
        // to the browser would scroll the page out from under a user who is inside the
        // widget.
        event.preventDefault();
        const target = items[to];
        if (target === undefined || target === items[from]) return;

        // Selection is attempted, and focus moves REGARDLESS of whether it took. Gating
        // the focus move on the selection having changed put the user back in the state
        // this module exists to remove: with focus on row 0 and the selection already on
        // row 1 — reachable by setting `selected` while focus sits elsewhere — the
        // sidebar's `select` returned false for the row the arrow key targeted, so the
        // press was swallowed and focus stayed on a row the roving tabindex had taken out
        // of the Tab order. Measured in Firefox: tabIndex `[-1, 0, -1]`, two ArrowDowns,
        // `document.activeElement` unmoved both times.
        init.select(target);

        // Focus travels with the roving tabindex or the next keypress goes nowhere — the
        // rule `<adw-tab-view>` states. Plain `focus()`, deliberately, and NOT because
        // these widgets have no scroller of their own: `adw-sidebar` is `overflow-y: auto`
        // (scss/_sidebar.scss) and does. `focus()` walks every scrollable ancestor up to
        // the window, and here that is what a GtkListBox cursor move does too — the
        // enclosing scrolled window scrolls, and an outer one follows. Measured in Firefox
        // on a 4000 px page: 25 ArrowDowns moved the sidebar's own `scrollTop` 0 → 898 and
        // left `window.scrollY` at 0. `<adw-tab-view>` needs `preventScroll` for the
        // opposite reason — C only ever writes the strip's own adjustment
        // (`scroll_to_tab_full`), so a window scroll there is a divergence, and one
        // ArrowRight was measured taking the window from y=1800 to y=8367.
        init.items()[to]?.focus();
    });
}
