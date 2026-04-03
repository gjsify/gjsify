// esbuild plugin for compiling GNOME Blueprint (.blp) files to XML.
// Adapted from @gjsify/vite-plugin-blueprint (refs/gjsify-vite/packages/vite-plugin-blueprint).
// Copyright (c) gjsify contributors. MIT license.

import type { Plugin } from 'esbuild';
import { execa } from 'execa';
import { resolve } from 'path';

export function blueprintPlugin(): Plugin {
    return {
        name: 'blueprint',
        setup(build) {
            build.onResolve({ filter: /\.blp$/ }, (args) => {
                return {
                    path: args.path,
                    namespace: 'blueprint',
                    pluginData: { resolveDir: args.resolveDir },
                };
            });

            build.onLoad({ filter: /\.blp$/, namespace: 'blueprint' }, async (args) => {
                const fullPath = resolve(args.pluginData.resolveDir, args.path);
                const { stdout } = await execa('blueprint-compiler', ['compile', fullPath]);

                return {
                    contents: `export default ${JSON.stringify(stdout)};`,
                    loader: 'js',
                };
            });
        },
    };
}
