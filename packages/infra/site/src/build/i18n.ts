import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import {
    DOWNLOAD_LABELS,
    FORMAT_LABELS,
    UI_SOURCE_LANGUAGE,
    languageCandidates,
    parseCatalog,
    parsePo,
    quotePo,
    type Catalog,
    type SiteConfig,
} from '../site-data/index.js';

const T_CALL = /\bt\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g;

/**
 * The msgids the renderer itself can emit: every translator call in its sources, plus the default
 * download labels. They belong to this package and are translated in its own `po/`.
 */
export async function rendererMsgids(buildDir: string): Promise<string[]> {
    const msgids = new Set<string>();
    for (const file of (await readdir(buildDir)).sort()) {
        if (!file.endsWith('.ts') || file.endsWith('.spec.ts')) continue;
        const source = await readFile(join(buildDir, file), 'utf8');
        for (const match of source.matchAll(T_CALL)) msgids.add(JSON.parse(`"${match[1]}"`) as string);
    }
    for (const label of [...Object.values(DOWNLOAD_LABELS), ...Object.values(FORMAT_LABELS)]) msgids.add(label);
    return [...msgids];
}

/**
 * The msgids a configuration introduces: the captions and download labels its author wrote. They
 * belong to the consumer and are translated in the consumer's `pageTranslations`.
 */
export function configMsgids(config: SiteConfig): string[] {
    const msgids = new Set<string>();
    for (const item of config.screenshots.items) if (item.caption) msgids.add(item.caption);
    for (const download of config.downloads) if (download.label) msgids.add(download.label);
    return [...msgids];
}

/** Every msgid in a `.po`/`.pot` file, translated or not, header excluded. */
export async function catalogMsgids(file: string): Promise<Set<string>> {
    if (!existsSync(file)) return new Set();
    const entries = parsePo(await readFile(file, 'utf8'));
    return new Set(entries.filter((entry) => entry.msgid !== '').map((entry) => entry.msgid));
}

const HEADER = (language: string | undefined) =>
    [
        'msgid ""',
        'msgstr ""',
        '"Project-Id-Version: gjsify-site\\n"',
        ...(language ? [`"Language: ${language}\\n"`] : []),
        '"MIME-Version: 1.0\\n"',
        '"Content-Type: text/plain; charset=UTF-8\\n"',
        '"Content-Transfer-Encoding: 8bit\\n"',
    ].join('\n');

/** Writes a catalogue: the translations in `known` are kept, everything else is left empty. */
export function renderPo(
    msgids: readonly string[],
    language: string | undefined,
    known: Catalog = new Map(),
): string {
    const entries = msgids.map((msgid) => `msgid ${quotePo(msgid)}\nmsgstr ${quotePo(known.get(msgid) ?? '')}`);
    return `${[HEADER(language), ...entries].join('\n\n')}\n`;
}

export function poPath(poDir: string, language: string): string {
    const existing = languageCandidates(language)
        .map((candidate) => join(poDir, `${candidate}.po`))
        .find((file) => existsSync(file));
    return existing ?? join(poDir, `${language.replace(/-/g, '_')}.po`);
}

export interface I18nResult {
    /** Files whose content differs from what the build would write (written unless `check`). */
    stale: string[];
    /** Languages with msgids that still lack a translation. */
    untranslated: string[];
}

export interface SyncOptions {
    /** Directory the `<lang>.po` catalogues live in; created by the caller. */
    dir: string;
    /** The languages to keep a catalogue for; `en` is the msgid language and gets none. */
    languages: readonly string[];
    msgids: readonly string[];
    /** Report what would change instead of writing it. */
    check: boolean;
    /** Write a `site.pot` template next to the catalogues. An overlay has no template of its own. */
    pot?: boolean;
    /** The paths in the result are reported relative to this directory. */
    base: string;
}

/** Regenerates the catalogues of one directory, or with `check` only reports what would change. */
export async function syncCatalogs(options: SyncOptions): Promise<I18nResult> {
    const { dir, languages, msgids, check, base } = options;
    const stale: string[] = [];
    const untranslated: string[] = [];
    const write = async (file: string, content: string) => {
        const current = existsSync(file) ? await readFile(file, 'utf8') : '';
        if (current === content) return;
        stale.push(relative(base, file));
        if (!check) await writeFile(file, content);
    };

    if (options.pot) await write(join(dir, 'site.pot'), renderPo(msgids, undefined));
    for (const language of languages) {
        if (language === UI_SOURCE_LANGUAGE) continue;
        const file = poPath(dir, language);
        const known = existsSync(file) ? parseCatalog(await readFile(file, 'utf8')) : new Map<string, string>();
        await write(file, renderPo(msgids, language, known));
        const missing = msgids.filter((msgid) => !known.get(msgid));
        if (missing.length > 0) {
            untranslated.push(
                `${relative(base, file)} has ${missing.length} untranslated string(s), e.g. "${missing[0]}"`,
            );
        }
    }
    return { stale, untranslated };
}
