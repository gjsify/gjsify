// `gjsify link <checkout>` / `gjsify unlink` — develop a consumer against a local
// gjsify checkout without waiting for an npm release, and without changing a byte
// of what the consumer commits.
//
// The model, the trap it closes and why `--immutable` refuses it are the header of
// `utils/dev-link.ts` and ADR 0065. This file is the surface: two commands, the
// output that makes an active link visible, and the undo.
//
// `unlink` REINSTALLS by default. Removing a link leaves a hole where the registry
// copy used to be, and a command that promises to undo itself must not hand back a
// tree that no longer resolves; `--no-install` is there for the case where the next
// step is an install anyway.

import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { Argv } from 'yargs';

import type { LeafCommand } from '../types/index.js';
import {
    applyDevLinks,
    consumerKnownNames,
    DEV_LINK_FILE,
    devLinkPath,
    type DevLink,
    ensureLocallyIgnored,
    formatUnbuiltDevLinks,
    planDevLinks,
    prepareDevLinks,
    readDevLinkOverride,
    removeDevLinkOverride,
    removeDevLinks,
    resolveCheckoutWorkspaces,
    retireDevLinks,
    scanDevLinks,
    unbuiltDevLinks,
    writeDevLinkOverride,
} from '../utils/dev-link.js';

interface LinkOptions {
    checkout: string;
    packages?: string[];
    'dry-run'?: boolean;
}

interface UnlinkOptions {
    'dry-run'?: boolean;
    install?: boolean;
}

