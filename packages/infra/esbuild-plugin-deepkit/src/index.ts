import { readFile } from 'fs/promises';
import { DeepkitLoader } from '@deepkit/type-compiler';
import { inspect } from 'util';

import type { Plugin } from 'esbuild';

const loader = new DeepkitLoader();

interface DeepkitPluginOptions {
  reflection?: boolean;
  tsconfigName?: string;
  cwd?: string;
}

export const printDiagnostics = (...args: any[]) => {
    console.log(inspect(args, false, 10, true));
}

export const deepkitPlugin = (options: DeepkitPluginOptions = {}): Plugin => {
  return {
    name: 'deepkit',
    setup(build) {
      options.reflection = options.reflection === undefined ? true : options.reflection;

      if (!options.reflection) {
        return;
      }

      build.onLoad({ filter: /\.(m|c)?tsx?$/}, async (args) => {
        let reflected: string;

        try {
          const tsSrc = await readFile(args.path, 'utf8');
          reflected = loader.transform(tsSrc, args.path);
        } catch (error) {
          printDiagnostics({ file: args.path, error });
        }
        
        return { contents: reflected, loader: 'ts' };
      });
    }
  }
}

export default deepkitPlugin;

