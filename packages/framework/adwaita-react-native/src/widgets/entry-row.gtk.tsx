/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwEntryRow` on GTK — the real `Adw.EntryRow`. libadwaita runs `update_empty`.
// (On the pragma, see `bin.gtk.tsx`.)
//
// `EntryRowState` IS NOT USED HERE, for the reason `clamp.gtk.tsx` does not call
// `clampAllocate`: the five-output truth table is already running in C inside this
// widget, and a second copy of it in TypeScript would be a second authority for the
// same pixels. The core's value on this path is as the oracle `entry-row.native.tsx` is
// measured against — the same rows, asserted on both sides.
//
// `max-length` GOES TO THE WIDGET RAW, and that is the one place the two halves reach
// the same answer by different routes. `Adw.EntryRow:max-length` is documented as a
// number of CHARACTERS and GTK enforces it on the buffer, where React Native's
// `TextInput.maxLength` counts UTF-16 units and would cut a surrogate pair in half — so
// the React Native half runs `@gjsify/adwaita-core`'s `clampEntryText` instead of handing
// the number to the platform. Here handing it over IS the faithful spelling.
//
// THE `ref` IS THE ONLY ROUTE TO THE NEW TEXT: the host strips the emitting object before
// calling a handler, so `notify::text` carries the ParamSpec alone. The full measurement
// is in `switch-row.gtk.tsx`, which needs the same thing for the same reason.

import { useCallback, useRef, type ReactElement } from 'react';

import type Adw from 'gi://Adw?version=1';

import type { AdwEntryRowProps } from '../props.js';

/** {@link import('./entry-row.js').AdwEntryRow} on GTK. */
export function AdwEntryRow({
    title,
    text,
    maxLength,
    editable,
    showApplyButton,
    onNotifyText,
    onApply,
    onEntryActivated,
}: AdwEntryRowProps): ReactElement | null {
    const row = useRef<Adw.EntryRow | null>(null);

    const notifyText = useCallback(() => {
        // A narrowing, not a probe — see `switch-row.gtk.tsx`.
        const widget = row.current;
        if (widget !== null) onNotifyText?.(widget.text);
    }, [onNotifyText]);

    return (
        <adw-entry-row
            ref={row}
            title={title}
            text={text}
            max-length={maxLength}
            editable={editable}
            show-apply-button={showApplyButton}
            onNotifyText={notifyText}
            onApply={onApply}
            onEntryActivated={onEntryActivated}
        />
    );
}
