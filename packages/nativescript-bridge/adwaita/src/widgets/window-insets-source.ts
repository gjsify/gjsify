// Where window insets come from — the base, for a host that is neither Android nor iOS.
//
// The platform variants sit beside this file (`.android.ts`, `.ios.ts`) and the
// bundler picks one; a consumer only ever writes `./window-insets-source.js`.
//
// This one reports NO insets, forever, and says so rather than throwing: a host
// without system bars genuinely has none to apply, and the toolbar view asking for
// them is not an error there. The screenshot backend's base file throws because
// "capture this widget" cannot be answered with a plausible-looking nothing; "what
// are the insets" can, and the honest answer is zero.

import { type WindowInsetsListener, WindowInsetsBroadcast } from './window-insets.js';

const broadcast = new WindowInsetsBroadcast();

/**
 * Subscribe to window-inset changes. Returns the unsubscribe.
 *
 * The listener is called once, immediately, with zero insets — the same contract
 * the platform variants keep, so a consumer never needs a platform branch.
 */
export function observeWindowInsets(listener: WindowInsetsListener): () => void {
    return broadcast.subscribe(listener);
}
