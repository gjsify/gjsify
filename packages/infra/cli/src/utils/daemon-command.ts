// Whether the command currently running SETTLES.
//
// Almost every gjsify command finishes: its handler resolves and the caller acts
// on the result. A watch loop does not — `runWatchLoop` resolves as soon as the
// watcher is armed and the process then lives on the watcher (Node) or the held
// main loop (GJS) until Ctrl+C. To anything that merely awaits the handler the
// two are the same event, and one caller has to tell them apart: `gjsify run`'s
// in-process fast path dispatches a `gjsify <sub>` script through the same yargs
// surface and then `process.exit()`s on the result. For `gjsify run dev` that
// exit fired the instant the first build+launch was done, killing the loop the
// script had just asked for — and that IS the documented entry point (`gjsify
// create` prints `gjsify run dev`, and every template's `dev` script is a bare
// `gjsify dev`). Invisible on Node, where the same script takes the spawn path.
//
// A module-level flag rather than a return value because the answer has to cross
// `runCli`, whose contract is `Promise<void>` for every command; threading a
// "did not settle" result through yargs would change the shape of all of them to
// carry a fact about one.

let daemon = false;

/**
 * Declare that this command keeps running after its handler resolves, so a
 * caller must not treat that resolution as completion.
 */
export function markDaemonCommand(): void {
    daemon = true;
}

/** Whether a command dispatched in this process declared itself a daemon. */
export function isDaemonCommand(): boolean {
    return daemon;
}
