// Tab stop and Enter/Space activation for the rows that libadwaita makes activatable.
//
// THE INCIDENT
//
// Measured in Firefox on an `<adw-preferences-group>` holding an activatable
// `<adw-action-row>`, an `<adw-button-row>` and an `<adw-expander-row>`: Tab reached NONE
// of them. Every one reported `tabIndex` `-1` and `role` `null` while all three activated
// on click, so the whole group was operable by mouse and invisible to a keyboard. The only
// things Tab did reach inside a group were the NATIVE controls a row happens to contain —
// `<adw-switch-row>`'s bare checkbox and `<adw-combo-row>`'s `<select>` — i.e. the row was
// never the thing that took focus, even where upstream says it is.
//
// GTK gives this free and the web renderer does not inherit it: every one of these extends
// `GtkListBoxRow`, which is focusable by construction and activates on Enter and Space.
//
// WHICH ROWS, AND WHY EACH
//
// Derived from the C, not chosen — a row that is a tab stop it should not be turns every
// static label into a stop, and one that is not becomes unreachable:
//
//   - `<adw-action-row>` only while `activatable`. A plain row is a label.
//   - `<adw-button-row>` always: `adw-button-row.c:31` says "AdwButtonRow is always
//     activatable", and the upstream template hardcodes it.
//   - `<adw-expander-row>` always, on its HEADER — `adw_expander_row_grab_focus`
//     (adw-expander-row.c:123) forwards focus to `priv->action_row`, so the header row is
//     the focus target and the disclosure control at once.
//   - `<adw-switch-row>` on the ROW, and its slider stops being a tab stop:
//     `adw_switch_row_init` sets `gtk_widget_set_can_focus (self->slider, FALSE)`
//     (adw-switch-row.c:159) and `gtk_list_box_row_set_activatable (…, TRUE)` (:160).
//
// `<adw-combo-row>` is deliberately NOT here. Its control is a native `<select>` stretched
// over the row: already a tab stop, already a combobox to the accessibility tree, already
// arrow-navigable, and already `disabled` at one option or fewer — which is exactly
// `gtk_list_box_row_set_activatable (…, n_items > 1)` (adw-combo-row.c:194) without a line
// of our own. Making the row the tab stop would take focus off it and put a SECOND
// combobox in the tree.
//
// The key set is `GtkListBoxRow`'s: Enter and Space. Space is prevented because the
// browser would otherwise scroll the page under the row the user just activated.

/** What a row needs to become the keyboard's idea of one activatable thing. */
export interface AdwRowActivationInit {
    /** The element that becomes the tab stop and receives the keys. */
    row: HTMLElement;
    /** Re-read on every {@link AdwRowActivation.sync}: is the row activatable right now? */
    activatable: () => boolean;
    /**
     * What Enter and Space do. Defaults to `row.click()` so a row keeps ONE activation
     * path — the click handler it already has — rather than growing a second one that can
     * drift from it.
     */
    activate?: () => void;
}

export interface AdwRowActivation {
    /** Re-derive the tab stop after anything that can change `activatable()`. */
    sync(): void;
}

/**
 * Make `row` a tab stop while it is activatable, and activate it on Enter and Space.
 *
 * The listener is the element's OWN and is bound once, without teardown: it survives a
 * re-parent and is collected with the element, so there is nothing here for
 * `check-adwaita-connect-rebind.mjs` to hold. Only bindings that reach outside the element
 * need releasing and re-arming.
 */
export function attachRowActivation(init: AdwRowActivationInit): AdwRowActivation {
    const { row, activatable } = init;
    const activate = init.activate ?? (() => row.click());

    row.addEventListener('keydown', (event: KeyboardEvent) => {
        // A child control owns its own keys: a `<select>`, an entry's `<input>` and a
        // suffix button all use Enter or Space for something else, and swallowing them
        // here would break the control to activate the row it sits in.
        if (event.target !== row) return;
        if (!activatable()) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate();
    });

    const sync = () => {
        // `removeAttribute`, not `tabIndex = -1`: a row that is not activatable is not
        // focusable at all upstream, and writing `-1` would make every static label
        // programmatically focusable instead.
        if (activatable()) row.tabIndex = 0;
        else row.removeAttribute('tabindex');
    };
    sync();
    return { sync };
}
