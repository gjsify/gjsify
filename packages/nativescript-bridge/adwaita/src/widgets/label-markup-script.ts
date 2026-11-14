// The baseline shift a `<sub>`/`<sup>` run asks of its `Span` — written through
// `style.verticalAlignment`, which NativeScript turns into a platform baseline offset
// (Android's `BaselineAdjustedSpanImpl`, iOS's `NSBaselineOffsetAttributeName`).
//
// THIS BASE FILE answers for every host but iOS: the shift is written as asked. Free of
// `@nativescript/core` so the `Span` path stays spec-able off a device.
// `label-markup-script.ios.ts` is the one host that answers differently, and says why.

import type { LabelMarkupStyle } from '@gjsify/adwaita-core';

/** The `verticalAlignment` to write for a run's `<sub>`/`<sup>`, or `null` to write none. */
export function labelMarkupScriptShift(script: NonNullable<LabelMarkupStyle['script']>): 'sub' | 'sup' | null {
    return script;
}
