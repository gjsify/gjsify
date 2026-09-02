/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwComboRow` on GTK — the real `Adw.ComboRow`. libadwaita owns the selection. (On the
// pragma, see `bin.gtk.tsx`.)
//
// `ComboState` IS NOT USED HERE, the same way `clamp.gtk.tsx` does not run `clampAllocate`:
// the core's port of the selection model is for a renderer with no libadwaita, and running
// both would give the row two authorities for which item is selected. What the core DOES own
// on this path is the option vocabulary — `normalizeComboOptions` is what turns the authored
// `model` into `{value,label}` pairs here as well, so a bare string means the same thing on
// both halves.
//
// THE MODEL IS MEMOISED, AND THAT IS NOT AN OPTIMISATION. `@gjsify/gtk-host` patches a
// property only when the prop CHANGES, and a freshly constructed `Gtk.StringList` is a new
// value on every render — so an unmemoised model would be written on every parent re-render,
// and `adw_combo_row_set_model` resets the selection through `gtk_single_selection_set_model`
// each time. The key is the LABELS joined, not the array identity, because an inline
// `model={['a','b']}` literal is a new array on every render too and is the ordinary way to
// write this. `preferences.gtk.spec.tsx` re-renders a row with an unrelated prop changed and
// asserts the selection survives; without the memo that assertion fails, which is what makes
// this paragraph a rule and not a preference.
//
// `GTK_INVALID_LIST_POSITION` IS TRANSLATED ON THE WAY OUT. `AdwComboRow:selected` is a
// `guint`, so "nothing selected" reads back as 4294967295; `@gjsify/adwaita-core` spells the
// same state `ADW_COMBO_NO_SELECTION`, i.e. `-1`, and `preferences.native.spec.tsx` asserts
// that number. Handing the raw `guint` to the callback would make one state have two
// spellings across the two halves — the exact shape `normalizeClampSize` exists to remove on
// `AdwClamp`.

import Gtk from 'gi://Gtk?version=4.0';
import type Adw from 'gi://Adw?version=1';
import { useCallback, useMemo, useRef, type ReactElement } from 'react';

import { ADW_COMBO_NO_SELECTION, normalizeComboOptions } from '@gjsify/adwaita-core';

import type { AdwComboRowProps } from '../props.js';

/**
 * `GTK_INVALID_LIST_POSITION` — `G_MAXUINT`, which GIR gives no constant for.
 *
 * Exported so the spec can assert the translation against the number libadwaita actually
 * stores rather than against itself; `parity.spec.ts` allows a platform-only export beside
 * the widget for exactly this.
 */
export const GTK_INVALID_LIST_POSITION = 0xff_ff_ff_ff;

/** `AdwComboRow:selected` as `@gjsify/adwaita-core` spells it. */
export const comboSelectedIndex = (selected: number): number =>
    selected === GTK_INVALID_LIST_POSITION ? ADW_COMBO_NO_SELECTION : selected;

/** {@link import('./combo-row.js').AdwComboRow} on GTK. */
export function AdwComboRow({
    title,
    subtitle,
    model,
    selected,
    useSubtitle,
    onNotifySelected,
}: AdwComboRowProps): ReactElement | null {
    const row = useRef<Adw.ComboRow | null>(null);

    // `Gtk.StringList` and not a `Gtk.StringObject` list: `Adw.ComboRow`'s default
    // `expression` reads `GtkStringObject:string`, so a string list is the model that needs
    // no factory and no expression — which is what keeps this half's surface as small as the
    // core's.
    const labels = normalizeComboOptions(model).map((option) => option.label);
    // A separator that cannot occur in an authored label. Joining on a space would give
    // `['a b']` and `['a', 'b']` the same key, and the second model would never reach the
    // widget.
    const key = labels.join('\u0001');
    const strings = useMemo(() => new Gtk.StringList({ strings: labels }), [key]);

    const notifySelected = useCallback(() => {
        const current = row.current;
        if (current !== null) onNotifySelected?.(comboSelectedIndex(current.selected));
    }, [onNotifySelected]);

    return (
        <adw-combo-row
            ref={row}
            title={title}
            subtitle={subtitle}
            model={strings}
            selected={selected}
            use-subtitle={useSubtitle}
            onNotifySelected={onNotifySelected === undefined ? undefined : notifySelected}
        />
    );
}
