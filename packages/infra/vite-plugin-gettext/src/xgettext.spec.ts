// The two ways this plugin used to destroy translations while exiting 0.
//
// Measured 2026-09-03 in JumpLink/Learn6502: one `sources` entry pointed at
// `../learn/dist/**/*.ui`, a build artifact of a SIBLING workspace package.
// Built in the wrong order that pattern matches nothing, so the `ui` group
// simply did not exist — 902 lines left the POT and ~1573 left each of 16
// catalogs, every MDX-derived tutorial string among them. Nothing failed; it was
// caught by reading the diff before committing.
//
// These cases drive the REAL `buildStart` against real gettext binaries, because
// what went wrong was the orchestration — which patterns are globbed, and what
// is allowed to reach `msgmerge` — not a parser. The entry counting here is
// deliberately its own three lines rather than the implementation's counter: a
// test that judged the fix with the fix's own arithmetic could not see it be
// wrong.

import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '@gjsify/unit';
import type { XGettextPluginOptions } from './types.js';
import { xgettextPlugin } from './xgettext.js';

/** Calls the plugin's real `buildStart`, which is where extraction is driven from. */
async function runBuildStart(options: XGettextPluginOptions): Promise<void> {
    const plugin = xgettextPlugin(options) as unknown as { buildStart: () => Promise<void> };
    await plugin.buildStart();
}

async function fixture(): Promise<string> {
    return await fs.mkdtemp(path.join(tmpdir(), 'gjsify-xgettext-'));
}

async function write(dir: string, relative: string, content: string): Promise<string> {
    const file = path.join(dir, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, 'utf-8');
    return file;
}

/** A Blueprint template whose captions are the msgids a case is about. */
function blueprint(...msgids: string[]): string {
    const labels = msgids.slice(1).map((id) => `  Gtk.Label { label: _("${id}"); }`);
    return [
        'using Gtk 4.0;',
        '',
        'template $Window : Gtk.ApplicationWindow {',
        `  title: _("${msgids[0]}");`,
        ...labels,
        '}',
        '',
    ].join('\n');
}

/** A translated catalog, so a prune shows up as lost TRANSLATIONS, not lost msgids. */
function catalog(...msgids: string[]): string {
    const header = [
        'msgid ""',
        'msgstr ""',
        '"Project-Id-Version: messages\\n"',
        '"MIME-Version: 1.0\\n"',
        '"Content-Type: text/plain; charset=UTF-8\\n"',
        '"Content-Transfer-Encoding: 8bit\\n"',
        '"Language: de\\n"',
        '',
    ];
    const entries = msgids.flatMap((id) => [`msgid "${id}"`, `msgstr "${id} auf Deutsch"`, '']);
    return [...header, ...entries].join('\n');
}

/**
 * Entries a catalog still USES. `msgmerge` does not delete what the POT lost, it
 * comments it out as `#~`, and `msgfmt` ignores those — so a line count would
 * report a gutted catalog as healthy.
 */
function activeEntries(po: string): number {
    const heads = po.split('\n').filter((line) => /^msgid\s/.test(line));
    return heads.length - 1; // the header entry is `msgid ""`
}

/** The `change` handler `configureServer` registers, with a way to fire it. */
function watchedServer(options: XGettextPluginOptions) {
    let onChange: ((file: string) => Promise<void>) | undefined;
    const server = {
        watcher: {
            add() {},
            on(event: string, handler: (file: string) => Promise<void>) {
                if (event === 'change') {
                    onChange = handler;
                }
            },
        },
    };
    const plugin = xgettextPlugin(options) as unknown as { configureServer: (server: unknown) => void };
    plugin.configureServer(server);
    if (!onChange) {
        throw new Error('configureServer registered no change handler');
    }
    return onChange;
}

