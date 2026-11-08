// Argv parsing over `site.ts`; every decision worth testing lives there.
//
// No shebang and no top-level run: this is a LIBRARY entry point. `gjsify site`
// generates a tiny module that calls `runSiteCli`, bundles it for the runtime
// the CLI itself is on, and runs it — so there is no `gjsify-site` bin bound to
// one runtime. See `packages/infra/cli/src/commands/site.ts`.

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { runListing, STORES, type Store } from './listing/index.js';
import { buildSite, syncSiteI18n } from './site.js';

const USAGE = `Usage: gjsify site <command> [options]

  build [options]    Render the static pages of a repository
  i18n [options]     Update the page catalogues from the strings the build can emit
  listing [options]  Derive browser-extension store listings (cws, edge, amo) from the metainfo

Options:
  --root <path>      Repository to work on (default: the working directory)
  --out <dir>        Output directory, emptied first (default: <root>/dist)
  --offline          Skip every network call
  --drafts           build: include blog posts marked \`draft: true\`
  --no-cache         Ignore the one-hour HTTP response cache
  --cache-dir <dir>  Where to keep the response cache and image renditions
                     (default: <root>/node_modules/.cache/gjsify-site)
  --release-tag <t>  build: take the download links from this GitHub release
                     instead of \`releases/latest\`, which lags a fresh publish
                     (default: $GJSIFY_SITE_RELEASE_TAG)
  --check            i18n: report what is out of date instead of writing it
  --store <s>        listing: cws | edge | amo | all (default: all)
  --metainfo <path>  listing: AppStream metainfo, overriding the configured one
  --config <file>    listing: JSON that overrides \`gjsify.webext.listing\`
  --pot <file>       listing: write the config strings as a gettext template
  --package          i18n: sync this package's own catalogues instead of a consumer's
  --package-dir <d>  Where @gjsify/site is installed; the client bundle and the
                     shipped catalogues are read from there (default: derived
                     from this module's own location)
  -h, --help         Show this text

Environment: GITHUB_TOKEN raises the GitHub API rate limit.
             GJSIFY_SITE_RELEASE_TAG is the default of --release-tag.`;

/** The value after `--name`, or `undefined` when the flag is absent. */
function flagValue(flags: readonly string[], name: string): string | undefined {
    const index = flags.indexOf(name);
    if (index === -1) return undefined;
    const value = flags[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`);
    return value;
}

function cacheOption(flags: readonly string[]): string | false | undefined {
    if (flags.includes('--no-cache')) return false;
    return flagValue(flags, '--cache-dir');
}

async function build(flags: readonly string[]): Promise<number> {
    const root = resolve(flagValue(flags, '--root') ?? process.cwd());
    const result = await buildSite({
        root,
        out: resolve(flagValue(flags, '--out') ?? join(root, 'dist')),
        offline: flags.includes('--offline'),
        drafts: flags.includes('--drafts'),
        cacheDir: cacheOption(flags),
        packageDir: flagValue(flags, '--package-dir'),
        githubToken: process.env.GITHUB_TOKEN || undefined,
        releaseTag: flagValue(flags, '--release-tag') ?? (process.env.GJSIFY_SITE_RELEASE_TAG || undefined),
        log: (message) => console.log(message),
        warn: (message) => console.warn(`warning: ${message}`),
    });
    console.log(`Built the pages in ${result.languages.length} languages and ${result.screenshots} screenshots`);
    return 0;
}

async function i18n(flags: readonly string[]): Promise<number> {
    const check = flags.includes('--check');
    const root = flags.includes('--package') ? undefined : resolve(flagValue(flags, '--root') ?? process.cwd());
    const { stale, untranslated } = await syncSiteI18n({
        root,
        check,
        packageDir: flagValue(flags, '--package-dir'),
    });
    for (const file of stale)
        console.log(check ? `${file} is out of date; run \`gjsify site i18n\`` : `updated ${file}`);
    for (const message of untranslated) console.error(message);
    return untranslated.length > 0 || (check && stale.length > 0) ? 1 : 0;
}

async function listing(flags: readonly string[]): Promise<number> {
    const root = resolve(flagValue(flags, '--root') ?? process.cwd());
    const check = flags.includes('--check');
    const requested = flagValue(flags, '--store') ?? 'all';
    if (requested !== 'all' && !STORES.includes(requested as Store))
        throw new Error(`--store must be one of ${STORES.join(', ')}, all`);
    const configFile = flagValue(flags, '--config');
    const pot = flagValue(flags, '--pot');
    const result = await runListing({
        root,
        out: resolve(flagValue(flags, '--out') ?? join(root, 'dist', 'listing')),
        stores: requested === 'all' ? STORES : [requested as Store],
        check,
        config: configFile ? JSON.parse(await readFile(resolve(configFile), 'utf8')) : undefined,
        metainfo: flagValue(flags, '--metainfo'),
        pot,
        offline: flags.includes('--offline'),
        cacheDir: flagValue(flags, '--cache-dir'),
        warn: (message) => console.warn(`warning: ${message}`),
    });
    for (const issue of result.issues) console.error(`error: ${issue.message}`);
    if (!check) console.log(`Wrote ${result.files.length} files`);
    return result.issues.length > 0 ? 1 : 0;
}

/**
 * Runs one `gjsify site` invocation and answers the process exit code. Never
 * exits the process itself: under GJS `process.exit` does not halt
 * synchronously, so the decision belongs to the generated entry.
 */
export async function runSiteCli(argv: readonly string[]): Promise<number> {
    const [command, ...flags] = argv;
    try {
        if (command === 'build') return await build(flags);
        if (command === 'i18n') return await i18n(flags);
        if (command === 'listing') return await listing(flags);
    } catch (error: unknown) {
        console.error(error instanceof Error ? error.message : error);
        return 1;
    }
    console.error(USAGE);
    return command === '--help' || command === '-h' ? 0 : 2;
}
