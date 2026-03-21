import { tmpdir } from 'os';
import { run, Resolve } from './run.js';

// Lifted from https://raw.githubusercontent.com/denoland/deno_graph/89affe43c9d3d5c9165c8089687c107d53ed8fe1/lib/media_type.ts
export type MediaType =
  | "JavaScript"
  | "Mjs"
  | "Cjs"
  | "JSX"
  | "TypeScript"
  | "Mts"
  | "Cts"
  | "Dts"
  | "Dmts"
  | "Dcts"
  | "TSX"
  | "Json"
  | "Wasm"
  | "TsBuildInfo"
  | "SourceMap"
  | "Unknown";

export interface InfoOutput {
  roots: string[];
  modules: ModuleEntry[];
  redirects: Record<string, string>;
}

export interface ModuleEntry {
  specifier: string;
  size: number;
  mediaType?: MediaType;
  local?: string;
  checksum?: string;
  emit?: string;
  map?: string;
  error?: string;
}

interface DenoInfoOptions {
  importMap?: string;
}

let tempDir: null | string;

export async function info(
  specifier: URL,
  options: DenoInfoOptions,
): Promise<InfoOutput> {
  const cmd = "deno";
  const args = [
    "info",
    "--json",
  ];
  if (options.importMap !== undefined) {
    args.push("--import-map", options.importMap);
  }
  args.push(specifier.href);

  if (!tempDir) {
    tempDir = tmpdir();
  }

  let proc: Resolve;

  try {
    proc = await run(cmd, args, {
      cwd: tempDir,
    });
    
    const txt = proc.stdout;
    return JSON.parse(txt);
  } catch(error) {
    throw new Error(`Failed to call '${cmd} ${args.join (" ")}' on '${specifier.href}'\n${error.message}`);
  }
}
