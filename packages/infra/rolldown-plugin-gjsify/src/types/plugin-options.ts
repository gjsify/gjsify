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
    /**
     * `--app node` only. When true, the node factory wraps the entry so it
     * side-effect imports `@gjsify/node-gi/globals` before the user code runs,
     * seeding the GJS ambient globals (`print`/`printerr`/`log`/`logError`/
     * `ARGV`/`imports`) on Node. Set by the CLI after `detectNodeGiGlobals`
     * finds those globals in the bundled (post-tree-shake) output. Left false
     * when none are referenced — importing the shim eagerly loads the native
     * node-gi addon, so it must NEVER be injected into a bundle that doesn't
     * use the globals. Defaults to `false`.
     */
    nodeGiGlobalsInject?: boolean;
    /**
     * Preserve the entry module's `default` export through the `--app gjs`
     * side-effect entry wrapper. The wrapper normally re-exports the entry with
     * `export * from <entry>`, which carries named bindings but NOT `default`.
     * That's correct for executables (run, not imported), but wrong when the
     * bundle is imported as a library whose API is a default export — e.g. a
     * bundler plugin bundled for GJS by `gjsify build`'s plugin loader, where
     * the plugin factory IS the default export. When set, the wrapper also
     * re-exports `default` (safely `undefined` when the entry has none).
     * Only meaningful for `--app gjs` and only when globals injection forces
     * the wrapper. Defaults to `false`.
     */
    preserveDefaultExport?: boolean;
    /**
     * Where to look for a `@gjsify/*` the PROJECT cannot resolve, when the input is
     * TOOLCHAIN rather than user code: a file path inside the running CLI's own
     * install, used as the importer of a second resolve.
     *
     * OPT-IN PER CALL SITE, never inferred from the code path. `gjsify build` never
     * sets it, and neither does a `node <file>` in an ordinary project's package
     * script — a user's application must still fail loudly on a missing dependency
     * rather than silently pick up whatever version the CLI ships. Rationale and the
     * measured incident: `WorkspaceImportGuardOptions.toolchainAnchor`.
     */
    toolchainAnchor?: string;
}
