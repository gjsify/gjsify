import type { App } from './app.js';
import type { DeepkitPluginOptions } from '@gjsify/esbuild-plugin-deepkit';

export interface PluginOptions extends DeepkitPluginOptions {
    debug?: boolean;
    app?: App;
    aliases?: Record<string, string>;
    /** An array of glob patterns to exclude matches and aliases */
    exclude?: string[];
    jsExtension?: string;
    /** Override the format */
    format?: 'esm' | 'cjs'
    /**
     * Library Mode
     * Use this if you want to build a library for Gjsify instead of an end user application.
     */
    library?: 'esm' | 'cjs';
    /**
     * Inject a console shim into GJS builds that uses print()/printerr() instead of
     * GLib.log_structured(). This removes the "Gjs-Console-Message:" prefix and allows
     * ANSI escape codes to be interpreted correctly by the terminal.
     * Only applies to GJS app builds. Default: true.
     */
    consoleShim?: boolean;

    /**
     * Path to a pre-computed globals stub file. The stub is an ESM file
     * containing one `import '<pkg>/register';` per entry from the user's
     * `--globals` CLI flag. When set, the plugin appends the stub path to
     * esbuild's `inject` list alongside the console shim.
     *
     * The plugin does no scanning or inference — the CLI is the sole source
     * of truth for which `/register` modules get included. Only applies to
     * `--app gjs`.
     */
    autoGlobalsInject?: string;
}