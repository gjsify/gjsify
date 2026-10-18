// SPDX-License-Identifier: MIT
// Flathub quality rules, one good and one bad fixture per rule.
// Pure string work: runs on GJS and Node.

import { describe, expect, it } from '@gjsify/unit';
import {
    type ImageInfo,
    type QualityOptions,
    lintMetainfo,
    readImageInfo,
    summarizeFindings,
} from './metainfo-quality.js';

const GOOD = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>org.example.Notes</id>
  <name>Notes</name>
  <name xml:lang="de">Notizen</name>
  <summary>Write notes in style</summary>
  <summary xml:lang="de">Gedanken festhalten</summary>
  <description>
    <p>Notes keeps your thoughts in one place. Organise them in notebooks, search across everything and export to plain text whenever you like.</p>
    <ul><li>One</li><li>Two</li></ul>
  </description>
  <branding>
    <color type="primary" scheme_preference="light">#faa298</color>
    <color type="primary" scheme_preference="dark">#7f2c22</color>
  </branding>
  <screenshots>
    <screenshot type="default">
      <caption>The notebook overview</caption>
      <image type="source">shot.png</image>
    </screenshot>
    <screenshot>
      <caption xml:lang="de">Die Notizansicht</caption>
      <image type="source">shot2.png</image>
    </screenshot>
  </screenshots>
  <releases>
    <release version="1.1" date="2026-01-02"><description><p>Adds notebook export and fixes a crash on startup.</p></description></release>
  </releases>
