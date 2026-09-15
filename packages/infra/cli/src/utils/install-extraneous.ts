/**
 * The half of `--immutable` that was missing: every locked package is present AND
 * NOTHING ELSE IS.
 *
 * The installer only ever ADDED. Handed a `node_modules` carrying a package the
 * lockfile never mentions, `--immutable` extracted whatever was missing, left the
 * stranger in place and exited 0 — a green install over a tree its own lockfile does
 * not describe.
 *
 * THE INCIDENT (gjsify#1683, 2026-09-15). CI caches `node_modules` keyed on
 * `hashFiles('gjsify-lock.json')` with a prefix fallback `restore-keys:
 * node-modules-v1-`. An earlier run of a `@girs` bump genuinely nested
 * `node_modules/@girs/gtk-4.0/node_modules/@girs/graphene-1.0` and saved that tree.
 * The fix push changed the lockfile → new key → miss → the FALLBACK restored the
 * nested tree. `--immutable` added what was missing, pruned nothing, and `tsc` then
 * saw one type under two identities: TS2883. Worse, the still-nested tree was saved
 * under the NEW key, so no plain re-run could go green — the failure reproduced
 * itself until the caches were deleted by hand. Nothing about the PR's code was
 * wrong, and any lockfile-changing PR could poison itself the same way.
 *
 * WHY NAMING, NOT DELETING. The peers split: `npm ci` removes `node_modules` first,
 * yarn's `--immutable` fails on a mismatch. This follows yarn, for three reasons.
 * The flag's own name promises not to mutate, and this repo already refuses
 * automatic deletion under it ({@link automaticPruneRefusal} returns `'--immutable'`).
 * A verifier that deletes can delete the wrong thing — a `link`ed dep, a package
 * some other tool put there — while a verifier that reports cannot. And the failure
 * mode is asymmetric: a wrong deletion loses work, a wrong refusal costs one red run
 * carrying the exact paths and the fix.
 *
 * That choice has a price, paid in `.github/actions/gjsify-setup/action.yml`: with
 * this check fatal, a restored FOREIGN tree stops being silent corruption and
 * becomes a hard failure on every lockfile-changing PR. So the `restore-keys`
 * fallback is gone — see the comment there. The two decisions are one decision.
 */

import { relative, sep } from 'node:path';
import type { InstalledPackage } from './prune-prefix.js';

/** A package directory on disk that the lockfile does not describe. */
export interface ExtraneousPackage {
    /**
     * Path relative to the install prefix, always `/`-separated — the exact shape of
     * a `gjsify-lock.json` `packages` key, so "not in the lockfile" is checkable by
     * grepping the reported string against the file.
     */
    installPath: string;
    /** From the on-disk manifest; the directory path when it was unreadable. */
    name: string;
    version: string;
}

/** `/`-separated, no trailing slash — lockfile key shape on every host. */
function normalizePath(p: string): string {
    const slashed = sep === '/' ? p : p.split(sep).join('/');
    return slashed.endsWith('/') ? slashed.slice(0, -1) : slashed;
}

/**
 * Package directories under `prefix` that no entry of `expected` accounts for.
 *
 * Pure: it takes the scan rows ({@link scanPrefix}) and the resolved set rather than
 * reading either, so every branch — nested placements, symlinks, subtree collapsing —
 * is decidable without a filesystem.
 *
 * Three things are deliberately NOT extraneous:
 *   - a SYMLINK, which is a workspace source tree linked in by `workspaceInstall`
 *     and by construction absent from the lockfile (`scanPrefix` does not descend
 *     into one either, so the user's own sources are never walked);
 *   - a dot-entry like `.bin` or `.cache`, already dropped by the scan;
 *   - a package the lockfile describes but the PLATFORM filter skipped on this host.
 *     It is described, so it is not a stranger; removing the foreign-platform residue
 *     is `prune-prefix.ts`'s separate job under a separate rule.
 *
 * Descendants of an extraneous directory are collapsed away: reporting the parent
 * says everything, and the nested `@girs` tree of the incident would otherwise list
 * its whole subtree.
 */
export function findExtraneous(opts: {
    prefix: string;
    installed: readonly InstalledPackage[];
    expected: readonly { installPath: string }[];
}): ExtraneousPackage[] {
    const described = new Set(opts.expected.map((n) => normalizePath(n.installPath)));
    const found: ExtraneousPackage[] = [];
    for (const pkg of opts.installed) {
        if (pkg.linked) continue;
        const installPath = normalizePath(relative(opts.prefix, pkg.dir));
        // Outside the prefix, or the prefix itself: not this install's to judge.
        if (installPath === '' || installPath.startsWith('..')) continue;
        if (described.has(installPath)) continue;
        found.push({ installPath, name: pkg.name, version: pkg.version });
    }
    found.sort((a, b) => (a.installPath < b.installPath ? -1 : a.installPath > b.installPath ? 1 : 0));

    const roots: ExtraneousPackage[] = [];
    for (const entry of found) {
        const parent = roots[roots.length - 1];
        // Sorted, so an enclosing extraneous directory is always the last one kept.
        if (parent && entry.installPath.startsWith(`${parent.installPath}/`)) continue;
        roots.push(entry);
    }
    return roots;
}

/** How many paths the message names before it starts counting. */
export const EXTRANEOUS_REPORT_LIMIT = 20;

/**
 * The refusal, built to be actionable from the CI log alone: what is wrong, which
 * paths, and the one thing that fixes it. Truncated past
 * {@link EXTRANEOUS_REPORT_LIMIT} so a wholly foreign tree does not bury the advice
 * under a thousand lines.
 *
 * It says DELETE, and says so as the only remedy, because that is what was measured:
 * a plain `gjsify install` — and an explicit `--prune` — leave both a top-level and a
 * nested stranger exactly where they were. The installer only adds, and `prune-prefix`
 * judges one thing, npm's `os`/`cpu`/`libc`, so a package that is merely UNDESCRIBED
 * matches no rule either owns. Sending a developer to `gjsify install` instead would
 * hand them a command that changes nothing and a refusal that repeats verbatim.
 */
export function formatExtraneousError(entries: readonly ExtraneousPackage[], prefix: string): string {
    const shown = entries.slice(0, EXTRANEOUS_REPORT_LIMIT);
    const lines = shown.map((e) => `  ${e.installPath}  (${e.name}@${e.version})`);
    if (entries.length > shown.length) lines.push(`  … and ${entries.length - shown.length} more`);
    return [
        `install: --immutable, but ${prefix}/node_modules holds ${entries.length} package(s) ` +
            'that gjsify-lock.json does not describe.',
        '--immutable installs the lockfile and removes nothing, so each of these would survive ' +
            'the install and be resolved, bundled and type-checked as if it belonged ' +
            '(gjsify#1683: a nested copy of an already-hoisted package → TS2883, one type ' +
            'with two identities).',
        ...lines,
        'Fix: delete those directories — or the whole node_modules — and re-run. A plain ' +
            '`gjsify install` does NOT clear them: it only ever adds, and its prune pass judges ' +
            'foreign-PLATFORM packages alone (prune-prefix.ts), so an undescribed package ' +
            'survives both. Deleting is currently the only thing that removes one. ' +
            'In CI this usually means a cache entry was restored from a DIFFERENT lockfile.',
    ].join('\n');
}
