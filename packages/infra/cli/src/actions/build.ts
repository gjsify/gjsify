import type { ConfigData, BundlerOptions } from "../types/index.js";
import type { App, PluginOptions } from "@gjsify/rolldown-plugin-gjsify";
import type { RolldownOutput, RolldownPluginOption } from "rolldown";
import { runBundle } from "../bundler-pick.js";
import { gjsifyPlugin, textLoaderPlugin, resolveShebangLine } from "@gjsify/rolldown-plugin-gjsify";
import { resolveUserPlugins } from "../utils/resolve-plugin-by-name.js";
import {
    resolveGlobalsList,
    writeRegisterInjectFile,
    detectAutoGlobals,
} from "@gjsify/rolldown-plugin-gjsify/globals";
import { pnpPlugin } from "@gjsify/rolldown-plugin-pnp";
import { dirname, extname } from "node:path";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { normalizeBundlerOptions, mergeBundlerOptions } from "../utils/normalize-bundler-options.js";

const DEFAULT_GJS_SHEBANG = "#!/usr/bin/env -S gjs -m";

/**
 * `true` when `path` points at a location that's unsafe to use as a build
 * outfile (would overwrite source). Currently catches:
 *   - any TypeScript extension (`.ts`, `.tsx`, `.mts`, `.cts`, `.mtsx`, `.ctsx`)
 *   - paths that live under a `src/` segment (relative or absolute)
 */
