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
// the chain for `gjsify gettext` too. One more is local to here: the catalogues
// reach us as `.mo` and msgfmt reads `.po` — handing it a `.mo` gives
// `de.mo:1:2: syntax error`, exit 1. `msgunfmt` (same `gettext` package, so no
// new dependency) converts back, and the round trip is exact for the
// msgid/msgstr pairs these two formats consume.

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
        // file's output in another module's keeping.
        const catalogues: MsgfmtCatalogue[] = [...localeFiles]
            .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
            .map((file, index) => {
                const po = join(workDir, `${index}.po`);
                execFileSync('msgunfmt', [file.abs, '--output-file', po], { stdio: 'pipe' });
                return { locale: localeOf(file.rel), po };
            });

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

/** One actionable line for a failed merge, naming the tool the host is missing. */
function describeFailure(error: unknown, count: number): string {
    const e = error as { code?: unknown; stderr?: Buffer | string };
    if (e?.code === 'ENOENT') {
        return (
            'gjsify ship: `msgfmt`/`msgunfmt` are not on PATH, but the package stages ' +
            `${count} gettext catalogue(s). Install them (package: gettext) — shipping the metadata ` +
            'untranslated would install an English app menu entry for a translated app, which nothing ' +
            'downstream can detect.'
        );
    }
    const stderr = e?.stderr === undefined ? '' : `\n${String(e.stderr).trim()}`;
    return `gjsify ship: could not fold the gettext catalogues into the freedesktop metadata.${stderr}`;
}
