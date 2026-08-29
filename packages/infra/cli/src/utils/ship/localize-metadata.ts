// Folding the staged gettext catalogues into the generated freedesktop metadata.
//
// `gjsify ship` already discovered, validated and staged the compiled `.mo`
// catalogues, and `app-metadata.ts` already rendered a `.desktop` entry and an
// AppStream component. The two never met: no `Name[xx]=` and no `xml:lang=` was
// emitted anywhere, so a fully translated app still showed an English name in
// the GNOME app menu and in Software. Nobody reported it because both files
// stay VALID without the translations — `desktop-file-validate` and
// `appstreamcli validate` pass an untranslated file at exit 0, which is why the
// tests for this assert the localised keys are PRESENT rather than trusting a
// validator to notice they are gone.
//
// The msgfmt constraints this rests on live in `../msgfmt-merge.ts`, which runs
// the chain for `gjsify gettext` too. Two more are local to here, both from what
// a STAGED locale tree may hold that a `po/` directory cannot:
//
//   * The catalogues reach us as `.mo` and msgfmt reads `.po` — handing it a
//     `.mo` gives `de.mo:1:2: syntax error`, exit 1. `msgunfmt` converts back,
//     and the round trip is exact for the msgid/msgstr pairs these two formats
//     consume.
//   * One language may arrive as SEVERAL catalogues, because the tree is keyed by
//     `<lang>/LC_MESSAGES/<domain>.mo` and a package may ship more than one text
//     domain. `msgcat --use-first` folds those into one before the chain sees
//     them — the alternative is `msgfmt-merge.ts` constraint 5, an invalid file
//     out of nothing but exit-0 calls.
//
// Both tools are in the same `gettext` package as `msgfmt`, so neither adds a
// dependency the fold did not already have.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type MsgfmtCatalogue, type MsgfmtMergeMode, mergeCatalogues } from '../msgfmt-merge.js';

/** The generated metadata, before or after translation. */
export interface LocalizableMetadata {
    /** The rendered AppStream MetaInfo XML. */
    metainfo: string;
    /** The rendered desktop entry — `undefined` for `kind: 'cli'`. */
    desktopEntry?: string;
}

/** A staged catalogue, in the `<lang>/LC_MESSAGES/<domain>.mo` shape `discoverLocales` guarantees. */
export interface StagedCatalogue {
    rel: string;
    abs: string;
}

/**
 * The locale a staged catalogue path declares.
 *
 * Read rather than re-validated: `discoverLocales` has already refused anything
 * that is not `<lang>/LC_MESSAGES/<domain>.mo`, and a second validator here would
 * be a second definition of the layout.
 */
function localeOf(rel: string): string {
    return rel.split('/')[0] ?? '';
}

/** Chain one metadata file through every catalogue, and read the result back. */
function fold(
    mode: MsgfmtMergeMode,
    source: string,
    extension: string,
    catalogues: readonly MsgfmtCatalogue[],
    workDir: string,
): string {
    // The source is a STRING, so it has to become a file before msgfmt can be its
    // template — and that file needs `extension` for the same reason the
    // intermediates do (`msgfmt-merge.ts`, constraint 4).
    const template = join(workDir, `source${extension}`);
    writeFileSync(template, source);
    return readFileSync(mergeCatalogues({ mode, template, extension, catalogues, workDir }), 'utf-8');
}

/**
 * Translate the generated metadata with the catalogues the package ships.
 *
 * Returns the input unchanged when there is nothing to fold in, so a project
 * without a `localeDir` never needs the gettext tools. A project WITH catalogues
 * that lacks them is REFUSED rather than shipped in English: an untranslated
 * `.desktop` is indistinguishable from a correct one at install time, and the
 * package would have promised translations it does not deliver.
 */
export function localizeMetadata(
    metadata: LocalizableMetadata,
    localeFiles: readonly StagedCatalogue[],
): LocalizableMetadata {
    if (localeFiles.length === 0) return metadata;

    const workDir = mkdtempSync(join(tmpdir(), 'gjsify-ship-l10n-'));
    try {
        // Sorted so the emitted `Name[xx]=` order — and therefore the artifact's
        // bytes — does not depend on directory-read order. `listFilesRecursive`
        // already sorts; relying on that from here would put the determinism of this
        // file's output in another module's keeping. The sort ALSO fixes which
        // domain wins below, so `--use-first` is a choice and not a coin toss.
        const sorted = [...localeFiles].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

        // Grouped by LOCALE, not one entry per file. `discoverLocales` accepts every
        // `<lang>/LC_MESSAGES/<domain>.mo`, and a package that ships two text domains
        // (its own plus a bundled library's) therefore hands us two catalogues for one
        // language. Chained as-is that is `msgfmt-merge.ts` constraint 5: two exit-0
        // calls and a file both validators reject — `multiple keys named "Name[de]"`
        // (exit 1) and `tag-duplicated name (lang=de)` (exit 3). Measured.
        const byLocale = new Map<string, string[]>();
        for (const [index, file] of sorted.entries()) {
            const po = join(workDir, `${index}.po`);
            execFileSync('msgunfmt', [file.abs, '--output-file', po], { stdio: 'pipe' });
            const locale = localeOf(file.rel);
            byLocale.set(locale, [...(byLocale.get(locale) ?? []), po]);
        }

        const catalogues: MsgfmtCatalogue[] = [...byLocale].map(([locale, files]) => ({
            locale,
            // `--use-first` rather than a plain concatenation: two domains translating
            // the same source string is not an error a packager can act on, and the
            // alternatives are both worse. msgfmt given both files at once refuses
            // outright (`duplicate message definition`, 2 fatal errors, exit 1), and a
            // plain `msgcat` writes `#-#-#-#-#` conflict markers straight into the
            // `Name=` a user reads. First in the sort above wins, deterministically.
            po: files.length === 1 ? (files[0] as string) : msgcat(files, join(workDir, `${locale}.merged.po`)),
        }));

        return {
            metainfo: fold('--xml', metadata.metainfo, '.metainfo.xml', catalogues, workDir),
            desktopEntry:
                metadata.desktopEntry === undefined
                    ? undefined
                    : fold('--desktop', metadata.desktopEntry, '.desktop', catalogues, workDir),
        };
    } catch (error) {
        throw new Error(describeFailure(error, localeFiles.length));
    } finally {
        rmSync(workDir, { recursive: true, force: true });
    }
}

/** Fold several `.po` for ONE language into one, first translation wins. Returns its path. */
function msgcat(files: readonly string[], out: string): string {
    execFileSync('msgcat', ['--use-first', '--output-file', out, ...files], { stdio: 'pipe' });
    return out;
}

/** One actionable line for a failed merge, naming the tool the host is missing. */
function describeFailure(error: unknown, count: number): string {
    const e = error as { code?: unknown; stderr?: Buffer | string };
    if (e?.code === 'ENOENT') {
        return (
            'gjsify ship: `msgfmt`/`msgunfmt`/`msgcat` are not on PATH, but the package stages ' +
            `${count} gettext catalogue(s). Install them (package: gettext) — shipping the metadata ` +
            'untranslated would install an English app menu entry for a translated app, which nothing ' +
            'downstream can detect.'
        );
    }
    const stderr = e?.stderr === undefined ? '' : `\n${String(e.stderr).trim()}`;
    return `gjsify ship: could not fold the gettext catalogues into the freedesktop metadata.${stderr}`;
}
