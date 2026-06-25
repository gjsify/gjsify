// @gjsify/devtools-nativescript — platform-neutral screenshot fallback.
//
// The gjsify NativeScript build's `platformResolvePlugin` rewrites an
// `import './screenshot.js'` to the most specific variant on disk
// (`screenshot.android.ts` on Android, `screenshot.ios.ts` on iOS). This base
// file is the fallthrough used when neither platform variant applies — it
// throws so a mis-resolved or unsupported target fails loudly instead of
// silently returning an empty image.
//
// Original implementation.

import type { NsView } from './view-tree.js';

/**
 * Capture a NativeScript view to a base64 PNG. Platform-specific
 * implementations live in `screenshot.android.ts` / `screenshot.ios.ts`; this
 * base throws because no capture backend exists off-platform.
 */
export function captureViewPng(_view: NsView): string | null {
    throw new Error('Platform not supported');
}
