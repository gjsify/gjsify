import type { App } from '@gjsify/rolldown-plugin-gjsify';

export interface CliBuildOptions {
    /** Input files to the bundling algorithm. */
    entryPoints?: string[];
    verbose?: boolean;
    /** Minify the generated code instead of pretty-printing it. */
    minify?: boolean;
    /** Override the default output format. */
    format?: 'iife' | 'esm' | 'cjs';
    /** Build an application or test. `node` is mostly internal, for gjsify's tests. */
    app?: App;
    /** Build a library rather than an application. */
    library?: boolean;
    /** Output file name. Single entry point only — otherwise use `outdir`. */
    outfile?: string;
    outdir?: string;
    /** Enables TypeScript types at runtime using Deepkit's type compiler. */
    reflection?: boolean;
    /** How much the bundler prints to the terminal. */
    logLevel: 'silent' | 'error' | 'warning' | 'info' | 'debug' | 'verbose';
    /** Glob patterns excluding matches and aliases. */
    exclude?: string[];
    /**
     * Inject a console shim into GJS app builds for clean output (no GLib prefix,
     * working ANSI colors). Disable with `--no-console-shim`. Default: true.
     */
    consoleShim?: boolean;
    /**
     * React Native port mode (ADR 0032): alias `react-native` onto
     * `@gjsify/react-native` and fail the build on an import whose support-table
     * status is not `supported` or `partial`. `gjs` and `node` targets. Default:
     * false — a tree with a phone leg has the real `react-native` on purpose.
     */
    reactNative?: boolean;
    /**
     * Comma-separated global identifiers the code needs, e.g.
     * `"fetch,Buffer,process,URL,crypto"`. Each maps to the corresponding
     * `@gjsify/<pkg>/register` module, injected into the bundle. GJS app builds only.
     */
    globals?: string;
    /**
     * Prepend a `#!/usr/bin/env -S gjs -m` shebang and chmod 755. GJS app builds with
     * a single `--outfile` only. Default: false.
     */
    shebang?: boolean;
    /**
     * Module names that must NOT be bundled: each stays a literal `import`/`require`
     * in the output, resolved by the runtime at execution time. Repeat the flag or
     * pass a comma-separated value (`--external typedoc,prettier --external
     * typescript`); glob-style wildcards (`@inquirer/*`, `lodash-*`) pass through to
     * the bundler unchanged.
     */
    external?: string[];
    /**
     * Compile-time constants as `KEY=VALUE`, where `VALUE` is an arbitrary JS
     * expression — string literals must be quoted (`--define VERSION='"1.2.3"'`).
     * For upstream packages reading a build-time constant via
     * `typeof __FOO__ !== 'undefined'`.
     */
    define?: string[];
    /**
     * Remap module specifiers at bundle time as `FROM=TO`, typically to
     * `@gjsify/empty` to drop a heavy dep the scenario never executes. Layered on top
     * of the built-in alias map.
     */
    alias?: string[];
    /**
     * Comma-separated global identifiers to drop from the auto-detected set — for
     * false positives from dead browser-compat code in npm deps whose polyfills need
     * unavailable native libraries. Example: `--exclude-globals fetch,XMLHttpRequest`.
     */
    excludeGlobals?: string[];
    /**
     * Watch and rebuild on change; SIGINT/SIGTERM closes the watcher cleanly. Valid
     * only with `--app gjs|node|browser`, rejected with `--library`, and requires the
     * npm `rolldown` engine — so run it under Node.
     */
    watch?: boolean;
}
