/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwComboRow` on GTK — the real `Adw.ComboRow`. libadwaita owns the selection. (On the
// pragma, see `bin.gtk.tsx`.)
//
// `ComboState` IS NOT USED HERE, the same way `clamp.gtk.tsx` does not run `clampAllocate`:
// the core's port of the selection model is for a renderer with no libadwaita, and running
// both would give the row two authorities for which item is selected. What the core DOES own
// on this path is the option vocabulary — the seam runs `normalizeComboOptions` over the
// authored `model` exactly as the native half does, so a bare string means the same thing on
// both halves.
//
// THE `Gtk.StringList` IS NOT BUILT HERE ANY MORE. This file used to construct it by hand,
// which was the conversion ADR 0046 § 7 described as existing "one package over" and not at
// the seam. `@gjsify/gtk-host`'s `coerce` turns the portable list model into the real model
// at the ParamSpec seam now (ADR 0046 § Amendment), so this half hands the array through and
// imports no `gi://` at all — the second copy is where the helper got lifted.
//
// THE MODEL IS NOT MEMOISED ANY MORE, AND THE REASON IS THE SEAM'S. This file carried a
// content-keyed `useMemo` because a new `Gtk.StringList` per render reset the selection
// through `gtk_single_selection_set_model`, and an inline `model={['a','b']}` literal IS a new
// array on every render. The seam now splices a list it built rather than replacing it, and
// answers an equal array with no write at all (`gtk-host/src/list-model.ts` has the
// measurement), so the workaround went home to the core. `preferences.gtk.spec.tsx` still
// re-renders a row with an unrelated prop changed and asserts the selection survives — the
// same assertion, held by the seam instead of by this file.
//
// `GTK_INVALID_LIST_POSITION` IS TRANSLATED ON THE WAY OUT. `AdwComboRow:selected` is a
// `guint`, so "nothing selected" reads back as 4294967295; `@gjsify/adwaita-core` spells the
// same state `ADW_COMBO_NO_SELECTION`, i.e. `-1`, and `preferences.native.spec.tsx` asserts
// that number. Handing the raw `guint` to the callback would make one state have two
// spellings across the two halves — the exact shape `normalizeClampSize` exists to remove on
// `AdwClamp`.

import type Adw from 'gi://Adw?version=1';
import { useCallback, useRef, type ReactElement } from 'react';

import { ADW_COMBO_NO_SELECTION } from '@gjsify/adwaita-core';

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

    const notifySelected = useCallback(() => {
        const current = row.current;
        if (current !== null) onNotifySelected?.(comboSelectedIndex(current.selected));
    }, [onNotifySelected]);

    return (
        <adw-combo-row
            ref={row}
            title={title}
            subtitle={subtitle}
            model={model}
            selected={selected}
            use-subtitle={useSubtitle}
            onNotifySelected={onNotifySelected === undefined ? undefined : notifySelected}
        />
    );
}
