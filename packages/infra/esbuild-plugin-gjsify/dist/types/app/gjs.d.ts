import type { PluginBuild } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';
export declare const setupForGjs: (build: PluginBuild, pluginOptions: PluginOptions) => Promise<void>;
