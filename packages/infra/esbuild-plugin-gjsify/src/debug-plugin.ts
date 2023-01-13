import type { Plugin } from "esbuild";

export const debugPlugin = () => {

  const plugin: Plugin = {
    name: 'debug',
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {

        // if(args.path.endsWith("runtime/js/index.js")) {
        //   console.debug("onResolve", args);
        // }

        return null;
      });
    },
  };

  return plugin;
};