import {
  esbuild,
  fromFileUrl,
  ImportMap,
  resolveImportMap,
  resolveModuleSpecifier,
  toFileUrl,
} from "./deps.js";
import { load as nativeLoad } from "./src/native_loader.js";
import { load as portableLoad } from "./src/portable_loader.js";
import { ModuleEntry } from "./src/deno.js";
import { getNodeModulesPath } from './src/node.js';
import { existsSync } from 'fs';
import { readFile, realpath } from 'fs/promises';
import { transformExtern, DeepkitPluginOptions } from '@gjsify/esbuild-plugin-deepkit';

export interface DenoPluginOptions {
  /**
   * Specify the URL to an import map to use when resolving import specifiers.
   * The URL must be fetchable with `fetch`.
   */
  importMapURL?: URL;
  /**
   * Specify which loader to use. By default this will use the `native` loader,
   * unless the `--allow-run` permission has not been given.
   *
   * - `native`:     Shells out to the Deno execuatble under the hood to load
   *                 files. Requires --allow-read and --allow-run.
   * - `portable`:   Do module downloading and caching with only Web APIs.
   *                 Requires --allow-read and/or --allow-net.
   */
  loader?: "native" | "portable";
}

/** The default loader to use. */
export const DEFAULT_LOADER: "native" | "portable" = "portable";

export function denoPlugin(options: DenoPluginOptions & DeepkitPluginOptions = {}): esbuild.Plugin {
  const loader = options.loader ?? DEFAULT_LOADER;
  return {
    name: "deno",
    setup(build) {
      const infoCache = new Map<string, ModuleEntry>();
      let importMap: ImportMap | null = null;

      build.onStart(async function onStart() {
        if (options.importMapURL !== undefined) {
          let txt: string;
          if(options.importMapURL.href.startsWith('file://')) {
            const url = new URL(options.importMapURL.href);
            txt = await readFile(url.pathname, { encoding: 'utf-8'});
          } else {
            const resp = await fetch(options.importMapURL.href);
            txt = await resp.text();
          }
          importMap = resolveImportMap(JSON.parse(txt), options.importMapURL);
        } else {
          importMap = null;
        }
      });

      build.onResolve({ filter: /.*/ }, async function onResolve(
        args: esbuild.OnResolveArgs,
      ): Promise<esbuild.OnResolveResult | null | undefined> {
        // If this is a node module
        if(args.kind === 'import-statement' || args.kind === 'require-call') {
          const nodeModulePath = await getNodeModulesPath(args.path);
          if(nodeModulePath) {
            return null
          }
        }

        if(args.path.endsWith('/')) {
          return null;
        }

        if (args.path.startsWith('gi://')) {
          return {
            path: args.path,
            external: true,
          }
        }

        if (args.path.startsWith('ext:')) {
          const path = args.path;
          let importModule: string;

          if (path.startsWith('ext:deno_node/')) {
            importModule = path.replace(/^ext:deno_node\//, '@gjsify/deno-runtime-2/ext/node/polyfills/');
          }else if (path.startsWith('ext:deno_')) {
            importModule = path.replace(/^ext:deno_/, '@gjsify/deno-runtime-2/ext/');
          }else if (path.startsWith('ext:runtime/')) {
            importModule = path.replace(/^ext:runtime\//, '@gjsify/deno-runtime-2/runtime/js/');
          } else if (path.startsWith('ext:core/')) {
            importModule = path.replace(/^ext:core\//, '@gjsify/deno-core/');
          } else {
            throw new Error(`Unknown ext: module ${path}`);
          }

          // .ts -> .js
          importModule = importModule.replace(/\.ts$/, '.js');

          try {
            const resolvedModule = (await build.resolve(importModule, {
              importer: args.importer,
              kind: args.kind,
              namespace: args.namespace,
              resolveDir: args.resolveDir,
              pluginData: args.pluginData,
            }));
  
            if (resolvedModule.errors.length > 0) {
              console.error(resolvedModule.errors);
            }

            return resolvedModule;
          } catch (error) {
            console.error(error);
            throw error;
          }


          // console.debug('ext:', args, resolvedModule);

          
        }
        
        const resolveDir = args.resolveDir
          ? `${toFileUrl(args.resolveDir).href}/`
          : "";
        const referrer = args.importer
          ? `${args.namespace}:${args.importer}`
          : resolveDir;
        let resolved: URL;
        if (importMap !== null) {
          const res = resolveModuleSpecifier(
            args.path,
            importMap,
            new URL(referrer) || undefined,
          );
          resolved = new URL(res);
        } else {
          resolved = new URL(args.path, referrer);
        }
        const protocol = resolved.protocol;
        if (protocol === "file:") {
          let path = fromFileUrl(resolved);
          if(existsSync(path)) {
            path = await realpath(path);
            return { path, namespace: "file" };
          } else {
            return null;
          }
        }
        const path = resolved.href.slice(protocol.length);
        return { path, namespace: protocol.slice(0, -1) };

      });

      async function onLoad(
        args: esbuild.OnLoadArgs,
      ): Promise<esbuild.OnLoadResult | null> {
        let url;

        if (args.namespace === "file") {
          url = toFileUrl(args.path);
        } else {
          url = new URL(`${args.namespace}:${args.path}`);
        }

        let result: esbuild.OnLoadResult | null = null

        switch (loader) {
          case "native":
            result = await nativeLoad(infoCache, url, options);
          case "portable":
            result = await portableLoad(url, options);
        }

        if(result?.contents && options.reflection) {
          return transformExtern(options, args, result);
        }

        return result;
      }
      build.onLoad({ filter: /.*\.json/, namespace: "file" }, onLoad);
      build.onLoad({ filter: /.*/, namespace: "http" }, onLoad);
      build.onLoad({ filter: /.*/, namespace: "https" }, onLoad);
      build.onLoad({ filter: /.*/, namespace: "data" }, onLoad);
    },
  };
}
