import type { ConfigData } from "../types/index.js";
import type { App } from "@gjsify/esbuild-plugin-gjsify";
import { build, BuildOptions, BuildResult, Plugin } from "esbuild";
import { gjsifyPlugin } from "@gjsify/esbuild-plugin-gjsify";
import {
	resolveGlobalsList,
	writeRegisterInjectFile,
	detectAutoGlobals,
} from "@gjsify/esbuild-plugin-gjsify/globals";
import { getBundleDir, rewriteContents } from "@gjsify/esbuild-plugin-gjsify";
import { getPnpPlugin } from "@gjsify/resolve-npm/pnp-relay";
import { dirname, extname } from "node:path";
import { chmod, readFile, writeFile } from "node:fs/promises";

const GJS_SHEBANG = "#!/usr/bin/env -S gjs -m\n";

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
 * Wires the @gjsify/esbuild-plugin-gjsify rewriter (`__filename`/`__dirname`
 * injection for CJS code in node_modules) into the pnp plugin's onLoad —
 * esbuild stops at the first matching onLoad, so the rewriter MUST run from
 * inside the pnp plugin's onLoad rather than as a separate registration.
 */
async function buildPnpPlugin(): Promise<Plugin | null> {
	return getPnpPlugin({
		issuerUrl: import.meta.url,
		transformContentsFactory: (build) => {
			const bundleDir = getBundleDir(build);
			return (args, contents) => rewriteContents(args, contents, bundleDir);
		},
	});
}

export class BuildAction {
	constructor(readonly configData: ConfigData = {}) {}

	getEsBuildDefaults() {
		const defaults: BuildOptions = {
			allowOverwrite: true,
		};
		return defaults;
	}

