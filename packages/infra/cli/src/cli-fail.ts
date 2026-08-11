// The one place that decides whether a CLI failure is a USAGE error (help is the
// right output) or a RUNTIME error (help buries the answer).
//
// A missing native engine must not leave through the usage path: `gjsify build`
// under GJS without `@gjsify/rolldown-native` printed an actionable diagnosis
// naming the package and the install command, and then ~60 lines of yargs help on
// top of it, so the CI log read as "bad arguments" (#1005).
//
// Four yargs behaviours shape this module, measured against the pinned yargs 18
// (`@types/yargs` is still 17, so the types understate `fail`):
//
//  1. `.fail()` IS reached for an async handler rejection, because `cli-app.ts`
//     calls `parseAsync()` with no callback. No try/catch around it is needed.
//  2. `msg` is the discriminator, NOT `err`: every usage/validation/parse site
//     passes a string, and only the handler rejection passes `null`. Branching on
//     `err` would suppress help for genuine parser errors — exactly backwards.
//  3. Registering a handler removes yargs' own `showHelp` + `exit(1)`, so the
//     usage branch must terminate itself. `throw` rather than relying on
//     `showHelp()` setting `hasOutput`, which only holds while the chain is
//     synchronous and would break under a future async builder or middleware.
//  4. Never re-throw the incoming `YError` — yargs routes that class back into
//     `usage.fail()` and prints help twice. Throw a plain `Error` with `cause`.
//
// The runtime branch prints and exits NOTHING on purpose: the rejection
// propagates out of `parseAsync()` and `index.ts` is the single printer (it owns
// `GJSIFY_DEBUG` stacks and the GJS-side `gjsExit(1)`). Suppressing yargs'
// help-and-exit is this branch's whole job — it only looks like a no-op.

/** What kind of failure yargs is reporting, and the message when it has one. */
export type CliFailure =
    /** A usage/validation/parse error: the caller's argv was wrong, so help helps. */
    | { kind: 'usage'; message: string }
    /** A command handler threw or rejected: help is noise, `index.ts` prints it. */
    | { kind: 'runtime' };

/**
 * Classify a yargs `fail(msg, err)` callback into the two cases that need
 * different output. Kept pure so the rule is testable without driving a process
 * to its death; `cli-fail.spec.ts` pins the yargs-side half against a real
 * instance, so a yargs upgrade that reroutes `fail` fails a test instead of
 * silently turning every runtime error back into a help dump.
 */
export function classifyCliFailure(msg: string | null | undefined, _err: unknown): CliFailure {
    // An empty string counts as "no message", not as an empty usage error: it has
    // nothing to print, and help with no reason is the worst of both.
    if (typeof msg === 'string' && msg.length > 0) return { kind: 'usage', message: msg };
    return { kind: 'runtime' };
}
