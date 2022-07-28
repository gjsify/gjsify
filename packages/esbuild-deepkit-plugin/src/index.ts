import { readFile } from 'fs/promises';
import { DeepkitLoader } from '@deepkit/type-compiler';
import { printDiagnostics } from './log.js';
import { parseTsConfig } from './config.js';

import type { Plugin } from 'esbuild';

const loader = new DeepkitLoader();

interface DeepkitPluginOptions {
  reflection?: boolean;
  tsconfigName?: string;
  cwd?: string;
}

export const deepkit = (options: DeepkitPluginOptions = {}): Plugin => {
  return {
    name: 'deepkit',
    setup(build) {

      let parsedTsConfig= parseTsConfig(options.tsconfigName, options.cwd);
      const reflection = options.reflection === true || parsedTsConfig.raw.reflection === true;

      if (!reflection) {
        console.debug("Skip deepkit reflection. Reason: Disabled.");
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

export default deepkit;

