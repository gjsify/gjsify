// Headless check/radio behaviour (ADR 0004 — headless Adwaita core).
//
// WHAT IS HERE, AND WHY IT IS ONLY THIS MUCH
//
// A checkbox is a styled `<input type="checkbox">` in the browser and a styled
// native view under NativeScript; neither port needs a state machine for "one
// boolean the host already holds", and ADR 0004 is explicit that a widget with
// genuinely trivial behaviour does not get a core class. So `<adw-checkbox>` has
// none. Two things about the PAIR are not trivial, and both are here:
//
//   1. {@link RadioGroupState} — group exclusivity. Selecting a member has to
//      deselect the previous one and say so ONCE, carrying both halves, or a
//      renderer cannot repaint the member that just lost the selection. The
//      browser gives exclusivity to the inner `<input type="radio">` for free
//      but stops there: it unchecks the sibling INPUT and leaves the sibling
//      `<adw-radio>` host's `checked` attribute — the published state, and what
//      the stylesheet selects on — stale. NativeScript has no exclusivity at
//      all. Both ports would otherwise invent this, differently.
//
//   2. {@link AdwCheckState} / {@link resolveCheckState} — indeterminate is a
//      THIRD state, not a second flag, and it outranks checked.
//
// WHAT IS NOT VERIFIABLE IN THIS TREE, AND IS THEREFORE NOT MODELLED
//
// `GtkCheckButton` is a GTK widget: `refs/gtk` is EMPTY here and libadwaita
// vendors no `adw-checkbox.c`, so its group semantics
// (`gtk_check_button_set_group`, whether a group starts with a member active,
// what happens when the active member leaves the group) and the exact meaning of
// `GtkCheckButton:inconsistent` are NOT verifiable in this tree. Nothing below
// guesses at them: a fresh group reports "nothing selected", and indeterminate
// is whatever the caller sets.
//
// What IS verifiable is the STYLESHEET, which libadwaita does vendor, and the
// precedence in {@link resolveCheckState} is read off it: `check:checked` draws
// `check.svg` (_checks.scss:70) and `radio:checked` draws `bullet.svg` (:76),
// then `check, radio { &:indeterminate { … dash.svg } }` (:79-81) re-declares the
// glyph at EQUAL specificity further down the file — so a control that is both
// checked and indeterminate draws the dash. Same for the fill: `&:checked,
// &:indeterminate` share one block (:52-60), so the two states are one paint
// with two glyphs.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_checks.scss:52-60,67-81
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/**
 * The three states a check or radio can be in.
 *
 * `indeterminate` is not "checked plus a flag": it paints its own glyph, and it
 * maps to a distinct a11y value (`aria-checked="mixed"`), so a renderer that
 * models the pair as two booleans has to re-derive the precedence every time it
 * needs to answer "what does this look like / sound like right now".
 */
export type AdwCheckState = 'unchecked' | 'checked' | 'indeterminate';

/**
 * Collapse the `checked` / `indeterminate` pair into the one state that paints.
 *
 * Indeterminate WINS, including over checked — see the module header for the
 * cascade reading that settles it (_checks.scss:79-81 re-declares the glyph
 * after both `:checked` rules, at equal specificity).
 */
export function resolveCheckState(checked: boolean, indeterminate: boolean): AdwCheckState {
    if (indeterminate) return 'indeterminate';
    return checked ? 'checked' : 'unchecked';
}

/** Payload of a {@link RadioGroupState} change — both halves of one exclusive move. */
export interface RadioGroupChange {
    /** The group the move happened in. */
    name: string;
    /** The value that is now selected. */
    selected: string;
    /** The value that just lost the selection, or `null` when the group was empty. */
    deselected: string | null;
}

/** Subscriber for {@link RadioGroupState} changes. */
export type RadioGroupListener = (change: RadioGroupChange) => void;

/**
 * Which value is selected in each named radio group.
 *
 * ONE registry over MANY groups, keyed by name, because that is the shape the
 * renderers need: a radio knows its own group NAME, not its siblings, exactly as
 * `<input type="radio" name="…">` does. Two independent groups therefore need
 * two names — the registry is as global as its host (one instance per document
 * in `@gjsify/adwaita-web`).
 *
 * {@link select} notifies ONCE per move, carrying the value that gained the
 * selection and the one that lost it, so a renderer repaints both members off a
 * single event. Re-selecting the value already held is a no-op and notifies
 * nothing — a user clicking a checked radio twice must not produce a second
 * event, and must never end up with nothing selected (HTML radios cannot be
 * unchecked by clicking either).
 *
 * A group nobody has picked in reports `null`. Whether GTK instead activates the
 * first member of a group is NOT verifiable here (see the module header), so
 * this reports the state it actually has rather than inventing a default.
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
        // Snapshot so a listener that unsubscribes mid-fan-out can't skip another.
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