function isUnsafeDefaultOutput(path: string): boolean {
    if (/\.[cm]?tsx?$/i.test(path)) return true;
    const norm = path.replace(/\\/g, "/");
    if (/(?:^|\/)src\//.test(norm)) return true;
    return false;
}

/**
 * Resolve the gjsify-flavoured PnP plugin. Anchors the relay on this file's
 * URL so transitive `@gjsify/*` polyfills (reached via @gjsify/cli's deps on
 * @gjsify/{node,web}-polyfills) are resolvable for external consumers without
 * each one having to be a direct devDep.
 *
 * The path rewriter (`__filename`/`__dirname` + `import.meta.url` injection
 * for node_modules code) is registered separately by the orchestrator —
 * Rolldown's transform hooks all run sequentially, no shared `onLoad` race.
 */
async function buildPnpPlugin(): Promise<RolldownPluginOption | null> {
    return pnpPlugin({ issuerUrl: import.meta.url });
}

export class BuildAction {
    constructor(readonly configData: ConfigData = {}) {}

    /** Library mode */
    async buildLibrary(): Promise<RolldownOutput[]> {
        const { verbose, library, typescript, exclude, aliases } = this.configData;
        const lib = library ?? {};
        const userBundler = normalizeBundlerOptions(this.configData);

        const moduleOutdir = lib.module ? dirname(lib.module) : undefined;
        const mainOutdir = lib.main ? dirname(lib.main) : undefined;

        const moduleOutExt = lib.module ? extname(lib.module) : ".js";
        const mainOutExt = lib.main ? extname(lib.main) : ".js";

        const multipleBuilds =
            moduleOutdir && mainOutdir && moduleOutdir !== mainOutdir;

        const pnp = await buildPnpPlugin();
        const pnpPlugins: RolldownPluginOption[] = pnp ? [pnp] : [];

        const results: RolldownOutput[] = [];

        if (multipleBuilds) {
            const moduleFormat: "esm" | "cjs" =
                moduleOutdir.includes("/cjs") || moduleOutExt === ".cjs"
                    ? "cjs"
                    : "esm";
            results.push(
                await runOneLibraryBuild({
                    pluginOpts: {
                        debug: verbose,
                        library: moduleFormat,
                        exclude,
                        reflection: typescript?.reflection,
                        jsExtension: moduleOutExt,
                    },
                    userBundler,
                    output: { dir: moduleOutdir },
                    userAliases: aliases,
                    pnpPlugins,
                }),
            );

            const mainFormat: "esm" | "cjs" =
                mainOutdir.includes("/cjs") || mainOutExt === ".cjs" ? "cjs" : "esm";
            results.push(
                await runOneLibraryBuild({
                    pluginOpts: {
                        debug: verbose,
                        library: mainFormat,
                        exclude,
                        reflection: typescript?.reflection,
                        jsExtension: mainOutExt,
                    },
                    userBundler,
                    output: { dir: mainOutdir },
                    userAliases: aliases,
                    pnpPlugins,
                }),
            );
        } else {
            const outfilePath =
                userBundler.output?.file ?? lib.module ?? lib.main;
            const outExt = outfilePath ? extname(outfilePath) : ".js";
            const outdir =
                userBundler.output?.dir ?? (outfilePath ? dirname(outfilePath) : undefined);
            const format: "esm" | "cjs" =
                (userBundler.output?.format as "esm" | "cjs" | undefined) ??
                (outdir?.includes("/cjs") || outExt === ".cjs" ? "cjs" : "esm");
            results.push(
                await runOneLibraryBuild({
                    pluginOpts: {
                        debug: verbose,
                        library: format,
                        exclude,
                        reflection: typescript?.reflection,
                        jsExtension: outExt,
                    },
                    userBundler,
                    output: { dir: outdir },
                    userAliases: aliases,
                    pnpPlugins,
                }),
            );
        }
        return results;
    }

    /**
     * Parse the `--globals` value into { autoMode, extras }.
     * - `auto`             → { autoMode: true, extras: '' }
     * - `auto,dom`         → { autoMode: true, extras: 'dom' }
     * - `auto,dom,fetch`   → { autoMode: true, extras: 'dom,fetch' }
     * - `dom,fetch`        → { autoMode: false, extras: 'dom,fetch' }
     * - `none` / ``        → { autoMode: false, extras: '' }
     * - `undefined`        → { autoMode: true, extras: '' }  (default)
     */
    private parseGlobalsValue(value: string | undefined): {
        autoMode: boolean;
        extras: string;
    } {
        if (value === undefined) return { autoMode: true, extras: "" };
        if (value === "none" || value === "")
            return { autoMode: false, extras: "" };

        const tokens = value
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
        const hasAuto = tokens.includes("auto");
        const extras = tokens.filter((t) => t !== "auto").join(",");

        return { autoMode: hasAuto, extras };
    }

    /**
     * Resolve the `--globals` CLI list into a pre-computed inject stub path
     * that the orchestrator appends to its input list. Only runs for
     * `--app gjs` — Node and browser builds rely on native globals.
     *
     * Used only for the explicit-only path (no `auto` token in the value).
     * The auto path is handled in `buildApp` via the iterative multi-pass build.
     */
    private async resolveGlobalsInject(
        app: App,
        globals: string,
        verbose: boolean | undefined,
    ): Promise<string | undefined> {
        if (app !== "gjs") return undefined;
        if (!globals) return undefined;

        const registerPaths = resolveGlobalsList(globals);
        if (registerPaths.size === 0) return undefined;

        const injectPath = await writeRegisterInjectFile(
            registerPaths,
            process.cwd(),
        );
        if (verbose && injectPath) {
            console.debug(
                `[gjsify] globals: injected ${registerPaths.size} register module(s) from --globals ${globals}`,
            );
        }
        return injectPath ?? undefined;
    }

    /**
     * Post-processing: prepend the resolved shebang line and mark the
     * output executable. Only runs for GJS app builds with a single outfile.
     * The shebang plugin in `@gjsify/rolldown-plugin-gjsify` already injects
     * during bundling — this hook is the safety net for anything that
     * bypassed the plugin (e.g. user-supplied banners that out-ordered it),
     * plus the chmod.
     */
    private async applyShebang(
        outfile: string | undefined,
        verbose: boolean | undefined,
    ): Promise<void> {
        if (!outfile) {
            if (verbose)
                console.warn(
                    "[gjsify] --shebang skipped: no single outfile (use --outfile for GJS executables)",
                );
            return;
        }

        const line = resolveShebangLine(this.configData.shebang) ?? DEFAULT_GJS_SHEBANG;

        const content = await readFile(outfile, "utf-8");
        if (content.startsWith("#!")) {
            if (verbose)
                console.debug(
                    `[gjsify] --shebang skipped: ${outfile} already starts with a shebang`,
                );
        } else {
            await writeFile(outfile, line + "\n" + content);
        }
        await chmod(outfile, 0o755);
        if (verbose)
            console.debug(
                `[gjsify] --shebang: wrote ${line} + chmod 0o755 to ${outfile}`,
            );
    }

    /** Application mode */
    async buildApp(app: App = "gjs"): Promise<RolldownOutput[]> {
        const {
            verbose,
            typescript,
            exclude,
            library: pkg,
            aliases,
            excludeGlobals,
        } = this.configData;

        const userBundler = normalizeBundlerOptions(this.configData);

        const formatRaw =
            (userBundler.output?.format as "esm" | "cjs" | "iife" | undefined) ??
            (userBundler.output?.file?.endsWith(".cjs") ? "cjs" : "esm");
        // The orchestrator only handles esm/cjs (iife is not a GJS / Node /
        // browser-bundle target we support). Coerce.
        const format: "esm" | "cjs" = formatRaw === "iife" ? "esm" : formatRaw;

        // Set default outfile if no outdir is set
        let outfile = userBundler.output?.file;
        let outdir = userBundler.output?.dir;
        if (!outfile && !outdir && (pkg?.main || pkg?.module)) {
            const candidate =
                format === "cjs"
                    ? pkg.main ?? pkg.module
                    : pkg.module ?? pkg.main;
            if (candidate && isUnsafeDefaultOutput(candidate)) {
                throw new Error(
                    `gjsify build: refusing to default --outfile to ${candidate} ` +
                        `(would overwrite a TypeScript source file). Pass --outfile/--outdir ` +
                        `explicitly, or set "gjsify.bundler.output.file" in package.json.`,
                );
            }
            outfile = candidate;
        }

        const { consoleShim, globals } = this.configData;

        const userExternal = Array.isArray(userBundler.external)
            ? (userBundler.external as string[])
            : undefined;
        const userBanner = typeof userBundler.output?.banner === "string"
            ? (userBundler.output.banner as string)
            : undefined;

        const pluginOpts: PluginOptions = {
            debug: verbose,
            app,
            format,
            exclude,
            reflection: typescript?.reflection,
            consoleShim,
            ...(aliases ? { aliases } : {}),
        };

        const { autoMode, extras } = this.parseGlobalsValue(globals);

        const pnp = await buildPnpPlugin();
        const pnpPlugins: RolldownPluginOption[] = pnp ? [pnp] : [];

        // User-supplied text loaders need to be available during BOTH the
        // auto-globals pre-build (`detectAutoGlobals`) and the final build —
        // otherwise Rolldown's parser hits unknown extensions like `.ui` /
        // `.asm` during the pre-build, fails to parse them as JS/JSX, and
        // the auto-globals iteration aborts before the final plugin chain is
        // ever assembled. Build the user-plugin chain once, up front, and
        // pass it into both passes.
        const userTextLoader = textLoaderPlugin({ loaders: this.configData.loaders });
        const userPlugins: RolldownPluginOption[] = userTextLoader ? [userTextLoader] : [];

        // User-supplied bundler.plugins (mix of plugin objects + by-name
        // entries) — resolved from the project's node_modules. Same
        // ordering rationale as the text loader: must be present during
        // auto-globals pre-build to avoid claiming the same files via
        // Rolldown's default classifier.
        if (userBundler.plugins?.length) {
            const resolved = await resolveUserPlugins(userBundler.plugins, process.cwd());
            userPlugins.push(...resolved);
        }

        // --- Auto mode (with optional extras): iterative multi-pass build ---
        if (app === "gjs" && autoMode) {
            const gjsifyPluginFactory = async (opts: PluginOptions) => {
                const cfg = await gjsifyPlugin(
                    {
                        input: userBundler.input,
                        output: { file: outfile, dir: outdir },
                        userExternal,
                        userBanner,
                        userAliases: aliases,
                        shebang: this.configData.shebang,
                    },
                    opts,
                );
                return cfg.plugins;
            };

            const { injectPath } = await detectAutoGlobals(
                {
                    input: userBundler.input,
                    plugins: [...pnpPlugins, ...userPlugins],
                    external: userBundler.external,
                    transform: userBundler.transform,
                    format,
                },
                pluginOpts,
                gjsifyPluginFactory,
                verbose,
                { extraGlobalsList: extras, excludeGlobals },
            );

            pluginOpts.autoGlobalsInject = injectPath;
        } else if (extras) {
            pluginOpts.autoGlobalsInject = await this.resolveGlobalsInject(
                app,
                extras,
                verbose,
            );
        }

        // Final build: orchestrator → rolldown → write
        const cfg = await gjsifyPlugin(
            {
                input: userBundler.input,
                output: { file: outfile, dir: outdir },
                userExternal,
                userBanner,
                userAliases: aliases,
                shebang: this.configData.shebang,
            },
            pluginOpts,
        );

        const merged = mergeBundlerOptions(cfg.options as BundlerOptions, userBundler);

        const finalOpts: BundlerOptions = {
            ...merged,
            // Drop user-config plugins from `merged` — they survived
            // mergeBundlerOptions via spread but have already been resolved
            // and appended into `userPlugins` above. Re-emitting the raw
            // entries (which may include `BundlerPluginByName` shapes
            // Rolldown doesn't understand) would crash the build.
            plugins: [...pnpPlugins, ...userPlugins, ...cfg.plugins],
        };

        const writeResult = await runBundle(finalOpts);

        if (app === "gjs" && this.configData.shebang) {
            await this.applyShebang(outfile, verbose);
        }

        return [writeResult];
    }

    async start(buildType: { library?: boolean; app?: App } = { app: "gjs" }) {
        if (buildType.library) {
            return await this.buildLibrary();
        }
        return await this.buildApp(buildType.app);
    }
}

interface OneLibraryBuildArgs {
    pluginOpts: PluginOptions;
    userBundler: BundlerOptions;
    output: { file?: string; dir?: string };
    userAliases?: Record<string, string>;
    pnpPlugins: RolldownPluginOption[];
}

async function runOneLibraryBuild(args: OneLibraryBuildArgs): Promise<RolldownOutput> {
    const cfg = await gjsifyPlugin(
        {
            input: args.userBundler.input,
            output: args.output,
            userAliases: args.userAliases,
        },
        args.pluginOpts,
    );

    const merged = mergeBundlerOptions(cfg.options as BundlerOptions, args.userBundler);
    const finalOpts: BundlerOptions = {
        ...merged,
        plugins: [...args.pnpPlugins, ...cfg.plugins],
    };

    return await runBundle(finalOpts);
}
