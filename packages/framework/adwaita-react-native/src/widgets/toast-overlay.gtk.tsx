/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwToastOverlay` on GTK — the real `Adw.ToastOverlay`, and libadwaita's own queue.
// (On the pragma, see `bin.gtk.tsx`.)
//
// `AdwToastQueue` IS NOT USED HERE. The core's port of the one-at-a-time policy is for a
// renderer that has no libadwaita; this half has the original, and running both would
// give the overlay two authorities for which toast is on screen. Measured on libadwaita
// 1.9.3: two toasts added back to back leave exactly ONE `AdwToastWidget` in the tree,
// showing the first — the same behaviour `toast-overlay.native.spec.tsx` asserts of the
// port.
//
// THE UNIT IS THE ONE THING THAT HAS TO BE CONVERTED, and it is a real divergence
// between the two authorities rather than a formality: `Adw.Toast:timeout` counts
// SECONDS as a `guint`, `AdwToast.timeout` counts MILLISECONDS. `DEFAULT_TOAST_TIMEOUT`
// is 5000 and a freshly constructed `Adw.Toast` reads `timeout === 5`, so the two agree
// on the duration and disagree on the unit — which is exactly the shape that survives as
// a silent off-by-1000 if nobody writes it down.
//
// The overlay is reached through a `ref` because `add_toast` is a CALL. gtk-host's
// `getPublicInstance` hands back the author's own widget, so the ref is the real
// `Adw.ToastOverlay` and not a wrapper.

import Adw from 'gi://Adw?version=1';
import { useImperativeHandle, useRef, type ReactElement } from 'react';

import type { AdwToast } from '@gjsify/adwaita-core';

import type { AdwToastOverlayProps } from '../props.js';

/**
 * `AdwToast.timeout` (ms) as `Adw.Toast:timeout` (whole seconds).
 *
 * Exported so `content.gtk.spec.tsx` can assert the conversion against
 * libadwaita's own default instead of against itself; `parity.spec.ts` allows a
 * platform-only export beside the widget for exactly this.
 *
 * IT ROUNDS UP, AND `Math.round` WAS THE FIRST VERSION AND WAS WRONG. `timeout: 0` is
 * libadwaita's "until dismissed", so any rule that can take a POSITIVE millisecond count
 * to 0 turns a brief toast into a permanent one — and `Math.round(400 / 1000)` is exactly
 * that, caught by the row in `content.gtk.spec.tsx` that asserts the conversion. `ceil`
 * cannot reach 0 from a positive input and leaves an authored 0 alone, so the one value
 * that means something else keeps meaning it.
 *
 * It is lossy in the other direction and the README names that: GObject stores whole
 * seconds, so 1500 ms is 2 s on GTK and stays 1500 ms on React Native.
 */
export const adwToastTimeoutSeconds = (milliseconds: number): number => Math.ceil(milliseconds / 1000);

/** {@link import('./toast-overlay.js').AdwToastOverlay} on GTK. */
export function AdwToastOverlay({ children, ref }: AdwToastOverlayProps): ReactElement | null {
    const overlay = useRef<Adw.ToastOverlay | null>(null);

    useImperativeHandle(
        ref,
        () => ({
            addToast: (toast: AdwToast): void => {
                overlay.current?.add_toast(
                    new Adw.Toast({
                        title: toast.title,
                        timeout: adwToastTimeoutSeconds(toast.timeout),
                        // `Adw.Toast:button-label` is nullable and NULL is what hides the
                        // button; the core descriptor spells the same state `''`.
                        buttonLabel: toast.buttonLabel.length > 0 ? toast.buttonLabel : null,
                    }),
                );
            },
            dismissAll: (): void => overlay.current?.dismiss_all(),
        }),
        [],
    );

    return <adw-toast-overlay ref={overlay}>{children}</adw-toast-overlay>;
}
