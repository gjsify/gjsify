// One catalog, three namespaces — and the table that keeps them apart.
//
// A catalog is called ONE thing in the repository and has to be spelled three
// different ways downstream. They disagree on the same catalog, so passing the
// name through unchanged is wrong in two of the three places.
//
//   | target                       | namespace         | zh_Hans | pt_BR |
//   |------------------------------|-------------------|---------|-------|
//   | gettext `.mo` directory      | POSIX locale      | zh_CN   | pt_BR |
//   | Android resources (via JSON) | Android qualifier | zh      | pt-BR |
//   | Weblate / the `.po` in repo  | BCP-47-ish        | zh_Hans | pt_BR |
//
// THE INCIDENT, POSIX SIDE (JumpLink/Learn6502#182, measured 2026-09-11).
// Catalogs are maintained on Weblate, which names simplified Chinese `zh_Hans`.
// The compiler used the `.po` basename verbatim as the locale directory, so the
// catalog landed in `locale/zh_Hans/LC_MESSAGES/`. `zh_Hans` is BCP-47, not a
// POSIX locale name, and glibc never probes it. Measured against the real
// shipped `.mo` with the glibc `gettext` CLI as the oracle:
//
//     LANGUAGE=zh_Hans -> 黄色      (a selector no real user has)
//     LANGUAGE=zh_CN   -> Yellow    <- what an actual user in China gets
//     LANGUAGE=zh_TW   -> Yellow
//     LANGUAGE=de      -> Gelb      (control: ordinary names were always fine)
//
// A complete Chinese catalog shipped and every Chinese user saw English. The
// build exited 0; 14 of the 15 catalogs were fine, which is why nobody looked.
//
// THE INCIDENT, ANDROID SIDE (JumpLink/Learn6502#179). `po2json` wrote the same
// basename as the JSON filename, and `@nativescript/localize` turns that
// filename straight into an Android resource directory (`hooks/converter.js`:
// values-${language.replace(/^(.+?)-(.+?)$/, '$1-r$2')}). Running that
// transformation over the names in play:
//
//     de       -> values-de        ok
//     pt-BR    -> values-pt-rBR    ok      <- the name the repo tracks
//     pt_BR    -> values-pt_BR     BROKEN  <- what po2json wrote
//     zh       -> values-zh        ok      <- the name the repo tracks
//     zh_Hans  -> values-zh_Hans   BROKEN  <- what po2json wrote
//     zh-Hans  -> values-zh-rHans  BROKEN  (a script subtag needs values-b+zh+Hans)
//
// An underscore is not legal in an Android resource qualifier, so those are
// directories Android never consults. Both generations sat in the tree at once:
// the tracked, correct `pt-BR.json`/`zh.json` and the generated, dead
// `pt_BR.json`/`zh_Hans.json` beside them.
//
// NOT MEASURED: that Android then loads the resulting directory. The qualifier
// rule is derived from the hook's source and the transformation above was
// executed, but no emulator or device ran. The POSIX side, by contrast, was
// measured end to end against glibc.
//
// Why this cannot be fixed by renaming the `.po`: the name comes from Weblate,
// it is correct there, and the two downstream namespaces would still disagree
// with each other. The mapping has to happen where each artifact is written.
//
// The mapping is DATA in one table read by both plugins, rather than logic in
// each — two copies of this reasoning would drift, and the drifted one wins
// silently.
//
// The decisions live here, apart from the I/O that acts on them, so they can be
// tested without gettext installed and without a filesystem.

import { GettextGuardError } from './guards.js';

/** A catalog name whose script subtag maps to no name we know. */
export class UnmappableCatalogNameError extends GettextGuardError {
    constructor(
        message: string,
        /** The catalog names that could not be mapped, verbatim as the `.po` is called. */
        readonly catalogs: readonly string[],
    ) {
        super(message);
        this.name = 'UnmappableCatalogNameError';
    }
}

/** Two catalogs claim one output name; one would overwrite the other. */
export class CollidingCatalogNameError extends GettextGuardError {
    constructor(
        message: string,
        /** The name claimed twice, and the catalogs claiming it. */
        readonly claimed: string,
        readonly catalogs: readonly string[],
    ) {
        super(message);
        this.name = 'CollidingCatalogNameError';
    }
}

/** How one catalog is spelled in each namespace that consumes it. */
export interface CatalogNames {
    /** The `.po` basename, verbatim. What an error message names. */
    catalog: string;
    /** `.mo` locale directories, in write order. */
    posix: readonly string[];
    /** JSON basename — a BCP-47 tag `@nativescript/localize` can qualify. */
    bcp47: string;
}

