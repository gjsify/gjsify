import { describe, expect, it } from '@gjsify/unit';

import type { StoreEntry } from '../listing/build.js';
import { storeManifest } from '../listing/store-json.js';
import { storePreviewHtml } from './store-preview.js';

const entry: StoreEntry = {
    name: 'Ex <ample>',
    summary: 'Sum',
    description: 'Desc',
    singlePurpose: 'One',
    permissions: [{ permission: 'tabs', justification: 'Why' }],
    category: 'tools',
};
const files = {
    icon: 'icon-128.png',
    screenshots: ['screenshots/01-a.png'],
    promo: { small: 'promo-small-440x280.png' },
};

export default async () => {
    await describe('store preview', async () => {
        const manifest = storeManifest({ app: 'x', store: 'cws', entries: { en: entry, de: entry }, files });
        const html = storePreviewHtml({
            app: 'x',
            stores: [{ manifest, entries: { en: entry, de: entry }, files }],
            t: (language) => (msgid) => (language === 'de' && msgid === 'Screenshot' ? 'Bildschirmfoto' : msgid),
        });
        await it('escapes listing text and links the store files', async () => {
            expect(html.includes('Ex &lt;ample&gt;')).toBe(true);
            expect(html.includes('src="cws/screenshots/01-a.png"')).toBe(true);
            expect(html.includes('src="cws/promo-small-440x280.png"')).toBe(true);
        });
        await it('supports both colour schemes and narrow screens', async () => {
            expect(html.includes('prefers-color-scheme:dark')).toBe(true);
            expect(html.includes('width=device-width')).toBe(true);
        });
        await it('translates the page chrome per language', async () => {
            expect(html.includes('alt="Bildschirmfoto"')).toBe(true);
        });
        await it('flags a required field with no value', async () => {
            const bare = storeManifest({
                app: 'x',
                store: 'cws',
                entries: { en: entry },
                files: { screenshots: [], promo: {} },
            });
            const page = storePreviewHtml({
                app: 'x',
                stores: [{ manifest: bare, entries: { en: entry }, files: { screenshots: [], promo: {} } }],
                t: () => (m) => m,
            });
            expect(page.includes('class="missing"')).toBe(true);
        });
    });
};
