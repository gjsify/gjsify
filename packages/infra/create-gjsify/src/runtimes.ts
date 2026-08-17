// Runtime ↔ package-manager model for `gjsify create` / `npm create @gjsify/app`.
// gjsify targets four runtimes and each has its own installer, so assuming `npm`
// printed next steps a `deno` user cannot run and, with `--install`, ran the wrong
// installer for the layout their runtime resolves against.
//
// WHY THE RUNTIME LIST IS NOT IMPORTED FROM `@gjsify/cli`, which owns
// `EXAMPLE_RUNTIMES`: nothing here twins it. The runtimes OFFERED come from the
// template's own manifest, and the table below is a different fact (which
// installer serves which runtime) whose key set `runtimes.spec.ts` asserts
// against `EXAMPLE_RUNTIMES`. A runtime import was measured and rejected twice —
// `@gjsify/cli` as a `dependency` closes the loop cli → create-app → cli, and
// `@gjsify/workspace`'s `topologicalSort` throws on a prod cycle ("dependency
// cycle detected involving @gjsify/cli, @gjsify/create-app"), taking `build:infra`
// with it; while `@gjsify/rolldown-plugin-gjsify/runtime`, the cycle-free leaf
// owning `hostRuntime()`, drags typescript + deepkit + sass + lightningcss into a
// scaffolder whose whole runtime dependency set is `yargs`. Both are
// devDependencies, and the spec cross-checks against them.

/**
 * Package managers a scaffolded project can be installed with. npm/yarn/pnpm/
 * gjsify all work on a Node host — templates declare every dependency explicitly,
 * `@gjsify/rolldown-native` included, which the three would otherwise skip as an
 * optional peer of `@gjsify/cli`. `gjsify` is the only one of the six that works
 * on a host with no Node.js.
 */
export const PACKAGE_MANAGERS = ['npm', 'yarn', 'pnpm', 'gjsify', 'bun', 'deno'] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/**
 * The `install` argv per manager, each read off the tool's own `--help` rather
 * than assumed: `bun install` and a BARE `deno install` mean "install what
 * package.json lists" — `deno install --global` is the unrelated
 * install-a-script mode.
 */
export const INSTALL_ARGV: Record<PackageManager, readonly string[]> = {
    npm: ['install', '--no-audit', '--no-fund'],
    yarn: ['install'],
    pnpm: ['install'],
    gjsify: ['install'],
    bun: ['install'],
    deno: ['install'],
};

/**
 * How each manager spells "run the package script `<name>`" — six managers, four
 * spellings. Printing the one the user's manager accepts is why the choice is
 * threaded this far: `npm run dev` is a dead end for someone who installed with
 * deno.
 */
const RUN_SCRIPT_PREFIX: Record<PackageManager, string> = {
    npm: 'npm run',
    yarn: 'yarn',
    pnpm: 'pnpm',
    gjsify: 'gjsify run',
    bun: 'bun run',
    deno: 'deno task',
};

/** The command prefix that runs a package script under `manager`. */
export function runScriptCommand(manager: PackageManager): string {
    return RUN_SCRIPT_PREFIX[manager];
}

/**
 * Which managers can install a project the user intends to RUN on `<runtime>` —
 * not taste, but the module layout each runtime resolves against. `gjs` is the
 * Node-free column, where npm/yarn/pnpm are not discouraged but ABSENT; bun writes
 * its own layout; `deno install` populates the `node_modules` that
 * `--node-modules-dir=manual` (how `gjsify run --runtime deno` launches) reads
 * without re-resolving. The KEYS double as "runtimes this scaffolder has an
 * installer for", and the spec asserts they equal the CLI's `EXAMPLE_RUNTIMES`, so
 * a runtime added upstream fails loudly instead of vanishing from every prompt.
 */
export const RUNTIME_PACKAGE_MANAGERS: Readonly<Record<string, readonly PackageManager[]>> = {
    gjs: ['gjsify'],
    node: ['npm', 'yarn', 'pnpm', 'gjsify'],
    bun: ['bun'],
    deno: ['deno'],
};

/** One-line label for each runtime, shown beside it in the picker. */
export const RUNTIME_DESCRIPTIONS: Readonly<Record<string, string>> = {
    gjs: 'GNOME JavaScript — no Node.js needed at runtime.',
    node: 'Node.js — gi:// via the @gjsify/node-gi bridge.',
    bun: 'Bun — runs the same --app node bundle.',
    deno: 'Deno — runs the same --app node bundle.',
};

/**
 * The managers that install for `runtime`, `undefined` when unmapped — not a
 * permissive fallback: unmapped means the template is newer than the scaffolder,
 * and guessing an installer buries the cause.
 */
export function packageManagersForRuntime(runtime: string): readonly PackageManager[] | undefined {
    return RUNTIME_PACKAGE_MANAGERS[runtime];
}

/** `true` when this scaffolder knows how to install for `runtime`. */
export function isKnownRuntime(runtime: string): boolean {
    return packageManagersForRuntime(runtime) !== undefined;
}

/**
 * The JS runtime this scaffolder is itself executing on. A LOCAL implementation,
 * kept for the two measured reasons in the file header and held to the canonical
 * one by `runtimes.spec.ts`, which runs on all four runtimes and compares against
 * `@gjsify/rolldown-plugin-gjsify/runtime`.
 *
 * Probe order is load-bearing: **Bun and Deno first**, because both fake
 * `process.versions.node` for npm compatibility and GJS's `@gjsify/process` shim
 * does too, making that read a false Node positive on three of the four hosts.
 */
export function hostRuntime(): string {
    const g = globalThis as {
        Bun?: unknown;
        Deno?: unknown;
        imports?: { gi?: unknown };
    };
    if (typeof g.Bun !== 'undefined') return 'bun';
    if (typeof g.Deno !== 'undefined') return 'deno';
    if (typeof g.imports?.gi !== 'undefined') return 'gjs';
    return 'node';
}

/**
 * Which runtime to start on: the host when the template supports it — "whatever
 * you are already running" needs no second toolchain — else the template's own
 * first declaration, which is the canonical one.
 *
 * `manager` OVERRIDES that, because a pinned manager already names a runtime.
 * Without it, `create-app x -t cli -p bun` resolved to the host (`node`), found
 * bun illegal there and refused a combination the user had spelled out. "First
 * declared runtime this manager installs for" needs no per-manager table: bun and
 * deno serve one each, npm/yarn/pnpm only node, and `gjsify` — legal on gjs and
 * node — lands on gjs, the column it was written for.
 *
 * `undefined` for an empty list, or when nothing declared installs with
 * `manager`; the caller decides whether that is an error.
 */
export function defaultRuntimeFor(runtimes: readonly string[], manager?: PackageManager): string | undefined {
    if (manager) return runtimes.find((rt) => packageManagersForRuntime(rt)?.includes(manager));
    const host = hostRuntime();
    return runtimes.includes(host) ? host : runtimes[0];
}

/**
 * The script that launches the project on `runtime`. Template convention: `start`
 * is the gjs entry (what `gjsify.main` points at), every other runtime a suffixed
 * sibling — `start:node`, `start:bun`, `start:deno`.
 */
export function startScriptFor(runtime: string): string {
    return runtime === 'gjs' ? 'start' : `start:${runtime}`;
}
