import type { Plugin } from "esbuild";
import type { PluginOptions } from './types/plugin-options.js';
import { setupCjsLib, setupEsmLib } from './lib/index.js';
import { setupForGjs, setupForNode, setupForDeno } from './app/index.js';

export const gjsifyPlugin = (pluginOptions: PluginOptions = {}) => {
    const plugin: Plugin = {
        name: 'gjsify',
        async setup(build) {

            // Library mode
            if(pluginOptions.library) {
                switch (pluginOptions.library) {
                    case 'esm':
                        return setupEsmLib(build, pluginOptions)
                    case 'cjs':
                        return setupCjsLib(build, pluginOptions)
                    default:
                        throw new TypeError('Unknown library type: ' + pluginOptions.library);
                }
            }

            pluginOptions.app ||= 'gjs';
            
            // End user applications or tests
            switch (pluginOptions.app) {
                case 'gjs':
                    return await setupForGjs(build, pluginOptions);
                case 'node':
                    return await setupForNode(build, pluginOptions);
                case 'deno':
                    return await setupForDeno(build, pluginOptions);
                default:
                    throw new TypeError('Unknown app platform: ' + pluginOptions.app);
            }
        }
    }
    return plugin;
};

export default gjsifyPlugin;