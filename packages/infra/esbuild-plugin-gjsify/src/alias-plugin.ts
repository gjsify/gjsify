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
          let resolvedAlias = aliasObj[args.path];

          // console.debug(`aliasPlugin: ${args.path} -> ${resolvedAlias}`);

          let namespace = args.namespace;

          if(resolvedAlias.startsWith('http://')) {
            namespace = 'http';
            resolvedAlias = resolvedAlias.slice(5)
          } else if(resolvedAlias.startsWith('https://')) {
            namespace = 'https';
            resolvedAlias = resolvedAlias.slice(6)
          } 

          if (resolvedAlias) {
            return {
              path: resolvedAlias,
              namespace: namespace,
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
  