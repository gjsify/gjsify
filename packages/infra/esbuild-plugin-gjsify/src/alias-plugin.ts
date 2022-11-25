// Based on https://github.com/igoradamenko/esbuild-plugin-alias

import type { Plugin } from "esbuild";

export const aliasPlugin = (options: Record<string, string>) => {
    const aliases = Object.keys(options);
    const re = new RegExp(`^(${aliases.map(x => escapeRegExp(x)).join('|')})$`);
  
    const plugin: Plugin = {
      name: 'alias',
      setup(build) {
        // we do not register 'file' namespace here, because the root file won't be processed
        // https://github.com/evanw/esbuild/issues/791
        build.onResolve({ filter: re }, (args) => {
          const resolvedAlias = options[args.path];

          if(resolvedAlias.startsWith("http://") || resolvedAlias.startsWith("https://")) {
            return {
              path: resolvedAlias,
              external: true // TODO use deno plugin?
            }
          }

          return {
            path: resolvedAlias,
          }
        });
      },
    };

    return plugin;
  };
  
function escapeRegExp(str: string) {
// $& means the whole matched string
return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
  