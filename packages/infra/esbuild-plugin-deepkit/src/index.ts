import { readFile } from 'fs/promises';
import { inspect } from 'util';
import { Utf8ArrayToStr } from './utils.js';

import type { Plugin, OnLoadArgs, OnLoadResult, OnLoadOptions } from 'esbuild';

// `@deepkit/type-compiler` is loaded lazily — its transitive dep
// `@marcj/ts-clone-node` does `require("typescript")` without declaring TS
// as a peer, so eagerly importing this module from a Yarn-PnP consumer that
// doesn't list `typescript` itself fails with `UNDECLARED_DEPENDENCY` even
// when `reflection: false` (the default). Defer until the user opts in.
type DkLoader = { transform: (contents: string, path: string) => string };
let cachedLoader: Promise<DkLoader> | null = null;
async function getLoader(): Promise<DkLoader> {
  if (cachedLoader) return cachedLoader;
  cachedLoader = (async () => {
    const DkType: typeof import('@deepkit/type-compiler') = await import('@deepkit/type-compiler');
    return new DkType.DeepkitLoader() as DkLoader;
  })();
  return cachedLoader;
}

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
export const transformExtern = async (options: DeepkitPluginOptions, args: Partial<OnLoadArgs> & { path: string; }, result: OnLoadResult): Promise<OnLoadResult | null> => {
  if(!options.reflection || !result.contents || !deepkitPluginOnLoadOptions.filter.test(args.path) || args.pluginData?.isReflected) {
    return result;
  }

  const path = args.namespace + ':' + args.path;

  try {
    const loader = await getLoader();
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

    const loader = await getLoader();
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
      options.reflection = options.reflection ?? false;

      if (!options.reflection) {
        return;
      }

      build.onLoad(deepkitPluginOnLoadOptions, onLoad);

    }
  }
}

export default deepkitPlugin;
