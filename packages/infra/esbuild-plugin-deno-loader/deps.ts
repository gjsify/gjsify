import { pathToFileURL, fileURLToPath } from 'url';
import type * as esbuild from "esbuild";
export type { esbuild };
export { basename, extname, resolve } from "path";
export {
  resolveImportMap,
  resolveModuleSpecifier,  
} from "deno-importmap";
export type { ImportMap } from "deno-importmap";


export const toFileUrl = pathToFileURL;
export const fromFileUrl = fileURLToPath;