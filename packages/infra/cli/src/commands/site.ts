// `gjsify site` — render the static landing page of the CURRENT project from its
// AppStream metainfo, or sync the page catalogues. The work lives in
// `@gjsify/site`; this is the entry point into it.
//
// Why a subcommand and not a `gjsify-site` bin: a bin has to name an
// interpreter in its shebang, and that would pick the runtime FOR the user. The
// CLI already runs on whichever runtime it was installed with — gjs after the
// Linux install script, Node after `npm install -g @gjsify/cli` on
// Windows/macOS, bun or deno when installed with those — so taking the entry
// point through the CLI makes the site build inherit that choice instead of
// overriding it. `@gjsify/site` uses GdkPixbuf for its image work, which is
// reachable on all four (natively under gjs, through the `@gjsify/node-gi`
// reverse bridge otherwise).
//
// Dispatch follows `gjsify storybook`: a generated entry importing
// `@gjsify/site` from the CONSUMER's node_modules, bundled `--app gjs|node` and
// run. That keeps `@gjsify/site` (tier 2) out of this tier-1 package's
// dependencies, and it is what lowers the `gi://GdkPixbuf` import to the right
// thing for the runtime in use.
//
// The resolved install directory is passed to the child as `--package-dir`. A
// bundle's `import.meta.url` is the OUTFILE, so the library cannot find its own
// `po/` and `lib/client/` on its own — only the caller still knows.

import { resolve } from 'node:path';

import type { Command } from '../types/index.js';
import { dispatchSite } from '../utils/site-dispatch.js';

interface SiteCliOptions {
    operation: string;
    root?: string;
    out?: string;
    offline: boolean;
    drafts: boolean;
    cache: boolean;
    cacheDir?: string;
    check: boolean;
    package: boolean;
    runtime?: string;
    globals?: string;
}

export const siteCommand: Command<unknown, SiteCliOptions> = {
    command: 'site <operation>',
    description:
        "Render this project's static landing page from its AppStream metainfo (downloads, screenshots, " +
        'release notes, support links), or sync the page catalogues.',
    builder: (yargs) =>
        yargs
            .positional('operation', {
                description: 'build — render the pages; i18n — update the page catalogues',
                type: 'string',
                choices: ['build', 'i18n'],
                demandOption: true,
            })
            .option('root', {
                description: 'Repository to read from (default: the working directory)',
                type: 'string',
            })
            .option('out', { description: 'Output directory, emptied first (default: <root>/dist)', type: 'string' })
            .option('offline', { description: 'Skip every network call', type: 'boolean', default: false })
            .option('drafts', {
                description: 'build: include blog posts marked `draft: true`',
                type: 'boolean',
                default: false,
            })
            .option('cache', {
                description: 'Use the one-hour HTTP response cache (--no-cache to ignore it)',
                type: 'boolean',
                default: true,
            })
            .option('cache-dir', {
                description: 'Where the response cache and the image renditions live',
                defaultDescription: '<root>/node_modules/.cache/gjsify-site',
                type: 'string',
            })
            .option('check', {
                description: 'i18n: report what is out of date instead of writing it',
                type: 'boolean',
                default: false,
            })
            .option('package', {
                description: "i18n: sync @gjsify/site's own catalogues instead of this project's",
                type: 'boolean',
                default: false,
            })
            .option('runtime', {
                description:
                    'Runtime to build for and run on: gjs | node | bun | deno (default: the host runtime). ' +
                    'node/bun/deno build the same `--app node` bundle and require @gjsify/node-gi in the project; ' +
                    'without it the default falls back to gjs.',
                type: 'string',
                choices: ['gjs', 'node', 'bun', 'deno'],
                defaultDescription: 'host runtime (gjs on gjs, else node/bun/deno)',
            })
            .option('globals', { description: 'Value for `gjsify build --globals` (default: auto)', type: 'string' }),
    handler: async (args) => {
        const cwd = process.cwd();
        const forwarded: string[] = [args.operation];
        if (args.root) forwarded.push('--root', resolve(cwd, args.root));
        if (args.out) forwarded.push('--out', resolve(cwd, args.out));
        if (args.offline) forwarded.push('--offline');
        if (args.drafts) forwarded.push('--drafts');
        if (!args.cache) forwarded.push('--no-cache');
        else if (args.cacheDir) forwarded.push('--cache-dir', resolve(cwd, args.cacheDir));
        if (args.check) forwarded.push('--check');
        if (args.package) forwarded.push('--package');

        await dispatchSite({
            invokedAs: 'gjsify site',
            argv: forwarded,
            runtime: args.runtime,
            globals: args.globals,
            needsClient: args.operation === 'build',
        });
    },
};
