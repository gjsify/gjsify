import { parseArgs } from "https://deno.land/std@0.211.0/cli/parse_args.ts ";

import type { Options } from "../types.ts";

/**
 * Parse CLI arguments for the Deno script.
 * @returns An object containing the parsed CLI arguments.
 */
export const parseArguments = (): Options => {
  const args = parseArgs<Options>(Deno.args);

  // The prefix of the op methods to process
  const prefix = args.prefix || "";

  // The path the script should search for op methods
  const dir = args.dir || "../../deno/runtime-2/src";

  const baseDir = args.baseDir || dir;

  const outDir = args.outDir || dir;

  // If the AI should be used to write boilerplate for the methods
  const ai = args.ai || false;

  const help = args.help || false;

  return { prefix, dir, baseDir, outDir, ai, help };
};

export const getOptions = () => {
  return parseArguments();
};

/**
 * Prints a help text for the --help argument for the possible options.
 */
export const printHelp = (options: Options): void => {
  console.log(`
    Usage: script [options]

    Options:
      --prefix    The prefix of the op methods to process
      --dir       The path the script should search for op methods
      --baseDir   The base directory of the project
      --outDir    The directory where the generated files should be placed
      --ai        If the AI should be used to write boilerplate for the methods
      --help      Show help information

    Examples:
      script --prefix=op --dir=../../deno/runtime-2/src --ai
      script --help
  `);

  console.log(`
    Your Options:
      --prefix=${options.prefix}
      --dir=${options.dir}
      --outDir=${options.outDir}
      --ai=${options.ai}
  `);
};
