// `gjsify dlx <package> [bin] [-- args...]` — runs the GJS bundle of an
// npm-published package without persisting it in the user's project.
//
// Cardinal rule: dlx is a **GJS-bundle runner**, not a generic bin runner.
// It always invokes `gjs -m <bundle>` via the existing `runGjsBundle()` util.
// Packages without a GJS entry (no `gjsify.main`/`gjsify.bin`, no fallback
// `main`) fail loudly.
//
// Cache: $XDG_CACHE_HOME/gjsify/dlx/<sha256>/ with TTL (default 7d, override
// via --cache-max-age=<minutes>). Cache hit on second run skips `npm install`
// entirely. Layout + atomic-swap pattern adapted from pnpm's dlx implementation
// (refs/pnpm/exec/commands/src/dlx.ts).

import type { Command } from '../types/index.js';
import { runGjsBundle } from '../utils/run-gjs.js';
import { parseSpec, type ParsedSpec } from '../utils/parse-spec.js';
import { resolveGjsEntry } from '../utils/resolve-gjs-entry.js';
import {
    cacheDirFor,
    createCacheKey,
    getValidCachedPkg,
    makePrepareDir,
    resolveInstalledPkgDir,
    symlinkSwap,
} from '../utils/dlx-cache.js';
import { installPackages } from '../utils/install-backend.js';

interface DlxOptions {
    spec: string;
    binOrArg?: string;
    extraArgs?: string[];
    'cache-max-age': number;
    reinstall: boolean;
    frozen: boolean;
    verbose: boolean;
    registry?: string;
}

export const dlxCommand: Command<unknown, DlxOptions> = {
    command: 'dlx <spec> [binOrArg] [extraArgs..]',
    description: 'Run the GJS bundle of an npm-published package without installing it locally.',
    builder: (yargs) =>
        yargs
            // Collect everything after `--` into argv['--'] so callers can
            // forward flags that would otherwise be intercepted by gjsify's
            // own parser. Canonical example: `gjsify dlx @ts-for-gir/cli --
            // --help` shows ts-for-gir's --help instead of gjsify dlx's.
            // Without `populate--`, the trailing `--help` is consumed at
            // the gjsify level and the bundle never sees it.
            .parserConfiguration({ 'populate--': true })
            .positional('spec', {
                description: 'Package spec (`name`, `name@version`, `@scope/name@spec`, or local path).',
                type: 'string',
                demandOption: true,
            })
            .positional('binOrArg', {
                description:
                    'Optional bin name when the package defines `gjsify.bin` with multiple entries; otherwise treated as the first argument forwarded to the bundle. To pass a flag here (e.g. `--help`) use the `--` separator: `gjsify dlx <pkg> -- --help`.',
                type: 'string',
            })
            .positional('extraArgs', {
                description:
                    'Extra args forwarded to `gjs -m <bundle>`. Use `--` before flags to bypass gjsify-level parsing (`gjsify dlx <pkg> -- --help --verbose`).',
                type: 'string',
                array: true,
            })
            .option('cache-max-age', {
                description: 'Cache TTL in minutes. Defaults to 7 days. Use 0 to bypass cache.',
                type: 'number',
                default: 60 * 24 * 7,
            })
            .option('reinstall', {
                description: 'Bypass the cache for this run (alias for --cache-max-age=0).',
                type: 'boolean',
                default: false,
            })
            .option('frozen', {
                description:
                    'Use the project-local gjsify-lock.json verbatim — fail if missing or stale (no resolver pass).',
                type: 'boolean',
                default: false,
            })
            .option('verbose', {
                description: 'Verbose logging (passes --loglevel verbose to npm).',
                type: 'boolean',
                default: false,
            })
            .option('registry', {
                description: 'Registry URL override.',
                type: 'string',
            }),
    handler: async (args) => {
        const parsed = parseSpec(args.spec);

        const cacheMaxAge = args.reinstall ? 0 : args['cache-max-age'];
        const { pkgDir, cachedPkgName } = await ensurePkgDir(parsed, {
            verbose: args.verbose,
            registry: args.registry,
            cacheMaxAge,
            frozen: args.frozen,
        });

        // Bin / args disambiguation:
        //   gjsify dlx <pkg>                         → no bin, no args
        //   gjsify dlx <pkg> mybin                   → bin if package has gjsify.bin[mybin], else arg
        //   gjsify dlx <pkg> mybin -- arg1 arg2      → bin + extra args
        //   gjsify dlx <pkg> -- arg1 arg2            → no bin, extra args
        //
        // The `parserConfiguration({ 'populate--': true })` on the builder
        // routes anything after `--` into `args['--']` (as `(string |
        // number)[]`), so flags like `--help` reach the bundle untouched.
        // Merge those into the positional extraArgs the splitter sees so
        // both call shapes share one downstream path.
        const passthroughDoubleDash = ((args as { ['--']?: ReadonlyArray<string | number> })['--'] ?? []).map((v) =>
            String(v),
        );
        const extraArgsCombined = [...(args.extraArgs ?? []), ...passthroughDoubleDash];
        const { binName, extraArgs } = splitBinAndArgs(pkgDir, args.binOrArg, extraArgsCombined);

        const entry = resolveGjsEntry(pkgDir, binName);
        if (entry.fromFallback) {
            console.warn(
                `[gjsify dlx] package "${cachedPkgName ?? parsed.kind}" has no \`gjsify\` field — falling back to package.json#main. Add \`gjsify.main\` to silence.`,
            );
        }

        await runGjsBundle(entry.bundlePath, extraArgs);
    },
};

