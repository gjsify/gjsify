import type { App } from './app.js';

/** CSS handling forwarded to Rolldown / Lightning CSS. */
export interface GjsifyCssOptions {
    /** Browserslist-compatible target list. Defaults to `['firefox60']` for `--app gjs`. */
    target?: string[];
    /** Whether to minify the emitted CSS. Defaults to bundle-level `minify`. */
    minify?: boolean;
}

export interface PluginOptions {
    debug?: boolean;
    app?: App;
    aliases?: Record<string, string>;
    /** Glob patterns to exclude when expanding entry points. */
    exclude?: string[];
    jsExtension?: string;
    /** Override the bundle output format. */
    format?: 'esm' | 'cjs';
    /**
     * Library mode — `'esm' | 'cjs'`. When set, the plugin emits an
     * unbundled multi-entry library suitable for republication on npm
     * rather than a single application bundle.
     */
    library?: 'esm' | 'cjs';
    /**
     * Inject a console shim into GJS builds that uses print()/printerr() instead
     * of `GLib.log_structured()`. Removes the "Gjs-Console-Message:" prefix and
     * lets the terminal interpret ANSI escape codes correctly. Only applies to
     * `--app gjs`. Defaults to `true`.
     */
    consoleShim?: boolean;
    /** Enable Deepkit TypeScript reflection. Defaults to `false`. */
    reflection?: boolean;
    /** CSS pipeline options forwarded to the Rolldown / Lightning CSS layer. */
    css?: GjsifyCssOptions;
    /**
     * Path to a pre-computed globals stub file. The stub is an ESM file
     * containing one `import '<pkg>/register';` per entry from the user's
     * `--globals` CLI flag. When set, the plugin appends the stub path to
     * Rolldown's inject list alongside the console shim.
     *
     * The plugin does no scanning or inference at this layer — the CLI is the
     * sole source of truth for which `/register` modules get included. Only
     * applies to `--app gjs`.
     */
    autoGlobalsInject?: string;
}
