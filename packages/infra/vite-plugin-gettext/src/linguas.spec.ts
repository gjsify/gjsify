// The LINGUAS file, and why it kept rewriting itself.
//
// Measured 2026-09-11 in JumpLink/Learn6502 (#179): `gjsify workspace
// @learn6502/translations build` changed `LINGUAS` on every run over an
// untouched tree — `de`, `es` and `uk` moved to the end and the trailing
// newline disappeared, producing a diff on each build that looked like work.
//
// Two causes, both in the generator: the language list came straight from
// `fs.readdir`, whose order is unspecified and varies by filesystem and by the
// directory's history, and the file was joined with `\n` between entries and
// nothing after the last one.
//
// The determinism case below drives the generator TWICE with the SAME set in
// DIFFERENT orders and demands byte equality. That closes the CLASS — any
// non-determinism in this generator — rather than the two instances that were
// found, and it tests it on every host, instead of hoping a CI filesystem
// happens to hand back a scrambled directory.

import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '@gjsify/unit';
import { gettextPlugin } from './gettext.js';
import { generateLinguasFile } from './utils.js';

async function fixture(): Promise<string> {
    return await fs.mkdtemp(path.join(tmpdir(), 'gjsify-linguas-'));
}

/** A minimal catalog, enough for the plugin to count it as a language. */
async function catalog(dir: string, name: string): Promise<void> {
    await fs.writeFile(
        path.join(dir, `${name}.po`),
        ['msgid ""', 'msgstr "Content-Type: text/plain; charset=UTF-8\\n"', ''].join('\n'),
        'utf-8',
    );
}

export default async () => {
    await describe('generateLinguasFile', async () => {
        await it('writes the same bytes whatever order the languages arrive in', async () => {
            const first = await fixture();
            const second = await fixture();
            const languages = ['de', 'es', 'fi', 'pt', 'pt_BR', 'uk', 'zh_Hans'];

            await generateLinguasFile([...languages], first);
            await generateLinguasFile([...languages].reverse(), second);

            const a = await fs.readFile(path.join(first, 'LINGUAS'), 'utf-8');
            const b = await fs.readFile(path.join(second, 'LINGUAS'), 'utf-8');
            expect(a).toBe(b);
        });

        await it('ends with a newline', async () => {
            // Without it git reports "\ No newline at end of file" on every
            // regeneration, and anything appending to the list joins its first
            // entry onto the last language.
            const dir = await fixture();
            await generateLinguasFile(['de', 'fr'], dir);

            expect((await fs.readFile(path.join(dir, 'LINGUAS'), 'utf-8')).endsWith('\n')).toBe(true);
        });

        await it('sorts by code unit, not by the builder locale', async () => {
            // `localeCompare` would order by whoever ran the build, which makes
            // the committed file depend on the host: the same class of bug.
            const dir = await fixture();
            await generateLinguasFile(['zh_Hans', 'pt_BR', 'pt', 'de'], dir);

            expect(await fs.readFile(path.join(dir, 'LINGUAS'), 'utf-8')).toBe('de\npt\npt_BR\nzh_Hans\n');
        });

        await it('is stable across two full plugin runs', async () => {
            // The end-to-end version of the same claim: a second build on an
            // untouched tree must not produce a diff.
            const dir = await fixture();
            await catalog(dir, 'de');
            await catalog(dir, 'zh_Hans');
            await catalog(dir, 'pt_BR');

            const plugin = gettextPlugin({
                poDirectory: dir,
                moDirectory: path.join(dir, 'dist'),
                filename: 'probe.mo',
            });

            await (plugin as unknown as { buildStart: () => Promise<void> }).buildStart();
            const first = await fs.readFile(path.join(dir, 'LINGUAS'), 'utf-8');
            await (plugin as unknown as { buildStart: () => Promise<void> }).buildStart();
            const second = await fs.readFile(path.join(dir, 'LINGUAS'), 'utf-8');

            expect(first).toBe(second);
            expect(first).toBe('de\npt_BR\nzh_Hans\n');
        });
    });
};
