<!--
THE PROSE PREAMBLE FOR THE NEXT RELEASE.

`scripts/check-changelog-references.mjs --release-notes <version>` publishes this
file ABOVE the generated changelog section in the GitHub release body. Write here
in the PR that lands the change, while you still remember why it mattered — the
generated section already says what changed.

  · Prose is OPTIONAL. No prose costs a warning in the cut's job summary and
    nothing else; the body is then the changelog section alone.
  · It counts only if git says this file changed since the last tag, so the
    previous release's text can never reappear under a new version. There is no
    version to write down and nothing to reset by hand: after a release this file
    is stale by definition, and the next prose is simply the next edit.
    So REPLACE what you find here, do not append to it — right after a release
    this file still holds the text that shipped with it, and the tag is where
    that copy lives (`git show v0.28.0:docs/release-notes/next.md`).
  · It goes through the same broken-reference detector as CHANGELOG.md, so a
    fabricated issue or repository link fails the cut. Write `#123` for a real
    issue in this repo; put anything `#`-shaped that is NOT a reference in
    backticks (`PKCS#7`), and the same for npm scopes and at-rules (`@girs`,
    `@font-face`) so they are not read as GitHub accounts.
  · No `## [x.y.z]` heading — the preamble sits above the section, not beside it.

Everything below the last comment is published verbatim. Delete this comment or
leave it; comments are stripped either way, and a file holding only comments
counts as no prose.

A worked example is the v0.28.0 release body:
https://github.com/gjsify/gjsify/releases/tag/v0.28.0
-->

## What this release is about

Three separate bugs here share one shape: **the work finished, and then the last step
failed silently — while something in the toolchain already knew.** The installer printed
`Missing required system dependencies: ✗ GJS` and then wrote a launcher that runs `gjs`.
`gjsify pack` wrote your tarball, printed its complete JSON, and then never exited. A
prebuild's typelib loaded and its class resolved, and construction died with a message that
named nothing.

None of the three is exotic. Each was reachable by following the documented path on a normal
machine, and each had gone unnoticed because the failure did not look like its cause.

**If you use `@gjsify/cli` on macOS or Windows, upgrade** — the shim the installer wrote for
you never worked there. **If you publish with `gjsify pack` or `gjsify publish`**, this is the
release where that stops hanging.

---

### The installed `gjsify` command did not run on macOS or Windows

`node_modules/.bin/gjsify` was written as `exec gjs -m <bundle>`, unconditionally. On a host
with no `gjs` — macOS and Windows, the two platforms this project has been porting to — that
is `exec: gjs: not found` and exit 127, while a working Node entry sat beside it in the same
package. The CLI itself was fine through `npx`; only the shim the install *wrote* was dead.
It had been red on both platforms for three consecutive releases (#1001).

The launcher now decides **per invocation**: use `gjs` when it is on `PATH`, otherwise Node.
`gjs` still wins where both exist, so nothing changes on a Linux/GNOME machine.

Deliberately not an install-time probe of what the host has. That would be a snapshot —
install without `gjs`, install it a week later, and the shim would still point at Node
forever. This project already paid for that once, in v0.24.1, from the other direction.

### `gjsify pack` never returned on a package with a lifecycle script

If your `package.json` declares `prepack` (or `prepare`, or `prepublishOnly`), `gjsify pack`
under GJS did all of its work — tarball written, `--json` printed in full — and then parked
at 0% CPU. Measured: five and a half minutes of wall clock for one second of CPU, until
something killed it. The same package with no lifecycle script exited in under a second, and
the same pack under Node took 0.68s (#1010).

This sits in the publish path, so it was not only a problem for scripts calling `gjsify pack`
— publishing a package with a `prepack` would hang the same way.

The cause is worth stating because it is counter-intuitive. Running a lifecycle script means
spawning a child process, and under GJS that starts a GLib main loop which only
`process.exit()` tears down. The helper that runs lifecycle scripts avoids calling
`process.exit()` on purpose — pack has to keep working afterwards — and a comment at the top
of that file claimed this also avoided the main loop. It was the opposite: **not exiting is
exactly what left the loop running.**

### `gjsify build` could fail with a message that named nothing

On a host without `json-glib`, `gjsify build` died with:

```
Error: Unsupported type void, deriving from fundamental void
```

The real cause: `@gjsify/rolldown-native`, the GJS bundler engine, links `json-glib`, and
without it the library cannot be opened. Meanwhile `gjsify install` reported
`System dependencies OK.` on that same machine, because `json-glib` appeared in neither of
its dependency tables.

Every committed Linux prebuild was then measured with `ldd` on a consumer-baseline container.
Three libraries did not resolve and are now declared and checked, with install hints for six
package managers: `json-glib` (`@gjsify/rolldown-native`), `libepoxy` (`@gjsify/webgl`) and
`gst-webrtc` (`@gjsify/webrtc-native`). The check also gained a test holding its two tables
against each other, since the way `json-glib` went missing was that nothing required them to
agree.

### Two checks moved to where they can still stop a mistake

The base image of the prebuild workflow decides which glibc version the published binaries
require — so bumping that image silently rewrites a compatibility promise for every consumer
without touching a line of source. Not hypothetical: a routine image bump moved the floor from
glibc 2.39 to 2.43 and turned `main` red three times in a row (#924). A check existed and
caught it correctly, but ran only *after* merge, so the pull request that caused it was green
(#1004).

That measurement now runs inside the build jobs themselves, against the binaries the job just
produced rather than the ones already committed. It executed on every architecture in its own
first run, measuring 8–10 targets per job.

Separately, the install script the documentation points at used to 404 for over two hours
after every release, because the asset was attached later than the page advertising it. The
release now uploads it before anything announces it, and asserts that the documented URLs
return 200.

### Also in this release

- **`@gjsify/oxlint-plugin-gjsify`**: a `TODO` / `FIXME` / `HACK` comment must now name what it
  is waiting for — an issue, a URL, or the open-work ledger. A deferral marker with no owner
  has no retirement date, so this is an error rather than a convention.
- **ADR 0019** records why `ts-for-gir` is becoming usable as a library, and why `.gir` files
  travel with the runtime packages instead of the type packages. It also writes down a rejected
  option and what it cost, so it does not get proposed again.
- The agent-facing documentation was split into per-subtree files, so a contributor reads the
  rules for the part of the tree they are touching rather than all of them at once.

### Known and open

- A `gjsify install --immutable` (the CI shape) still cannot acquire the GJS bundler engine,
  because the lockfile a frozen install consumes does not name it. It now says so, and names the
  durable fix: declare `@gjsify/rolldown-native` so the lockfile carries it. A normal project
  install lays it down by itself (#1005, and ADR 0020 for the shape that would retire the policy).
- Nothing yet stops a new call site inside the CLI from bypassing the spawn/teardown contract
  the `pack` hang came from. The contract is documented and the fix is in; the guard that would
  make a future bypass visible is not (#1012).
