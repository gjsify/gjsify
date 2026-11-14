// iOS writes NO baseline shift for `<sub>`/`<sup>`, and still scales them (`SCALE_SCRIPT`).
//
// MEASURED, not assumed, in Learn6502 on an iPhone 18 Pro simulator (iOS 26, NativeScript
// iOS 9.1): the title `Tutorial <sub>by <a>Nick Morgan</a>, licensed under CC BY 4.0</sub>`
// in a wrapping label drew only its FIRST line. `UILabel`'s own measure agreed with the label
// (`textRectForBounds` 87.7 dp tall for two lines, the same as `getMeasuredHeight()`), so the
// height was not the fault; the second line was simply not DRAWN while the span carried a
// `NSBaselineOffset`. The same label with the shift left out drew both lines, in 66.7 dp.
// `@nativescript/core`'s `getBaselineOffset` (`ui/text-base/index.ios.js`) is what turns
// `verticalAlignment` into that attribute, so a shifted run inside a wrapped label is
// unusable until that is understood — a label that shows the text smaller on the baseline is
// the lesser divergence from GTK than a label that loses its second line.

import type { LabelMarkupStyle } from '@gjsify/adwaita-core';

/** iOS writes no shift: see the header. */
export function labelMarkupScriptShift(_script: NonNullable<LabelMarkupStyle['script']>): 'sub' | 'sup' | null {
    return null;
}
