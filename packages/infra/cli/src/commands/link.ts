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
    removeDevLinkOverride,
    removeDevLinks,
    resolveCheckoutWorkspaces,
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

        const written = applyDevLinks(links);
        writeDevLinkOverride(consumerRoot, { version: 1, checkout, packages: patterns });
        const ignored = ensureLocallyIgnored(consumerRoot);
        console.log(`\n  ${written.length} link(s) written, ${links.length - written.length} already current.`);
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

        // Planned from the override, not from a scan: the override is what named
        // the checkout, so it is also what says which links are OURS to remove.
        // A checkout that has since been deleted must still be unlinkable, so the
        // dead-target refusal is caught here rather than propagated.
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
            for (const link of links) console.log(`  would remove link  ${link.name}`);
            console.log(`  would remove       ${overridePath}`);
            console.log(`\n${label}: nothing changed. Drop --dry-run to apply.`);
            return;
        }

        const removed = removeDevLinks(links);
        for (const link of removed) console.log(`  unlinked  ${link.name}`);
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
