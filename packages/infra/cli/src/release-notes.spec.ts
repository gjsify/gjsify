// `gjsify release-notes` — Markdown conversion and the error cases.

import { describe, expect, it } from '@gjsify/unit';
import { descriptionToMarkdown, renderReleaseNotes } from './utils/release-notes.js';

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
    });
};
