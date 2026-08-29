// Merging gettext catalogues INTO a template — the `msgfmt --desktop` / `--xml` half.
//
// Two callers need this and they are not variants of each other: `gjsify gettext`
// substitutes a template a user wrote, `gjsify ship` substitutes metadata it just
// rendered. What they share is every constraint below, all four measured against
// GNU gettext 0.26, and each one fails a DIFFERENT way — one of them silently.
// Written twice, the silent one is the copy that loses them.
//
//  1. `--desktop` and `--xml` REQUIRE `--template`:
//     `msgfmt: --desktop requires a "--template template" specification`, exit 1.
//     Neither format can be produced from `.po` files alone, so a caller without a
//     template has nothing to ask for.
//
//  2. The bulk form (`-d <podir>`) fails SILENTLY. With no `LINGUAS` file beside
//     the `.po` files:
//         msgfmt --desktop --template=app.desktop.in -d po -o out.desktop
//         exit 0 · stderr `po/LINGUAS does not exist` · out.desktop UNTRANSLATED
//     and `desktop-file-validate out.desktop` then exits 0 as well. Exit 0, an
//     English file and a passing oracle is the worst of the three outcomes, which
//     is why this module names each language with `--locale=` instead: that form
//     needs no `LINGUAS` and cannot degrade to a no-op without a non-zero exit.
//
//  3. The template and the output must never be the SAME path. msgfmt truncates
//     `--output-file` before it reads the template, so chaining in place destroys
//     it: measured, `--desktop` wrote a 0-byte file and exited 0, `--xml` printed
//     `cannot read <file>: Document is empty` and died on SIGSEGV (exit 139).
//     Hence the numbered intermediates below rather than one file rewritten.
//
//  4. `--xml` finds its ITS rules by FILENAME PATTERN, not by reading the document.
//     gettext walks `/usr/share/gettext/its/*.loc`, where each rule pairs a glob
//     with a root element; AppStream's is `pattern="*.metainfo.xml"` +
//     `localName="component"`, so the same bytes named `foo.xml` die with
//     `msgfmt: cannot locate ITS rules for foo.xml` (exit 1). `extension` is
//     therefore part of this function's contract, not a temp-file detail.
//
//     Stated as "`--xml` needs a `.metainfo.xml` name" the rule would be wrong in
//     the direction that matters next: `shared-mime-info.loc` pairs `pattern="*.xml"`
//     with `localName="mime-info"`, so a MIME package needs no suffix care at all.
//     The constraint belongs to the AppStream rule, not to `--xml`.

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** Which of msgfmt's two template writers to run. */
export type MsgfmtMergeMode = '--desktop' | '--xml';

/** One catalogue: the language tag msgfmt is TOLD, and the `.po` holding it. */
export interface MsgfmtCatalogue {
    /** Passed as `--locale=`. Named explicitly so no `LINGUAS` file is needed — constraint 2. */
    locale: string;
    /** Path to a `.po`. msgfmt reads only this format here: a `.mo` gives `syntax error`, exit 1. */
    po: string;
}

export interface MsgfmtMergeOptions {
    mode: MsgfmtMergeMode;
    /** The file the FIRST call substitutes into. Every later call substitutes into the previous output. */
    template: string;
    /** The suffix every intermediate keeps — load-bearing for `--xml`, see constraint 4. */
    extension: string;
    catalogues: readonly MsgfmtCatalogue[];
    /** A directory this function may fill with intermediates; the caller owns its removal. */
    workDir: string;
    /** Called with each msgfmt argv, for `--verbose`. */
    onCall?: (args: readonly string[]) => void;
}

/**
 * Fold every catalogue into one file, chaining `msgfmt` once per language.
 *
 * Returns the PATH of the last file written — the caller decides whether to read
 * it, post-process it or copy it. With no catalogues that is `template` itself,
 * so a project with nothing to merge never spawns msgfmt at all.
 *
 * `stdio: 'pipe'` so a failure's stderr survives on the thrown error rather than
 * going to the terminal and leaving the caller with an exit code.
 */
export function mergeCatalogues(options: MsgfmtMergeOptions): string {
    let current = options.template;

    for (const [index, catalogue] of options.catalogues.entries()) {
        const next = join(options.workDir, `${index}${options.extension}`);
        const args = [
            options.mode,
            `--template=${current}`,
            `--locale=${catalogue.locale}`,
            `--output-file=${next}`,
            catalogue.po,
        ];
        options.onCall?.(args);
        execFileSync('msgfmt', args, { stdio: 'pipe' });
        // Every language after the first merges INTO what the previous one wrote.
        current = next;
    }

    return current;
}
