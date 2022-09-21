// Forked from https://github.com/igoradamenko/esbuild-plugin-alias

import type { Plugin } from "esbuild";

export const aliasPlugin = (options: Record<string, string>) => {
    const aliases = Object.keys(options);
    const re = new RegExp(`^(${aliases.map(x => escapeRegExp(x)).join('|')})$`);
  
    const plugin: Plugin = {
      name: 'alias',
      setup(build) {
        // we do not register 'file' namespace here, because the root file won't be processed
        // https://github.com/evanw/esbuild/issues/791
        build.onResolve({ filter: re }, args => ({
          path: options[args.path],
        }));
      },
    };

    return plugin;
  };
  
function escapeRegExp(str: string) {
// $& means the whole matched string
return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
  