// How the gjsify toolchain is invoked on each host runtime — ONE definition,
// used by every command window on the site.
//
// Lifted here because the second copy is where a documented command drifts: the
// slideshow and the quick-start CTA each carried their own map, and a fix to one
// left the other printing a command that does something else.
//
// `@latest` is not decoration. `npx`/`bunx`/`deno run` all reuse a CACHED copy
// of an unpinned bin, and on one machine on one day that served 0.4.25 under npx
// and 0.23.0 under deno while bunx fetched 0.24.1 — with the two old ones
// failing in ways that read as gjsify bugs. A pinned tag is what makes a
// documented command reproducible.

/** The runtimes a command window can offer a tab for. */
export type Runtime = 'gjs' | 'node' | 'bun' | 'deno';

/**
 * Runtime → how the gjsify toolchain is invoked on that host.
 *
 * THE DENO LINE CARRIES TWO EXTRA FLAGS, and both are load-bearing rather than
 * belt-and-braces. Deno applies two rules on top of the shared runner cache:
 * it caches an unpinned bin like the others, AND `minimumDependencyAge` (24 h by
 * default) refuses any version published more recently than that. Measured
 * across a cross-platform verification run of this very page: `deno run -A
 * npm:@gjsify/cli@latest --version` answered **0.25.1** on a workstation and
 * **0.35.0** on a machine with an EMPTY deno cache — never the 0.37.0 that was
 * published. So on deno `@latest` does not mean latest, and the page said
 * nothing about it.
 *
 * The cost was not theoretical: `three-loader-ldraw` does not exist in those
 * older CLIs, so its deno tab was a documented command that could not work
 * ("Unknown showcase"), and every other deno tab was quietly exercising a CLI up
 * to twelve releases old. `--reload` defeats the cache, `--min-dep-age 0` waives
 * the age rule for one run. Same pair the CLI's own `PIN_HINT` prints
 * (`packages/infra/cli/src/commands/showcase.ts`) — keep the two in step.
 */
export const RUNTIME_INVOCATION: Record<Runtime, string> = {
    gjs: 'gjsify',
    node: 'npx @gjsify/cli@latest',
    bun: 'bunx @gjsify/cli@latest',
    deno: 'deno run -A --reload --min-dep-age 0 npm:@gjsify/cli@latest',
};

/** Runtime → the CommandTabs tab id it renders as. */
export const RUNTIME_TAB: Record<Runtime, 'gjsify' | 'npm' | 'bun' | 'deno'> = {
    gjs: 'gjsify',
    node: 'npm',
    bun: 'bun',
    deno: 'deno',
};

/** The four tabs for a command that is the same on every runtime but the invocation. */
export function invocationCommands(suffix: string): { runtime: string; code: string }[] {
    return (Object.keys(RUNTIME_INVOCATION) as Runtime[]).map((rt) => ({
        runtime: RUNTIME_TAB[rt],
        code: `${RUNTIME_INVOCATION[rt]} ${suffix}`,
    }));
}
