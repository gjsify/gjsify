import type { PluginBuild } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';
export declare const setupForNode: (build: PluginBuild, pluginOptions: PluginOptions) => Promise<void>;
