import type { BuildOptions } from "esbuild";
export declare const globToEntryPoints: (_entryPoints: BuildOptions["entryPoints"], ignore?: string[]) => Promise<string[] | Record<string, string> | {
    in: string;
    out: string;
}[]>;
