// `gjsify release-notes` — Markdown conversion and the error cases.

import { describe, expect, it } from '@gjsify/unit';
import { parseMetainfoReleases } from './utils/metainfo-releases.js';
import { descriptionToMarkdown, renderReleaseNotes, resolveReleases } from './utils/release-notes.js';

const releases = [
    {
        version: '0.1.7',
        date: '2026-10-30',
        description: [
            { p: 'First   paragraph.' },
            { p: 'Second paragraph.', translatorHint: 'ignored' },
            { ul: ['One', { item: 'Two', translatorHint: 'ignored' }] },
        ],
    },
    { version: '0.1.6', date: '2026-10-01', description: 'Plain\n\ntext.' },
    { version: '0.1.5', date: '2026-09-01' },
];

const metainfo = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>eu.example.App</id>
  <releases>
    <release version="0.2.0" date="2026-10-30">
      <description>
        <p>Faster &amp; <em>smoother</em> with <code>--fast</code>.</p>
        <p xml:lang="de">Schneller.</p>
        <ul>
          <li>One &lt;thing&gt;</li>
          <li xml:lang="de">Eins</li>
          <li>Two <strong>bold</strong></li>
        </ul>
      </description>
      <description xml:lang="de"><p>Deutsch.</p></description>
    </release>
    <release version="0.1.0" timestamp="1759276800">
      <description><ol><li>First</li></ol></description>
    </release>
    <release version="0.0.1" date="2026-01-01"/>
  </releases>
</component>`;

function message(fn: () => unknown): string {
    try {
        fn();
    } catch (err) {
        return (err as Error).message;
    }
    return '';
}

export default async () => {
    await describe('release-notes', async () => {
        await it('renders paragraphs and lists', async () => {
            expect(descriptionToMarkdown(releases[0]!.description!)).toBe(
                'First paragraph.\n\nSecond paragraph.\n\n- One\n- Two',
            );
        });

        await it('splits a plain string on blank lines', async () => {
            expect(descriptionToMarkdown('A\nb\n\nC')).toBe('A b\n\nC');
        });

        await it('accepts a leading v on the version', async () => {
            expect(renderReleaseNotes({ releases, version: 'v0.1.6' })).toBe('Plain\n\ntext.\n');
        });

        await it('appends the compare link against the previous entry', async () => {
            const out = renderReleaseNotes({ releases, version: '0.1.7', repoUrl: 'https://github.com/a/b/' });
            expect(out.endsWith('\n\n**Full changelog:** https://github.com/a/b/compare/v0.1.6...v0.1.7\n')).toBe(true);
        });

        await it('skips the link without a previous entry or URL', async () => {
            expect(renderReleaseNotes({ releases, version: '0.1.6' }).includes('Full changelog')).toBe(false);
            expect(renderReleaseNotes({ releases: [releases[1]!], version: '0.1.6', repoUrl: 'https://x' })).toBe(
                'Plain\n\ntext.\n',
            );
        });

        await it('fails for an unknown version', async () => {
            expect(
                message(() => renderReleaseNotes({ releases, version: '9.9.9' })).includes('no `releases` entry'),
            ).toBe(true);
            expect(
                message(() => renderReleaseNotes({ releases: undefined, version: '1.0.0' })).includes('no `releases`'),
            ).toBe(true);
        });

        await it('fails for an entry without a description', async () => {
            expect(message(() => renderReleaseNotes({ releases, version: '0.1.5' })).includes('no description')).toBe(
                true,
            );
            expect(
                message(() =>
                    renderReleaseNotes({ releases: [{ version: '1', date: 'x', description: '  ' }], version: '1' }),
                ),
            ).toContain('no description');
        });

        await it('reads paragraphs, lists, inline markup and entities from a metainfo file', async () => {
            const [latest] = parseMetainfoReleases(metainfo);
            expect(latest!.version).toBe('0.2.0');
            expect(latest!.date).toBe('2026-10-30');
            expect(descriptionToMarkdown(latest!.description!)).toBe(
                'Faster & *smoother* with `--fast`.\n\n- One <thing>\n- Two **bold**',
            );
        });

        await it('derives the date from a timestamp and keeps ordered lists as items', async () => {
            const entries = parseMetainfoReleases(metainfo);
            expect(entries.map((e) => e.version).join(',')).toBe('0.2.0,0.1.0,0.0.1');
            expect(entries[1]!.date).toBe('2025-10-01');
            expect(descriptionToMarkdown(entries[1]!.description!)).toBe('- First');
            expect(entries[2]!.description).toBe(undefined);
        });

        await it('compares against the previous metainfo entry', async () => {
            const { releases, source } = resolveReleases({ metainfo: 'm.xml', readMetainfo: () => metainfo });
            const out = renderReleaseNotes({ releases, source, version: '0.1.0', repoUrl: 'https://x/y' });
            expect(out).toBe('- First\n\n**Full changelog:** https://x/y/compare/v0.0.1...v0.1.0\n');
        });

        await it('fails for a version the metainfo lacks, naming the file', async () => {
            const { releases, source } = resolveReleases({ metainfo: 'm.xml', readMetainfo: () => metainfo });
            const text = message(() => renderReleaseNotes({ releases, source, version: '9.9.9' }));
            expect(text).toContain('in m.xml');
            expect(text).toContain('found: 0.2.0, 0.1.0, 0.0.1');
            expect(message(() => renderReleaseNotes({ releases, source, version: '0.0.1' }))).toContain(
                'no description',
            );
            const empty = resolveReleases({ metainfo: 'e.xml', readMetainfo: () => '<component/>' });
            expect(message(() => renderReleaseNotes({ ...empty, version: '1' }))).toContain('no `<release>` entries');
        });

        await it('lets config releases win over site.metainfo, and --metainfo win over both', async () => {
            const reads: string[] = [];
            const readMetainfo = (path: string) => (reads.push(path), metainfo);
            const configReleases = [{ version: '5.0.0', date: 'x', description: 'From config.' }];

            const fromConfig = resolveReleases({ configReleases, siteMetainfo: 'site.xml', readMetainfo });
            expect(fromConfig.releases![0]!.version).toBe('5.0.0');
            expect(reads.length).toBe(0);

            const fromSite = resolveReleases({ siteMetainfo: 'site.xml', readMetainfo });
            expect(fromSite.releases![0]!.version).toBe('0.2.0');
            expect(reads.join(',')).toBe('site.xml');

            const fromFlag = resolveReleases({
                metainfo: 'flag.xml',
                configReleases,
                siteMetainfo: 'site.xml',
                readMetainfo,
            });
            expect(fromFlag.releases![0]!.version).toBe('0.2.0');
            expect(reads.join(',')).toBe('site.xml,flag.xml');

            const none = resolveReleases({ readMetainfo });
            expect(none.releases).toBe(undefined);
        });
    });
};
