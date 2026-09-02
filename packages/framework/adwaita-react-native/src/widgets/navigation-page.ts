// `AdwNavigationPage` — the base module. See `../refuse.ts` for who reaches this and
// why it throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwNavigationPageProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * One page of a navigation view, or one pane of a navigation split view.
 *
 * IT CARRIES THREE VALUES AND DRAWS NONE OF THEM. `title`, `tag` and `can-pop` are
 * read by whatever holds the page — the view's stack machine on both halves — and the
 * page itself is a container. That is libadwaita's own shape: `AdwNavigationPage` is an
 * `AdwBin` with three properties, and the title appears on screen only because the
 * view puts it in a header bar.
 */
export function AdwNavigationPage(_props: AdwNavigationPageProps): ReactElement | null {
    return refuseBaseModule('AdwNavigationPage');
}
