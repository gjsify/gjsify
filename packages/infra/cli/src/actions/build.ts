import type { ConfigData } from "../types/index.js";
import type { App } from "@gjsify/esbuild-plugin-gjsify";
import { build, BuildOptions, BuildResult, Plugin } from "esbuild";
import { gjsifyPlugin } from "@gjsify/esbuild-plugin-gjsify";
import {
	resolveGlobalsList,
	writeRegisterInjectFile,
	detectAutoGlobals,
} from "@gjsify/esbuild-plugin-gjsify/globals";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const GJS_SHEBANG = "#!/usr/bin/env -S gjs -m\n";

/** Walk up from dir until .pnp.cjs is found; return its directory or null. */
function findPnpRoot(dir: string): string | null {
	let current = dir;
	while (true) {
		if (existsSync(join(current, ".pnp.cjs"))) return current;
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

/**
 * If the current project uses Yarn PnP, return the official
 * @yarnpkg/esbuild-plugin-pnp plugin so esbuild can resolve
 * modules from zip archives without manual extraction.
 *
 * Custom onResolve: when the project's PnP context throws
 * UNDECLARED_DEPENDENCY (package is a transitive dep but not listed in the
 * issuer's direct deps), retry the resolution from gjsify's own package
 * context via `pnpapi.resolveRequest()`. gjsify has @gjsify/node-polyfills
 * and @gjsify/web-polyfills as direct deps, so all injected globals packages
 * (e.g. @gjsify/node-globals) are accessible from there. For bare specifiers
 * that the gjsify alias plugin maps (e.g. `abort-controller`), fall through
 * to let that plugin handle the resolution.
 */
async function getPnpPlugin(): Promise<Plugin | null> {
	if (!findPnpRoot(process.cwd())) return null;
	try {
		const { pnpPlugin } = await import("@yarnpkg/esbuild-plugin-pnp");

		// gjsify's own file path — used as issuer for fallback PnP resolution.
		// @gjsify/cli has @gjsify/node-polyfills + @gjsify/web-polyfills as direct
		// deps, so all injected globals packages resolve from this context.
		const gjsifyIssuer = fileURLToPath(import.meta.url);

		// pnpapi is a virtual module injected by Yarn PnP at runtime.
		type PnpApi = {
			resolveRequest: (req: string, issuer: string) => string | null;
		};
		let pnpApi: PnpApi | null = null;
		try {
			// pnpapi has no npm package — it is a virtual module injected by Yarn PnP
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-expect-error
			pnpApi = (await import("pnpapi")) as PnpApi;
		} catch {
			// Not in a PnP runtime (shouldn't happen since findPnpRoot passed)
		}

		return pnpPlugin({
			onResolve: async (args, { resolvedPath, error, watchFiles }) => {
				if (resolvedPath !== null) {
					return { namespace: "pnp", path: resolvedPath, watchFiles };
				}
				if (
					(error as { pnpCode?: string } | null)?.pnpCode ===
					"UNDECLARED_DEPENDENCY"
				) {
					// Retry from gjsify's context — covers @gjsify/* inject paths.
					if (pnpApi !== null) {
						try {
							const rp = pnpApi.resolveRequest(args.path, gjsifyIssuer);
							if (rp !== null) {
								return { namespace: "pnp", path: rp, watchFiles };
							}
						} catch {
							// Falls through; bare aliases (abort-controller etc.) are
							// handled by the gjsify alias plugin after this returns null.
						}
					}
					return null;
				}
				return {
					external: true,
					errors: error ? [{ text: error.message }] : [],
					watchFiles,
				};
			},
		});
	} catch {
		return null;
	}
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

		const pnpPlugin = await getPnpPlugin();
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
			esbuild.outfile =
				esbuild?.format === "cjs"
					? pgk.main || pgk.module
					: pgk.module || pgk.main;
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

		const pnpPlugin = await getPnpPlugin();
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
