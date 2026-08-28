// `AdwClamp` — the base module. See `../refuse.ts` for who reaches this and why it
// throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwClampProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * Constrain a child's size and centre it.
 *
 * THE TWO IMPLEMENTATIONS SHARE THEIR ARITHMETIC AND NOTHING ELSE. On GTK the real
 * `Adw.Clamp` computes the allocation in C; on React Native `@gjsify/adwaita-core`'s
 * `clampAllocate` — a port of `adw_clamp_layout_allocate` — computes it in TypeScript.
 * Both are libadwaita's easing curve, so the same properties over the same available
 * width produce the same child size and the same centring offset, and the suites
 * assert exactly that number on both sides rather than each side's own idea of
 * "clamped".
 */
export function AdwClamp(_props: AdwClampProps): ReactElement | null {
    return refuseBaseModule('AdwClamp');
}
