// Headless check/radio behaviour (ADR 0004 — headless Adwaita core).
//
// A checkbox is one boolean the host already holds, so per ADR 0004 it gets no
// core class. Only two things about the pair are non-trivial and live here:
// {@link RadioGroupState} for group exclusivity — the browser unchecks the sibling
// `<input type="radio">` but leaves the sibling `<adw-radio>` HOST's `checked`
// attribute (the published state, and what the stylesheet selects on) stale, and
// NativeScript has no exclusivity at all — and {@link resolveCheckState}, because
// indeterminate is a third state rather than a second flag.
//
// `GtkCheckButton` group semantics (`gtk_check_button_set_group`, whether a fresh
// group starts with a member active) and the exact meaning of
// `GtkCheckButton:inconsistent` are NOT modelled: they are GTK, `refs/gtk` is
// empty here and libadwaita vendors no `adw-checkbox.c`. A fresh group reports
// "nothing selected"; indeterminate is whatever the caller sets.
//
// The stylesheet IS vendored, and {@link resolveCheckState}'s precedence is read
// off it: `check:checked` draws `check.svg` (_checks.scss:70), `radio:checked`
// draws `bullet.svg` (:76), then `check, radio { &:indeterminate { … dash.svg } }`
// (:79-81) re-declares the glyph at EQUAL specificity further down the file — so
// checked+indeterminate draws the dash. The fill is one block for both states
// (:52-60).
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_checks.scss:52-60,67-81
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/**
 * The three states a check or radio can be in. `indeterminate` paints its own
 * glyph and maps to `aria-checked="mixed"`, so it is a state and not a flag.
 */
export type AdwCheckState = 'unchecked' | 'checked' | 'indeterminate';

/**
 * Collapse the `checked` / `indeterminate` pair into the one state that paints.
 * Indeterminate wins over checked — _checks.scss:79-81 re-declares the glyph
 * after both `:checked` rules, at equal specificity.
 */
export function resolveCheckState(checked: boolean, indeterminate: boolean): AdwCheckState {
    if (indeterminate) return 'indeterminate';
    return checked ? 'checked' : 'unchecked';
}

/** Payload of a {@link RadioGroupState} change — both halves of one exclusive move. */
export interface RadioGroupChange {
    name: string;
    selected: string;
    /** The value that just lost the selection, or `null` when the group was empty. */
    deselected: string | null;
}

/** Subscriber for {@link RadioGroupState} changes. */
export type RadioGroupListener = (change: RadioGroupChange) => void;

/**
 * Which value is selected in each named radio group.
 *
 * One registry over many groups keyed by name, because a radio knows its own group
 * NAME and not its siblings, exactly as `<input type="radio" name="…">` does. The
 * registry is as global as its host — one instance per document in
 * `@gjsify/adwaita-web`.
 *
 * {@link select} notifies once per move carrying both halves, so a renderer
 * repaints the loser too. Re-selecting the held value is a no-op: clicking a
 * checked radio twice must not fire twice, and must never leave the group empty
 * (HTML radios cannot be unchecked by clicking).
 */
export class RadioGroupState {
    private readonly _selected = new Map<string, string>();
    private readonly _listeners = new Set<RadioGroupListener>();

    /** Subscribe to selection changes in ANY group. Returns an unsubscribe function. */
    subscribe(listener: RadioGroupListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    private _emit(change: RadioGroupChange): void {
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
        for (const listener of [...this._listeners]) listener(change);
    }

    /** The value selected in `name`, or `null` when nothing is selected there. */
    selected(name: string): string | null {
        return this._selected.get(name) ?? null;
    }

    /**
     * Select `value` in group `name`, deselecting whatever was selected there.
     *
     * Returns whether the selection actually moved; a no-op notifies nothing.
     */
    select(name: string, value: string): boolean {
        const previous = this._selected.get(name);
        if (previous === value) return false;
        this._selected.set(name, value);
        this._emit({ name, selected: value, deselected: previous ?? null });
        return true;
    }
}
