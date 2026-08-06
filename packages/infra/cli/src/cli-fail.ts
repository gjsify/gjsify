// How the CLI ends when something goes wrong — the one place that decides
// whether a failure is a USAGE error (help is the right output) or a RUNTIME
// error (help is noise that buries the answer).
//
// The defect this exists for, measured from outside the repo: `gjsify build`
// under GJS without `@gjsify/rolldown-native` prints a CORRECT and actionable
// diagnosis — `diagnoseNativeEngine()` names the package and the exact install
// command — and then yargs prints ~60 lines of `gjsify build` help on top of it
// and exits 1. In a CI log the actionable line scrolls out of view and the
// visible artifact is a help dump, which reads as "bad arguments". That is what
// ts-for-gir's `test-e2e` leg looked like (#1005). A missing engine is not a
// usage error and must not leave through the usage path.
//
// Four things about yargs make this module's shape non-obvious. All four were
// measured against the pinned `yargs@18.0.0` (note `@types/yargs` is still 17,
// one major behind, so the types lie in one place — see below):
//
//  1. `.fail()` IS reached for an async handler rejection. `command.js:253-260`
//     does `if (isPromise(innerArgv) && !hasParseCallback()) innerArgv.catch(e =>
//     usage.fail(null, e))`, and `hasParseCallback()` is false because
//     `cli-app.ts` calls `parseAsync()` with no function argument. So no
//     try/catch around `parseAsync` is needed to see handler errors here.
//
//  2. THE DISCRIMINATOR IS `msg`, NOT `err`. Every usage/validation/parse
//     failure passes a STRING: all ten `validation.js` sites call
//     `usage.fail(msg)`, `command.js:370` calls `fail(parsed.error.message,
//     parsed.error)`, and `yargs-factory.js:188/192/1473` call `fail(msg, err)`.
//     Only `command.js:257` — the handler rejection — passes `null`. Branching on
//     `err` instead would suppress help for genuine parser errors, which is
//     exactly backwards.
//
//  3. REGISTERING A HANDLER REMOVES YARGS' OWN EXIT. With no `.fail()` yargs does
//     `showHelp('error')` + `logger.error(msg || err)` + `exit(1)` itself
//     (`usage.js:27-70`). With one, it does none of that — so the usage branch has
//     to terminate on its own. `showHelp()` happens to set `hasOutput`
//     (`yargs-factory.js:834`), which blocks the handler while the chain is still
//     synchronous, but that is a side effect, not a guarantee: `throw` is what
//     survives a future async builder or middleware.
//
//  4. NEVER RE-THROW THE INCOMING `YError`. `yargs-factory.js:1471-1475` routes
//     that class back into `usage.fail()`, so re-throwing it prints the help a
//     second time. The usage branch throws a plain `Error` with the original
//     attached as `cause`.
//
// The runtime branch deliberately prints NOTHING and exits NOTHING: the rejection
// propagates out of `parseAsync()` on its own, and `index.ts` is the single
// printer (it also handles `GJSIFY_DEBUG` stacks and the GJS-side `gjsExit(1)`,
// which a second printer here would duplicate). Suppressing yargs'
// help-and-exit IS this branch's whole job — it only looks like a no-op.

/** What kind of failure yargs is reporting, and the message when it has one. */
export type CliFailure =
    /** A usage/validation/parse error: the caller's argv was wrong, so help helps. */
    | { kind: 'usage'; message: string }
    /** A command handler threw or rejected: help is noise, `index.ts` prints it. */
    | { kind: 'runtime' };

/**
 * Classify a yargs `fail(msg, err)` callback into the two cases that need
 * different output.
 *
 * Pure on purpose — the whole point is that the rule is testable without
 * driving a process to its death. `cli-fail.spec.ts` additionally pins the
 * yargs-side half (which call site passes `null`) against a real instance, so a
 * yargs upgrade that changes the routing fails a test instead of silently
 * turning every runtime error back into a help dump.
 */
export function classifyCliFailure(msg: string | null | undefined, _err: unknown): CliFailure {
    // A non-empty string means yargs itself diagnosed the argv. An empty string
    // is treated as "no message" rather than as an empty usage error: it carries
    // nothing to print, and printing help with no reason is the worst of both.
    if (typeof msg === 'string' && msg.length > 0) return { kind: 'usage', message: msg };
    return { kind: 'runtime' };
}
