#!/usr/bin/env node
// Argv parsing over `site.ts`; every decision worth testing lives there.

import { join, resolve } from 'node:path';

import { buildSite, syncSiteI18n } from './site.js';

const USAGE = `Usage: gjsify-site <command> [options]

  build [options]    Render the static pages of a repository
  i18n [options]     Update the page catalogues from the strings the build can emit

Options:
  --root <path>      Repository to work on (default: the working directory)
  --out <dir>        Output directory, emptied first (default: <root>/dist)
  --offline          Skip every network call
  --no-cache         Ignore the one-hour HTTP response cache
  --cache-dir <dir>  Where to keep the response cache and image renditions
                     (default: <root>/node_modules/.cache/gjsify-site)
  --check            i18n: report what is out of date instead of writing it
  --package          i18n: sync this package's own catalogues instead of a consumer's
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
        cacheDir: cacheOption(flags),
        githubToken: process.env.GITHUB_TOKEN || undefined,
        warn: (message) => console.warn(`warning: ${message}`),
    });
    console.log(`Built ${result.languages.length} pages and ${result.screenshots} screenshots`);
    return 0;
}

async function i18n(flags: readonly string[]): Promise<number> {
    const check = flags.includes('--check');
    const root = flags.includes('--package') ? undefined : resolve(flagValue(flags, '--root') ?? process.cwd());
    const { stale, untranslated } = await syncSiteI18n({ root, check });
    for (const file of stale)
        console.log(check ? `${file} is out of date; run \`gjsify-site i18n\`` : `updated ${file}`);
    for (const message of untranslated) console.error(message);
    return untranslated.length > 0 || (check && stale.length > 0) ? 1 : 0;
}

async function main(argv: readonly string[]): Promise<number> {
    const [command, ...flags] = argv;
    if (command === 'build') return build(flags);
    if (command === 'i18n') return i18n(flags);
    console.error(USAGE);
    return command === '--help' || command === '-h' ? 0 : 2;
}

main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    },
);
