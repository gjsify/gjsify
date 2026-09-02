/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwPasswordEntryRow` on GTK — the real `Adw.PasswordEntryRow`. (On the pragma, see
// `bin.gtk.tsx`.)
//
// `EntryRowState` AND `PasswordEntryRowState` ARE NOT USED HERE, the same way
// `clamp.gtk.tsx` does not run `clampAllocate`. `update_empty`, the apply latch, the peek
// pair and the caps-lock suppression all run in C inside this widget; the core's port of
// them is what `preferences.native.spec.tsx` measures the phone half against.
//
// THE PEEK BUTTON IS NOT AUTHORED, on either half, and that is the widget's own design.
// `adw_password_entry_row_init` installs it through `add_suffix` and nothing about it is a
// property — which is why `AdwPasswordEntryRowProps` in gtk-host's generated table is an
// EMPTY interface over `AdwEntryRowProps`, and why `props.ts` publishes no `revealed`. The
// React Native half builds its own button for the same reason: it is part of the widget, not
// part of the surface.
//
// `onNotifyText` READS THE PROPERTY BACK RATHER THAN TRUSTING THE PROP, because the two can
// differ by exactly one keystroke. gtk-host writes `text` only when the PROP changes, so a
// keystroke the consumer does not echo back stands in the widget while `text` still holds
// the old value — which is `entry-row.native.tsx`'s "the machine is the buffer" on this side
// of the package. The notify handler is the only place that difference is visible, so it
// asks the widget.

import type Adw from 'gi://Adw?version=1';
import { useCallback, useRef, type ReactElement } from 'react';

import type { AdwPasswordEntryRowProps } from '../props.js';

/** {@link import('./password-entry-row.js').AdwPasswordEntryRow} on GTK. */
export function AdwPasswordEntryRow({
    title,
    text,
    maxLength,
    editable,
    showApplyButton,
    onNotifyText,
    onApply,
    onEntryActivated,
}: AdwPasswordEntryRowProps): ReactElement | null {
    const row = useRef<Adw.PasswordEntryRow | null>(null);

    const notifyText = useCallback(() => {
        const widget = row.current;
        if (widget !== null) onNotifyText?.(widget.get_text());
    }, [onNotifyText]);

    return (
        <adw-password-entry-row
            ref={row}
            title={title}
            text={text}
            max-length={maxLength}
            editable={editable}
            show-apply-button={showApplyButton}
            onNotifyText={onNotifyText === undefined ? undefined : notifyText}
            onApply={onApply === undefined ? undefined : () => onApply()}
            onEntryActivated={onEntryActivated === undefined ? undefined : () => onEntryActivated()}
        />
    );
}
