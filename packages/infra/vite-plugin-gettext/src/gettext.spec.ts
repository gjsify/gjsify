// Where a compiled catalog lands, and whether gettext itself can find it.
//
// Measured 2026-09-11 in JumpLink/Learn6502 (#182): a Weblate `zh_Hans.po` was
// compiled to `locale/zh_Hans/LC_MESSAGES/`, which glibc never probes, so every
// Chinese user saw English while a complete catalog shipped.
//
// These cases drive the REAL `buildStart` against the REAL gettext binaries,
// because what went wrong was where files are written, not a parser. The
// question "can this be looked up" is answered by the glibc `gettext` CLI —
// asking our own implementation whether its own directory choice was right
// could not see it be wrong, which is exactly how the bug survived. The CLI is
// the only oracle here that is genuinely independent.
//
// THE MEASUREMENT TRAP, paid for once: `LC_ALL` must name an INSTALLED, non-C
// locale. Under `C`, `C.UTF-8`, `POSIX` or an uninstalled locale, glibc falls
// back to C and ignores `LANGUAGE` COMPLETELY — every probe then returns the
// untranslated msgid and the suite measures nothing while looking green. The
// language is selected by `LANGUAGE`; `LC_ALL` only has to be a real locale.

import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { describe, expect, it } from '@gjsify/unit';
import { gettextPlugin } from './gettext.js';
import { po2jsonPlugin } from './po2json.js';
import { UnmappableCatalogNameError } from './catalog-names.js';

const DOMAIN = 'probe';

/** Calls the plugin's real `buildStart`, which is where compilation is driven. */
async function runBuildStart(plugin: unknown): Promise<void> {
    await (plugin as { buildStart: () => Promise<void> }).buildStart();
}

async function fixture(): Promise<string> {
    return await fs.mkdtemp(path.join(tmpdir(), 'gjsify-gettext-'));
}

/** A catalog translating "Yellow" to a marker that says WHICH catalog answered. */
async function catalog(dir: string, name: string, translation: string): Promise<void> {
    await fs.writeFile(
        path.join(dir, `${name}.po`),
        [
            'msgid ""',
            'msgstr "Content-Type: text/plain; charset=UTF-8\\n"',
            '',
            'msgid "Yellow"',
            `msgstr "${translation}"`,
            '',
        ].join('\n'),
        'utf-8',
    );
}

async function exists(file: string): Promise<boolean> {
    try {
        await fs.stat(file);
        return true;
    } catch {
        return false;
    }
}

/**
 * An installed non-C locale, or `undefined` when the host has none.
 *
 * Cached because `locale -a` lists hundreds of entries and every probe would
 * otherwise re-read them.
 */
let localeProbe: string | undefined | null = null;
async function usableLocale(): Promise<string | undefined> {
    if (localeProbe !== null) {
        return localeProbe;
    }
    try {
        const { stdout } = await execa('locale', ['-a']);
        const candidates = stdout.split('\n').map((line) => line.trim());
        // en_US first for a stable message language, then any UTF-8 locale that
        // is not the C one — `C.UTF-8` is a C locale and disables LANGUAGE.
        localeProbe =
            candidates.find((name) => /^en_US\.(utf8|UTF-8)$/i.test(name)) ??
            candidates.find((name) => /\.(utf8|UTF-8)$/i.test(name) && !/^(C|POSIX)\b/i.test(name));
    } catch {
        localeProbe = undefined;
    }
    return localeProbe;
}

/** What glibc returns for `msgid` when the user's language is `language`. */
async function askGettext(moRoot: string, language: string, msgid: string): Promise<string> {
    const locale = await usableLocale();
    const { stdout } = await execa('gettext', [DOMAIN, msgid], {
        env: {
            LC_ALL: locale,
            LANG: locale,
            LANGUAGE: language,
            TEXTDOMAINDIR: moRoot,
            OUTPUT_CHARSET: 'UTF-8',
        },
        extendEnv: true,
    });
    return stdout;
}

