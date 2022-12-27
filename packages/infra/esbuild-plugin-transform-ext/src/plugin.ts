import { readFile } from 'fs/promises';

import type { Plugin, OnLoadArgs, OnLoadResult } from "esbuild";
import type { PluginOptions, Extension } from './types/index.js';

const IMPORT_PATTERN = /(import|from) ("|')\..*\.(js|ts|mjs|cjs|mts|cts)("|')/gm;
const TS_EXT_PATTERN = /\.(ts|mts|cts|tsx)/;
const JS_EXT_PATTERN = /\.(js|mjs|cjs|jsx)/;
const DEFAULT_EXTENSIONS: Extension = {'.js': '.js', '.ts': '.js', '.mts': '.js', '.cts': '.js', '.cjs': '.js', '.mjs': '.js'};

/**
 * You can use this method to transform the imports of a file by yourself without the need of the esbuild plugin
 * @param path The file path you want to transform 
 * @param outExtension The extension map you want to transform
 * @param options 
 * @returns The transformed file content
 */
export const transformImports = async (path: string, outExtension: Extension = {}, verbose = false) => {

  let changed = false;

  let contents = await readFile(path, 'utf8');

  if(Object.keys(outExtension).length <= 0) {
    outExtension = DEFAULT_EXTENSIONS;
  }

  const matches =  Array.from(contents.matchAll(IMPORT_PATTERN));

  for (const match of matches) {
    const importStr = match[0];
    let transformed = importStr;
    for (const ext of Object.keys(outExtension)) {
      transformed = transformed.replaceAll(ext, outExtension[ext])
    }

    if(importStr === transformed) {
      continue
    }

    changed = true;

    contents = contents.replace(importStr, transformed)
    if(verbose) {
      console.debug(`[transform-ext] ${importStr} -> ${transformed}`);
    }
  }

  if(changed && verbose) {
    console.debug(`[transform-ext] in ${path}\n`);
  }
  
  return contents
}

export const transformExtPlugin = (pluginOptions: PluginOptions) => {
    const plugin: Plugin = {
        name: 'transform-ext',
        async setup(build) {

          const outExtension: {[ext: string]: string;} = {};

          if(pluginOptions.outExtension) {
            Object.assign(outExtension, pluginOptions.outExtension)
          } else if(build.initialOptions.outExtension) {
            Object.assign(outExtension, build.initialOptions.outExtension)
          } else {
            Object.assign(outExtension, DEFAULT_EXTENSIONS)
          }

          const onLoad = async (loader: 'js'|'ts', args: OnLoadArgs): Promise<OnLoadResult | null | undefined> => {
            let contents: string;
        
            try {
              contents = await transformImports(args.path, outExtension, pluginOptions.verbose)
            } catch (error) {
              console.error(error);
              return null;
            }
            
            return { contents, loader };
          }

          build.onLoad({filter: TS_EXT_PATTERN}, onLoad.bind(this, 'ts'));
          build.onLoad({filter: JS_EXT_PATTERN}, onLoad.bind(this, 'js'));
        }
    }
    return plugin;
};

export default transformExtPlugin;