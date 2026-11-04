import { describe, expect, it } from '@gjsify/unit';

import { parseMetainfo } from '../site-data/metainfo.js';
import { parseCatalog } from '../site-data/po.js';
import { buildListingModel, checkEntry, type StoreEntry } from './build.js';
import { parseListingConfig } from './config.js';
import { fitInto, parseHexColor, planPlacement } from './fit.js';
import { descriptionHtml, descriptionText } from './text.js';

const METAINFO = `<?xml version="1.0"?>
<component type="addon">
  <id>eu.example.app</id>
  <name>Example</name>
  <summary>Does one thing</summary>
  <summary xml:lang="de">Macht eine Sache</summary>
  <description>
    <p>First paragraph.</p>
    <p xml:lang="de">Erster Absatz.</p>
    <ul><li>One</li><li>Two &amp; three</li></ul>
  </description>
  <url type="homepage">https://example.eu/</url>
  <url type="donation">https://example.eu/donate</url>
  <url type="privacy">https://example.eu/privacy</url>
</component>`;

const config = (extra: object = {}) =>
    parseListingConfig({ gjsify: { webext: { listing: { metainfo: 'm.xml', languages: ['en', 'de'], ...extra } } } });

const entry = (over: Partial<StoreEntry> = {}): StoreEntry => ({
    name: 'Example',
    summary: 'Does one thing',
    description: 'x'.repeat(300),
    singlePurpose: 'One purpose',
    permissions: [],
    category: 'Tools',
    ...over,
});

export default async () => {
    await describe('listing config', async () => {
        await it('falls back to the gjsify.site values', async () => {
            const parsed = parseListingConfig({
                gjsify: { site: { metainfo: 'a.xml', languages: ['en', 'de'], repository: 'o/r', translations: 'po' } },
            });
            expect(parsed.metainfo).toBe('a.xml');
            expect(parsed.languages.length).toBe(2);
            expect(parsed.repository).toBe('o/r');
            expect(parsed.translations).toBe('po');
        });

        await it('lets the override win and names the key on error', async () => {
            expect(
                parseListingConfig({ gjsify: { site: { metainfo: 'a.xml' } } }, { metainfo: 'b.xml' }).metainfo,
            ).toBe('b.xml');
            expect(() => parseListingConfig({})).toThrow();
            expect(() => config({ category: { opera: 'x' } })).toThrow();
        });
    });

    await describe('listing field mapping', async () => {
        const metainfo = parseMetainfo(METAINFO);

        await it('resolves metainfo translations per language', async () => {
            const model = buildListingModel({ metainfo, config: config(), catalogs: {} });
            expect(model.stores.cws?.en?.summary).toBe('Does one thing');
            expect(model.stores.cws?.de?.summary).toBe('Macht eine Sache');
            expect(model.stores.cws?.de?.description.startsWith('Erster Absatz.')).toBe(true);
        });

        await it('never carries the donation URL and prefers the metainfo privacy URL', async () => {
            const model = buildListingModel({
                metainfo,
                config: config({ privacyUrl: 'https://other/' }),
                catalogs: {},
            });
            const json = JSON.stringify(model.stores);
            expect(json.includes('donate')).toBe(false);
            expect(model.stores.amo?.en?.privacyUrl).toBe('https://example.eu/privacy');
        });

        await it('looks config strings up in the catalogue and warns about a missing msgid', async () => {
            const cfg = config({ singlePurpose: 'Do it' });
            const catalogs = { de: parseCatalog('msgid "Do it"\nmsgstr "Mach es"\n') };
            const model = buildListingModel({ metainfo, config: cfg, catalogs });
            expect(model.stores.cws?.de?.singlePurpose).toBe('Mach es');
            expect(model.msgids.includes('Do it')).toBe(true);
            const missing = buildListingModel({ metainfo, config: cfg, catalogs: {} });
            expect(missing.warnings.some((w) => w.includes('"de"') && w.includes('Do it'))).toBe(true);
        });

        await it('only emits HTML for AMO', async () => {
            const model = buildListingModel({ metainfo, config: config(), catalogs: {} });
            expect(model.stores.amo?.en?.descriptionHtml?.includes('<li>Two &amp; three</li>')).toBe(true);
            expect(model.stores.cws?.en?.descriptionHtml).toBe(undefined);
        });

        await it('renders paragraphs and bullets as plain text', async () => {
            const text = descriptionText(metainfo.description, (t) => t.source);
            expect(text).toBe('First paragraph.\n\n• One\n• Two & three');
            expect(descriptionHtml(metainfo.description, (t) => t.source).startsWith('<p>First paragraph.</p>')).toBe(
                true,
            );
        });
    });

    await describe('listing limit checks', async () => {
        await it('accepts a valid entry', async () => {
            expect(checkEntry('cws', 'en', entry()).length).toBe(0);
        });

        await it('names store, language, field and limit', async () => {
            const [issue] = checkEntry('amo', 'de', entry({ name: 'n'.repeat(51) }));
            expect(issue?.field).toBe('name');
            expect(issue?.message.includes('Firefox Add-ons')).toBe(true);
            expect(issue?.message.includes('[de]')).toBe(true);
            expect(issue?.message.includes('limit 50')).toBe(true);
        });

        await it('enforces the Edge description minimum and the AMO no-URL summary', async () => {
            expect(checkEntry('edge', 'en', entry({ description: 'short' })).length).toBe(1);
            expect(checkEntry('amo', 'en', entry({ summary: 'See https://x.eu' })).length).toBe(1);
        });

        await it('requires the single purpose and a justification per permission on CWS', async () => {
            const issues = checkEntry(
                'cws',
                'en',
                entry({ singlePurpose: '', permissions: [{ permission: 'tabs', justification: '' }] }),
            );
            expect(issues.length).toBe(2);
        });

        await it('counts code points, not UTF-16 units', async () => {
            expect(checkEntry('amo', 'en', entry({ name: '😀'.repeat(50) })).length).toBe(0);
        });
    });

    await describe('listing image geometry', async () => {
        await it('letterboxes a narrow shot centred', async () => {
            const fit = fitInto({ width: 400, height: 800 }, { width: 1280, height: 800 });
            expect(fit.width).toBe(400);
            expect(fit.x).toBe(440);
            expect(fit.y).toBe(0);
        });

        await it('scales a large shot down to the box', async () => {
            const fit = fitInto({ width: 2560, height: 1600 }, { width: 1280, height: 800 });
            expect(fit.width).toBe(1280);
            expect(fit.height).toBe(800);
        });

        await it('refuses a blurry enlargement and allows a modest one', async () => {
            expect(planPlacement({ width: 200, height: 100 }, { width: 1280, height: 800 }).ok).toBe(false);
            expect(planPlacement({ width: 700, height: 440 }, { width: 1280, height: 800 }).ok).toBe(true);
        });

        await it('parses hex colours', async () => {
            expect(parseHexColor('#d9c2f0')).toBe(0xd9c2f0);
            expect(parseHexColor('#fff')).toBe(0xffffff);
            expect(parseHexColor('#12345678')).toBe(undefined);
        });
    });
};
