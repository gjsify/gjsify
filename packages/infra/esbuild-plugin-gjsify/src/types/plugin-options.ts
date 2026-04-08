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
     * Auto-inject `/register` modules for globals referenced in user code
     * (fetch, Buffer, process, ReadableStream, …). The plugin scans entry
     * points with a lightweight regex, collects identifier references, and
     * prepends the matching register subpath via esbuild's `inject` option.
     * Only applies to GJS app builds. Default: true.
     */
    autoGlobals?: boolean;

    /**
     * Explicit globals list. Takes precedence over `autoGlobals` scan results.
     *
     * - `"fetch,crypto"`          — absolute whitelist, replaces scan results
     * - `"+crypto"`               — add on top of scan results
     * - `"-fetch"`                — remove from scan results
     * - `"+crypto,-fetch"`        — combined modifiers
     *
     * Only applies to GJS app builds.
     */
    globals?: string;
}