export default async () => {
    await describe('gettextPlugin — POSIX locale directories', async () => {
        await it('compiles a Weblate script name into the locales glibc probes', async () => {
            const dir = await fixture();
            await catalog(dir, 'zh_Hans', '黄色');

            await runBuildStart(
                gettextPlugin({ poDirectory: dir, moDirectory: path.join(dir, 'dist'), filename: `${DOMAIN}.mo` }),
            );

            const locales = path.join(dir, 'dist', 'locale');
            // The directory a real user's locale actually reaches.
            expect(await exists(path.join(locales, 'zh_CN', 'LC_MESSAGES', `${DOMAIN}.mo`))).toBe(true);
            expect(await exists(path.join(locales, 'zh_SG', 'LC_MESSAGES', `${DOMAIN}.mo`))).toBe(true);
            // And the original, kept so nothing that already worked stops.
            expect(await exists(path.join(locales, 'zh_Hans', 'LC_MESSAGES', `${DOMAIN}.mo`))).toBe(true);
        });

        await it('folds a hyphenated catalog name to the POSIX spelling', async () => {
            const dir = await fixture();
            await catalog(dir, 'pt-BR', 'Amarelo');

            await runBuildStart(
                gettextPlugin({ poDirectory: dir, moDirectory: path.join(dir, 'dist'), filename: `${DOMAIN}.mo` }),
            );

            expect(await exists(path.join(dir, 'dist', 'locale', 'pt_BR', 'LC_MESSAGES', `${DOMAIN}.mo`))).toBe(true);
        });

        await it('refuses a catalog it cannot place instead of compiling it somewhere', async () => {
            const dir = await fixture();
            await catalog(dir, 'az_Arab', 'Sarı');

            let thrown: unknown;
            try {
                await runBuildStart(
                    gettextPlugin({ poDirectory: dir, moDirectory: path.join(dir, 'dist'), filename: `${DOMAIN}.mo` }),
                );
            } catch (error) {
                thrown = error;
            }

            // The guard must survive the plugin's catch-and-wrap, or its
            // instruction is buried under "Failed to compile MO files: Error: …".
            expect(thrown).toBeInstanceOf(UnmappableCatalogNameError);
            expect((thrown as Error).message.includes('az_Arab.po')).toBe(true);
        });
    });

    await describe('gettextPlugin — glibc as the oracle', async () => {
        const locale = await usableLocale();

        await it.failing(
            'a user with a real Chinese locale gets the Chinese catalog',
            async () => {
                const dir = await fixture();
                await catalog(dir, 'zh_Hans', '黄色');
                await catalog(dir, 'de', 'Gelb');

                const moRoot = path.join(dir, 'dist', 'locale');
                await runBuildStart(
                    gettextPlugin({
                        poDirectory: dir,
                        moDirectory: path.join(dir, 'dist'),
                        filename: `${DOMAIN}.mo`,
                    }),
                );

                // THE DISCRIMINATOR. `de` is an ordinary name that was never
                // broken, so it proves the probe can see translations at all. If
                // this fails the environment cannot do gettext lookups and every
                // assertion below would pass vacuously as English.
                expect(await askGettext(moRoot, 'de', 'Yellow')).toBe('Gelb');

                // A selector no real user has — what the bug made the only
                // working one.
                expect(await askGettext(moRoot, 'zh_Hans', 'Yellow')).toBe('黄色');
                // What an actual user in China has. This is the regression.
                expect(await askGettext(moRoot, 'zh_CN', 'Yellow')).toBe('黄色');
                expect(await askGettext(moRoot, 'zh_SG', 'Yellow')).toBe('黄色');

                // Not claimed: a simplified catalog must not answer a
                // traditional user. It is why the broad `zh` is never written.
                expect(await askGettext(moRoot, 'zh_TW', 'Yellow')).toBe('Yellow');
            },
            'the host has no installed non-C locale, so glibc ignores LANGUAGE and the oracle cannot run',
            { when: !locale },
        );
    });

    await describe('po2jsonPlugin — the Android namespace', async () => {
        await it('names the JSON so the resource qualifier comes out legal', async () => {
            // `zh_Hans.json` -> `values-zh_Hans` and `pt_BR.json` ->
            // `values-pt_BR`: an underscore is illegal in a qualifier, so those
            // are directories Android never consults.
            const dir = await fixture();
            await catalog(dir, 'zh_Hans', '黄色');
            await catalog(dir, 'pt_BR', 'Amarelo');
            const json = path.join(dir, 'json');

            await runBuildStart(po2jsonPlugin({ poDirectory: dir, jsonDirectory: json }));

            expect(await exists(path.join(json, 'zh.json'))).toBe(true);
            expect(await exists(path.join(json, 'pt-BR.json'))).toBe(true);
            // The dead spellings must not be written beside them — two
            // generations in one tree is what made this hard to see.
            expect(await exists(path.join(json, 'zh_Hans.json'))).toBe(false);
            expect(await exists(path.join(json, 'pt_BR.json'))).toBe(false);
        });

        await it('keeps the POSIX and Android names apart for one catalog', async () => {
            // The same `pt_BR.po` is `pt_BR` as a locale directory and `pt-BR`
            // as a JSON file. One string cannot serve both.
            const dir = await fixture();
            await catalog(dir, 'pt_BR', 'Amarelo');

            await runBuildStart(
                gettextPlugin({ poDirectory: dir, moDirectory: path.join(dir, 'dist'), filename: `${DOMAIN}.mo` }),
            );
            await runBuildStart(po2jsonPlugin({ poDirectory: dir, jsonDirectory: path.join(dir, 'json') }));

            expect(await exists(path.join(dir, 'dist', 'locale', 'pt_BR', 'LC_MESSAGES', `${DOMAIN}.mo`))).toBe(true);
            expect(await exists(path.join(dir, 'json', 'pt-BR.json'))).toBe(true);
        });
    });
};