export default async () => {
    await describe('xgettextPlugin — source patterns', async () => {
        await it('fails on a pattern that matches no files', async () => {
            const dir = await fixture();
            try {
                await write(dir, 'src/window.blp', blueprint('Hello'));
                const output = path.join(dir, 'po', 'messages.pot');

                // The Learn6502 shape exactly: one good pattern, one pointing at a
                // sibling package's not-yet-built `dist/`.
                await expect(
                    runBuildStart({
                        sources: [path.join(dir, 'src', '**', '*.blp'), path.join(dir, 'dist', '**', '*.ui')],
                        output,
                        keywords: ['_'],
                    }),
                ).rejects.toThrow(/matched no files/);

                // A partial POT must not exist either: the next run would diff
                // against it and read the loss as intentional.
                expect(existsSync(output)).toBe(false);
            } finally {
                await fs.rm(dir, { recursive: true, force: true });
            }
        });

        await it('keeps a negated pattern excluding instead of failing', async () => {
            // fast-glob reads a leading `!` as an ignore filter over the whole
            // list and returns NOTHING for a list of only negations — so globbing
            // patterns one at a time turns an exclusion into a group that matched
            // no files, and the guard would fail a build that was configured
            // correctly. Declaring it optional to shut the guard up would be worse
            // still: the excluded file would then be extracted.
            const dir = await fixture();
            try {
                await write(dir, 'src/window.blp', blueprint('Real'));
                await write(dir, 'src/generated.blp', blueprint('Generated'));
                const output = path.join(dir, 'po', 'messages.pot');

                await runBuildStart({
                    sources: [path.join(dir, 'src', '**', '*.blp'), `!${path.join(dir, 'src', 'generated.blp')}`],
                    output,
                    keywords: ['_'],
                });

                const pot = await fs.readFile(output, 'utf-8');
                expect(pot.includes('"Real"')).toBe(true);
                expect(pot.includes('"Generated"')).toBe(false);
            } finally {
                await fs.rm(dir, { recursive: true, force: true });
            }
        });

        await it('fails when nothing is left to extract from at all', async () => {
            // The hole the per-pattern check leaves open: every pattern declared
            // optional and every one empty. Extraction would run over no files,
            // write an empty POT and prune every catalog against it.
            const dir = await fixture();
            try {
                const pattern = path.join(dir, 'src', '**', '*.blp');
                await expect(
                    runBuildStart({
                        sources: [pattern],
                        optionalSources: [pattern],
                        output: path.join(dir, 'po', 'messages.pot'),
                        keywords: ['_'],
                    }),
                ).rejects.toThrow(/no source file to extract from/);
            } finally {
                await fs.rm(dir, { recursive: true, force: true });
            }
        });
    });

    await describe('xgettextPlugin — the dev-server watch path', async () => {
        await it('re-extracts on a source change, and only for a source', async () => {
            // `configureServer` matched with `file.match(pattern)`, which compiles
            // the glob as a REGEXP — and `**` in one is `Nothing to repeat`, so
            // every change event threw a SyntaxError before deciding anything.
            // Re-extraction in `vite dev` had never run, and neither guard had ever
            // been reached from here.
            const dir = await fixture();
            try {
                const source = await write(dir, 'src/window.blp', blueprint('Hello', 'Second'));
                const output = path.join(dir, 'po', 'messages.pot');
                const onChange = watchedServer({
                    sources: [path.join(dir, 'src', '**', '*.blp')],
                    output,
                    keywords: ['_'],
                });

                await onChange(path.join(dir, 'README.md'));
                expect(existsSync(output)).toBe(false);

                await onChange(source);
                expect(activeEntries(await fs.readFile(output, 'utf-8'))).toBe(2);
            } finally {
                await fs.rm(dir, { recursive: true, force: true });
            }
        });

        await it('arms the catalog guard on that path too', async () => {
            const dir = await fixture();
            try {
                const source = await write(dir, 'src/window.blp', blueprint('Hello'));
                await write(dir, 'po/LINGUAS', 'de\n');
                const poFile = await write(dir, 'po/de.po', catalog('Hello', 'Second', 'Third', 'Fourth'));
                const before = await fs.readFile(poFile, 'utf-8');
                const onChange = watchedServer({
                    sources: [path.join(dir, 'src', '**', '*.blp')],
                    output: path.join(dir, 'po', 'messages.pot'),
                    keywords: ['_'],
                    autoUpdatePo: true,
                });

                await expect(onChange(source)).rejects.toThrow(/catalog/i);
                expect(await fs.readFile(poFile, 'utf-8')).toBe(before);
            } finally {
                await fs.rm(dir, { recursive: true, force: true });
            }
        });
    });

    await describe('xgettextPlugin — autoUpdatePo', async () => {
        await it('refuses to prune catalogs a collapsed POT would empty', async () => {
            const dir = await fixture();
            try {
                await write(dir, 'src/window.blp', blueprint('Hello'));
                await write(dir, 'po/LINGUAS', 'de\n');
                const poFile = await write(dir, 'po/de.po', catalog('Hello', 'Second', 'Third', 'Fourth'));
                const before = await fs.readFile(poFile, 'utf-8');

                await expect(
                    runBuildStart({
                        sources: [path.join(dir, 'src', '**', '*.blp')],
                        output: path.join(dir, 'po', 'messages.pot'),
                        keywords: ['_'],
                        autoUpdatePo: true,
                    }),
                ).rejects.toThrow(/catalog/i);

                expect(await fs.readFile(poFile, 'utf-8')).toBe(before);
                expect(activeEntries(await fs.readFile(poFile, 'utf-8'))).toBe(4);
            } finally {
                await fs.rm(dir, { recursive: true, force: true });
            }
        });

        await it('still merges when the POT holds what the catalogs hold', async () => {
            const dir = await fixture();
            try {
                await write(dir, 'src/window.blp', blueprint('Hello', 'Second', 'Third'));
                await write(dir, 'po/LINGUAS', 'de\n');
                const poFile = await write(dir, 'po/de.po', catalog('Hello', 'Second'));
                const output = path.join(dir, 'po', 'messages.pot');

                await runBuildStart({
                    sources: [path.join(dir, 'src', '**', '*.blp')],
                    output,
                    keywords: ['_'],
                    autoUpdatePo: true,
                });

                expect(activeEntries(await fs.readFile(output, 'utf-8'))).toBe(3);
                const merged = await fs.readFile(poFile, 'utf-8');
                expect(activeEntries(merged)).toBe(3);
                expect(merged.includes('Hello auf Deutsch')).toBe(true);
            } finally {
                await fs.rm(dir, { recursive: true, force: true });
            }
        });
    });
};
