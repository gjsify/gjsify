import type { Command } from '../types/index.js';
import { discoverShowcases, findShowcase, type ShowcaseInfo } from '../utils/discover-showcases.js';
import { runMinimalChecks, detectPackageManager, buildInstallCommand } from '../utils/check-system-deps.js';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { ensurePkgDir } from './dlx.js';
import { parseSpec } from '../utils/parse-spec.js';
import { resolveNodeEntry } from '../utils/resolve-gjs-entry.js';
import { runRuntimeBundle } from '../utils/run-node.js';
import {
    EXAMPLE_RUNTIMES,
    isExampleRuntime,
    readDeclaredRuntimes,
    checkRuntimeSupported,
    defaultExampleRuntime,
    type ExampleRuntime,
} from '../utils/runtimes.js';

function readCliVersion(): string | undefined {
    try {
        const pkgUrl = new URL('../../package.json', import.meta.url);
        const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8')) as { version?: unknown };
        return typeof pkg.version === 'string' ? pkg.version : undefined;
    } catch {
        return undefined;
    }
}

interface ShowcaseOptions {
    name?: string;
    json: boolean;
    list: boolean;
    runtime?: string;
}

export const showcaseCommand: Command<unknown, ShowcaseOptions> = {
    command: 'showcase [name]',
    description: 'List or run curated gjsify showcase applications.',
    builder: (yargs) =>
        yargs
            .positional('name', {
                description: 'Showcase name to run (omit to list all)',
                type: 'string',
            })
            .option('json', {
                description: 'Output as JSON',
                type: 'boolean',
                default: false,
            })
            .option('list', {
                description: 'List available showcases',
                type: 'boolean',
                default: false,
            })
            .option('runtime', {
                // Runtime selector, mirroring `gjsify storybook --runtime`. gjs
                // runs the showcase's GJS bundle via `gjsify dlx`; node/bun/deno
                // run its `--app node` bundle on that runtime. Validated against
                // the showcase's declared `gjsify.example.runtimes` — a GTK-only
                // showcase requested under node fails with a clear message, not
                // a crash.
                //
                // NO eager yargs `default:` — it is resolved in the handler via
                // `defaultExampleRuntime()` (gjs when gjs is installed, else the
                // host runtime). Two reasons: yargs evaluates a `default:` while
                // BUILDING the command, before we know a showcase was even
                // named, and resolving it probes PATH — work that must not
                // happen for `gjsify showcase` in list mode.
                type: 'string',
                choices: EXAMPLE_RUNTIMES,
                defaultDescription: 'gjs when gjs is installed, else the host runtime',
                description:
                    'Runtime to run the showcase on: gjs | node | bun | deno (default: gjs when installed, else the host runtime). node/bun/deno run its `--app node` bundle.',
            }),
    handler: async (args) => {
        // List mode: no name given, or --list flag
        if (!args.name || args.list) {
            const showcases = discoverShowcases();

            if (args.json) {
                console.log(JSON.stringify(showcases, null, 2));
                return;
            }

            if (showcases.length === 0) {
                console.log(
                    'No showcases found. The CLI ships a curated list in `showcases.json`; if it is missing the CLI install is incomplete.',
                );
                return;
            }

            const grouped = new Map<string, typeof showcases>();
            for (const sc of showcases) {
                const list = grouped.get(sc.category) ?? [];
                list.push(sc);
                grouped.set(sc.category, list);
            }

            console.log('Available gjsify showcases:\n');
            for (const [category, list] of grouped) {
                console.log(`  ${category.toUpperCase()}:`);
                const maxNameLen = Math.max(...list.map((e) => e.name.length));
                for (const sc of list) {
                    const pad = ' '.repeat(maxNameLen - sc.name.length + 2);
                    const desc = sc.description ? `${pad}${sc.description}` : '';
                    console.log(`    ${sc.name}${desc}`);
                }
                console.log('');
            }

            console.log('Run a showcase:  gjsify showcase <name>');
            return;
        }

        const showcase = findShowcase(args.name);
        if (!showcase) {
            console.error(`Unknown showcase: "${args.name}"`);
            console.error('Run "gjsify showcase" to list available showcases.');
            // `return process.exit()`: a bare `process.exit()` does NOT halt
            // synchronously under GJS (no atexit, GLib loop still armed), so
            // execution would fall through to `showcase.packageName` below on an
            // undefined `showcase` → throw racing the scheduled exit → the
            // `m_should_exit` core dump. Returning halts the handler here.
            return process.exit(1);
        }

        // System dependency check before delegating — only system libs (gjs,
        // gtk4, …). The showcase's npm deps (incl. `@gjsify/webgl` with the
        // gwebgl Vala prebuild) are fetched by `gjsify dlx` into the npm
        // cache, and `runGjsBundle()` picks the prebuild up from the bundle
        // dir via `detectNativePackages()`. Pre-flight-checking npm deps
        // here would fail for `npx @gjsify/cli showcase` (no project
        // node_modules, CLI doesn't dep on the showcase libs).
        const results = runMinimalChecks();
        const missingHard = results.filter((r) => !r.found && r.severity === 'required');
        if (missingHard.length > 0) {
            console.error('Missing system dependencies:\n');
            for (const dep of missingHard) {
                console.error(`  ✗  ${dep.name}`);
            }
            const pm = detectPackageManager();
            const cmd = buildInstallCommand(pm, missingHard);
            if (cmd) {
                console.error(`\nInstall with:\n  ${cmd}`);
            }
            // `return` — bare `process.exit` falls through under GJS (see above).
            return process.exit(1);
        }

        const runtime = (args.runtime ?? defaultExampleRuntime()) as string;
        if (!isExampleRuntime(runtime)) {
            console.error(`Unknown --runtime "${runtime}" (expected: ${EXAMPLE_RUNTIMES.join(', ')}).`);
            // `return` — bare `process.exit` falls through under GJS (see above).
            return process.exit(1);
        }

        const cliVersion = readCliVersion();

        // Non-gjs runtime: resolve the showcase's `--app node` bundle and run it
        // on node/bun/deno. Handled in-process (not via the GJS-only `dlx`).
        if (runtime !== 'gjs') {
            await runShowcaseOnRuntime(showcase, runtime, cliVersion);
            return;
        }

        // gjs runtime: delegate to `gjsify dlx <package>@<cli-version>` — same
        // npm-cache, same atomic symlink-swap, same `gjsify.main` resolution.
        // Dispatched in-process to keep the dlx logic in one place.
        //
        // Pinning to the CLI's own version is load-bearing: showcases ship in
        // lockstep with the CLI, so users running `npx @gjsify/cli@X showcase
        // <name>` expect the matching `@gjsify/example-*@X`. Without the pin,
        // dlx caches the first resolved-latest on disk; subsequent CLI
        // releases leave that cache untouched until the 7-day TTL expires,
        // and the user gets a stale showcase that may be missing deps the
        // newer CLI assumes (the `@gjsify/http-soup-bridge` regression
        // reported against `@gjsify/cli@0.3.17`).
        const dlxSpec = cliVersion ? `${showcase.packageName}@${cliVersion}` : showcase.packageName;
        console.log(`Running showcase: ${showcase.name} (via gjsify dlx ${dlxSpec})\n`);
        // Dispatch `dlx` IN-PROCESS (not `spawn(process.execPath, [cliBin, …])`):
        // under the committed GJS bundle `process.execPath` is `gjs` and
        // `../index.js` is the Node entry, so the spawn ran `gjs cli.gjs.mjs
        // index.js dlx …` (yargs saw `index.js` as the command) — the
        // CLAUDE.md-flagged trap. In-process runCli works identically under Node
        // and GJS and stays node-free (same fix `gjsify storybook` uses).
        try {
            const { runCli } = await import('../cli-app.js');
            await runCli(['dlx', dlxSpec]);
        } catch (err) {
            console.error((err as Error).message);
            process.exit(1);
        }
    },
};

