# `@gjsify/timers` handles: `unref()` per runtime

Detail moved out of `packages/node/AGENTS.md` (agent context budget, see
[governance.md](governance.md) § Agent context budget).

Handles carry the FULL `NodeJS.Timeout` surface (`ref`/`unref`/`hasRef`/`refresh`/`close`/
`_onTimeout`/`[Symbol.toPrimitive]`/`[Symbol.dispose]`), so consumers call `.unref()` without the
`as unknown as {unref?}` cast they needed before. `clear*` duck-types the handle so a duplicated
module still cancels.

**`unref()` is honest per-runtime**: delegated to libuv on Node; on GJS RECORDED only — `hasRef()`
reports it and the timer keeps firing, because the app owns the main loop and `g_source_unref`
(the only release) destroys the source.

**Incident behind the probe.** Delegation is gated on a POSITIVE probe (`hasRef` + `refresh`,
absent from `GLib.Source`). A native GJS handle has `ref`/`unref` and NO `$gtype` (measured gjs
1.88.1), so a "not a GSource" test lets it through and `.unref()` kills the process with
`g_source_unref_internal: assertion 'old_ref > 0' failed`.
