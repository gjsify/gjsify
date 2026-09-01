/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwExpanderRow` on GTK — the real `Adw.ExpanderRow`. (On the pragma, see `bin.gtk.tsx`.)
//
// `ExpanderState` IS NOT USED HERE, for the reason `clamp.gtk.tsx` does not call
// `clampAllocate`: the disclosure is a GObject property with its own change gate, and a
// second copy of that gate in TypeScript would be a second authority for one flag. The
// core's value on this path is as the oracle `expander-row.native.tsx` is measured
// against.
//
// CHILDREN LAND IN THE DISCLOSURE, and that is `@gjsify/gtk-host`'s curated descriptor
// for this GType rather than a choice made here: `slots: { prefix: 'add_prefix', suffix:
// 'add_suffix', row: 'add_row' }` with `defaultSlot: 'row'`. That descriptor is part of
// this change — the widget was in the GENERATED table, which knows the tag and no
// placement, so every child of an `<adw-expander-row>` was an `uncurated-placement`
// refusal before it. `set_child` exists on the class (it is a `GtkListBoxRow`) and
// replaces the whole template, which is why guessing was never available.
//
// THE `ref` IS THE ONLY ROUTE TO THE NEW FLAG: the host strips the emitting object before
// calling a handler, so `notify::expanded` carries the ParamSpec alone. The full
// measurement is in `switch-row.gtk.tsx`, which needs the same thing for the same reason.

import { useCallback, useRef, type ReactElement } from 'react';

import type Adw from 'gi://Adw?version=1';

import type { AdwExpanderRowProps } from '../props.js';

/** {@link import('./expander-row.js').AdwExpanderRow} on GTK. */
export function AdwExpanderRow({
    title,
    subtitle,
    expanded,
    onNotifyExpanded,
    children,
}: AdwExpanderRowProps): ReactElement | null {
    const row = useRef<Adw.ExpanderRow | null>(null);

    const notifyExpanded = useCallback(() => {
        // A narrowing, not a probe — see `switch-row.gtk.tsx`.
        const widget = row.current;
        if (widget !== null) onNotifyExpanded?.(widget.expanded);
    }, [onNotifyExpanded]);

    return (
        <adw-expander-row
            ref={row}
            title={title}
            subtitle={subtitle}
            expanded={expanded}
            onNotifyExpanded={notifyExpanded}
        >
            {children}
        </adw-expander-row>
    );
}
