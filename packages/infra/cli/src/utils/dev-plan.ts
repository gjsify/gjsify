// What `gjsify dev` builds, launches and watches — resolved from the project's
// OWN declarations rather than from a second set of flags.
//
// Re-declaring `--globals auto,dom,PointerEvent,…` here, beside the `build:gjs`
// script that already says it, would be exactly the drifting second copy this
// repo keeps paying for: the day the build script gains a flag, the dev loop
// builds a different bundle than `gjsify run build` does, and the difference
// surfaces as a runtime error in the app rather than as a diff. So the plan is
// DERIVED from the script, with the CLI flags as overrides on top.
//
// Pure by design — no filesystem, no process — so precedence is unit-tested
// instead of inferred from a running watch loop.

import { dirname } from 'node:path';
import { gjsifyCommandArgv } from './simple-command.js';

export interface DevPlanRequest {
    /** The project's `package.json#scripts`. */
    scripts: Readonly<Record<string, string>>;
    /** Name of the build script to reuse, e.g. `build:gjs`. */
    scriptName: string;
    /** `gjsify build --app <app>` target the chosen runtime consumes. */
    app: 'gjs' | 'node';
    /** The bundle the package declares for `app` (`gjsify.main` / `gjsify.example.node`). */
    declaredBundle?: string;
    /** `gjsify dev [entry]` — overrides the entry point the script names. */
    entry?: string;
    /** `--globals` override. */
    globals?: string;
    /** `--outfile` override. */
    outfile?: string;
    /** `--watch-dir` override. */
    watchDir?: string;
}

export interface DevPlan {
    /** argv fed to `runCli` on every rebuild (starts with `build`). */
    buildArgv: string[];
    /**
     * Bundle launched after a successful build, or undefined when nothing names
     * one. See {@link noBundleError}.
     */
    bundle?: string;
    /** Directory watched recursively. */
    watchDir: string;
}

/** The value of `--name value` / `--name=value` in `argv`, if present. */
export function readFlag(argv: readonly string[], name: string): string | undefined {
    const long = `--${name}`;
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i]!;
        if (token === long) return argv[i + 1];
        if (token.startsWith(`${long}=`)) return token.slice(long.length + 1);
    }
    return undefined;
}

/** `argv` with `--name value` set — replacing any existing occurrence, else appended. */
export function withFlag(argv: readonly string[], name: string, value: string): string[] {
    const long = `--${name}`;
    const out = [...argv];
    for (let i = 0; i < out.length; i++) {
        const token = out[i]!;
        if (token === long) {
            out[i + 1] = value;
            return out;
        }
        if (token.startsWith(`${long}=`)) {
            out[i] = `${long}=${value}`;
            return out;
        }
    }
    out.push(long, value);
    return out;
}

/**
 * The entry point a `gjsify build` argv names positionally. Only the token
 * DIRECTLY after `build` counts: further positionals are indistinguishable from
 * the value of a preceding flag without knowing every flag's arity, and a wrong
 * guess here would silently build the wrong file.
 */
export function buildEntryPoint(argv: readonly string[]): string | undefined {
    const candidate = argv[1];
    if (candidate === undefined || candidate.startsWith('-')) return undefined;
    return candidate;
}

/** Message shown when neither a usable build script nor an explicit entry exists. */
function noEntryError(scriptName: string, hasScript: boolean): Error {
    const why = hasScript
        ? `\`${scriptName}\` is not a plain \`gjsify build <entry> …\` command, so its entry point cannot be read`
        : `this package declares no \`${scriptName}\` script`;
    return new Error(
        `gjsify dev: nothing to build — ${why}.\n` +
            `  Name the entry point directly:   gjsify dev src/index.ts\n` +
            `  or point at another script:      gjsify dev --script <name>`,
    );
}

/**
 * Resolve the build argv, the bundle to launch and the directory to watch.
 * Throws with both fixes named when the project declares neither.
 */
export function planDev(req: DevPlanRequest): DevPlan {
    const literal = req.scripts[req.scriptName];
    const scriptArgv = typeof literal === 'string' ? gjsifyCommandArgv(literal) : null;
    const derived = scriptArgv && scriptArgv[0] === 'build' ? scriptArgv : null;

    const entry = req.entry ?? (derived ? buildEntryPoint(derived) : undefined);
    if (entry === undefined) throw noEntryError(req.scriptName, typeof literal === 'string');

    // Start from the script's own argv so every flag it declares survives, then
    // put the overrides on top. `--app` is SET rather than inherited: `--script`
    // and `--runtime` can name different targets, and the runtime that will
    // launch the bundle is the one that must decide what is built.
    let argv: string[];
    if (derived) {
        argv = [...derived];
        // Replace the entry the script names, or splice one in when it names
        // none (the script may take its entry from `gjsify.bundler.input`).
        if (buildEntryPoint(derived) !== undefined) argv[1] = entry;
        else argv.splice(1, 0, entry);
    } else {
        argv = ['build', entry];
    }
    argv = withFlag(argv, 'app', req.app);
    if (req.globals !== undefined) argv = withFlag(argv, 'globals', req.globals);
    if (req.outfile !== undefined) argv = withFlag(argv, 'outfile', req.outfile);

    return {
        buildArgv: argv,
        bundle: readFlag(argv, 'outfile') ?? req.declaredBundle,
        watchDir: req.watchDir ?? dirname(entry),
    };
}

/**
 * Message for a launch that has no bundle to launch. Separate from `planDev`
 * because only the LAUNCHING caller needs one: a build writing an `--outdir`
 * legitimately has no single output file, and refusing inside the planner would
 * fail `--build-only` for a reason that does not apply to it.
 */
export function noBundleError(scriptName: string, app: 'gjs' | 'node'): Error {
    const declaration = app === 'gjs' ? '`gjsify.main`' : '`gjsify.example.node`';
    return new Error(
        `gjsify dev: nothing to launch — neither \`${scriptName}\` nor --outfile names an output file, ` +
            `and this package declares no ${declaration}.\n` +
            `  Pass one:   gjsify dev --outfile dist/index.${app}.mjs\n` +
            `  or rebuild without launching:   gjsify dev --build-only`,
    );
}