	/** Library mode */
	async buildLibrary() {
		let { verbose, library, esbuild, typescript, exclude } = this.configData;
		library ||= {};
		esbuild ||= {};
		typescript ||= {};

		const moduleOutdir = library?.module ? dirname(library.module) : undefined;
		const mainOutdir = library?.main ? dirname(library.main) : undefined;

		const moduleOutExt = library.module ? extname(library.module) : ".js";
		const mainOutExt = library.main ? extname(library.main) : ".js";

		const multipleBuilds =
			moduleOutdir && mainOutdir && moduleOutdir !== mainOutdir;

		const pnpPlugin = await buildPnpPlugin();
		const pnpPlugins: Plugin[] = pnpPlugin ? [pnpPlugin] : [];

		const results: BuildResult[] = [];

		if (multipleBuilds) {
			const moduleFormat =
				moduleOutdir.includes("/cjs") || moduleOutExt === ".cjs"
					? "cjs"
					: "esm";
			results.push(
				await build({
					...this.getEsBuildDefaults(),
					...esbuild,
					format: moduleFormat,
					outdir: moduleOutdir,
					plugins: [
						...pnpPlugins,
						gjsifyPlugin({
							debug: verbose,
							library: moduleFormat,
							exclude,
							reflection: typescript?.reflection,
							jsExtension: moduleOutExt,
						}),
					],
				}),
			);

			const mainFormat =
				mainOutdir.includes("/cjs") || mainOutExt === ".cjs" ? "cjs" : "esm";
			results.push(
				await build({
					...this.getEsBuildDefaults(),
					...esbuild,
					format: moduleFormat,
					outdir: mainOutdir,
					plugins: [
						...pnpPlugins,
						gjsifyPlugin({
							debug: verbose,
							library: mainFormat,
							exclude,
							reflection: typescript?.reflection,
							jsExtension: mainOutdir,
						}),
					],
				}),
			);
		} else {
			const outfilePath = esbuild?.outfile || library?.module || library?.main;
			const outExt = outfilePath ? extname(outfilePath) : ".js";
			const outdir =
				esbuild?.outdir || (outfilePath ? dirname(outfilePath) : undefined);
			const format: "esm" | "cjs" =
				(esbuild?.format as "esm" | "cjs") ??
				(outdir?.includes("/cjs") || outExt === ".cjs" ? "cjs" : "esm");
			results.push(
				await build({
					...this.getEsBuildDefaults(),
					...esbuild,
					format,
					outdir,
					plugins: [
						...pnpPlugins,
						gjsifyPlugin({
							debug: verbose,
							library: format,
							exclude,
							reflection: typescript?.reflection,
							jsExtension: outExt,
						}),
					],
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
	 * that the esbuild plugin will append to its `inject` list. Only runs
	 * for `--app gjs` — Node and browser builds rely on native globals.
	 *
	 * Used only for the explicit-only path (no `auto` token in the value).
	 * The auto path is handled in `buildApp` via the two-pass build.
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
	 * Post-processing: prepend GJS shebang and mark the output file executable.
	 * Only runs for GJS app builds with a resolvable single outfile.
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

		const content = await readFile(outfile, "utf-8");
		if (content.startsWith("#!")) {
			if (verbose)
				console.debug(
					`[gjsify] --shebang skipped: ${outfile} already starts with a shebang`,
				);
		} else {
			await writeFile(outfile, GJS_SHEBANG + content);
		}
		await chmod(outfile, 0o755);
		if (verbose)
			console.debug(
				`[gjsify] --shebang: wrote shebang + chmod 0o755 to ${outfile}`,
			);
	}

	/** Application mode */
	async buildApp(app: App = "gjs") {
		const {
			verbose,
			esbuild,
			typescript,
			exclude,
			library: pgk,
			aliases,
			excludeGlobals,
		} = this.configData;

		const format: "esm" | "cjs" =
			(esbuild?.format as "esm" | "cjs") ??
			(esbuild?.outfile?.endsWith(".cjs") ? "cjs" : "esm");

		// Set default outfile if no outdir is set
		if (
			esbuild &&
			!esbuild?.outfile &&
			!esbuild?.outdir &&
			(pgk?.main || pgk?.module)
		) {
			const candidate =
				esbuild?.format === "cjs"
					? pgk.main || pgk.module
					: pgk.module || pgk.main;
			if (candidate && isUnsafeDefaultOutput(candidate)) {
				// `package.json#main`/`module` commonly points at a TypeScript
				// source (e.g. `src/index.ts` for TS-direct workflows). Falling
				// back to that value would have esbuild OVERWRITE the source.
				// Surface a clear error and require an explicit outfile/outdir
				// instead of silently destroying the user's code.
				throw new Error(
					`gjsify build: refusing to default --outfile to ${candidate} ` +
					`(would overwrite a TypeScript source file). Pass --outfile/--outdir ` +
					`explicitly, or set "gjsify.esbuild.outfile" in package.json.`,
				);
			}
			esbuild.outfile = candidate;
		}

		const { consoleShim, globals } = this.configData;

		const pluginOpts = {
			debug: verbose,
			app,
			format,
			exclude,
			reflection: typescript?.reflection,
			consoleShim,
			...(aliases ? { aliases } : {}),
		};

		const { autoMode, extras } = this.parseGlobalsValue(globals);

		const pnpPlugin = await buildPnpPlugin();
		const pnpPlugins: Plugin[] = pnpPlugin ? [pnpPlugin] : [];

		// --- Auto mode (with optional extras): iterative multi-pass build ---
		// The extras token is used for cases where the detector cannot
		// statically see a global (e.g. Excalibur indirects globalThis via
		// BrowserComponent.nativeComponent). Common pattern: --globals auto,dom
		if (app === "gjs" && autoMode) {
			const { injectPath } = await detectAutoGlobals(
				{
					...this.getEsBuildDefaults(),
					...esbuild,
					format,
					plugins: pnpPlugins,
				},
				pluginOpts,
				verbose,
				{ extraGlobalsList: extras, excludeGlobals },
			);

			const result = await build({
				...this.getEsBuildDefaults(),
				...esbuild,
				format,
				plugins: [
					...pnpPlugins,
					gjsifyPlugin({
						...pluginOpts,
						autoGlobalsInject: injectPath,
					}),
				],
			});

			if (app === "gjs" && this.configData.shebang) {
				await this.applyShebang(esbuild?.outfile, verbose);
			}

			return [result];
		}

		// --- Explicit list (no `auto` token) or none mode ---
		const autoGlobalsInject = extras
			? await this.resolveGlobalsInject(app, extras, verbose)
			: undefined;

		const result = await build({
			...this.getEsBuildDefaults(),
			...esbuild,
			format,
			plugins: [
				...pnpPlugins,
				gjsifyPlugin({
					...pluginOpts,
					autoGlobalsInject,
				}),
			],
		});

		if (app === "gjs" && this.configData.shebang) {
			await this.applyShebang(esbuild?.outfile, verbose);
		}

		return [result];
	}

	async start(buildType: { library?: boolean; app?: App } = { app: "gjs" }) {
		const results: BuildResult[] = [];
		if (buildType.library) {
			results.push(...(await this.buildLibrary()));
		} else {
			results.push(...(await this.buildApp(buildType.app)));
		}

		return results;
	}
}