export const linkCommand: LeafCommand<unknown, LinkOptions> = {
    command: 'link <checkout>',
    description:
        'Link this project against a local gjsify checkout for development: its workspace packages replace the installed registry copies, recorded in a git-ignored .gjsify-link.json that every later `gjsify install` re-applies. Undo with `gjsify unlink`.',
    builder: (yargs) =>
        yargs
            .positional('checkout', {
                description:
                    'Path to the gjsify checkout to link from (a repo whose package.json declares "workspaces").',
                type: 'string',
                demandOption: true,
            })
            .option('packages', {
                description:
                    "Name glob selecting which of the checkout's workspace packages take part (repeatable; default: all of them). Matched against the package NAME with the same single-segment dialect as `gjsify foreach --include`, so a whole scope is `@gjsify/*` — a bare `*` matches no scoped name. Only packages this project actually depends on are ever linked.",
                type: 'string',
                array: true,
            })
            .option('dry-run', {
                description: 'Print the links that would be made and write nothing.',
                type: 'boolean',
                default: false,
            }) as Argv<LinkOptions>,
    handler: (args: LinkOptions) => {
        const consumerRoot = process.cwd();
        const dryRun = args['dry-run'] ?? false;
        const checkout = resolve(consumerRoot, args.checkout);
        const overridePath = devLinkPath(consumerRoot);

        // Validated BEFORE anything is written: a `.gjsify-link.json` naming a
        // directory that is not a gjsify checkout would fail on every later install
        // instead of on the command that created it.
        const workspaces = resolveCheckoutWorkspaces(checkout, overridePath);
        // No `--packages` means every workspace package, spelled as the EMPTY list:
        // `['*']` would select nothing, because the glob dialect's `*` does not
        // cross a `/` and every name here is scoped (utils/dev-link.ts).
        const patterns = args.packages ?? [];
        const links = planDevLinks({
            consumerRoot,
            workspaces,
            patterns,
            knownNames: consumerKnownNames(consumerRoot),
        });

        if (links.length === 0) {
            console.error(
                `gjsify link: nothing to link — ${checkout} has ${workspaces.length} workspace package(s), ` +
                    `none of which ${consumerRoot} depends on${patterns.length === 0 ? '' : ` and matches ${patterns.join(', ')}`}.\n` +
                    `A link that links nothing is a silent no-op, so this is an error. Check the --packages ` +
                    `pattern, or run \`gjsify install\` first so the dependency tree exists.`,
            );
            return process.exit(1);
        }

        const label = `gjsify link${dryRun ? ' (dry-run)' : ''}`;
        console.log(`${label}  → ${checkout}`);
        console.log(`${' '.repeat(label.length)}    in ${consumerRoot}`);
        for (const link of links) {
            console.log(`  ${link.name}  →  ${relative(checkout, link.target) || '.'}`);
        }

        // REFUSES rather than warns, and it refuses before anything is written.
        // A link to an unbuilt package is not a smaller link, it is a tree whose
        // first import fails — and the earlier draft's warning was printed once,
        // at link time, while `gjsify install` re-applied the same link on every
        // later run in silence (`utils/dev-link.ts`, `assertDevLinksBuilt`).
        const unbuilt = unbuiltDevLinks(links);
        if (unbuilt.length > 0) {
            console.error(`\n${formatUnbuiltDevLinks(unbuilt)}`);
            return process.exit(1);
        }

        if (dryRun) {
            console.log(`\n${label}: nothing written. Drop --dry-run to apply.`);
            return;
        }

        // RE-linking is a re-SELECTION, not an addition: whatever the previous
        // override linked and this one does not is removed here. Without it a
        // narrower `--packages` left an orphan symlink out of `node_modules` that
        // no later command would ever name, and every `gjsify install` after it
        // aborted (utils/dev-link.ts, `scanDevLinks`). Both checkouts are swept,
        // because the new override may point somewhere else entirely.
        const previousCheckout = previousCheckoutOf(consumerRoot);
        const retired = retireDevLinks(
            consumerRoot,
            previousCheckout && previousCheckout !== checkout ? [previousCheckout, checkout] : [checkout],
            new Set(links.map((l) => l.name)),
        );

        const written = applyDevLinks(links);
        writeDevLinkOverride(consumerRoot, { version: 1, checkout, packages: patterns });
        const ignored = ensureLocallyIgnored(consumerRoot);
        console.log(`\n  ${written.length} link(s) written, ${links.length - written.length} already current.`);
        if (retired.length > 0) {
            console.log(
                `  ${retired.length} link(s) retired (dropped by this selection): ${retired.map((l) => l.name).join(', ')}`,
            );
        }
        console.log(`  override: ${overridePath}`);
        if (ignored === 'added')
            console.log(`  git: ${DEV_LINK_FILE} added to .git/info/exclude (local, never committed)`);
        if (ignored === 'no-git') console.log(`  git: ${consumerRoot} is not a git repository — nothing to ignore`);
        console.log(
            `\nEvery \`gjsify install\` here now re-applies these links and says so.\n` +
                `\`gjsify install --immutable\` refuses while the override exists. Undo: \`gjsify unlink\`.`,
        );
    },
};

