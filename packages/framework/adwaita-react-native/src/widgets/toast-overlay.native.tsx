/** @jsxImportSource react */
// `AdwToastOverlay` on React Native — `@gjsify/adwaita-core`'s port of libadwaita's queue.
// (On the pragma, see `bin.native.tsx`.)
//
// WHERE THE STATE LIVES, AND WHY IT IS SPLIT IN TWO.
//
// The QUEUE is in a `useRef` and is never re-created. `AdwToastQueue` owns the ordering,
// the one-at-a-time policy and a live timer handle; rebuilding it on a render would
// restart the timer of the toast currently on screen and lose everything queued behind
// it, and putting it in `useState` would additionally make React the thing that decides
// when the queue exists. It is the authority, so it outlives every render — exactly as
// `Adw.ToastOverlay` does on the other half, where the authority is libadwaita's own C.
//
// The VISIBLE TOAST is in `useState`, because that is the only part React has to react
// to. The queue pushes it there through `onShow`/`onHide`, which is the same seam the
// browser and NativeScript renderers use to mount and tear down their strip.
//
// So neither half holds the queue in React, and the two are asserted against each other
// by BEHAVIOUR rather than by shape: two toasts added back to back show ONE, measured on
// libadwaita 1.9.3 (a single `AdwToastWidget` in the tree, showing the first) and asserted
// of the port here.
//
// THE SCHEDULER IS THE PLATFORM TIMER, injected rather than reached for inside the core —
// that seam is why the queue's auto-dismiss lifecycle is testable at all, and it is
// already exercised against a deterministic fake in `@gjsify/adwaita-core`'s own suite.
// What this file's suite adds is that the wiring is real, which needs one real timer.
//
// THE ACTION BUTTON DISMISSES AND ADVANCES, WITH NO CALLBACK. `AdwToast` carries a label
// and no action — `Adw.Toast` expresses the action as `action-name`, a `GAction` this
// package has no surface for — so pressing it does what both other renderers do: dismiss
// the current toast, which advances the queue. The README names the absent callback.

import { useEffect, useImperativeHandle, useRef, useState, type ReactElement } from 'react';
import { Text, View } from 'react-native';

import { AdwToastQueue, type AdwToast, type ToastScheduler, type ToastTimerHandle } from '@gjsify/adwaita-core';

import type { AdwToastOverlayProps } from '../props.js';

/** The platform timing seam the core queue's auto-dismiss runs on. */
const TIMEOUT_SCHEDULER: ToastScheduler = {
    schedule: (callback, ms) => setTimeout(callback, ms) as unknown as ToastTimerHandle,
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** {@link import('./toast-overlay.js').AdwToastOverlay} on React Native. */
export function AdwToastOverlay({ children, ref }: AdwToastOverlayProps): ReactElement | null {
    const [current, setCurrent] = useState<AdwToast | null>(null);
    const queue = useRef<AdwToastQueue | null>(null);
    queue.current ??= new AdwToastQueue({
        scheduler: TIMEOUT_SCHEDULER,
        onShow: (toast) => setCurrent(toast),
        onHide: () => setCurrent(null),
    });

    useImperativeHandle(
        ref,
        () => ({
            addToast: (toast: AdwToast): void => queue.current?.add(toast),
            dismissAll: (): void => queue.current?.clear(),
        }),
        [],
    );

    // The timer is the only thing here that outlives the tree, so it is the only thing
    // that has to be torn down: `clear()` cancels a pending auto-dismiss and drops the
    // backlog. Without it an unmounted overlay keeps a `setTimeout` alive for up to its
    // last toast's timeout.
    useEffect(() => () => queue.current?.clear(), []);

    return (
        <View style={{ flex: 1 }}>
            {children}
            {current === null ? null : (
                <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text>{current.title}</Text>
                        {current.hasButton ? (
                            <Text accessibilityRole="button" onPress={() => queue.current?.dismiss()}>
                                {current.buttonLabel}
                            </Text>
                        ) : null}
                    </View>
                </View>
            )}
        </View>
    );
}
