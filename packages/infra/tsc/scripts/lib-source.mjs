// Decide where @gjsify/tsc's shipped default-library (`lib*.d.ts`) files come
// from when (re)building the bundle.
//
// The committed `<pkgRoot>/lib/lib*.d.ts` are the version-locked source of
// truth — tracked in git exactly like `dist/tsc.gjs.mjs`. They MUST match the
// pinned `TYPESCRIPT_VERSION`. We only refresh them from the upstream
// `typescript` devDep when that devDep EXACTLY matches the pin AND ships a
// complete lib set. Any other case keeps the committed libs untouched.
//
// Why this matters (root cause of the v0.4.42 Fedora-44 `main` red): a naive
// `rm -rf lib/` + copy-from-`node_modules/typescript` destroys the correct,
// committed libs and replaces them with whatever happens to be installed —
//   • a STALE install (TS 5.9's 100-file set, missing the `es2025.*` libs that
//     TS 6's `lib.esnext` references), or
//   • a PARTIAL/corrupt install (missing `lib.esnext.full.d.ts` entirely).
// Either yields a `lib/` that fails EVERY downstream `gjsify tsc` with
// `TS6053: File '…/lib.esnext.full.d.ts' not found` + a `TS2318` cascade. The
// committed libs exist precisely to be that version-locked safety net;
// `rm`-ing them before they can help defeats the point.
//
// Pure function — no fs / process — so it is unit-testable in isolation.

/** The TS-6 "super-lib" that aggregates every other lib; its presence is the
 *  cheapest reliable completeness probe for a lib set. */
export const SUPER_LIB = 'lib.esnext.full.d.ts';

/**
 * @param {object}   o
 * @param {string}   o.tsVersion       version of the installed `typescript` devDep
 * @param {string}   o.pinnedVersion   the pinned `TYPESCRIPT_VERSION` constant
 * @param {string[]} o.sourceLibs      `lib*.d.ts` filenames in `node_modules/typescript/lib`
 * @param {string[]} o.committedLibs   `lib*.d.ts` filenames currently in the package's `lib/`
 * @returns {{action:'refresh'|'keep'|'error', reason:string}}
 *   - `refresh`: installed devDep matches the pin and is complete → copy it in.
 *   - `keep`   : devDep is mismatched/incomplete but the committed libs are
 *               valid → leave them untouched.
 *   - `error`  : neither source can supply a valid set → abort the build.
 */
export function pickLibSource({ tsVersion, pinnedVersion, sourceLibs, committedLibs }) {
    const sourceHasSuperLib = sourceLibs.includes(SUPER_LIB);
    // A complete source has the super-lib AND at least as many files as we
    // already ship (guards against a partial install with fewer files).
    const sourceComplete = sourceHasSuperLib && sourceLibs.length >= committedLibs.length;
    const versionMatches = tsVersion === pinnedVersion;

    if (versionMatches && sourceComplete) {
        return {
            action: 'refresh',
            reason: `typescript@${tsVersion} matches the pin and ships ${sourceLibs.length} lib*.d.ts`,
        };
    }

    const committedValid = committedLibs.length > 0 && committedLibs.includes(SUPER_LIB);
    if (committedValid) {
        const why = !versionMatches
            ? `installed typescript@${tsVersion} != pinned ${pinnedVersion}`
            : `installed typescript@${tsVersion} ships an incomplete lib set ` +
              `(${sourceLibs.length} files${sourceHasSuperLib ? '' : `, no ${SUPER_LIB}`})`;
        return {
            action: 'keep',
            reason: `${why}; keeping the committed lib/ (${committedLibs.length} files) as-is`,
        };
    }

    return {
        action: 'error',
        reason:
            `committed lib/ is missing or incomplete (${committedLibs.length} files) AND installed ` +
            `typescript@${tsVersion} cannot supply a valid set (${sourceLibs.length} files) — ` +
            `install typescript@${pinnedVersion} and rebuild`,
    };
}
