// Which edges each platform's host already pays. Both platform files type-import `View` only
// (never a value import), so they load without `@nativescript/core` — the same reason
// `engine-target.spec.ts` imports its platform files by their explicit `.ios.js`/`.android.js`
// name rather than through plain `./host-insets.js`, which the bundler's platform resolution
// would answer per BUILD target, not per file requested.

import { describe, expect, it } from '@gjsify/unit';

import { resolveHostInsets as resolveAndroid } from './widgets/host-insets.android.js';
import { resolveHostInsets as resolveBase } from './widgets/host-insets.js';
import { resolveHostInsets as resolveIos } from './widgets/host-insets.ios.js';
import { NO_INSETS } from './widgets/window-insets.js';

/** None of the three reads `view` beyond a `.page`/`.className` Android needs — `undefined` is fine here. */
const NO_VIEW = undefined as never;

export default async () => {
    await describe('resolveHostInsets', async () => {
        await it('a host that is neither platform pays nothing', () => {
            expect(resolveBase(NO_VIEW, NO_INSETS)).toStrictEqual({ top: false, bottom: false });
        });

        await it('iOS: Page.onLayout pays both edges unconditionally, so the widget pays neither', () => {
            expect(resolveIos(NO_VIEW, NO_INSETS)).toStrictEqual({ top: true, bottom: true });
        });

        await it('Android with no page above the view pays nothing', () => {
            expect(resolveAndroid({ page: null } as never, NO_INSETS)).toStrictEqual({ top: false, bottom: false });
        });
    });
};
