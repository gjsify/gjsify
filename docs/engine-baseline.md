# Engine baseline — what SM140 gives you

> Detail for the root [AGENTS.md](../AGENTS.md) § Constraints. A lookup table, so it lives
> here rather than in a file loaded on every turn.

Target: GJS 1.86.0 / SpiderMonkey 140 / Rolldown `firefox140`. SM128 (GJS 1.84) is no longer
supported; SM128-era polyfills still load as idempotent no-ops and are retired package by
package as the native SM140 path for each is validated.

Available beyond ES2024:

|Iterator helpers |`import … with { type: "json" }` |Temporal (preview) |Float16Array
|`Uint8Array.{from,to}{Base64,Hex}` |`RegExp.escape` |`Promise.try` |`JSON.rawJSON`
|`Intl.DurationFormat` |`Math.sumPrecise` |`Atomics.pause` |`Error.isError`
|native `Error.captureStackTrace`

Reaching for one of these is the point of the baseline: a polyfill kept alive past the
version that made it native is a second implementation nobody reads.
