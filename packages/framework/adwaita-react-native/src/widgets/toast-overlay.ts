// `AdwToastOverlay` — the base module. See `../refuse.ts` for who reaches this and why it
// throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwToastOverlayProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * Wraps content and shows one transient toast at a time over it.
 *
 * THIS IS THE ONE WIDGET IN THE PACKAGE WITH STATE RATHER THAN LAYOUT, and the two
 * halves therefore hold it in two places on purpose. On GTK the queue is libadwaita's
 * own: `adw_toast_overlay_add_toast` enqueues, the overlay shows one at a time and
 * builds the `AdwToastWidget` itself, and nothing about it is reachable from a renderer.
 * On React Native the queue is `@gjsify/adwaita-core`'s `AdwToastQueue` — the port of
 * that policy — living in a `useRef` because it owns timers whose identity must survive
 * a re-render, with only the VISIBLE toast in `useState` because that is what React
 * re-renders on.
 *
 * So there is exactly one authority per half and neither is React's. What is asserted
 * across them is the behaviour: two toasts added at once show ONE, on both.
 */
export function AdwToastOverlay(_props: AdwToastOverlayProps): ReactElement | null {
    return refuseBaseModule('AdwToastOverlay');
}