interface EnsureOpts {
    verbose: boolean;
    registry?: string;
    cacheMaxAge: number;
    frozen: boolean;
}

async function ensurePkgDir(
    parsed: ParsedSpec,
    opts: EnsureOpts,
): Promise<{ pkgDir: string; cachedPkgName: string | null }> {
    if (parsed.kind === 'local') {
        return { pkgDir: parsed.path, cachedPkgName: null };
    }

    const cacheKey = createCacheKey({ packages: [parsed.spec] });
    const cacheDir = cacheDirFor(cacheKey);

    const cached = opts.cacheMaxAge > 0 ? getValidCachedPkg(cacheDir, opts.cacheMaxAge) : undefined;
    if (cached) {
        return {
            pkgDir: resolveInstalledPkgDir(cached, parsed.name),
            cachedPkgName: parsed.name,
        };
    }

    const prepareDir = makePrepareDir(cacheDir);
    await installPackages({
        prefix: prepareDir,
        specs: [parsed.spec],
        verbose: opts.verbose,
        registry: opts.registry,
        // Cache-prepare dirs are scoped per cache key, so writing a lockfile
        // there gives us reproducibility for repeated `gjsify dlx <pkg>` calls
        // and lets `--frozen` short-circuit the resolver entirely.
        lockfile: true,
        frozen: opts.frozen,
    });

    const liveTarget = symlinkSwap(cacheDir, prepareDir);
    return {
        pkgDir: resolveInstalledPkgDir(liveTarget, parsed.name),
        cachedPkgName: parsed.name,
    };
}

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function splitBinAndArgs(
    pkgDir: string,
    binOrArg: string | undefined,
    extraArgs: string[],
): { binName: string | null; extraArgs: string[] } {
    if (!binOrArg) {
        return { binName: null, extraArgs };
    }

    const pkgJsonPath = join(pkgDir, 'package.json');
    if (existsSync(pkgJsonPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as {
                gjsify?: { bin?: Record<string, string> };
            };
            const bins = pkg.gjsify?.bin;
            if (bins && Object.prototype.hasOwnProperty.call(bins, binOrArg)) {
                return { binName: binOrArg, extraArgs };
            }
        } catch {
            // Fall through to treating as an arg.
        }
    }
    // Not a known bin — treat the positional as the first argv to the bundle.
    return { binName: null, extraArgs: [binOrArg, ...extraArgs] };
}
