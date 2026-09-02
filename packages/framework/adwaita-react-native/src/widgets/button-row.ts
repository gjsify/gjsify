// `AdwButtonRow` — the base module. See `../refuse.ts` for who reaches this and why it
// throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwButtonRowProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * A boxed-list row that behaves like a button.
 *
 * ALWAYS ACTIVATABLE, and that is a fact both halves read out of
 * `@gjsify/adwaita-core`'s `BUTTON_ROW_ACTIVATABLE` rather than each writing `true`:
 * the upstream template hardcodes `activatable=True`, the class documentation says
 * "AdwButtonRow is always activatable", and the sibling `<AdwActionRow>` reads
 * `activatable` as an ordinary prop — so one surface carrying two opposite meanings for
 * the same word is exactly what the shared constant prevents.
 */
export function AdwButtonRow(_props: AdwButtonRowProps): ReactElement | null {
    return refuseBaseModule('AdwButtonRow');
}
