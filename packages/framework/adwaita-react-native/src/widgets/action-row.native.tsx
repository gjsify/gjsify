/** @jsxImportSource react */
// `AdwActionRow` on React Native — the label rule in TypeScript, the row as a `Pressable`.
// (On the pragma, see `bin.native.tsx`.)
//
// `deriveRowLabels` FROM `@gjsify/adwaita-core`, NOT `title !== ''`. The rule
// `adw-action-row.ui` binds is `string_is_not_empty`, and it is bound to BOTH labels —
// the title's is the half a hand-written port drops, so a row with an empty title keeps a
// blank first line where GTK has none. Running the core's derivation is also what makes
// the two suites able to assert the same four outputs; the shell that draws them is
// `../row-shell.native.tsx`.
//
// `activatable` BECOMES `disabled`, ONE MAPPING AND NOT TWO. On GTK the flag decides
// whether a CLICK activates the row (`GtkListBox` does not emit `row-activated` for an
// unactivatable row); on React Native `disabled` decides whether a press reaches
// `onPress`. Both halves therefore answer the click path the same way, and both default
// to "no", because `Adw.ActionRow`'s own template sets `activatable=False`.
//
// The `Pressable` is rendered UNCONDITIONALLY rather than swapped for a `View` when the
// row is inert: swapping the element type at the root remounts the whole subtree on a
// prop flip, and a child that holds state would lose it for a flag GTK changes in place.

import type { ReactElement } from 'react';
import { Pressable } from 'react-native';

import type { AdwActionRowProps } from '../props.js';
import { ADW_ROW_STYLE, AdwRowLabels } from '../row-shell.native.js';

/** {@link import('./action-row.js').AdwActionRow} on React Native. */
export function AdwActionRow({
    title,
    subtitle,
    activatable,
    onActivated,
    children,
}: AdwActionRowProps): ReactElement | null {
    return (
        <Pressable style={ADW_ROW_STYLE} disabled={activatable !== true} onPress={onActivated}>
            <AdwRowLabels title={title} subtitle={subtitle} />
            {children}
        </Pressable>
    );
}
