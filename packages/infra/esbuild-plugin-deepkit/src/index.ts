import { readFile } from 'fs/promises';
import { DeepkitLoader } from '@deepkit/type-compiler';
import { inspect } from 'util';
import { Utf8ArrayToStr } from './utils.js';

import type { Plugin, OnLoadArgs, OnLoadResult, OnLoadOptions } from 'esbuild';

const loader = new DeepkitLoader();

export interface DeepkitPluginOptions {
  reflection?: boolean;
}

const printDiagnostics = (...args: any[]) => {
  console.log("printDiagnostics", inspect(args, false, 10, true));
}

const deepkitPluginOnLoadOptions: OnLoadOptions = { filter: /\.(m|c)?tsx?$/, namespace: 'file'};

/**
 * Use this method if you want to transform your typescript in any other plugin / onLoad callback method
 * @param options +
 * @param args 
 * @param result 
 * @returns 
 */
export const transformExtern = (options: DeepkitPluginOptions, args: Partial<OnLoadArgs> & { path: string; }, result: OnLoadResult): OnLoadResult | null => {
  if(!options.reflection || !result.contents || !deepkitPluginOnLoadOptions.filter.test(args.path) || args.pluginData?.isReflected) {
    return result;
  }

  const path = args.namespace + ':' + args.path;

  try {
    const contentStr = typeof result.contents === 'string' ? result.contents : Utf8ArrayToStr(result.contents);
    result.contents = loader.transform(contentStr, path);
    result.pluginData = result.pluginData || {};
    result.pluginData.isReflected = true;
  } catch (error) {
    printDiagnostics({ file: path, error });
  }

  return result;
}

const onLoad = async (args: OnLoadArgs): Promise<OnLoadResult | null | undefined> => {
  let contents: string;

  // console.debug("[deepkit] onLoad", args.path);

  try {
    contents = await readFile(args.path, 'utf8');
    // If already reflected do nothing
    if(args.pluginData?.isReflected) {
      return { contents, loader: 'ts', pluginData: { isReflected: true } };
    }

    contents = loader.transform(contents, args.path);
  } catch (error) {
    printDiagnostics({ file: args.path, error });
    return null;
  }
  
  return { contents, loader: 'ts', pluginData: { isReflected: true } };
}

export const deepkitPlugin = (options: DeepkitPluginOptions = {}): Plugin => {
  return {
    name: 'deepkit',
    setup(build) {
      options.reflection = options.reflection === undefined ? true : options.reflection;

      if (!options.reflection) {
        return;
      }

      build.onLoad(deepkitPluginOnLoadOptions, onLoad);

    }
  }
}

export default deepkitPlugin;
