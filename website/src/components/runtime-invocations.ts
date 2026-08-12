// How the gjsify toolchain is invoked on each host runtime — ONE definition for
// every command window, because the slideshow and the quick-start CTA each
// carried their own and the deno line drifted.
//
// `@latest` is not decoration: the runners reuse a CACHED unpinned bin, and deno
// adds a second rule (`minimumDependencyAge`, 24 h) refusing anything newer.
// Measured verifying this page against published packages,
// `deno run -A npm:@gjsify/cli@latest --version` answered 0.25.1 on a warm cache
// and 0.35.0 on an empty one, never the published 0.37.0 — so `three-loader-ldraw`'s
// deno tab was a documented command that could not work. Same flags the CLI's own
// `PIN_HINT` prints (`packages/infra/cli/src/commands/showcase.ts`); keep in step.

/** The runtimes a command window can offer a tab for. */
export type Runtime = 'gjs' | 'node' | 'bun' | 'deno';

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

/** The four tabs for a command that differs only in how the toolchain is invoked. */
export function invocationCommands(suffix: string): { runtime: string; code: string }[] {
    return (Object.keys(RUNTIME_INVOCATION) as Runtime[]).map((rt) => ({
        runtime: RUNTIME_TAB[rt],
        code: `${RUNTIME_INVOCATION[rt]} ${suffix}`,
    }));
}
