// The watch → rebuild → relaunch loop, shared by `gjsify storybook --watch` and
// `gjsify dev`.
//
// It lives here rather than in either command because it is the whole Node-free
// inner development cycle and `gjsify build --watch` cannot be it: rolldown's
// watcher API is npm-engine-only (`bundler-pick.ts` refuses under
// `@gjsify/rolldown-native`), so the one path that watches is the one running on
// the host that does not need it. This loop asks the bundler for no watcher at
// all — `fs.watch` reports the change and the rebuild is an in-process re-entry
// of the ordinary build command, which is runtime-agnostic.

import type { ChildProcess } from 'node:child_process';
import { watch } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { holdMainLoop } from '@gjsify/utils/main-loop';
import { markDaemonCommand } from './daemon-command.js';
import { spawnToCompletion } from './spawn.js';
import { type ExampleRuntime, RUNTIMES } from './runtimes.js';

/**
 * Start a child the caller SUPERVISES rather than waits for.
 *
 * `completion: 'daemon'` is the third row of the teardown table: a watch loop
 * neither exits nor unwinds, so the armed GJS main loop is not a leak here —
 * it is what keeps the session alive. The handle arrives synchronously through
 * `onSpawn`; the completion promise is deliberately never awaited (it settles
 * when the child is killed for the next rebuild), only its REJECTION is routed
 * out, so a missing interpreter still surfaces as a rebuild failure.
 */
export function spawnSupervised(cmd: string, cmdArgs: string[], env?: NodeJS.ProcessEnv): Promise<ChildProcess> {
    return new Promise<ChildProcess>((resolveChild, reject) => {
        void spawnToCompletion(cmd, cmdArgs, { completion: 'daemon', env, onSpawn: resolveChild }).catch(reject);
    });
}

/**
 * Launch a built bundle as a supervised child on `runtime`, wired the way
 * `gjsify run` would launch it for real: `gjs -m` for the `--app gjs` bundle,
 * the `--app node` bundle on node/bun/deno, and in BOTH cases the native
 * typelib/library environment for any `@gjsify` native package the bundle
 * reaches. The env is not optional on the gjs arm either — a watch loop that
 * skipped it would run an app that `gjsify run` can start and this cannot.
 *
 * `subject` names what is being run in the node-gi diagnostic ("the storybook",
 * "this project").
 */
export async function spawnBundleSupervised(
    runtime: ExampleRuntime,
    bundlePath: string,
    cwd: string,
    subject: string,
): Promise<ChildProcess> {
    if (runtime !== 'gjs') {
        // Only a bundle that actually reaches gi:// needs the reverse bridge;
        // the bundler keeps `@gjsify/node-gi` external, so its presence in the
        // output is the question. A plain Node app must run without it.
        const { bundleRequiresNodeGi, resolveNodeGiForBundle } = await import('./run-node.js');
        // Same resolution base as `runRuntimeBundle`: the bundle's own dir first
        // (that is where the runtime resolves the external specifier from), cwd
        // as the fallback.
        if (bundleRequiresNodeGi(bundlePath) && !resolveNodeGiForBundle(bundlePath, cwd)) {
            throw new Error(
                `Cannot run ${subject} on ${runtime}: \`@gjsify/node-gi\` is not installed. ` +
                    `Add @gjsify/node-gi as a dependency to run ${subject} on ${runtime}.`,
            );
        }
    }

    const { computeNativeEnvForBundle } = await import('./run-gjs.js');
    const { env: nativeEnv } = computeNativeEnvForBundle(bundlePath, cwd);
    const env = { ...process.env, ...nativeEnv };

    if (runtime === 'gjs') {
        return spawnSupervised('gjs', ['-m', bundlePath], env);
    }
    // `node` uses the resolved node binary (under a GJS-hosted CLI
    // `process.execPath` is gjs); bun/deno launch via the shared spec (deno's
    // `--node-modules-dir=manual`, etc.).
    if (runtime === 'node') {
        const { nodeBinary } = await import('./run-node.js');
        return spawnSupervised(nodeBinary(), [bundlePath], env);
    }
    const [cmd, launchArgs] = RUNTIMES[runtime].launch(bundlePath);
    return spawnSupervised(cmd, launchArgs, env);
}

export interface WatchLoopOptions {
    /** Directory watched recursively. */
    dir: string;
    /** How `dir` is spelled in the loop's own log lines. Defaults to `dir`. */
    dirLabel?: string;
    /** Prefix for the loop's log lines: `[<label>] …`. */
    label: string;
    /** Regenerate derived inputs before each build (e.g. a generated entry). */
    prepare?: () => void | Promise<void>;
    /** Build the bundle. Runtime-agnostic — an in-process re-entry of `build`. */
    build: () => Promise<void>;
    /** Launch the freshly built bundle, or `null` to rebuild without launching. */
    spawnChild: (() => Promise<ChildProcess>) | null;
    /**
     * Absolute path the build WRITES, when one is known. Changes to it never
     * trigger a rebuild — see {@link isSelfWrite} for why the loop otherwise
     * feeds itself.
     */
    output?: string;
    /** Quiet window after a change before rebuilding. */
    debounceMs?: number;
}