/**
 * Resolve a showcase package's on-disk directory. Prefers a LOCAL install (a
 * workspace member symlinked in node_modules — no network, and it runs the
 * in-tree build), falling back to `gjsify dlx`'s install-into-cache for a
 * published showcase. Returns the directory containing the package.json.
 */
async function resolveShowcaseDir(showcase: ShowcaseInfo, cliVersion: string | undefined): Promise<string> {
    // Local-first: a workspace showcase resolves via its own package name.
    try {
        const req = createRequire(import.meta.url);
        const localPkgJson = req.resolve(`${showcase.packageName}/package.json`);
        if (existsSync(localPkgJson)) return dirname(localPkgJson);
    } catch {
        // Not resolvable locally — fall through to dlx install.
    }

    const spec = cliVersion ? `${showcase.packageName}@${cliVersion}` : showcase.packageName;
    const { pkgDir } = await ensurePkgDir(parseSpec(spec), {
        verbose: false,
        cacheMaxAge: 60 * 24 * 7,
        frozen: false,
    });
    return pkgDir;
}

/**
 * Run a showcase on a non-gjs runtime (node/bun/deno). Resolves the package,
 * validates it against the showcase's `gjsify.example.runtimes` declaration
 * (clean error if the runtime is unsupported — e.g. a GTK/Adw showcase under
 * node), resolves its `--app node` bundle and launches it via the shared runner.
 */
async function runShowcaseOnRuntime(
    showcase: ShowcaseInfo,
    runtime: Exclude<ExampleRuntime, 'gjs'>,
    cliVersion: string | undefined,
): Promise<void> {
    let pkgDir: string;
    try {
        pkgDir = await resolveShowcaseDir(showcase, cliVersion);
    } catch (err) {
        console.error(`Could not resolve showcase "${showcase.name}": ${(err as Error).message}`);
        return process.exit(1);
    }

    // Declaration check — clear, actionable error for an unsupported runtime.
    let pkg: { name?: string; gjsify?: { example?: { runtimes?: unknown } } } = {};
    try {
        pkg = JSON.parse(readFileSync(`${pkgDir}/package.json`, 'utf-8'));
    } catch {
        // Fall through — no declaration means permissive.
    }
    const declared = readDeclaredRuntimes(pkg);
    const support = checkRuntimeSupported(runtime, declared, showcase.name);
    if (!support.ok) {
        console.error(support.message);
        return process.exit(1);
    }

    let entry: string;
    try {
        entry = resolveNodeEntry(pkgDir);
    } catch (err) {
        console.error(`Cannot run showcase "${showcase.name}" on ${runtime}: ${(err as Error).message}`);
        return process.exit(1);
    }

    console.log(`Running showcase: ${showcase.name} on ${runtime} (${entry})\n`);
    // Terminal call — exit on success.
    await runRuntimeBundle(runtime, entry, [], { exitOnSuccess: true });
}
