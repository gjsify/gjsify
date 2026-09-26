import { browser } from '@wxt-dev/browser';

import { COUNTS_KEY, isPageSeen, type Counts } from './messages.ts';

// Registered at the top level: an MV3 service worker woken for an event only
// delivers it to listeners that exist before its first await.
browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isPageSeen(message)) return undefined;
    return (async () => {
        const stored = (await browser.storage.local.get(COUNTS_KEY))[COUNTS_KEY] as Counts | undefined;
        const counts = { ...stored, [message.host]: (stored?.[message.host] ?? 0) + 1 };
        await browser.storage.local.set({ [COUNTS_KEY]: counts });
        return counts[message.host];
    })();
});
