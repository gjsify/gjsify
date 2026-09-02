// `AdwStatusPage` — the base module. See `../refuse.ts` for who reaches this and why it
// throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwStatusPageProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * A centred empty state: an icon, a title, a description and one child.
 *
 * THE PARTS ARE BUILT ONCE AND SHOWN OR HIDDEN, which is `adw-status-page.ui`'s own
 * shape: every part binds its `visible` to a closure over the property that feeds it
 * (:23-28, :41-46, :57-62), so a page with only a description opens without a blank line
 * above it. The predicate is `string_is_not_empty` — the FIRST BYTE, never trimmed — and
 * both halves take it from `@gjsify/adwaita-core` rather than writing `.length === 0`
 * again, which is what both other renderers had done.
 *
 * `iconName` is the one prop that does not reach both halves; the reason is on the prop.
 */
export function AdwStatusPage(_props: AdwStatusPageProps): ReactElement | null {
    return refuseBaseModule('AdwStatusPage');
}
