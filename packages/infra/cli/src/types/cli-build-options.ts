import type { Platform } from './index.js';

export interface CliBuildOptions {
  /** @see https://esbuild.github.io/api/#entry-points */
  entryPoints?: string[];
  /** The platform you want to build your application for, the platforms node and deno are usually only used internally to build the tests for Gjsify */
  platform?: Platform;
  /** Use this if you want to build a library for Gjsify */
  library?: boolean;
  /**
   * This option sets the output file name for the build operation.
   * This is only applicable if there is a single entry point.
   * If there are multiple entry points, you must use the outdir option instead to specify an output directory.
   * @see https://esbuild.github.io/api/#outfile
   */
  outfile?: string;
}