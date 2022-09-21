import type { App } from './index.js';

export interface CliBuildOptions {
  /**
   * This is an array of files that each serve as an input to the bundling algorithm.
   * @see https://esbuild.github.io/api/#entry-points
   */
  entryPoints?: string[];
  /** Switch on the verbose mode */
  verbose?: boolean;
  /** Use this if you want to build a application or test, the platforms node and deno are usually only used internally to build the tests for Gjsify */
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
}