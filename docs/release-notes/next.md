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

**Six things in this release reported success while doing nothing, and each was found the
same way: by running it instead of reading it.** A test suite that executed seventeen failing
tests and exited 0. A `getUserMedia` that handed back a track carrying no data. Fonts staged
beside an application that nothing registered. A getting-started page that was correct about
the package and wrong about what you type.

---

### Your test suite reports its own failures now

`@gjsify/unit`'s `run()` owns the process exit code. An entry that awaits its specs directly
runs all of them and then exits 0 — so a failing suite is green, forever, and nobody looks
again. `@gjsify/webrtc` had that shape and had been hiding **seventeen real failures**.

A gate now refuses any test entry that does not reach `run()`. It reads the entry set from the
`gjsify build … --app <target>` calls in each package's own scripts, so it sees what actually
builds, including entries a directory below the conventional place. Delegation is not a
blanket pass: an entry that re-exports another module counts only if that module reaches
`run()` itself.

If you have written your own suites against `@gjsify/unit`, this is worth checking in your
project too — the failure mode leaves no trace.

### `getUserMedia` now picks a source that opens

gjsify chose the first GStreamer source element it could **construct**. A constructible
element is not an openable device, and the two come apart on any machine without a running
audio daemon — a container, a headless server, a sandboxed application without audio access.
There, `pulsesrc` exists because the plugin package ships it, gjsify took it, and the working
fallback below it was never reached. The track you got produced nothing, silently, and the
error surfaced seconds later somewhere else entirely.

Candidates are opened for real before one is chosen, and the verdict is cached per process, so
the cost is paid once rather than per call. On a desktop you still get your microphone; in a
container you now get a working synthetic source instead of a dead track.

**Known limitation, unchanged and now written down:** sending an *empty string* over a data
channel kills the channel on GStreamer 1.28.5 — upstream builds a zero-length buffer where
SCTP requires one zero byte. It does not fail at the call site. `send('')` returns normally,
`readyState` is still `open` on the next line, the message you sent before it still arrives,
and the channel dies about a second later. That is why the symptom never points at the cause.

### Fonts you ship are registered, if you ask

`gjsify.ship.fonts` staged your typeface and the launcher exported `GJSIFY_FONT_DIR` — and
nothing read it. `initFonts()` in `@gjsify/gtk-host` does.

Call it before you build any UI, and treat that as a contract rather than advice: the font map
caches its fontset per description, and registration does not invalidate the cache. A layout
that already measured your family keeps measuring the substitute even though the family is now
listed. Measured, one layout either side of the call:

    before: listed=false measured=87x63
    initFonts: registered=1 declined=0 failed=0
    after:  listed=true  measured=87x63

Registration succeeded, the family is present, and the text is still the fallback.

macOS declines the call rather than failing it — CoreText does not support it, and a bundled
directory is already activated through `ATSApplicationFontsPath`, so nothing is lost. Windows
registers and additionally clears the map's cache. The guide states what to expect per
platform and gives you a check to run.

### One web-view API, three engines

`@gjsify/iframe` now has a backend on all three desktop systems: the distribution's WebKitGTK
on Linux, Apple's WebKit on macOS, and Microsoft's WebView2 on Windows — the last presented
under the same `WebKit-6.0` namespace, so your code carries no operating-system branch.

The Windows caveats are real and documented where you will meet them. The view is an overlay
child window and cannot be clipped, so a scrolling ancestor, an overlay's main child, a
popover or fractional opacity will not behave as you expect; gjsify warns rather than failing
quietly. User-script URL allow/block lists are refused, named script worlds ignored, and a
full-document snapshot returns the viewport. The WebView2 runtime is your installer's
obligation — and note that its registry key lives under `WOW6432Node`, so a 64-bit-only check
reports "not installed" on a machine that has it.

**Not yet proven:** the Windows view is demonstrated headlessly — it loads a page, runs
JavaScript against the DOM and takes a snapshot. Re-parented under a real application window
it has not been verified.

### Node-API corrections you may have been working around

`fs.exists` called its callback synchronously where Node defers it; a `catch` around that call
turned a throwing callback into a filesystem answer, entering the callback twice so an
existing file read as missing; and `util.promisify(fs.exists)` rejected where Node resolves,
because the custom symbol was absent.

`XMLHttpRequest` returned a blob for the *default* `responseType` — the empty string — so
`responseText` was empty unless you asked for text explicitly. Its WebIDL constants existed
only on instances, so `XMLHttpRequest.DONE` was `undefined`.

### The getting-started path works when you type it

It did not. `npm create @gjsify/app` without a version is served from npm's runner cache, and
that cached scaffold declares neither `build:node` nor `start:node` — which is the command the
page tells you to run next. The Deno path hit the same class through a dependency age floor.
The documentation was correct against the published package and wrong against what a person
types, which is a distinction only walking it can find.

Both paths are pinned now, and the walkthroughs were executed on GJS, on npm with Node 24 and
Node 20, on Bun and on Deno. The stated Node floor of 24 was also wrong: Node 20 works, and
nothing in the tree declared otherwise.

New guides cover shipping your own fonts, embedding web views, and WebRTC with media capture.
