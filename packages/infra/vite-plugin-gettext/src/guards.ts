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

/** `msgmerge` would obsolete more of the catalogs than this build allows. */
export class CatalogShrinkError extends GettextGuardError {
    constructor(
        message: string,
        /** Entries the reference catalog holds that the new POT no longer carries. */
        readonly lostEntries: number,
        readonly catalogEntries: number,
    ) {
        super(message);
        this.name = 'CatalogShrinkError';
    }
}

/** A `maxCatalogEntryLoss` that is not a fraction — the guard cannot act on it. */
export class InvalidEntryLossError extends GettextGuardError {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidEntryLossError';
    }
}

/** One `sources` pattern and how many files it actually resolved to. */
export interface SourcePatternMatch {
    /** The pattern verbatim as configured — it is what an error has to name. */
    pattern: string;
    fileCount: number;
}

/** A catalog's language and the msgids it currently still uses. */
export interface CatalogMsgids {
    language: string;
    msgids: ReadonlySet<string>;
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
 * Reads `maxCatalogEntryLoss`, which has to be a FRACTION.
 *
 * Validated separately, and before the catalogs are looked at, because the two
 * ways of getting it wrong both end in silence. `50` — the option read as a
 * percentage — is `<= 50` for every possible ratio, so the guard passes
 * everything and reports nothing; `NaN` fails every comparison, so the guard
 * fires on a build that lost nothing and gets raised out of the way. Neither
 * would ever be traced back to the option.
 */
export function resolveMaxEntryLoss(value: number | undefined, pluginName: string): number {
    if (value === undefined) {
        return DEFAULT_MAX_CATALOG_ENTRY_LOSS;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new InvalidEntryLossError(
            `[${pluginName}] maxCatalogEntryLoss must be a fraction between 0 and 1, and is ${String(value)}. ` +
                'It is a fraction, not a percentage: a third is 0.33, half is 0.5, and 1 turns the check off.',
        );
    }
    return value;
}

/**
 * Fails when merging the freshly written POT would obsolete more of the catalogs
 * than `maxEntryLoss` allows.
 *
 * What is measured is the SET of msgids the POT no longer carries, not how much
 * shorter it got. `msgmerge` matches by msgid, so an equally long POT whose
 * strings have changed obsoletes just as much as a short one — and measured on
 * gettext 0.26, a msgid that only gained a space is fuzzy-matched, keeps its
 * translation, and is then excluded from the `.mo` by `msgfmt` anyway. A count
 * cannot see that; a set difference is the quantity `msgmerge` acts on.
 *
 * The reference is the LARGEST catalog rather than each one in turn: `msgmerge`
 * gives every catalog the POT's msgid set (measured — a 1-entry and a 2-entry
 * catalog both came back with the POT's 3), so the biggest one is the best
 * evidence of what the project had before this run. Comparing per language would
 * let one catalog that a previous bad run already gutted excuse gutting the rest.
 */
export function assertCatalogsSurviveMerge(args: {
    potMsgids: ReadonlySet<string>;
    catalogs: readonly CatalogMsgids[];
    potFile: string;
    pluginName: string;
    maxEntryLoss?: number;
}): void {
    const limit = resolveMaxEntryLoss(args.maxEntryLoss, args.pluginName);
    const reference = args.catalogs.reduce<CatalogMsgids | undefined>(
        (largest, candidate) => (largest && largest.msgids.size >= candidate.msgids.size ? largest : candidate),
        undefined,
    );

    // No catalogs yet, or an empty one: there is nothing a merge can destroy, and
    // a ratio against zero is not a number.
    if (!reference || reference.msgids.size === 0) {
        return;
    }

    const held = reference.msgids.size;
    let lost = 0;
    for (const msgid of reference.msgids) {
        if (!args.potMsgids.has(msgid)) {
            lost++;
        }
    }
    if (lost === 0 || lost / held <= limit) {
        return;
    }

    const percent = (value: number) => `${Math.round(value * 100)}%`;
    throw new CatalogShrinkError(
        `[${args.pluginName}] refusing to update the catalogs: ${args.potFile} no longer carries ${lost} of the ` +
            `${held} entries ${reference.language}.po holds. That is a loss of ${percent(lost / held)}, over the ` +
            `${percent(limit)} this build allows, across ${args.catalogs.length} ` +
            `${args.catalogs.length === 1 ? 'catalog' : 'catalogs'}.\n` +
            'msgmerge would move every missing entry into `#~` comments, which msgfmt ignores — the ' +
            'translations would be gone. Usual cause: a source group went missing from this run.\n' +
            "If the strings really were deleted, raise the plugin's `maxCatalogEntryLoss` for the run that does it.",
        lost,
        held,
    );
}

/**
 * The msgids a PO/POT file still USES, keyed the way gettext keys them.
 *
 * Obsolete entries (`#~ msgid`) are excluded because `msgfmt` excludes them: a
 * gutted catalog keeps every line and loses every translation, so a line count
 * would report it as healthy. The header is excluded by being the one entry whose
 * msgid is empty and uncontextualised.
 *
 * Continuation lines are CONCATENATED rather than counted, which is what makes a
 * POT comparable with a catalog at all: the same string is wrapped differently
 * depending on `--no-wrap` and on how long the surrounding lines were, and only
 * the joined value is stable. `msgctxt` joins its msgid through gettext's own
 * `\u0004` separator, so two entries that differ only in context stay two.
 */
export function activeMsgids(text: string): Set<string> {
    const msgids = new Set<string>();
    let reading: 'msgctxt' | 'msgid' | undefined;
    let pieces: string[] = [];
    let context: string | undefined;

    const finish = () => {
        if (reading === 'msgctxt') {
            context = pieces.join('');
        } else if (reading === 'msgid') {
            const msgid = pieces.join('');
            if (msgid !== '' || context !== undefined) {
                msgids.add(context === undefined ? msgid : `${context}\u0004${msgid}`);
            }
            context = undefined;
        }
        reading = undefined;
        pieces = [];
    };

    for (const line of text.split('\n')) {
        const opener = /^(msgctxt|msgid)[ \t]/.exec(line);
        if (opener) {
            finish();
            reading = opener[1] as 'msgctxt' | 'msgid';
            pieces = [literal(line)];
            continue;
        }
        // A bare string literal continues whatever keyword opened the entry. An
        // obsolete entry's own continuations are prefixed `#~ `, so they never
        // reach here and never re-open one either.
        if (reading && /^[ \t]*"/.test(line)) {
            pieces.push(literal(line));
            continue;
        }
        finish();
    }
    finish();

    return msgids;
}

/** The quoted payload of a PO line, unescaped no further than both files are. */
function literal(line: string): string {
    const first = line.indexOf('"');
    const last = line.lastIndexOf('"');
    return first < 0 || last <= first ? '' : line.slice(first + 1, last);
}

/**
 * Entries a PO/POT file still USES — the size of {@link activeMsgids}, and the
 * same measurement, so the number and the set can never disagree.
 */
export function countActiveEntries(text: string): number {
    return activeMsgids(text).size;
}
