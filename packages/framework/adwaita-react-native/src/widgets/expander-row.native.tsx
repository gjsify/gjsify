/** @jsxImportSource react */
// `AdwExpanderRow` on React Native — one disclosure machine, a header that toggles it.
// (On the pragma, see `bin.native.tsx`.)
//
// `ExpanderState` FROM `@gjsify/adwaita-core` RATHER THAN A `useState<boolean>`. The
// difference is not ceremony: the machine's `setExpanded` RETURNS whether anything
// changed, which is the `g_object_notify` gate — a set to the value already held emits
// nothing, exactly as GObject's own property gate does on the GTK half — and it is the
// same object `@gjsify/adwaita-web`'s `<adw-expander-row>` and
// `@gjsify/adwaita-nativescript`'s `AdwExpanderRow` already subscribe to. A local boolean
// would give this renderer a fourth private answer to a question three of them share.
//
// THE MACHINE IS THE BUFFER, WHICH IS GObject'S CONTRACT AND NOT REACT'S — the same
// decision `entry-row.native.tsx` makes for `text`, and for the same reason. `expanded`
// seeds the row and overwrites it whenever the PROP changes; a tap the consumer does not
// echo back still stands. The GTK half behaves that way for a mechanical reason rather
// than a matching one: the real widget toggles itself and `@gjsify/gtk-host` patches a
// property only when the prop changes. A strictly controlled spelling would make the two
// halves disagree on the only interaction this widget has.
//
// THE COLLAPSED CHILDREN STAY IN THE TREE, hidden. GTK parks them under a
// `Gtk.Revealer`, which leaves them PARENTED and unmapped — measured on libadwaita 1.9.3,
// a collapsed disclosure row reports `get_mapped() === false` at 0×0 with its parent
// intact — so rendering `null` here would drop every child's state on a collapse where
// GTK keeps it, and the two halves would disagree the first time a nested entry row was
// closed and reopened.
//
// THE HEADER IS WHAT TOGGLES, not the row as a whole, and the disclosed rows must not.
// libadwaita says so in its own template: "The header row must be activatable to toggle
// expansion by clicking it", with `activatable=False` on the expander itself. Here the
// header is a separate `Pressable` SIBLING of the disclosure, so a press inside a
// disclosed row reaches that row and never this one — `@gjsify/adwaita-nativescript` had
// to reach the same shape the hard way, because a NativeScript `tap` does not stop at the
// child that handled it.

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ExpanderState } from '@gjsify/adwaita-core';

import type { AdwExpanderRowProps } from '../props.js';
import { ADW_ROW_HIDDEN_STYLE, ADW_ROW_STYLE, AdwRowLabels } from '../row-shell.native.js';

/**
 * The disclosure affordance, as a glyph.
 *
 * libadwaita draws `pan-down-symbolic` rotating to `pan-up-symbolic`, and this package
 * ships no icon renderer for React Native — the same hole `AdwActionRow:icon-name` and
 * `AdwButtonRow:start-icon-name` are absent from the surface for. The difference is that
 * those are PROPS a caller writes and this is the widget's only signal that it discloses
 * anything at all, so a stand-in beats nothing. It is a named divergence, in the README,
 * not a claim to have drawn libadwaita's chevron.
 */
const CHEVRON_COLLAPSED = '▾';
const CHEVRON_EXPANDED = '▴';

/** {@link import('./expander-row.js').AdwExpanderRow} on React Native. */
export function AdwExpanderRow({
    title,
    subtitle,
    expanded,
    onNotifyExpanded,
    children,
}: AdwExpanderRowProps): ReactElement | null {
    // SEEDED IN THE INITIALISER, not in an effect: an effect runs after the first paint,
    // so a row mounted `expanded` would show its disclosure collapsed for a frame and
    // then jump.
    const [row] = useState(() => {
        const state = new ExpanderState();
        state.setExpanded(expanded === true);
        return state;
    });
    const [isExpanded, setIsExpanded] = useState(() => row.expanded);

    useEffect(() => row.subscribe(setIsExpanded), [row]);

    // The prop-sync path deliberately does NOT call `onNotifyExpanded`: this is the
    // consumer's own write coming back, and reporting it is the echo `@gjsify/gtk-host`'s
    // `isHostWriteTarget` guard drops on the other half.
    useEffect(() => {
        row.setExpanded(expanded === true);
    }, [row, expanded]);

    const toggle = useCallback(() => {
        // `toggle` returns the notify gate. It cannot answer `false` for a flip, and it
        // is read anyway rather than assumed, because that is the one line that would
        // have to change if the machine ever grew an enable-expansion veto.
        if (row.toggle()) onNotifyExpanded?.(row.expanded);
    }, [row, onNotifyExpanded]);

    return (
        <View>
            {/* No style on the outer node: a `View` already lays its children out in a
                COLUMN, and writing `flexDirection: 'column'` would be a second author
                for a default — the row skeleton states the opposite for the header,
                where the default is the wrong one. */}
            <Pressable style={ADW_ROW_STYLE} onPress={toggle}>
                <AdwRowLabels title={title} subtitle={subtitle} />
                <Text>{isExpanded ? CHEVRON_EXPANDED : CHEVRON_COLLAPSED}</Text>
            </Pressable>
            <View style={isExpanded ? undefined : ADW_ROW_HIDDEN_STYLE}>{children}</View>
        </View>
    );
}
