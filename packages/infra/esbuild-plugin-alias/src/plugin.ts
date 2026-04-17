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

        if (!resolvedAliasPath) {
          return null;
        }

        if (resolvedAliasPath.startsWith('http://')) {
          namespace = 'http';
          resolvedAliasPath = resolvedAliasPath.slice(5)
        } else if (resolvedAliasPath.startsWith('https://')) {
          namespace = 'https';
          resolvedAliasPath = resolvedAliasPath.slice(6)
        } else {
          let resolvedAlias = (await build.resolve(resolvedAliasPath, {
            importer: args.importer,
            kind: args.kind,
            namespace: namespace,
            resolveDir: args.resolveDir,
            pluginData: args.pluginData,
          }));

          // If resolution failed from the importer's directory, retry from
          // the project root (absWorkingDir). This is needed for browser
          // polyfill aliases (e.g. path → path-browserify) where the polyfill
          // is installed in the project root but the importer is inside a
          // deep node_modules dependency.
          if (resolvedAlias.errors.length > 0 && build.initialOptions.absWorkingDir) {
            resolvedAlias = await build.resolve(resolvedAliasPath, {
              kind: args.kind,
              namespace: namespace,
              resolveDir: build.initialOptions.absWorkingDir,
            });
          }

          if (resolvedAlias.errors.length > 0) {
            return resolvedAlias;
          } else if (resolvedAlias.external) {
            return { path: resolvedAlias.path, external: true };
          } else {
            resolvedAliasPath = resolvedAlias.path;
            namespace = resolvedAlias.namespace;
          }
        }

        if (existsSync(resolvedAliasPath)) {
          resolvedAliasPath = await realpath(resolvedAliasPath);
        }

        return {
          path: resolvedAliasPath,
          namespace: namespace,
        };
      });
    },
  };

  return plugin;
};

export default aliasPlugin;