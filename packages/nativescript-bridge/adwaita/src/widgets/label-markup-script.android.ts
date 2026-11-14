// Android writes the baseline shift for `<sub>`/`<sup>` as asked: `style.verticalAlignment`
// becomes `BaselineAdjustedSpanImpl`. The file exists because `gjsify.nativescriptPlatforms`
// declares `android`, and a platform-resolved module owes that platform a variant of its own
// rather than a silent fall-through to the base. Same answer as `label-markup-script.ts`.

import type { LabelMarkupStyle } from '@gjsify/adwaita-core';

/** The `verticalAlignment` to write for a run's `<sub>`/`<sup>`. Android writes it as asked. */
export function labelMarkupScriptShift(script: NonNullable<LabelMarkupStyle['script']>): 'sub' | 'sup' | null {
    return script;
}