/** A script subtag's spelling in the two generated namespaces. */
interface ScriptMapping {
    posix: readonly string[];
    /**
     * Omitted where no SAFE Android qualifier exists. The hook's regex yields a
     * legal qualifier only for `<lang>` and `<lang>-<REGION>`; a script subtag
     * would need `values-b+<lang>+<Script>`, which the hook cannot emit. Such a
     * catalog is reported rather than given a name that merely looks right.
     */
    bcp47?: string;
}

/**
 * Script subtag → the names that serve it.
 *
 * The POSIX column was MEASURED on glibc 2.42 / gettext 0.26 by installing a
 * catalog under the target alone and asking the `gettext` CLI which selectors
 * reached it. Two rules came out of that and explain the shapes below:
 *
 *   - a bare `<lang>` directory is reached by `<lang>_<TERRITORY>` users
 *     (`sr` answered `sr_RS`), so a script that is simply the language's normal
 *     one needs no territory at all;
 *   - `<lang>@<modifier>` is reached by `<lang>_<TERRITORY>@<modifier>` users,
 *     while `<lang>_<TERRITORY>@<modifier>` is reached ONLY by itself, so the
 *     modifier forms are deliberately written WITHOUT a territory. This is the
 *     one place where the narrower spelling is the tempting one and is wrong.
 *
 * Chinese needs its territories spelled out: `zh_CN` is NOT reached by a
 * `zh_SG` user (measured), and the broad `zh` IS reached by `zh_TW` — so a
 * simplified catalog installed as `zh` would serve traditional users simplified
 * text. The territories are explicit precisely to avoid that.
 *
 * A POSIX target absent from the building host is still written: the catalog is
 * compiled once and installed on machines whose locale set this build cannot
 * see (`zh_MO` is absent on Fedora 44 and present elsewhere). A directory
 * nobody probes costs a few KB; a missing one costs the language.
 *
 * The table is deliberately NOT exhaustive. An unknown script is REPORTED
 * rather than guessed — a guessed territory is the same silent-wrong-name
 * failure this module exists to end.
 */
const SCRIPT_NAMES: Readonly<Record<string, ScriptMapping>> = {
    // Chinese: the script IS the axis users select on, and both halves ship.
    // `zh` for simplified is the name Learn6502 already tracks and yields
    // `values-zh`; traditional takes the territory form, `values-zh-rTW`.
    zh_Hans: { posix: ['zh_CN', 'zh_SG'], bcp47: 'zh' },
    zh_Hant: { posix: ['zh_TW', 'zh_HK', 'zh_MO'], bcp47: 'zh-TW' },
    // Scripts glibc expresses as an @modifier. None has a safe Android
    // qualifier: the distinction they carry is exactly the one the hook drops.
    sr_Latn: { posix: ['sr@latin'] },
    uz_Cyrl: { posix: ['uz@cyrillic'] },
    be_Latn: { posix: ['be@latin'] },
    // Scripts that are the language's ordinary one: the bare language covers it
    // in both namespaces, because there is no distinction left to express.
    sr_Cyrl: { posix: ['sr'], bcp47: 'sr' },
    uz_Latn: { posix: ['uz'], bcp47: 'uz' },
    az_Latn: { posix: ['az'], bcp47: 'az' },
    bs_Latn: { posix: ['bs'], bcp47: 'bs' },
    mn_Cyrl: { posix: ['mn'], bcp47: 'mn' },
    tg_Cyrl: { posix: ['tg'], bcp47: 'tg' },
    kk_Cyrl: { posix: ['kk'], bcp47: 'kk' },
    ky_Cyrl: { posix: ['ky'], bcp47: 'ky' },
    // Scripts glibc separates by territory, which Android can qualify too.
    pa_Guru: { posix: ['pa_IN'], bcp47: 'pa-IN' },
    pa_Arab: { posix: ['pa_PK'], bcp47: 'pa-PK' },
};

/**
 * `language`, optional `Script`, optional `TERRITORY` of a catalog name.
 *
 * Matched after hyphens are folded to underscores, so one pattern reads both the
 * BCP-47 spelling Weblate writes (`pt-BR`, `zh-Hans`) and the POSIX one. A name
 * already carrying an `@modifier` is handled before this: it is POSIX by
 * construction and needs no mapping.
 */
const CATALOG_NAME = /^([a-z]{2,3})(?:_([A-Z][a-z]{3}))?(?:_([A-Z]{2}|\d{3}))?$/;