export const unlinkCommand: LeafCommand<unknown, UnlinkOptions> = {
    command: 'unlink',
    description:
        'Undo `gjsify link`: remove the development links and the .gjsify-link.json override, then reinstall the registry copies.',
    builder: (yargs) =>
        yargs
            .option('dry-run', {
                description: 'Print what would be removed and change nothing.',
                type: 'boolean',
                default: false,
            })
            .option('install', {
                description:
                    'Reinstall after unlinking, to put the registry copies back where the links were. On by default; --no-install leaves the holes for a later `gjsify install`.',
                type: 'boolean',
                default: true,
            }) as Argv<UnlinkOptions>,
    handler: async (args: UnlinkOptions) => {
        const consumerRoot = process.cwd();
        const dryRun = args['dry-run'] ?? false;
        const overridePath = devLinkPath(consumerRoot);

        if (!existsSync(overridePath)) {
            console.log(`gjsify unlink: no development link in ${consumerRoot} (no ${DEV_LINK_FILE}).`);
            return;
        }

        // TWO readers, because the plan alone is not a census of what is linked
        // (utils/dev-link.ts, `scanDevLinks`). A checkout that has since been
        // deleted must still be unlinkable, so the dead-target refusal is caught
        // here rather than propagated.
        //
        // The checkout is read separately from the PLAN, because the plan is the
        // part that can fail (a checkout that has since been deleted, an unbuilt
        // one) and the checkout path is what the tree sweep below needs.
        const checkouts: string[] = [];
        try {
            const checkout = readDevLinkOverride(consumerRoot)?.checkout;
            if (checkout) checkouts.push(checkout);
        } catch {
            // Unparseable override: the sweep finds nothing, the plan below says
            // why, and the override is still removed.
        }
        let links: DevLink[] = [];
        try {
            links = prepareDevLinks(consumerRoot)?.links ?? [];
        } catch (err) {
            console.warn(
                `gjsify unlink: ${err instanceof Error ? err.message : String(err)}\n` +
                    `  Removing the override anyway; any dangling links are cleaned by the reinstall.`,
            );
        }

        const label = `gjsify unlink${dryRun ? ' (dry-run)' : ''}`;
        console.log(`${label}  in ${consumerRoot}`);
        if (dryRun) {
            const names = new Set(links.map((l) => l.name));
            for (const link of scanDevLinks(consumerRoot, checkouts)) names.add(link.name);
            for (const name of [...names].sort()) console.log(`  would remove link  ${name}`);
            console.log(`  would remove       ${overridePath}`);
            console.log(`\n${label}: nothing changed. Drop --dry-run to apply.`);
            return;
        }

        // ORDER IS THE FIX. The links go first, the override LAST: the override is
        // the only record of which checkout to sweep, so removing it while a link
        // is still standing destroys the escape route — measured, that left
        // `gjsify unlink` reporting success, the reinstall aborting on the orphan,
        // and no command able to name it again.
        //
        // And the sweep is by TREE, not by plan: `removeDevLinks(links)` only ever
        // visits what the CURRENT override selects, which is exactly how the orphan
        // survived in the first place.
        const removed = removeDevLinks(links);
        const kept = new Set(removed.map((l) => l.name));
        for (const link of retireDevLinks(consumerRoot, checkouts, new Set())) {
            if (kept.has(link.name)) continue;
            removed.push(link);
        }
        for (const link of removed) console.log(`  unlinked  ${link.name}`);

        // Nothing may point out of `node_modules` any more, or the reinstall below
        // dies on it. If something does, the override STAYS: it is what a later
        // `gjsify unlink` needs, and a half-undone tree with no record of the
        // checkout is the wedge this whole block exists to prevent.
        const stragglers = scanDevLinks(consumerRoot, checkouts);
        if (stragglers.length > 0) {
            console.error(
                `gjsify unlink: ${stragglers.length} link(s) still point into a checkout and could not be removed:\n` +
                    stragglers.map((l) => `  ${l.name}  ${l.linkPath} → ${l.target}`).join('\n') +
                    `\n  ${overridePath} is kept so this stays undoable. Remove the paths above and re-run.`,
            );
            return process.exit(1);
        }

        removeDevLinkOverride(consumerRoot);
        console.log(`  removed   ${overridePath}`);

        if (args.install === false) {
            console.log(
                `\n  ${removed.length} link(s) removed. Run \`gjsify install\` to restore the registry copies.`,
            );
            return;
        }
        console.log(`\n  ${removed.length} link(s) removed — reinstalling to restore the registry copies.\n`);
        const { runCli } = await import('../cli-app.js');
        await runCli(['install']);
    },
};

/**
 * The checkout the CURRENT override names, or `null` — swallowing every failure.
 *
 * Read only to decide what to sweep before a re-link. A malformed or dead
 * override must not stop a fresh `gjsify link` from fixing the situation, which is
 * usually exactly why it is being run.
 */
function previousCheckoutOf(consumerRoot: string): string | null {
    try {
        return readDevLinkOverride(consumerRoot)?.checkout ?? null;
    } catch {
        return null;
    }
}
