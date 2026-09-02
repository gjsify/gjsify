/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwSwitchRow` on GTK — the real `Adw.SwitchRow`. (On the pragma, see `bin.gtk.tsx`.)
//
// THE `ref` IS THE ONLY ROUTE TO THE NEW VALUE, and that is a measured property of the
// host rather than a preference. `@gjsify/gtk-host` strips the emitting object before it
// calls a handler (`next(...args.slice(1))` in its `signals.ts`), so a `notify::active`
// callback receives the `GObject.ParamSpec` and nothing else — its declared type,
// `NotifyHandler`, says exactly that. Deriving the value instead (`!active`) would be
// wrong the moment the row is used uncontrolled, where this half has no `active` prop to
// invert.
//
// THE HANDLER IS BOUND UNCONDITIONALLY, even with no `onNotifyActive` prop, because its
// identity is what the host keys the connection on: one stable `useCallback` means one
// `connect` for the life of the row, where a conditional `undefined` would disconnect and
// reconnect every time the consumer's callback identity changed anyway.
//
// WHAT DOES NOT NEED HANDLING HERE is the echo of this component's own property write.
// `@gjsify/gtk-host` drops a `notify` raised inside a host write (its `isHostWriteTarget`
// guard), so patching `active` from a re-render does not re-enter the consumer — which is
// what lets the prop be controlled without a latch in this file.

import { useCallback, useRef, type ReactElement } from 'react';

import type Adw from 'gi://Adw?version=1';

import type { AdwSwitchRowProps } from '../props.js';

/** {@link import('./switch-row.js').AdwSwitchRow} on GTK. */
export function AdwSwitchRow({ title, subtitle, active, onNotifyActive }: AdwSwitchRowProps): ReactElement | null {
    const row = useRef<Adw.SwitchRow | null>(null);

    const notifyActive = useCallback(() => {
        // A narrowing, not a probe: the ref is written before GTK can emit and the
        // handler is disconnected before it is cleared.
        const widget = row.current;
        if (widget !== null) onNotifyActive?.(widget.active);
    }, [onNotifyActive]);

    return <adw-switch-row ref={row} title={title} subtitle={subtitle} active={active} onNotifyActive={notifyActive} />;
}
