// Argv parsing over `site.ts`; every decision worth testing lives there.
//
// No shebang and no top-level run: this is a LIBRARY entry point. `gjsify site`
// generates a tiny module that calls `runSiteCli`, bundles it for the runtime
// the CLI itself is on, and runs it — so there is no `gjsify-site` bin bound to
// one runtime. See `packages/infra/cli/src/commands/site.ts`.

import { join, resolve } from 'node:path';

import { buildSite, syncSiteI18n } from './site.js';

const USAGE = `Usage: gjsify site <command> [options]

  build [options]    Render the static pages of a repository
  i18n [options]     Update the page catalogues from the strings the build can emit

Options:
  --root <path>      Repository to work on (default: the working directory)
  --out <dir>        Output directory, emptied first (default: <root>/dist)
  --offline          Skip every network call
  --drafts           build: include blog posts marked \`draft: true\`
  --no-cache         Ignore the one-hour HTTP response cache
  --cache-dir <dir>  Where to keep the response cache and image renditions
                     (default: <root>/node_modules/.cache/gjsify-site)
  --check            i18n: report what is out of date instead of writing it
  --package          i18n: sync this package's own catalogues instead of a consumer's
  --package-dir <d>  Where @gjsify/site is installed; the client bundle and the
                     shipped catalogues are read from there (default: derived
                     from this module's own location)
  -h, --help         Show this text

Environment: GITHUB_TOKEN raises the GitHub API rate limit.`;

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
    } catch (error: unknown) {
        console.error(error instanceof Error ? error.message : error);
        return 1;
    }
    console.error(USAGE);
    return command === '--help' || command === '-h' ? 0 : 2;
}
