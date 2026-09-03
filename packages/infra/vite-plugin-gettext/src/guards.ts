// What must be true before a POT is written over catalogs people have already
// translated.
//
// THE INCIDENT (JumpLink/Learn6502, 2026-09-03). Its `xgettext` sources included
// `../learn/dist/**/*.ui`, a build artifact of a SIBLING workspace package.
// Build `@learn6502/translations` before `@learn6502/learn` and that pattern
// matches nothing — the whole `ui` group silently ceases to exist. `xgettext`
// happily extracted the rest, `msgcat` wrote a POT 902 lines shorter, and
// `autoUpdatePo` then ran `msgmerge --update` over all 16 catalogs, which moved
// every entry the POT had lost into `#~` obsolete comments: ~1573 lines per
// language, every MDX-derived tutorial string among them. `msgfmt` ignores `#~`,
// so those translations were gone. Exit code 0, no warning. It was caught by
// reading the diff before committing; in CI, or on a machine with a stale
// `dist/`, it would have landed.
//
// The build-order dependency is real and implicit — extraction reads an artifact
// another package produces and nothing declares that edge — so the fix cannot be
// "order the build correctly". It has to be that the mistake FAILS.
//
// The decisions live here, apart from the I/O that feeds them, so they can be
// tested without gettext installed and without a filesystem.

/** Base class so the plugin can rethrow a guard verbatim instead of wrapping it. */
export class GettextGuardError extends Error {}

/** A `sources` pattern matched nothing, and was not declared optional. */
export class EmptySourcePatternError extends GettextGuardError {
    constructor(
        message: string,
        /** The patterns that matched no files, verbatim as configured. */
        readonly patterns: readonly string[],
    ) {
        super(message);
        this.name = 'EmptySourcePatternError';
    }
}

/** The new POT is too much smaller than the catalogs `msgmerge` would rewrite. */
export class CatalogShrinkError extends GettextGuardError {
    constructor(
        message: string,
        readonly potEntries: number,
        readonly catalogEntries: number,
    ) {
        super(message);
        this.name = 'CatalogShrinkError';
    }
}

/** One `sources` pattern and how many files it actually resolved to. */
export interface SourcePatternMatch {
    /** The pattern verbatim as configured — it is what an error has to name. */
    pattern: string;
    fileCount: number;
}

/** A catalog's language and the number of entries it currently still uses. */
export interface CatalogSize {
    language: string;
    entries: number;
}

/**
 * Fraction of its entries a catalog set may lose in one extraction.
 *
 * Why a RATIO: an absolute count cannot be right for both a twelve-string dialog
 * and a nine-hundred-string tutorial. Why a THIRD: the two populations this has
 * to separate are far apart. Ordinary churn between two runs of the same build is
 * a handful of strings — single-digit percent of any real catalog — while the
 * failure above drops a whole source group at once. A third sits in the empty
 * space between them. Half, the other candidate, is worse: a project with two
 * source groups of similar size loses one of them at ~50% and slips under.
 *
 * A deliberate rewrite that really does delete more says so with
 * `maxCatalogEntryLoss`, which is the point of it being an option.
 */
export const DEFAULT_MAX_CATALOG_ENTRY_LOSS = 1 / 3;

/**
 * Fails unless every source pattern resolved to at least one file.
 *
 * FAILING IS THE DEFAULT ON PURPOSE. A pattern that matches nothing is almost
 * always a build-order or path mistake, and the cost of being wrong is
 * asymmetric: a false failure costs one build, a missed one costs every
 * translation the group carried. A project that genuinely has an optional group
 * names those patterns in `optionalSources` — per pattern, never a blanket
 * boolean, so the guard stays armed for every other entry.
 */
