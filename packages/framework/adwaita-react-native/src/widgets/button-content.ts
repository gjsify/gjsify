// `AdwButtonContent` — the base module. See `../refuse.ts` for who reaches this and why it
// throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwButtonContentProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * An icon paired with a label, for the inside of a button.
 *
 * THE DERIVATIONS ARE THE WIDGET. There is no layout arithmetic here — there are four
 * questions (`buttonContentIconName`, `buttonContentIconExpands`,
 * `buttonContentLabelVisible`, `buttonContentEllipsize`) and both halves ask
 * `@gjsify/adwaita-core` all four. Two of them are places a renderer guesses wrong:
 * an empty `icon-name` DRAWS `image-missing` rather than hiding the icon (libadwaita's
 * own doc comments say otherwise and its code disagrees with them), and the icon takes
 * the free space exactly when there is no label.
 */
export function AdwButtonContent(_props: AdwButtonContentProps): ReactElement | null {
    return refuseBaseModule('AdwButtonContent');
}
