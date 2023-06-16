import { existsSync } from "fs";
import { realpath } from "fs/promises";

import type { Plugin } from "esbuild";

function escapeRegExp(str: string) {
  // $& means the whole matched string
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


export const aliasPlugin = (aliasObj: Record<string, string>) => {
  const aliases = Object.keys(aliasObj);
  const re = new RegExp(`^(${aliases.map(x => escapeRegExp(x)).join('|')})$`);

  const plugin: Plugin = {
    name: 'alias',
    setup(build) {
      // we do not register 'file' namespace here, because the root file won't be processed
      // https://github.com/evanw/esbuild/issues/791
      build.onResolve({ filter: re }, async (args) => {
        let resolvedAliasPath = aliasObj[args.path];

        let namespace = args.namespace;

        if (resolvedAliasPath) {

          if (resolvedAliasPath.startsWith('http://')) {
            namespace = 'http';
            resolvedAliasPath = resolvedAliasPath.slice(5)
          } else if (resolvedAliasPath.startsWith('https://')) {
            namespace = 'https';
            resolvedAliasPath = resolvedAliasPath.slice(6)
          } else {
            const resolvedAlias = (await build.resolve(resolvedAliasPath, {
              importer: args.importer,
              kind: args.kind,
              namespace: namespace,
              resolveDir: args.resolveDir,
              pluginData: args.pluginData,
            }));

            if (resolvedAlias.errors) {
              return resolvedAlias;
            } else {
              resolvedAliasPath = resolvedAlias.path;
              namespace = resolvedAlias.namespace;
            }
          }

          if (existsSync(resolvedAliasPath)) {
            resolvedAliasPath = await realpath(resolvedAliasPath);
          }

          // console.debug(`resolvedAliasPath: ${args.path} -> ${resolvedAliasPath}`);

          return {
            path: resolvedAliasPath,
            namespace: namespace,
          }
        }

        return null;
      });
    },
  };

  return plugin;
};

export default aliasPlugin;