</component>`;

const patch = (from: string, to: string): string => {
    expect(GOOD.includes(from)).toBe(true);
    return GOOD.replace(from, to);
};

const rules = async (xml: string, options?: QualityOptions): Promise<string[]> =>
    (await lintMetainfo(xml, options)).map((f) => f.rule).sort();

export default async () => {
    await describe('lintMetainfo: good document', async () => {
        await it('has no findings', async () => {
            expect(await rules(GOOD)).toStrictEqual([]);
        });
        await it('reports no-component for a file without one', async () => {
            expect(await rules('<foo/>')).toStrictEqual(['no-component']);
        });
    });

    await describe('lintMetainfo: name', async () => {
        await it('errors at 20 characters, warns above 15', async () => {
            expect(await rules(patch('<name>Notes</name>', '<name>Minimal Markdown Editor</name>'))).toContain(
                'name-too-long',
            );
            const sixteen = await lintMetainfo(patch('<name>Notes</name>', '<name>Notes Collection</name>'));
            expect(sixteen.find((f) => f.rule === 'name-long')?.severity).toBe('warning');
        });
        await it('flags appended information', async () => {
            expect(await rules(patch('<name>Notes</name>', '<name>Notes - Take Notes</name>'))).toContain(
                'name-extra-info',
            );
            expect(await rules(patch('<name>Notes</name>', '<name>Fractal (Matrix)</name>'))).toContain(
                'name-extra-info',
            );
        });
        await it('flags lowercase, uppercase, camel case and dots', async () => {
            expect(await rules(patch('<name>Notes</name>', '<name>notes</name>'))).toContain('name-formatting');
            expect(await rules(patch('<name>Notes</name>', '<name>NOTES</name>'))).toContain('name-formatting');
            expect(await rules(patch('<name>Notes</name>', '<name>NotesEditor</name>'))).toContain('name-formatting');
            expect(await rules(patch('<name>Notes</name>', '<name>Notes.org</name>'))).toContain('name-formatting');
        });
        await it('reports the locale in the location', async () => {
            const found = await lintMetainfo(
                patch('<name xml:lang="de">Notizen</name>', '<name xml:lang="de">notizen</name>'),
            );
            expect(found[0].location).toBe('name[de]');
        });
    });

    await describe('lintMetainfo: summary', async () => {
        const withSummary = (s: string): string =>
            patch('<summary>Write notes in style</summary>', `<summary>${s}</summary>`);
        await it('errors above 35, warns outside 10..25', async () => {
            expect(await rules(withSummary('Simple, easy-to-use, distraction-free markdown editor'))).toContain(
                'summary-too-long',
            );
            expect(await rules(withSummary('Write your notes quickly'))).not.toContain('summary-length');
            expect(await rules(withSummary('Write plain text notes quick'))).toContain('summary-length');
            expect(await rules(withSummary('Notes'))).toContain('summary-length');
        });
        await it('flags a trailing full stop and title case', async () => {
            expect(await rules(withSummary('Write notes in style.'))).toContain('summary-full-stop');
            expect(await rules(withSummary('Write Your Notes Quickly'))).toContain('summary-title-case');
        });
        await it('flags articles per language', async () => {
            expect(await rules(withSummary('An image viewer'))).toContain('summary-article');
            expect(
                await rules(
                    patch(
                        '<summary xml:lang="de">Gedanken festhalten</summary>',
                        '<summary xml:lang="de">Der Notizblock</summary>',
                    ),
                ),
            ).toContain('summary-article');
        });
        await it('flags a repeated name', async () => {
            expect(await rules(withSummary('Notes made simple'))).toContain('summary-repeats-name');
        });
        await it('flags technical terms, whole words only', async () => {
            expect(await rules(withSummary('GTK4 chat for friends'))).toContain('summary-technical');
            expect(await rules(withSummary('Free open source editor'))).toContain('summary-technical');
            expect(await rules(withSummary('Rusty gadgets for everyone'))).not.toContain('summary-technical');
        });
        await it('takes a configurable term list', async () => {
            expect(await rules(withSummary('Write with Vala'), { technicalTerms: ['Vala'] })).toContain(
                'summary-technical',
            );
            expect(await rules(withSummary('GTK4 chat for friends'), { technicalTerms: ['Vala'] })).not.toContain(
                'summary-technical',
            );
        });
    });

    await describe('lintMetainfo: description', async () => {
        await it('flags a short description and a repeated summary', async () => {
            const short = patch(
                /<description>[\s\S]*?<\/description>/.exec(GOOD)![0],
                '<description><p>Write notes in style</p></description>',
            );
            const found = await rules(short);
            expect(found).toContain('description-short');
            expect(found).toContain('description-repeats-summary');
        });
        await it('flags lists above 10 items', async () => {
            const items = Array.from({ length: 11 }, (_, i) => `<li>Item ${i}</li>`).join('');
            expect(await rules(patch('<li>One</li><li>Two</li>', items))).toContain('description-long-list');
        });
    });

    await describe('lintMetainfo: branding', async () => {
        await it('warns when a scheme is missing', async () => {
            expect(await rules(patch('<color type="primary" scheme_preference="dark">#7f2c22</color>', ''))).toContain(
                'branding-missing',
            );
        });
        await it('flags identical, dull and inverted colours', async () => {
            const same = patch('#7f2c22', '#faa298');
            expect(await rules(same)).toContain('branding-identical');
            const white = patch('#faa298', '#fefefe');
            expect(await rules(white)).toContain('branding-dull');
            const gray = patch('#7f2c22', '#222222');
            expect(await rules(gray)).toContain('branding-dull');
            const inverted = patch('#7f2c22', '#fcd5ce');
            expect(await rules(inverted)).toContain('branding-dark-not-darker');
        });
    });

    await describe('lintMetainfo: icon and image sizes', async () => {
        const probe =
            (table: Record<string, ImageInfo>) =>
            async (ref: string): Promise<ImageInfo | null> =>
                table[ref] ?? null;
        await it('errors on a small or non-square PNG icon, accepts SVG', async () => {
            const iconRefs = ['icon.png'];
            expect(
                await rules(GOOD, {
                    iconRefs,
                    probeImage: probe({ 'icon.png': { kind: 'raster', width: 128, height: 128 } }),
                }),
            ).toContain('icon-too-small');
            expect(
                await rules(GOOD, {
                    iconRefs,
                    probeImage: probe({ 'icon.png': { kind: 'raster', width: 512, height: 256 } }),
                }),
            ).toContain('icon-not-square');
            expect(await rules(GOOD, { iconRefs, probeImage: probe({ 'icon.png': { kind: 'svg' } }) })).toStrictEqual(
                [],
            );
        });
        await it('skips what the probe cannot answer', async () => {
            expect(await rules(GOOD, { iconRefs: ['gone.png'], probeImage: probe({}) })).toStrictEqual([]);
        });
        await it('warns on oversized screenshots', async () => {
            const big = probe({
                'shot.png': { kind: 'raster', width: 2400, height: 1500 },
                'shot2.png': { kind: 'raster', width: 1000, height: 700 },
            });
            const found = await lintMetainfo(GOOD, { probeImage: big });
            expect(found.map((f) => f.rule)).toStrictEqual(['screenshot-too-large']);
            expect(found[0].location).toBe('screenshot[1]');
        });
    });

    await describe('lintMetainfo: screenshots', async () => {
        await it('warns when there are none', async () => {
            expect(await rules(patch(/<screenshots>[\s\S]*<\/screenshots>/.exec(GOOD)![0], ''))).toContain(
                'screenshot-missing',
            );
        });
        await it('requires an English screenshot and default first', async () => {
            const onlyGerman = patch(
                '<screenshot type="default">',
                '<screenshot type="default" xml:lang="de">',
            ).replace(/<screenshot>\n/, '<screenshot xml:lang="de">\n');
            expect(await rules(onlyGerman)).toContain('screenshot-no-english');
            const twins = GOOD.replaceAll(
                /(<image type="source">(shot\d?)\.png<\/image>)/g,
                '$1\n      <image type="source" xml:lang="de">$2-de.png</image>',
            );
            expect(await rules(twins)).not.toContain('screenshot-no-english');
            expect(await rules(patch('<screenshot type="default">', '<screenshot>'))).toContain(
                'screenshot-default-not-first',
            );
        });
        await it('checks captions', async () => {
            expect(await rules(patch('<caption>The notebook overview</caption>', ''))).toContain(
                'screenshot-caption-missing',
            );
            expect(await rules(patch('The notebook overview', 'The notebook overview.'))).toContain(
                'caption-full-stop',
            );
            expect(await rules(patch('The notebook overview', '3 notebooks in a list'))).toContain(
                'caption-starts-with-number',
            );
            expect(await rules(patch('The notebook overview', 'The overview. It is nice'))).toContain(
                'caption-multiple-sentences',
            );
        });
    });

    await describe('lintMetainfo: releases', async () => {
        const release = (inner: string): string =>
            patch(
                /<release [\s\S]*<\/release>/.exec(GOOD)![0],
                `<release version="1.1" date="2026-01-02">${inner}</release>`,
            );
        await it('flags a release without notes', async () => {
            expect(await rules(release(''))).toContain('release-notes-missing');
        });
        await it('flags generic notes', async () => {
            expect(
                await rules(release('<description><p>Bug fixes and performance improvements.</p></description>')),
            ).toContain('release-notes-generic');
            expect(
                await rules(release('<description><p>Fehlerbehebungen und Verbesserungen</p></description>')),
            ).toContain('release-notes-generic');
        });
        await it('flags overlong notes', async () => {
            const long = `<description><p>${'Changed something visible. '.repeat(40)}</p></description>`;
            expect(await rules(release(long))).toContain('release-notes-long');
        });
    });

    await describe('summarizeFindings', async () => {
        await it('promotes warnings only under --strict', async () => {
            const findings = await lintMetainfo(
                patch('<name>Notes</name>', '<name>zettel</name>').replace(
                    '<summary>Write notes in style</summary>',
                    '<summary>Write down your ideas</summary>',
                ),
            );
            expect(summarizeFindings(findings, false)).toStrictEqual({ errors: 0, warnings: 1 });
            expect(summarizeFindings(findings, true)).toStrictEqual({ errors: 1, warnings: 0 });
        });
    });

    await describe('readImageInfo', async () => {
        await it('reads PNG dimensions', () => {
            const png = new Uint8Array(24);
            png.set([0x89, 0x50, 0x4e, 0x47]);
            png.set([0, 0, 1, 0], 16);
            png.set([0, 0, 0, 128], 20);
            expect(readImageInfo(png)).toStrictEqual({ kind: 'raster', width: 256, height: 128 });
        });
        await it('reads JPEG dimensions', () => {
            const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x02, 0x58, 0x03, 0x20, 3, 0, 0, 0, 0, 0, 0]);
            expect(readImageInfo(jpg)).toStrictEqual({ kind: 'raster', width: 800, height: 600 });
        });
        await it('recognises SVG and rejects unknown data', () => {
            const svg = new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>');
            expect(readImageInfo(svg)).toStrictEqual({ kind: 'svg' });
            expect(readImageInfo(new Uint8Array([1, 2, 3, 4]))).toBeNull();
        });
    });
};
