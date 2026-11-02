import { describe, it, expect } from '@gjsify/unit';

import gettextFallback, { bindtextdomain, textdomain, dgettext, dngettext, dpgettext } from './gettext-fallback.js';

export default async () => {
    await describe('@gjsify/native-platform/gettext-fallback', async () => {
        await it('dgettext returns the msgid unchanged', async () => {
            expect(dgettext('eu.jumplink.Learn6502', 'Help')).toBe('Help');
        });

        await it('dngettext picks singular/plural by n, both untranslated', async () => {
            expect(dngettext('d', '1 item', '%d items', 1)).toBe('1 item');
            expect(dngettext('d', '1 item', '%d items', 2)).toBe('%d items');
            expect(dngettext('d', '1 item', '%d items', 0)).toBe('%d items');
        });

        await it('dpgettext returns the msgid unchanged, ignoring the context', async () => {
            expect(dpgettext('d', 'menu', 'Open')).toBe('Open');
        });

        await it('bindtextdomain is a non-throwing no-op', async () => {
            expect(bindtextdomain('d', '/some/dir')).toBe(null);
        });

        await it('textdomain tracks and reports the active domain, as GJS does', async () => {
            expect(textdomain('eu.jumplink.Learn6502')).toBe('eu.jumplink.Learn6502');
            expect(textdomain(null)).toBe('eu.jumplink.Learn6502');
        });

        await it('the default export carries the same five functions', async () => {
            expect(gettextFallback.dgettext).toBe(dgettext);
            expect(gettextFallback.dngettext).toBe(dngettext);
            expect(gettextFallback.dpgettext).toBe(dpgettext);
            expect(gettextFallback.bindtextdomain).toBe(bindtextdomain);
            expect(gettextFallback.textdomain).toBe(textdomain);
        });
    });
};
