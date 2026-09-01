// Popover dismissal + keyboard navigation — the portable half of a popover: the
// dismissal/focus state machine ("is it open", "which item does this key move to")
// plus the surface metrics, so a renderer does not hardcode its own radius.
//
// NO POSITIONER HERE, on purpose: placement is pure CSS (`position: absolute; top:
// calc(100% + 6px)`), so there is no flip logic to lift, and a core one would need a
// measured viewport rect the two runtimes do not hand over the same way (DOM
// `getBoundingClientRect` vs NativeScript `getLocationOnScreen`) — ADR 0004's "resist
// over-abstracting" clause. The placement DECISION is shared already:
// {@link menuButtonPopupDirection} in `./split-button.js`.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_popovers.scss (popover > contents)
// Reference: refs/libadwaita/src/stylesheet/_common.scss ($menu_radius, $popover_radius)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/**
 * Padding inside a popover's content box, in px — `popover > contents { padding: 8px }`.
 *
 * NOT what a MENU popover uses: `popover.menu > contents` re-declares `padding: 0` and
 * moves the inset onto the item box as `$menu_margin` (6px) — two element selectors
 * plus a class, so it wins over the plain `popover > contents`. Both numbers are real;
 * the `.menu` class decides which applies. See {@link POPOVER_MENU_PADDING}.
 */
export const POPOVER_PADDING = 8;

/**
 * Padding around the item box of a MENU popover, in px — `$menu_margin`, applied by
 * `popover.menu > contents > … > stack > box` after that same rule zeroes the contents
 * padding.
 */
export const POPOVER_MENU_PADDING = 6;

/**
 * Corner radius of a popover surface, in px — `$popover_radius`, defined as
 * `$menu_radius + 6` = `9 + 6`. Not `$card_radius` (12px) and not `$button_radius`
 * (9px), the two values a hand-rolled popover reaches for.
 */
export const POPOVER_RADIUS = 15;

/** Corner radius of a menu item row, in px — `$menu_radius`, applied by `modelbutton`. */
export const POPOVER_ITEM_RADIUS = 9;

/** Payload of a {@link PopoverState} change. */
export interface PopoverStateChange {
    /** Whether the popover is now open. */
    open: boolean;
    /**
     * True for a user gesture ({@link PopoverState.toggle} — the anchor was
     * clicked — or {@link PopoverState.dismiss} — an outside click or Escape);
     * false for a programmatic {@link PopoverState.popup} / {@link PopoverState.popdown}.
     */
    interactive: boolean;
}

/** Subscriber for {@link PopoverState} changes. */
export type PopoverStateListener = (change: PopoverStateChange) => void;

/**
 * The open/closed state of a popover, with the programmatic-vs-interactive distinction
 * the other core states carry ({@link ComboState}, {@link SpinState},
 * {@link SplitButtonState}): a renderer re-emits `notify::*` only for the interactive
 * changes, so an application calling `popup()` does not look like a user click.
 *
 * NAMING: an `open` GETTER means the mutators cannot also be `open()`/`close()`, so
 * they take GTK's vocabulary ({@link popup} / {@link popdown}, after
 * `adw_split_button_popup()` / `..._popdown()`) — which is what `<gtk-popover>`
 * exposes too.
 *
 * Idempotent: setting the current value again is a no-op and notifies nobody.
 */
export class PopoverState {
    private _open = false;
    private readonly _listeners = new Set<PopoverStateListener>();