export function assertEverySourcePatternMatched(
    matches: readonly SourcePatternMatch[],
    context: { pluginName: string; cwd: string; optionalSources?: readonly string[]; ignore?: readonly string[] },
): void {
    const optional = new Set(context.optionalSources ?? []);
    const empty = matches
        .filter((match) => match.fileCount === 0 && !optional.has(match.pattern))
        .map((match) => match.pattern);

    if (empty.length === 0) {
        return;
    }

    const list = empty.map((pattern) => `  - ${pattern}`).join('\n');
    // The negated patterns are named whenever there are any: a pattern whose every
    // hit was excluded looks exactly like a wrong path, and the two have different
    // fixes.
    const excluded = context.ignore?.length
        ? `After excluding ${context.ignore.map((pattern) => `!${pattern}`).join(', ')}.\n`
        : '';
    throw new EmptySourcePatternError(
        `[${context.pluginName}] ${empty.length === 1 ? 'a source pattern' : `${empty.length} source patterns`} matched no files:\n` +
            `${list}\n` +
            `Resolved relative to ${context.cwd}.\n` +
            excluded +
            'Nothing was extracted. Extracting anyway writes a POT without those strings, and with ' +
            'autoUpdatePo that prunes the same strings out of every catalog. Usual cause: the pattern ' +
            'points at a build artifact of another package that has not been built yet.\n' +
            "If the group really is optional, list the pattern verbatim in the plugin's `optionalSources`.",
        empty,
    );
}

/**
 * Fails when the freshly written POT would cost the catalogs more entries than
 * `maxEntryLoss` allows.
 *
 * The reference is the LARGEST catalog rather than each one in turn: after a
 * successful merge every catalog carries the POT's msgid set, so the biggest one
 * is the best evidence of what the project had before this run. Comparing per
 * language would let one catalog that a previous bad run already gutted excuse
 * gutting the rest.
 */
export function assertCatalogsSurviveMerge(args: {
    potEntries: number;
    catalogs: readonly CatalogSize[];
    potFile: string;
    pluginName: string;
    maxEntryLoss?: number;
}): void {
    const limit = args.maxEntryLoss ?? DEFAULT_MAX_CATALOG_ENTRY_LOSS;
    const reference = args.catalogs.reduce<CatalogSize | undefined>(
        (largest, candidate) => (largest && largest.entries >= candidate.entries ? largest : candidate),
        undefined,
    );

    // No catalogs yet, or an empty one: there is nothing a merge can destroy, and
    // a ratio against zero is not a number.
    if (!reference || reference.entries === 0) {
        return;
    }

    const lost = reference.entries - args.potEntries;
    if (lost <= 0 || lost / reference.entries <= limit) {
        return;
    }

    const percent = (value: number) => `${Math.round(value * 100)}%`;
    throw new CatalogShrinkError(
        `[${args.pluginName}] refusing to update the catalogs: ${args.potFile} holds ${args.potEntries} ` +
            `entries, but ${reference.language}.po already holds ${reference.entries}. That is a loss of ` +
            `${percent(lost / reference.entries)}, over the ${percent(limit)} this build allows, across ` +
            `${args.catalogs.length} ${args.catalogs.length === 1 ? 'catalog' : 'catalogs'}.\n` +
            'msgmerge would move every missing entry into `#~` comments, which msgfmt ignores — the ' +
            'translations would be gone. Usual cause: a source group went missing from this run.\n' +
            "If the strings really were deleted, raise the plugin's `maxCatalogEntryLoss` for the run that does it.",
        args.potEntries,
        reference.entries,
    );
}

/**
 * Entries a PO/POT file still USES.
 *
 * Obsolete entries (`#~ msgid`) are excluded because `msgfmt` excludes them: a
 * gutted catalog keeps every line and loses every translation, so a line count
 * would report it as healthy. One `msgid` line per entry holds for multi-line and
 * `msgctxt`-qualified entries alike, and `msgid_plural` does not match — the
 * subtracted one is the header, whose msgid is empty.
 */
export function countActiveEntries(text: string): number {
    let heads = 0;
    for (const line of text.split('\n')) {
        if (/^msgid[ \t]/.test(line)) {
            heads++;
        }
    }
    return Math.max(0, heads - 1);
}
