import type { App } from '@gjsify/esbuild-plugin-gjsify';

export interface CliBuildOptions {
  /**
   * This is an array of files that each serve as an input to the bundling algorithm.
   * @see https://esbuild.github.io/api/#entry-points
   */
  entryPoints?: string[];
  /** Switch on the verbose mode */
  verbose?: boolean;
  /**
   * When enabled, the generated code will be minified instead of pretty-printed.
   * @see https://esbuild.github.io/api/#minify
   */
  minify?: boolean;
  /**
   * Override the default output format.
   * @see https://esbuild.github.io/api/#format
   */
  format?: 'iife' | 'esm' | 'cjs';
  /** Use this if you want to build an application or test, the platform node is usually only used internally to build the tests for Gjsify */
  app?: App;
  /** Use this if you want to build a library for Gjsify */
  library?: boolean;
  /**
   * This option sets the output file name for the build operation.
   * This is only applicable if there is a single entry point.
   * If there are multiple entry points, you must use the outdir option instead to specify an output directory.
   * @see https://esbuild.github.io/api/#outfile
   */
  outfile?: string;
  /**
   * This option sets the output directory for the build operation.
   * @see https://esbuild.github.io/api/#outdir
   */
  outdir?: string;
  /** Enables TypeScript types on runtime using Deepkit's type compiler */
  reflection?: boolean;
  /**
   * The log level can be changed to prevent esbuild from printing warning and/or error messages to the terminal
   * @see https://esbuild.github.io/api/#log-level
   */
  logLevel: 'silent' | 'error' | 'warning' | 'info' | 'debug' | 'verbose';
  /** An array of glob patterns to exclude matches and aliases */
  exclude?: string[];
  /**
   * Inject a console shim into GJS builds for clean output (no GLib prefix, ANSI colors work).
   * Use --no-console-shim to disable. Only applies to GJS app builds. Default: true.
   */
  consoleShim?: boolean;
  /**
   * Comma-separated list of global identifiers your code needs (e.g.
   * `"fetch,Buffer,process,URL,crypto"`). Each identifier is mapped to the
   * corresponding `@gjsify/<pkg>/register` module and injected into the
   * bundle. Only applies to GJS app builds.
   */
  globals?: string;
  /**
   * Prepend a `#!/usr/bin/env -S gjs -m` shebang to the output file and mark
   * it executable (chmod 755). Only applies to GJS app builds with a single
   * `--outfile`. Default: false.
   */
  shebang?: boolean;
  /**
   * Module names that should NOT be bundled. Each name remains as a literal
   * `import`/`require` in the output and is resolved by the runtime against
   * its own `node_modules` (or equivalent) at execution time.
   *
   * Repeat the flag or pass a comma-separated value:
   * `--external typedoc,prettier --external typescript`. Glob-style wildcards
   * (`@inquirer/*`, `lodash-*`) are forwarded as-is to esbuild.
   *
   * @see https://esbuild.github.io/api/#external
   */
  external?: string[];
  /**
   * Substitute compile-time constants in the bundle. Each entry is a
   * `KEY=VALUE` pair where `VALUE` is an arbitrary JS expression — string
   * literals must be quoted (`--define VERSION='"1.2.3"'`). Useful for
   * upstream packages that read a build-time constant via
   * `typeof __FOO__ !== 'undefined'`.
   *
   * @see https://esbuild.github.io/api/#define
   */
  define?: string[];
  /**
   * Map module specifiers to alternative targets at bundle time. Each entry
   * is `FROM=TO` where `FROM` is the imported package name and `TO` is the
   * substitute (typically `@gjsify/empty` to drop a heavy dep that the test
   * scenario never executes). Layered on top of the built-in alias map.
   */
  alias?: string[];
}