/** Which generated namespace a lookup is for, so errors can say what broke. */
export type CatalogNamespace = 'posix' | 'bcp47';

/** The script mapping for a catalog name, if it carries a script subtag at all. */
function scriptMappingFor(normalized: string): ScriptMapping | undefined {
    const parsed = CATALOG_NAME.exec(normalized);
    if (!parsed?.[2] || parsed[3]) {
        return undefined;
    }
    return SCRIPT_NAMES[`${parsed[1]}_${parsed[2]}`];
}

/**
 * How one catalog is spelled everywhere, or `undefined` when its script subtag
 * has no name in the namespace asked for.
 *
 * The ORIGINAL name is always kept among the POSIX directories. It is additive —
 * no deployment that already found a catalog can stop finding it — and it keeps
 * the compiled tree greppable against the catalogs it came from. It is never the
 * only entry, because on its own it is precisely what nothing probes. The JSON
 * side gets no such alias: a filename is one name, and a second copy under the
 * dead spelling is what left two generations in the tree to begin with.
 */
export function catalogNames(
    catalog: string,
    overrides?: Readonly<Record<string, readonly string[]>>,
): CatalogNames | undefined {
    // A configured override answers for the name as written AND as normalised,
    // so a project need not know which spelling this module reasons about.
    const normalized = catalog.replace(/-/g, '_');
    const override = overrides?.[catalog] ?? overrides?.[normalized];
    if (override && override.length > 0) {
        return {
            catalog,
            posix: dedupe([...override, catalog]),
            bcp47: override[0].split('@')[0].replace(/_/g, '-'),
        };
    }

    // A name carrying an @modifier is POSIX by construction — the modifier is
    // the thing BCP-47 has no spelling for, so nothing but a hand-written POSIX
    // name can have produced it. Android cannot express it either; the bare
    // language is the honest remainder.
    if (normalized.includes('@')) {
        return { catalog, posix: [normalized], bcp47: normalized.split('@')[0].replace(/_/g, '-') };
    }

    const parsed = CATALOG_NAME.exec(normalized);
    if (!parsed) {
        // Not a shape this module recognises. Passed through rather than
        // reported: gettext's own fallback still reaches a plain `<lang>`
        // prefix, and reporting every unusual name would make the guard noise
        // instead of signal. Only a SCRIPT subtag is a measured silent failure.
        return { catalog, posix: [normalized], bcp47: normalized.replace(/_/g, '-') };
    }

    const [, language, script, territory] = parsed;

    if (!script) {
        // `de`, `pt_BR`, `zh_CN` — already exactly what glibc probes. The only
        // work a hyphenated `pt-BR` needed was the underscore; Android needs the
        // hyphen back, which is why the two columns differ here for free.
        return { catalog, posix: dedupe([normalized, catalog]), bcp47: normalized.replace(/_/g, '-') };
    }

    // An explicit territory beside the script settles it without the table:
    // `zh_Hans_CN` is `zh_CN`, whatever the script says.
    if (territory) {
        return {
            catalog,
            posix: dedupe([`${language}_${territory}`, catalog]),
            bcp47: `${language}-${territory}`,
        };
    }

    const mapped = SCRIPT_NAMES[`${language}_${script}`];
    if (!mapped?.bcp47) {
        return undefined;
    }
    return { catalog, posix: dedupe([...mapped.posix, catalog]), bcp47: mapped.bcp47 };
}

/**
 * The POSIX directories alone.
 *
 * A script with a POSIX mapping but no safe Android qualifier (`sr_Latn`) is
 * answerable here and not by {@link catalogNames}: the `.mo` side knows exactly
 * where it goes. Splitting the lookup this way is what lets the gettext plugin
 * stay correct for catalogs the JSON plugin has to refuse.
 */
export function posixLocaleDirectories(
    catalog: string,
    overrides?: Readonly<Record<string, readonly string[]>>,
): readonly string[] | undefined {
    const both = catalogNames(catalog, overrides);
    if (both) {
        return both.posix;
    }
    const mapped = scriptMappingFor(catalog.replace(/-/g, '_'));
    return mapped ? dedupe([...mapped.posix, catalog]) : undefined;
}

