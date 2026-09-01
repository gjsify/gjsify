// `AdwWrapBox` — the base module. See `../refuse.ts` for who reaches this and why it
// throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwWrapBoxProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * A box whose children flow onto new lines when they run out of room.
 *
 * THE LINE DECISION IS SHARED AND THE LINE BREAKING IS NOT, which is the whole shape of
 * this widget. `resolveWrapBoxLine` in `@gjsify/adwaita-core` — held to
 * `WRAP_BOX_LINE_VECTORS` — answers what a line does with its leftover space, and its
 * three counter-intuitive rows are why no renderer may reinvent it: the FINAL line is
 * governed by `justify-last-line` rather than `justify`, a box whose children all fit on
 * one line is therefore the counter-intuitive case rather than the simple one, and
 * `spread` with a single child in the line STRETCHES it (C guards the keep-at-minimum
 * branch with `n_children > 1`). What no renderer can be handed is the BREAKING itself:
 * CSS flexbox, NativeScript's `FlexboxLayout` and React Native's Yoga each break lines
 * themselves, so the decision is mapped onto flex knobs — by `wrapBoxFlexStyle` and
 * `wrapBoxChildFlex`, which are in the core for the same reason the decision is.
 *
 * ON GTK NONE OF THAT RUNS: `Adw.WrapBox` is `adw-wrap-layout.c` itself. The core's
 * value on that path is as the oracle this half is measured against, exactly as
 * `clampAllocate` is for `AdwClamp`.
 */
export function AdwWrapBox(_props: AdwWrapBoxProps): ReactElement | null {
    return refuseBaseModule('AdwWrapBox');
}