/**
 * Whether a watcher event is the loop's OWN output rather than a source edit.
 *
 * Without this the loop feeds itself whenever the bundle lands inside the
 * watched tree, which is the DEFAULT arrangement rather than an exotic one: the
 * watch dir defaults to the entry point's directory, so `gjsify dev index.ts` on
 * a project building to `dist/` watches the project root and every build it runs
 * is a change under it. Measured before this filter: one edit to `index.ts`
 * started a rebuild every ~5 s that never stopped.
 *
 * Two shapes, because a build writes more than the file it is named after:
 *
 *  - the bundle itself and anything sharing its stem (`out.mjs.map`), which the
 *    bundler writes beside it in the same pass;
 *  - the whole output DIRECTORY — but only when it is not the watched directory
 *    itself. `--outfile dist/out.mjs` under a watch dir of `.` puts chunks and
 *    assets there too; an `--outfile` written straight into the watched dir has
 *    no directory to exclude that would not also exclude the sources.
 *
 * `filename` is what `fs.watch` reports, relative to `dir` — `null` on the
 * platforms that cannot name the changed path, where the honest answer is "no
 * idea", i.e. rebuild.
 */
export function isSelfWrite(dir: string, output: string | undefined, filename: string | null): boolean {
    if (output === undefined || filename === null) return false;
    const changed = resolve(dir, filename);
    if (changed === output || changed.startsWith(`${output}.`)) return true;
    const outDir = dirname(output);
    if (outDir === resolve(dir)) return false;
    return changed === outDir || changed.startsWith(`${outDir}${sep}`);
}

/**
 * Run the loop: build + launch once, then rebuild + relaunch on every change
 * under `dir`. Returns once the watcher is armed; the process is then held open
 * — by the watcher handle on Node, by the GLib main loop on GJS — so there is
 * nothing left to await. That the RESOLUTION is not completion is the one thing
 * a caller has to know, which is why it is also declared through
 * `markDaemonCommand()` for the callers that cannot see this signature.
 *
 * A build failure is reported and the loop KEEPS WATCHING: the next save is the
 * fix, and a dev loop that dies on a syntax error is a dev loop nobody uses.
 */
export async function runWatchLoop(opts: WatchLoopOptions): Promise<void> {
    const { dir, label, prepare, build, spawnChild, output, debounceMs = 200 } = opts;
    // Say so BEFORE the first build: `gjsify run`'s in-process dispatch acts on
    // this the moment the handler resolves, and a first build that throws still
    // leaves the loop watching.
    markDaemonCommand();
    let child: ChildProcess | null = null;
    let rebuilding = false;
    let pending = false;

    const rebuild = async (): Promise<void> => {
        if (rebuilding) {
            pending = true;
            return;
        }
        rebuilding = true;
        try {
            if (prepare) await prepare();
            if (child) {
                child.kill();
                child = null;
            }
            await build();
            if (spawnChild) {
                child = await spawnChild();
            }
        } catch (err) {
            console.error(`[${label}] rebuild failed: ${(err as Error).message}`);
        } finally {
            rebuilding = false;
            if (pending) {
                pending = false;
                void rebuild();
            }
        }
    };

    await rebuild();

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const watcher = watch(dir, { recursive: true }, (_event, filename) => {
        if (isSelfWrite(dir, output, typeof filename === 'string' ? filename : null)) return;
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => void rebuild(), debounceMs);
    });

    // Under GJS nothing else keeps us here. An `fs.watch` handle is a Gio file
    // monitor, not a Node handle count, and the supervised spawn's own
    // `ensureMainLoop()` declines to arm anything: it is reached from a
    // continuation that GJS resumed from inside the main-context spin it runs
    // while our entry module's top-level await is pending, where
    // `GLib.main_depth()` is 1. So the loop used to print "watching …" and exit
    // 0 on the very host `gjsify dev` exists for, leaving the app orphaned.
    // `holdMainLoop()` is the opt-in that arms it anyway; `shutdown()` below is
    // what takes it back down.
    holdMainLoop();

    // Ctrl+C is how this command ENDS, so the supervised child has to be taken
    // down with it: the loop spawns the app in the CLI's own process group, and
    // a SIGINT delivered to the CLI alone leaves a live GTK window behind with
    // nothing watching it. Registering a handler also removes Node's default
    // terminate, so the exit has to be explicit — and under GJS it is required
    // anyway, since the loop held above is what is keeping us alive. Delivery
    // there is `@gjsify/process` arming a `GLibUnix.signal_add()` source on the
    // first listener, which dispatches on that same held loop; before it existed
    // these two lines registered listeners nothing ever emitted.
    let stopping = false;
    const shutdown = (): void => {
        if (stopping) return;
        stopping = true;
        if (debounce) clearTimeout(debounce);
        child?.kill();
        watcher.close();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    console.log(`[${label}] watching ${opts.dirLabel ?? dir} — press Ctrl+C to stop`);
}