    /** Subscribe to open-state changes. Returns an unsubscribe function. */
    subscribe(listener: PopoverStateListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    private _emit(interactive: boolean): void {
        const change: PopoverStateChange = { open: this._open, interactive };
        // Snapshot so a listener that unsubscribes mid-fan-out can't skip another.
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
        for (const listener of [...this._listeners]) listener(change);
    }

    private _setOpen(open: boolean, interactive: boolean): boolean {
        if (open === this._open) return false;
        this._open = open;
        this._emit(interactive);
        return true;
    }

    /** Whether the popover is showing. */
    get open(): boolean {
        return this._open;
    }

    /** Show the popover programmatically. Returns whether it changed. */
    popup(): boolean {
        return this._setOpen(true, false);
    }

    /** Hide the popover programmatically. Returns whether it changed. */
    popdown(): boolean {
        return this._setOpen(false, false);
    }

    /** The anchor was activated by the user; flips open/closed. Returns whether it changed. */
    toggle(): boolean {
        return this._setOpen(!this._open, true);
    }

    /**
     * The user dismissed the popover — an outside click, or Escape. Distinct from
     * {@link popdown} only in the `interactive` flag: a dismissal is a gesture, a
     * `popdown()` call is not.
     */
    dismiss(): boolean {
        return this._setOpen(false, true);
    }
}

/** What a key press asks the renderer to do. */
export type PopoverKeyAction =
    /** Dismiss the popover and return focus to the anchor. */
    | 'close'
    /** Move focus to `index`. */
    | 'focus'
    /** Activate the item at `index` (and let the renderer close + notify). */
    | 'activate'
    /** Not ours — let the key through to whatever owns it. */
    | 'none';

/** The list state a key press is resolved against. */
export interface PopoverKeyContext {
    /**
     * How many items are navigable RIGHT NOW. For a filtered list (the drop-down's
     * search) that is the VISIBLE count, not the model length — filtering is the
     * renderer's business, and this function only ever sees the surviving list.
     */
    itemCount: number;
    /** Focused item's index in that same list; `-1` when focus is elsewhere (the search entry, the surface). */
    currentIndex: number;
    /**
     * Whether a search entry sits atop the popover. It matters only while
     * `currentIndex` is `-1` (i.e. the entry has focus and owns the caret) — see
     * {@link resolvePopoverKey}.
     */
    hasSearch?: boolean;
}

/** {@link resolvePopoverKey}'s answer. */
export interface PopoverKeyResolution {
    action: PopoverKeyAction;
    /** Item index for `focus`/`activate`; `-1` for `close` and `none`. */
    index: number;
}

/**
 * Resolve a key press inside an open popover to a focus/activation move — the
 * `(current ± 1 + n) % n` arithmetic, with three decisions a reader cannot see in it:
 *
 * - **`ArrowUp` from no focus** goes to `n - 1`, not to `(-1 - 1 + n) % n` = `n - 2`.
 *   Entering the list at the END is the ARIA menu/listbox convention and the mirror of
 *   ArrowDown → `0`; the second-to-last item is what the naive modulo gives.
 * - **`Enter`/`Space`** report `'activate'` rather than leaning on the browser
 *   activating a focused `<button>` natively: a renderer that calls
 *   `preventDefault()` then `.click()` activates exactly once, where the native path
 *   makes the behaviour depend on the item's tag.
 * - **`Home`/`End`** are `'none'` while `hasSearch && currentIndex < 0`, so Home moves
 *   the caret to the start of the query the user is typing.
 *
 * NOT VERIFIABLE IN THIS TREE: `refs/gtk` is empty and libadwaita vendors no
 * `adw-popover.c`, so `GtkPopover`'s own `position`/`autohide`/`has-arrow` semantics
 * and GTK's keynav from an unfocused list cannot be read from source. The wrap
 * arithmetic is reconciled against the ARIA patterns, not a claim about GTK's C.
 *
 * `Tab` is deliberately unhandled (`'none'`): GTK popovers trap focus, and doing that
 * in the DOM is a renderer concern (`inert`, a focus sentinel) with no portable
 * arithmetic to share.
 */
export function resolvePopoverKey(key: string, context: PopoverKeyContext): PopoverKeyResolution {
    // Escape closes even an empty popover — it is the escape hatch, not a move.
    if (key === 'Escape') return { action: 'close', index: -1 };

    const count = Number.isFinite(context.itemCount) ? Math.max(0, Math.trunc(context.itemCount)) : 0;
    if (count === 0) return { action: 'none', index: -1 };

    const raw = context.currentIndex;
    const current = Number.isFinite(raw) && raw >= 0 && raw < count ? Math.trunc(raw) : -1;
    // With focus in the search entry, the caret keys belong to the entry.
    const caretInSearch = context.hasSearch === true && current < 0;

    switch (key) {
        case 'ArrowDown':
            return { action: 'focus', index: current < 0 ? 0 : (current + 1) % count };
        case 'ArrowUp':
            return { action: 'focus', index: current < 0 ? count - 1 : (current - 1 + count) % count };
        case 'Home':
            return caretInSearch ? { action: 'none', index: -1 } : { action: 'focus', index: 0 };
        case 'End':
            return caretInSearch ? { action: 'none', index: -1 } : { action: 'focus', index: count - 1 };
        case 'Enter':
        case ' ':
            return current < 0 ? { action: 'none', index: -1 } : { action: 'activate', index: current };
        default:
            return { action: 'none', index: -1 };
    }
}
