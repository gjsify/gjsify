import { ensureDir } from "https://deno.land/std@0.211.0/fs/mod.ts";
import { dirname } from "https://deno.land/std@0.211.0/path/mod.ts";
import type { Options } from "../types.ts";

export const writeToFile = async (
  path: string,
  data: string,
  options: Options,
) => {
  const dest = path.replace(options.baseDir, options.outDir);
  const encoder = new TextEncoder();

  await ensureDir(dirname(dest));
  await Deno.writeFile(dest, encoder.encode(data));
  console.log(`Wrote ${dest}`);
  return data;
};