/**
 * Plans every catalog for ONE namespace, and fails if any cannot be spelled.
 *
 * FAILING IS THE DEFAULT ON PURPOSE, on the same asymmetry the source-pattern
 * guard is built on: a false failure costs one build and one line of config, a
 * missed one ships a whole language that silently renders in English — which is
 * what `zh_Hans` did, undetected, for as long as the catalog existed. A build
 * that cannot say where a catalog goes must not quietly put it somewhere,
 * because "somewhere" is indistinguishable from "correct" until a user of that
 * language complains.
 *
 * Every unmappable name is named in ONE error rather than the first aborting, so
 * a project adopting several Weblate languages fixes them in a single pass
 * instead of a build-fix-build loop.
 */
export function planCatalogNames(
    catalogs: readonly string[],
    context: {
        pluginName: string;
        namespace: CatalogNamespace;
        /** Per-catalog override, e.g. `{ az_Arab: ['az_IR'] }`. */
        localeNames?: Readonly<Record<string, readonly string[]>>;
    },
): CatalogNames[] {
    const plans: CatalogNames[] = [];
    const unmappable: string[] = [];

    for (const catalog of catalogs) {
        if (context.namespace === 'posix') {
            const posix = posixLocaleDirectories(catalog, context.localeNames);
            if (!posix) {
                unmappable.push(catalog);
                continue;
            }
            plans.push({ catalog, posix, bcp47: '' });
            continue;
        }

        const names = catalogNames(catalog, context.localeNames);
        if (!names) {
            unmappable.push(catalog);
            continue;
        }
        plans.push(names);
    }

    if (unmappable.length > 0) {
        throw new UnmappableCatalogNameError(unmappableMessage(unmappable, context), unmappable);
    }

    assertNoCollision(plans, context);
    return plans;
}

function unmappableMessage(
    unmappable: readonly string[],
    context: { pluginName: string; namespace: CatalogNamespace },
): string {
    const list = unmappable.map((name) => `  - ${name}.po`).join('\n');
    const subject = unmappable.length === 1 ? 'a catalog carries' : `${unmappable.length} catalogs carry`;

    if (context.namespace === 'posix') {
        return (
            `[${context.pluginName}] ${subject} a script subtag with no known POSIX locale:\n` +
            `${list}\n` +
            'Compiling it under that name produces a directory glibc never probes, so the language ships ' +
            'complete and renders in English — the build would exit 0 and nothing would look wrong.\n' +
            "Map it explicitly in the plugin's `localeNames`, e.g. `{ 'az_Arab': ['az_IR'] }`, using the " +
            'name `locale -a` lists on the target system.'
        );
    }

    return (
        `[${context.pluginName}] ${subject} a script subtag that has no Android resource qualifier:\n` +
        `${list}\n` +
        'A qualifier is built as `values-<lang>[-r<REGION>]` and cannot express a script, so the generated ' +
        'directory would be one Android never consults — and the build would exit 0.\n' +
        "Map it explicitly in the plugin's `localeNames`, e.g. `{ 'sr_Latn': ['sr'] }`, choosing the " +
        'language or region tag the app should serve it as.'
    );
}

/**
 * Fails when two catalogs claim the same output name.
 *
 * Reachable as soon as a project keeps both spellings of one language — a
 * `zh_Hans.po` from Weblate beside a hand-made `zh_CN.po` both resolve to
 * `zh_CN`. Without this, whichever is written last wins by iteration order, the
 * other's translations are simply absent, and the build still exits 0. That is
 * the same shape as the bug this module fixes, so it is guarded here rather than
 * left to be discovered the same way.
 */
function assertNoCollision(
    plans: readonly CatalogNames[],
    context: { pluginName: string; namespace: CatalogNamespace },
): void {
    const claimedBy = new Map<string, string[]>();
    for (const plan of plans) {
        const claims = context.namespace === 'posix' ? plan.posix : [plan.bcp47];
        for (const claim of claims) {
            const claimants = claimedBy.get(claim);
            if (claimants) {
                claimants.push(plan.catalog);
            } else {
                claimedBy.set(claim, [plan.catalog]);
            }
        }
    }

    for (const [claimed, catalogs] of claimedBy) {
        if (catalogs.length > 1) {
            const where = context.namespace === 'posix' ? `locale/${claimed}/` : `${claimed}.json`;
            throw new CollidingCatalogNameError(
                `[${context.pluginName}] ${catalogs.map((name) => `${name}.po`).join(' and ')} both compile to ` +
                    `${where}. One would overwrite the other and the build would still exit 0.\n` +
                    "Keep one catalog per language, or pin them apart with the plugin's `localeNames`.",
                claimed,
                catalogs,
            );
        }
    }
}

/** First occurrence wins, so the mapped name stays ahead of the original. */
function dedupe(values: readonly string[]): string[] {
    return [...new Set(values)];
}
