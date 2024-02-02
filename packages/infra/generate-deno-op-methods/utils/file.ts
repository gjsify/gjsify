import { ensureDir } from "https://deno.land/std@0.211.0/fs/mod.ts";
import { dirname } from "https://deno.land/std@0.211.0/path/mod.ts";

export const writeToFile = async (path: string, data: string) => {
  // Write to file
  const encoder = new TextEncoder();

  await ensureDir(dirname(path));
  await Deno.writeFile(path, encoder.encode(data));
  console.log(`Wrote ${path}`);
  return data;
};
