// Based on https://github.com/igoradamenko/esbuild-plugin-alias

import type { Plugin } from "esbuild";

export const aliasPlugin = (aliasObj: Record<string, string>) => {
    const aliases = Object.keys(aliasObj);
    const re = new RegExp(`^(${aliases.map(x => escapeRegExp(x)).join('|')})$`);
  
    const plugin: Plugin = {
      name: 'alias',
      setup(build) {
        // we do not register 'file' namespace here, because the root file won't be processed
        // https://github.com/evanw/esbuild/issues/791
        build.onResolve({ filter: re }, (args) => {
          const resolvedAlias = aliasObj[args.path];

          // console.debug(`aliasPlugin: ${args.path} -> ${resolvedAlias}`);

          if (resolvedAlias) {
            return {
              path: resolvedAlias,
              namespace: args.namespace,
            }
          }

          return null;
        });
      },
    };

    return plugin;
  };
  
function escapeRegExp(str: string) {
// $& means the whole matched string
return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
  