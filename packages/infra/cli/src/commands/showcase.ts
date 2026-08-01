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
    requiresGjsSystemDeps,
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

/**
 * `[gjsify <version>] ` for the banner — the CLI naming ITSELF.
 *
 * `showcase` pins the showcase package to the CLI's own version, so a stale CLI
 * silently runs a stale showcase, and the only version in the output was the
 * showcase's. That is not a hypothetical: every runner that caches an unpinned
 * bin reuses whatever it resolved once (`npx @gjsify/cli` → a 0.4.x `_npx`
 * entry; `deno run npm:@gjsify/cli` → whatever sits in `DENO_DIR`), so the same
 * command produced 0.24.1 under bunx, 0.4.25 under npx and 0.23.0 under deno on
 * ONE machine on ONE day — and the two old ones failed in ways that read as
 * gjsify bugs. gjsify cannot flush somebody else's cache, but it can stop the
 * output from hiding which gjsify is talking.
 */
function runningAs(cliVersion: string | undefined): string {
    return cliVersion ? `[gjsify ${cliVersion}] ` : '';
}

/**
 * Pinned invocations for the three runners that cache an unpinned bin.
 *
 * The deno line carries TWO flags because deno stacks two independent refusals,
 * and dropping either one leaves the hint broken in exactly the window where it
 * is reached most: `--reload` busts the `DENO_DIR` copy, and `--min-dep-age 0`
 * waives deno's supply-chain policy of refusing any version published within
 * the last 24 h (`minimumDependencyAge`, default `24h`). Without the second
 * flag `@latest` silently resolves to the newest release OLDER THAN A DAY — so
 * a user who hits a bug, is told to run `@latest`, and does, gets the SAME
 * pre-fix binary back and a stale error message with it. Measured twice on one
 * day against 0.25.1 (minutes old) falling back to 0.24.1. `@latest` is kept
 * rather than a baked version so the hint cannot go stale itself; the age
 * waiver is what makes `@latest` mean latest.
 */
export const PIN_HINT =
    'A package runner reuses a CACHED copy of an unpinned bin. Force the current one:\n' +
    '    npx @gjsify/cli@latest showcase <name>\n' +
    '    bunx @gjsify/cli@latest showcase <name>\n' +
    '    deno run -A --reload --min-dep-age 0 npm:@gjsify/cli@latest showcase <name>';

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

        // Resolve the runtime BEFORE the system-dependency gate: that gate is a
        // question ABOUT the runtime, and asking it first gated every showcase
        // on a gjs binary (see `requiresGjsSystemDeps`).
        const runtime = (args.runtime ?? defaultExampleRuntime()) as string;
        if (!isExampleRuntime(runtime)) {
            console.error(`Unknown --runtime "${runtime}" (expected: ${EXAMPLE_RUNTIMES.join(', ')}).`);
            // `return` — bare `process.exit` falls through under GJS (see above).
            return process.exit(1);
        }

        // System dependency check before delegating — only system libs (gjs,
        // gtk4, …), and only for a runtime that consumes the `--app gjs`
        // bundle. The showcase's npm deps (incl. `@gjsify/webgl` with the
        // gwebgl Vala prebuild) are fetched by `gjsify dlx` into the npm
        // cache, and `runGjsBundle()` picks the prebuild up from the bundle
        // dir via `detectNativePackages()`. Pre-flight-checking npm deps
        // here would fail for `npx @gjsify/cli showcase` (no project
        // node_modules, CLI doesn't dep on the showcase libs).
        if (requiresGjsSystemDeps(runtime)) {
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
        console.log(`Running showcase: ${showcase.name} ${runningAs(cliVersion)}(via gjsify dlx ${dlxSpec})\n`);
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
async function resolveShowcaseDir(
    showcase: ShowcaseInfo,
    cliVersion: string | undefined,
    extraSpecs: readonly string[] = [],
): Promise<string> {
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
        extraSpecs,
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
        // `@gjsify/node-gi` is the `gi://` bridge the `--app node` bundle
        // resolves at RUNTIME. Showcases carry it as a devDependency (it is a
        // build input for them), so a dlx tree — the package plus its own
        // `dependencies` — does not contain it and the launch died with "add
        // @gjsify/node-gi as a dependency": advice the user cannot act on,
        // since the tree is the CLI's cache. The launcher knows the runtime, so
        // it supplies the bridge. Pinned to the CLI's version like the showcase
        // itself, so the bridge and the bundle move together.
        const nodeGiSpec = cliVersion ? `@gjsify/node-gi@${cliVersion}` : '@gjsify/node-gi';
        pkgDir = await resolveShowcaseDir(showcase, cliVersion, [nodeGiSpec]);
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
        // The showcase promised this runtime and did not ship the bundle. Two
        // causes, and the user can only act on one of them, so name both: the
        // package version is genuinely broken (fixed by a newer one), or THIS
        // CLI is a cached old copy that pinned a genuinely broken old showcase.
        const version = typeof pkg.name === 'string' ? `${pkg.name}@${cliVersion ?? '?'}` : showcase.packageName;
        console.error(
            `Cannot run showcase "${showcase.name}" on ${runtime}: ${(err as Error).message}\n\n` +
                `  ${version} declares --runtime ${runtime} but ships no \`--app node\` bundle, so that\n` +
                `  version of the showcase cannot run there. You are running gjsify ${cliVersion ?? '(unknown)'},\n` +
                `  and \`showcase\` pins the showcase to the CLI's own version.\n\n  ${PIN_HINT}\n\n` +
                `  Or run it on GJS, which every showcase ships: gjsify showcase ${showcase.name} --runtime gjs`,
        );
        return process.exit(1);
    }

    console.log(`Running showcase: ${showcase.name} ${runningAs(cliVersion)}on ${runtime} (${entry})\n`);
    // Terminal call — exit on success. Failures are reported here rather than
    // thrown: an exception escaping the handler makes yargs dump the command's
    // full `--help` above the message, which buries it.
    try {
        await runRuntimeBundle(runtime, entry, [], { exitOnSuccess: true });
    } catch (err) {
        console.error(
            `${(err as Error).message}\n\n` +
                `  The showcase and the \`@gjsify/node-gi\` bridge it needs are both installed by THIS CLI\n` +
                `  (gjsify ${cliVersion ?? '(unknown)'}) into its own cache, so a missing bridge points at the CLI\n` +
                `  rather than at anything in your project.\n\n  ${PIN_HINT}`,
        );
        return process.exit(1);
    }
}
