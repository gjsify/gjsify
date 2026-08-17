// `<file>` → WHY a raw async `spawn` from `node:child_process` is correct there,
// instead of `spawnToCompletion` from `packages/infra/cli/src/utils/spawn.ts`.
//
// The helper owns the GJS teardown contract: an async spawn arms a GLib main loop
// that only `process.exit()` tears down, so a command that spawns and then RETURNS
// parks forever. `SpawnToCompletionOptions.completion` is required precisely so a new
// call site states which side of that table it is on — and one import bypasses the
// whole thing, which is how `gjsify pack` came to park for 5m30s after finishing its
// work, the production `gjsify run publish:app` chain included (#1010, #1012).
//
// Hence a ledger of stated reasons rather than a ban. Same shape as
// `POSIX_PATH_SLICE_EXCEPTIONS` and `E2E_UNLISTED_SUITES`, with the same self-retiring
// halves: an entry whose file no longer imports async `spawn` FAILS, so the ledger
// cannot outlive its cause.
//
// EVERY entry today is one kind: a spec file in a package with no GJS test leg, so the
// GJS rows of the table cannot apply to it at all. `check-spawn-teardown-contract.mjs`
// enforces exactly that precondition — it re-reads the owning `package.json` and fails
// the day a `test:gjs` appears. A DIFFERENT kind of exception is therefore not a new
// ledger line; it is a deliberate widening of the check, which is the point. In
// particular a command that supervises a long-lived child does NOT belong here:
// `completion: 'daemon'` is the table's third row and `onSpawn` hands back the live
// handle, which is what `gjsify storybook --watch` uses.
//
// The reason must say why the GJS side of the contract cannot apply. "It works today"
// is not a reason — a parked process works too, right up until someone waits for it.

/** @type {Record<string, string>} */
export const SPAWN_TEARDOWN_EXCEPTIONS = {
    'packages/infra/cli/src/affected-classifier.spec.ts':
        'A SPEC in @gjsify/cli, which ships no `test:gjs` and no `build:test:gjs` — it is ' +
        'built `--app node` and run on node/bun/deno, so only the Node row of the table ' +
        'applies and there is no armed GJS loop to tear down. The spawns run the classifier ' +
        'as a real child because what is asserted is its OUTPUT CONTRACT across the process ' +
        'boundary, including the shell word-splitting a same-process call would not exercise.',
    'packages/infra/cli/src/run-stdio-safe.spec.ts':
        'A SPEC in @gjsify/cli, Node-only for the same reason as the classifier spec above. ' +
        'Here the process boundary IS the subject: the assertion is that the child keeps ' +
        'stdout and stderr SEPARATE, which cannot be observed without spawning and reading ' +
        'both pipes.',
};
