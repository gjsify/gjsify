import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';

import { parseMetainfo } from '../site-data/metainfo.js';
import { parseCatalog } from '../site-data/po.js';
import { buildListingModel, checkEntry, type StoreEntry } from './build.js';
import { parseListingConfig } from './config.js';
import { captionTargets, hasOwnPromo, listingScreenshots } from './images.js';
import { fitInto, parseHexColor, planPlacement } from './fit.js';
import { parseStores, STORE_SPECS } from './limits.js';
import { promoFileName, promoSvg } from './promo.js';
import { storeManifest } from './store-json.js';
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

        await it('parses omit and rejects a wrong type', async () => {
            expect(config().omit.length).toBe(0);
            expect(config({ omit: ['A'] }).omit[0]).toBe('A');
            expect(() => config({ omit: 'A' })).toThrow();
            expect(() => config({ omit: [1] })).toThrow();
            expect(() => config({ omit: [''] })).toThrow();
        });

        await it('parses reviewerNotes and privacySummary and rejects empty ones', async () => {
            expect(config().reviewerNotes).toBe(undefined);
            expect(config().privacySummary).toBe(undefined);
            expect(config({ reviewerNotes: 'Log in with test.' }).reviewerNotes).toBe('Log in with test.');
            expect(config({ privacySummary: 'Nothing leaves your device.' }).privacySummary).toBe(
                'Nothing leaves your device.',
            );
            expect(() => config({ reviewerNotes: '' })).toThrow();
            expect(() => config({ privacySummary: 1 })).toThrow();
        });

        await it('parses intro and rejects an empty one', async () => {
            expect(config().intro).toBe(undefined);
            expect(config({ intro: 'Needs the app.' }).intro).toBe('Needs the app.');
            expect(() => config({ intro: '' })).toThrow();
        });
    });

    await describe('listing captions config', async () => {
        await it('parses captions and rejects wrong types', async () => {
            expect(Object.keys(config().captions).length).toBe(0);
            expect(config({ captions: { '01-hero.png': 'Hero' } }).captions['01-hero.png']).toBe('Hero');
            expect(() => config({ captions: ['01-hero.png'] })).toThrow();
            expect(() => config({ captions: 'Hero' })).toThrow();
            expect(() => config({ captions: { '01-hero.png': 1 } })).toThrow();
            expect(() => config({ captions: { '01-hero.png': '' } })).toThrow();
        });
    });

    await describe('listing search terms', async () => {
        const keywords = (terms: string) =>
            parseMetainfo(METAINFO.replace('<url type="homepage"', `${terms}<url type="homepage"`));

        await it('localizes the keywords per language and only for Edge', async () => {
            const metainfo = keywords(
                '<keywords><keyword>tabs</keyword><keyword xml:lang="de">Tabs</keyword><keyword>history</keyword></keywords>',
            );
            const catalogs = { de: parseCatalog('msgid "history"\nmsgstr "Verlauf"\n') };
            const model = buildListingModel({ metainfo, config: config(), catalogs });
            expect(model.stores.edge?.en?.searchTerms?.join()).toBe('tabs,history');
            expect(model.stores.edge?.de?.searchTerms?.join()).toBe('Tabs,Verlauf');
            expect(model.stores.cws?.en?.searchTerms).toBe(undefined);
            expect(model.stores.amo?.en?.searchTerms).toBe(undefined);
            expect(model.issues.filter((issue) => issue.field === 'searchTerms').length).toBe(0);
        });

        await it('documents Edge limits with their source', async () => {
            const limit = STORE_SPECS.edge.searchTerms;
            expect(limit?.maxTerms).toBe(7);
            expect(limit?.maxCharacters).toBe(30);
            expect(limit?.maxWords).toBe(21);
            expect(limit?.verified).toBe(true);
            expect(STORE_SPECS.cws.searchTerms).toBe(undefined);
            expect(STORE_SPECS.amo.searchTerms).toBe(undefined);
        });

        await it('errors on more than seven terms', async () => {
            const issues = checkEntry('edge', 'en', entry({ searchTerms: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }));
            expect(issues.length).toBe(1);
            expect(issues[0]?.message.includes('8 terms, limit 7')).toBe(true);
            expect(checkEntry('edge', 'en', entry({ searchTerms: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })).length).toBe(
                0,
            );
        });

        await it('errors on a term over 30 characters, counting code points', async () => {
            expect(checkEntry('edge', 'de', entry({ searchTerms: ['x'.repeat(31)] })).length).toBe(1);
            expect(checkEntry('edge', 'de', entry({ searchTerms: ['x'.repeat(30)] })).length).toBe(0);
            expect(checkEntry('edge', 'de', entry({ searchTerms: ['😀'.repeat(30)] })).length).toBe(0);
        });

        await it('errors on more than 21 words across all terms', async () => {
            const seven = 'one two three four';
            const over = checkEntry(
                'edge',
                'en',
                entry({ searchTerms: Array(6).fill(seven).slice(0, 5).concat(['a b']) }),
            );
            expect(over.some((issue) => issue.message.includes('22 words, limit 21'))).toBe(true);
            const ok = checkEntry(
                'edge',
                'en',
                entry({ searchTerms: ['a b c', 'd e f', 'g h i', 'j k l', 'm n o', 'p q r', 's t u'] }),
            );
            expect(ok.length).toBe(0);
        });

        await it('reports the violation through the model for the right language', async () => {
            const long = 'k'.repeat(31);
            const metainfo = keywords(`<keywords><keyword>${long}</keyword></keywords>`);
            const model = buildListingModel({ metainfo, config: config(), catalogs: {}, stores: ['edge'] });
            const terms = model.issues.filter((issue) => issue.field === 'searchTerms');
            expect(terms.length).toBe(2);
            expect(
                terms
                    .map((issue) => issue.language)
                    .sort()
                    .join(),
            ).toBe('de,en');
            expect(terms.every((issue) => issue.store === 'edge')).toBe(true);
        });

        await it('lists the per-language file in store.json', async () => {
            const m = storeManifest({
                app: 'x',
                store: 'edge',
                entries: { en: entry({ searchTerms: ['a'] }), de: entry({ searchTerms: ['b'] }) },
                files: { screenshots: [], promo: {} },
            });
            const terms = m.fields.find((f) => f.key === 'searchTerms')!;
            expect(terms.files?.join()).toBe('en/search-terms.txt,de/search-terms.txt');
        });
    });

    await describe('listing screenshot captions', async () => {
        const metainfo = parseMetainfo(METAINFO);
        const catalogs = { de: parseCatalog('msgid "The hero"\nmsgstr "Das Hauptbild"\n') };
        const cfg = config({ captions: { '01-hero.png': 'The hero' } });

        await it('translates captions through the catalogue, for AMO and Edge', async () => {
            const model = buildListingModel({ metainfo, config: cfg, catalogs });
            expect(model.stores.amo?.en?.captions?.['01-hero.png']).toBe('The hero');
            expect(model.stores.amo?.de?.captions?.['01-hero.png']).toBe('Das Hauptbild');
            expect(model.stores.cws?.en?.captions).toBe(undefined);
            expect(model.stores.edge?.en?.captions?.['01-hero.png']).toBe('The hero');
            expect(model.stores.edge?.de?.captions?.['01-hero.png']).toBe('Das Hauptbild');
            expect(STORE_SPECS.edge.screenshotCaptions?.url.startsWith('https://')).toBe(true);
            expect(STORE_SPECS.amo.screenshotCaptions?.url.startsWith('https://')).toBe(true);
        });

        await it('lists captions in --pot even when AMO is not selected, and warns on a missing translation', async () => {
            const model = buildListingModel({ metainfo, config: cfg, catalogs: {}, stores: ['edge'] });
            expect(model.msgids.includes('The hero')).toBe(true);
            expect(model.warnings.some((w) => w.includes('"de"') && w.includes('The hero'))).toBe(true);
        });

        await it('puts the captions in store.json next to the screenshots', async () => {
            const m = storeManifest({
                app: 'x',
                store: 'amo',
                entries: { en: entry(), de: entry() },
                files: {
                    screenshots: ['screenshots/01-hero.png'],
                    promo: {},
                    captions: { en: 'screenshots/captions.en.json', de: 'screenshots/captions.de.json' },
                },
                captions: { en: { '01-hero.png': 'The hero' }, de: { '01-hero.png': 'Das Hauptbild' } },
            });
            const field = m.fields.find((f) => f.key === 'screenshotCaptions')!;
            expect(field.status).toBe('derived');
            expect(field.captions?.de?.['01-hero.png']).toBe('Das Hauptbild');
            expect(field.files?.join()).toBe('screenshots/captions.en.json,screenshots/captions.de.json');
            expect(
                storeManifest({
                    app: 'x',
                    store: 'cws',
                    entries: { en: entry() },
                    files: { screenshots: [], promo: {} },
                }).fields.some((f) => f.key === 'screenshotCaptions'),
            ).toBe(false);
        });

        await it('maps a caption key to the kit file name and errors on an unknown screenshot', async () => {
            const root = mkdtempSync(join(tmpdir(), 'listing-captions-'));
            mkdirSync(join(root, 'shots'));
            writeFileSync(join(root, 'shots', '01-hero.png'), 'x');
            writeFileSync(join(root, 'shots', '02-popup.png'), 'x');
            const make = (captions: object) => config({ screenshots: 'shots', captions });
            const sets = async (captions: object) => {
                const c = make(captions);
                return captionTargets(c, await listingScreenshots(metainfo, c, root, {}));
            };
            const targets = await sets({ '01-hero.png': 'A', '02-popup.png': 'B' });
            expect(targets['01-hero.png']).toBe('01-hero.png');
            expect(targets['02-popup.png']).toBe('02-popup.png');
            let message = '';
            try {
                await sets({ '01-hero.png': 'A', '03-typo.png': 'B' });
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message.includes('"03-typo.png"')).toBe(true);
            expect(message.includes('01-hero.png, 02-popup.png')).toBe(true);
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

    await describe('listing omit', async () => {
        const metainfo = parseMetainfo(METAINFO);
        const omitted = (omit: string[], extra: Partial<Parameters<typeof buildListingModel>[0]> = {}) =>
            buildListingModel({ metainfo, config: config({ omit }), catalogs: {}, ...extra });

        await it('removes a paragraph in every language, text and HTML', async () => {
            const model = omitted(['First paragraph.']);
            for (const language of ['en', 'de']) {
                const entry = model.stores.amo?.[language];
                expect(entry?.description).toBe('• One\n• Two & three');
                expect(entry?.descriptionHtml?.includes('<p>')).toBe(false);
                expect(model.stores.cws?.[language]?.description.includes('paragraph')).toBe(false);
                expect(model.stores.cws?.[language]?.description.includes('Absatz')).toBe(false);
            }
        });

        await it('removes one list item and drops a list left empty', async () => {
            const one = omitted(['One']);
            expect(one.stores.cws?.en?.description).toBe('First paragraph.\n\n• Two & three');
            const both = omitted(['One', 'Two & three']);
            expect(both.stores.amo?.en?.descriptionHtml?.includes('<ul>')).toBe(false);
        });

        await it('leaves the metainfo untouched for the website path', async () => {
            omitted(['First paragraph.']);
            expect(descriptionText(metainfo.description, (t) => t.source)).toBe(
                'First paragraph.\n\n• One\n• Two & three',
            );
        });

        await it('throws on an entry that matches nothing', async () => {
            expect(() => omitted(['First paragraph', 'First paragraph.'])).toThrow();
        });
    });

    await describe('listing intro', async () => {
        const metainfo = parseMetainfo(METAINFO);
        const intro = 'Needs the free app & a browser.';

        await it('puts the intro first in every store description, text and HTML', async () => {
            const model = buildListingModel({ metainfo, config: config({ intro }), catalogs: {} });
            expect(model.stores.cws?.en?.description).toBe(`${intro}\n\nFirst paragraph.\n\n• One\n• Two & three`);
            expect(
                model.stores.amo?.en?.descriptionHtml?.startsWith('<p>Needs the free app &amp; a browser.</p>\n<p>'),
            ).toBe(true);
        });

        await it('translates the intro from the listing catalogue and warns when it is missing', async () => {
            const catalogs = { de: parseCatalog(`msgid "${intro}"\nmsgstr "Braucht die App."\n`) };
            const de = buildListingModel({ metainfo, config: config({ intro }), catalogs });
            expect(de.stores.edge?.de?.description.startsWith('Braucht die App.\n\n')).toBe(true);
            expect(de.msgids.includes(intro)).toBe(true);
            const none = buildListingModel({ metainfo, config: config({ intro }), catalogs: {} });
            expect(none.warnings.some((w) => w.includes(intro))).toBe(true);
        });

        await it('leaves the description alone without an intro', async () => {
            const model = buildListingModel({ metainfo, config: config(), catalogs: {} });
            expect(model.stores.cws?.en?.description).toBe('First paragraph.\n\n• One\n• Two & three');
        });
    });

    await describe('listing reviewer notes and privacy text', async () => {
        const metainfo = parseMetainfo(METAINFO);
        const reviewerNotes = 'Open the options page to test.';
        const privacySummary = 'Nothing leaves your device.';
        const both = { reviewerNotes, privacySummary };
        const files = { icon: 'icon-128.png', screenshots: ['screenshots/01-a.png'], promo: {} };
        const field = (m: ReturnType<typeof storeManifest>, key: string) => m.fields.find((f) => f.key === key)!;

        await it('carries each text only on the stores whose form has the field', async () => {
            const model = buildListingModel({ metainfo, config: config(both), catalogs: {} });
            expect(model.stores.cws?.en?.reviewerNotes).toBe(undefined);
            expect(model.stores.cws?.en?.privacySummary).toBe(undefined);
            expect(model.stores.edge?.en?.reviewerNotes).toBe(reviewerNotes);
            expect(model.stores.edge?.en?.privacySummary).toBe(undefined);
            expect(model.stores.amo?.en?.reviewerNotes).toBe(reviewerNotes);
            expect(model.stores.amo?.en?.privacySummary).toBe(privacySummary);
        });

        await it('translates both and warns when a translation is missing', async () => {
            const catalogs = {
                de: parseCatalog(
                    `msgid "${reviewerNotes}"\nmsgstr "Zum Testen die Optionen öffnen."\n\nmsgid "${privacySummary}"\nmsgstr "Nichts verlässt dein Gerät."\n`,
                ),
            };
            const de = buildListingModel({ metainfo, config: config(both), catalogs });
            expect(de.stores.amo?.de?.reviewerNotes).toBe('Zum Testen die Optionen öffnen.');
            expect(de.stores.amo?.de?.privacySummary).toBe('Nichts verlässt dein Gerät.');
            expect(de.msgids.includes(reviewerNotes) && de.msgids.includes(privacySummary)).toBe(true);
            const none = buildListingModel({ metainfo, config: config(both), catalogs: {} });
            expect(none.warnings.some((w) => w.includes(reviewerNotes))).toBe(true);
            expect(none.warnings.some((w) => w.includes(privacySummary))).toBe(true);
        });

        await it('derives the manifest fields when set, files named per language', async () => {
            const model = buildListingModel({ metainfo, config: config(both), catalogs: {} });
            const edge = storeManifest({ app: 'x', store: 'edge', entries: model.stores.edge!, files });
            expect(field(edge, 'certificationNotes').status).toBe('derived');
            expect(field(edge, 'certificationNotes').files?.[0]).toBe('en/reviewer-notes.txt');
            const amo = storeManifest({ app: 'x', store: 'amo', entries: model.stores.amo!, files });
            expect(field(amo, 'reviewerNotes').status).toBe('derived');
            expect(field(amo, 'privacyText').status).toBe('derived');
            expect(field(amo, 'privacyText').files?.[1]).toBe('de/privacy.txt');
        });

        await it('keeps Edge manual and AMO omitted without the config', async () => {
            const model = buildListingModel({ metainfo, config: config(), catalogs: {} });
            const edge = storeManifest({ app: 'x', store: 'edge', entries: model.stores.edge!, files });
            expect(field(edge, 'certificationNotes').status).toBe('manual');
            const amo = storeManifest({ app: 'x', store: 'amo', entries: model.stores.amo!, files });
            expect(field(amo, 'reviewerNotes').status).toBe('omitted');
            expect(field(amo, 'privacyText').status).toBe('omitted');
        });

        await it('stays manual on Edge when only some languages have the text', async () => {
            const m = storeManifest({
                app: 'x',
                store: 'edge',
                entries: { en: entry({ reviewerNotes }), de: entry() },
                files,
            });
            expect(field(m, 'certificationNotes').status).toBe('manual');
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

    await describe('listing --stores', async () => {
        await it('expands all, lists and single stores in canonical order', async () => {
            expect(parseStores('all').join()).toBe('cws,edge,amo');
            expect(parseStores('amo,cws').join()).toBe('cws,amo');
            expect(parseStores('edge').join()).toBe('edge');
        });
        await it('names an unknown store', async () => {
            expect(() => parseStores('cws,opera')).toThrow();
        });
    });

    await describe('store.json', async () => {
        const files = {
            icon: 'icon-128.png',
            screenshots: ['screenshots/01-a.png'],
            promo: { small: 'promo-small-440x280.png' },
        };
        const field = (m: ReturnType<typeof storeManifest>, key: string) => m.fields.find((f) => f.key === key)!;
        await it('marks derived, manual and missing fields', async () => {
            const m = storeManifest({ app: 'x', store: 'cws', entries: { en: entry() }, files });
            expect(field(m, 'name').status).toBe('derived');
            expect(field(m, 'name').limit?.max).toBe(75);
            expect(field(m, 'dataUsage').status).toBe('manual');
            expect(field(m, 'promoMarquee').status).toBe('omitted');
            expect(field(m, 'privacyUrl').status).toBe('missing');
        });
        await it('reports sizes, counts and file paths', async () => {
            const m = storeManifest({ app: 'x', store: 'cws', entries: { en: entry() }, files });
            expect(field(m, 'promoSmall').size?.width).toBe(440);
            expect(field(m, 'screenshots').count?.max).toBe(5);
            expect(field(m, 'screenshots').files?.[0]).toBe('screenshots/01-a.png');
            expect(field(m, 'description').files?.[0]).toBe('en/description.txt');
        });
        await it('flags a missing required file', async () => {
            const m = storeManifest({
                app: 'x',
                store: 'cws',
                entries: { en: entry() },
                files: { screenshots: [], promo: {} },
            });
            expect(field(m, 'promoSmall').status).toBe('missing');
            expect(field(m, 'screenshots').status).toBe('missing');
        });
        await it('carries Edge search terms and omits the optional tile', async () => {
            const m = storeManifest({
                app: 'x',
                store: 'edge',
                entries: { en: entry({ searchTerms: ['a', 'b'] }) },
                files,
            });
            expect(field(m, 'searchTerms').status).toBe('derived');
            expect(field(m, 'promoSmall').status).toBe('derived');
            expect(STORE_SPECS.amo.promo.length).toBe(0);
        });
    });

    await describe('promo tile svg', async () => {
        await it('has the exact size, escapes text and names the file', async () => {
            const spec = { kind: 'small' as const, width: 440, height: 280 };
            const svg = promoSvg(spec, {
                name: 'A<b>',
                summary: 'Does one thing',
                background: '#fff',
                foreground: '#000',
            });
            expect(svg.includes('width="440" height="280"')).toBe(true);
            expect(svg.includes('A&lt;b&gt;')).toBe(true);
            expect(promoFileName(spec)).toBe('promo-small-440x280.png');
        });
        await it('lays a marquee out beside the icon', async () => {
            const svg = promoSvg(
                { width: 1400, height: 560 },
                {
                    name: 'App',
                    summary: 'S',
                    background: '#fff',
                    foreground: '#000',
                    iconHref: 'data:image/png;base64,AA',
                },
            );
            expect(svg.includes('<image')).toBe(true);
            expect(svg.includes('text-anchor')).toBe(false);
        });
    });

    await describe('listing per language', async () => {
        const root = mkdtempSync(join(tmpdir(), 'listing-lang-'));
        for (const name of ['a.png', 'a-de.png']) writeFileSync(join(root, name), 'x');
        const meta = parseMetainfo(`<component><id>eu.example.app</id><name>Example</name><summary>S</summary>
          <screenshots><screenshot type="default"><image>https://raw.githubusercontent.com/o/r/v1/a.png</image>
          <image xml:lang="de">https://raw.githubusercontent.com/o/r/v1/a-de.png</image></screenshot></screenshots></component>`);
        const cfg = config({ repository: 'o/r' });

        await it('flags what each store localizes', async () => {
            expect(STORE_SPECS.cws.localized.screenshots).toBe(true);
            expect(STORE_SPECS.cws.localized.promo).toBe(false);
            expect(STORE_SPECS.edge.localized.promo).toBe(true);
            expect(STORE_SPECS.amo.localized.screenshots).toBe(false);
        });

        await it('picks the xml:lang image from the metainfo', async () => {
            const sets = await listingScreenshots(meta, cfg, root, {});
            expect(sets.source[0]?.slug).toBe('a');
            expect(sets.byLanguage.de?.[0]?.slug).toBe('a-de');
        });

        await it('has no per-language set without a translated image', async () => {
            const plain = parseMetainfo(
                '<component><id>x</id><name>E</name><summary>S</summary><screenshots><screenshot><image>https://raw.githubusercontent.com/o/r/v1/a.png</image></screenshot></screenshots></component>',
            );
            const sets = await listingScreenshots(plain, cfg, root, {});
            expect(Object.keys(sets.byLanguage).length).toBe(0);
        });

        await it('takes the source language subdirectory when the directory has no loose files', async () => {
            const dir = join(root, 'shots-by-language');
            mkdirSync(join(dir, 'en'), { recursive: true });
            mkdirSync(join(dir, 'de'), { recursive: true });
            writeFileSync(join(dir, 'en', '1.png'), 'x');
            writeFileSync(join(dir, 'de', '1.png'), 'x');
            const sets = await listingScreenshots(meta, config({ screenshots: 'shots-by-language' }), root, {});
            expect(sets.source.length).toBe(1);
            expect(sets.byLanguage.de?.length).toBe(1);
        });

        await it('ignores screenshotsDark: the store kit holds only the light set', async () => {
            const dir = join(root, 'with-dark');
            mkdirSync(join(dir, 'light'), { recursive: true });
            mkdirSync(join(dir, 'dark'), { recursive: true });
            writeFileSync(join(dir, 'light', '1-a.png'), 'x');
            writeFileSync(join(dir, 'dark', '1-a.png'), 'x');
            writeFileSync(join(dir, 'dark', '2-only-dark.png'), 'x');
            const cfg = config({ screenshots: 'with-dark/light', screenshotsDark: 'with-dark/dark' });
            expect(cfg.screenshotsDark).toBe('with-dark/dark');
            const sets = await listingScreenshots(meta, cfg, root, {});
            expect(sets.source.length).toBe(1);
            expect(sets.source.every((shot) => !shot.file.includes('/dark/'))).toBe(true);
            expect(Object.keys(sets.byLanguage).length).toBe(0);
            expect(() => config({ screenshotsDark: '/abs' })).toThrow();
        });

        await it('reads <dir>/<lang>/ subdirectories of a configured directory', async () => {
            const dir = join(root, 'shots');
            mkdirSync(join(dir, 'de'), { recursive: true });
            writeFileSync(join(dir, '1.png'), 'x');
            writeFileSync(join(dir, 'de', '1.png'), 'x');
            const sets = await listingScreenshots(meta, config({ screenshots: 'shots' }), root, {});
            expect(sets.source.length).toBe(1);
            expect(sets.byLanguage.de?.length).toBe(1);
            expect(sets.byLanguage.de?.[0]?.file.includes('/de/')).toBe(true);
        });

        await it('takes the source set from <dir>/<source>/ when the directory itself holds none', async () => {
            const dir = join(root, 'by-lang');
            mkdirSync(join(dir, 'en'), { recursive: true });
            mkdirSync(join(dir, 'de'), { recursive: true });
            writeFileSync(join(dir, 'en', '01-hero.png'), 'x');
            writeFileSync(join(dir, 'de', '01-hero.png'), 'x');
            const sets = await listingScreenshots(meta, config({ screenshots: 'by-lang' }), root, {});
            expect(sets.source.length).toBe(1);
            expect(sets.source[0]?.file.includes('/en/')).toBe(true);
            expect(sets.byLanguage.de?.[0]?.file.includes('/de/')).toBe(true);
        });

        await it('drops a leading ordinal from file names, since the output numbers them itself', async () => {
            const dir = join(root, 'ordinals');
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, '01-hero.png'), 'x');
            writeFileSync(join(dir, '2_popup.png'), 'x');
            writeFileSync(join(dir, '3.png'), 'x');
            const sets = await listingScreenshots(meta, config({ screenshots: 'ordinals' }), root, {});
            expect(sets.source.map((shot) => shot.slug).join(',')).toBe('hero,popup,3');
        });

        await it('renders Edge promo per language and keeps Chrome shared', async () => {
            const en = { name: 'Example', summary: 'Does one thing' };
            const de = { name: 'Example', summary: 'Macht eine Sache' };
            expect(hasOwnPromo('edge', de, en)).toBe(true);
            expect(hasOwnPromo('cws', de, en)).toBe(false);
            expect(hasOwnPromo('amo', de, en)).toBe(false);
            expect(hasOwnPromo('edge', en, en)).toBe(false);
            const spec = { width: 440, height: 280 };
            const svg = promoSvg(spec, { ...de, background: '#fff', foreground: '#000' });
            expect(svg.includes('Macht eine Sache')).toBe(true);
        });

        await it('lists per-language files in store.json', async () => {
            const m = storeManifest({
                app: 'x',
                store: 'edge',
                entries: { en: entry(), de: entry() },
                files: {
                    screenshots: ['screenshots/01-a.png'],
                    promo: { small: 'promo-small-440x280.png' },
                    byLanguage: {
                        de: {
                            screenshots: ['de/screenshots/01-a.png'],
                            promo: { small: 'de/promo-small-440x280.png' },
                        },
                    },
                },
            });
            const shots = m.fields.find((f) => f.key === 'screenshots')!;
            expect(shots.filesByLanguage?.de?.[0]).toBe('de/screenshots/01-a.png');
            const tile = m.fields.find((f) => f.key === 'promoSmall')!;
            expect(tile.filesByLanguage?.de?.[0]).toBe('de/promo-small-440x280.png');
        });
    });
};
