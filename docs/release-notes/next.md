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

This release is where GJS stops being a place you can only run a web page. Four
things here are new capability rather than repair, and they are the reason to
read the notes rather than skim the changelog:

- **Gamepads on macOS and Windows.** `@gjsify/gamepad` gains an SDL3 backend
  behind a C shim, so the W3C Gamepad API works on the two desktops that had
  none. Linux gets the same shim alongside libmanette, plus a mode that runs
  both on the same controllers and reports every disagreement.
- **Browser extensions.** `gjsify webext` builds a WebExtension for Chrome,
  Edge, Firefox and Safari from one source — on GJS as well as on Node, with no
  Vite.
- **`gjsify exec`.** Run an installed npm binary on the runtime gjsify itself
  runs on, instead of the program failing to start.
- **TLS in both directions.** A GJS `https` client now completes a real
  handshake, and `https.createServer({ key, cert })` serves the certificate it
  was given instead of listening in plain text.

Underneath them, a long-lived `node:sqlite` connection stops wearing out, Ed25519
and X25519 land in `node:crypto` and WebCrypto, readline echoes what you type,
and `gjsify` learns to find a native addon at run time so a GJS bundle is no
longer pinned to the machine that built it.

## Upgrading

Every `@gjsify/*` package moves together (ADR 0008): compatibility is guaranteed
only within one release, so upgrade the whole set with `gjsify upgrade --latest
--filter @gjsify`, or repair drift with `gjsify upgrade --align`.

## Gamepads on macOS and Windows

0.52.0 shipped `@gjsify/gamepad` on libmanette 0.2, which is a Linux library, so
macOS and Windows had no gamepad backend at all: `navigator.getGamepads()`
answered the empty list and the package said so rather than pretending. They have
one now.

`@gjsify/gamepad-native` is a GObject shim over SDL3 — one C source, statically
linked and trimmed to the input subsystems, reached as `gi://GjsifyGamepad`
(through `@gjsify/node-gi` on Windows, which has no GJS). It ships as one package
per target: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64` and
`win32-x64`, installed automatically as an optional dependency, and found by
`gjsify run` through `GI_TYPELIB_PATH` (and on Windows through `PATH`). Rumble
goes through `GamepadHapticActuator` as before and additionally reports
`trigger-rumble` as its own capability. The design is ADR 0075.

**On Linux nothing changes by default.** libmanette stays the backend, because
the shim has not yet replaced it there. `GJSIFY_GAMEPAD_BACKEND=sdl` selects the
shim, and `=compare` runs both on the same controllers at once, pairing them by
USB vendor:product and reporting every connect, disconnect and control on which
the two disagree for more than one poll. That comparison is not a formality: on
an 8BitDo N30 Pro 2, measured for ADR 0075, libmanette reports no Home button and
no right-stick Y and fires the left trigger when the right stick is pushed down,
because its evdev backend matches a mapping's `aN` against the kernel axis CODE
rather than the N-th axis the device has. SDL is the correct one of the two. What
is still open is replacing libmanette outright, which waits for that comparison
against real controllers to be finished rather than started.

**What has not been verified yet, stated plainly:** input from a real controller
on macOS or Windows. No CI runner has a controller, so those runs are against
virtual pads — a uinput X360 pad on Linux, and on Windows a virtual pad through
ViGEmBus, which the driver refuses to plug in on a Windows **Server** runner
(`windows-2022`), so that leg announces itself as skipped there and SDL's own
virtual joystick carries the measurement on every OS instead.
`gjsify.os.darwin` and `gjsify.os.win32` stay `partial` until a person has held a
real pad on each. On a host with no prebuild, `getGamepads()` still answers the
conformant empty list and `hasGamepadBackend()` still reports false — a platform
gap, reported rather than hidden.

## `node:sqlite` is safe in a long-lived process now

Two defects made a long-running connection on GJS the wrong thing to rely on, and
both are fixed. If you run a daemon that keeps one `DatabaseSync` open — a mail
sync, an indexer, a queue worker — this is the release to move to.

**The connection wore out.** Every statement a connection executed left libgda
objects registered on it: a cached prepared statement per execution, a hidden
`SELECT` libgda ran after every `INSERT`, and the data model of every read until
the collector reached it. Each holds a weak reference to the SQLite provider, and
GLib allows 65,535 of those per object. A connection that crossed the cap logged
"Too many GWeakRef registered" and then answered reads wrongly without throwing —
a wrong answer, not a crash, which is the harder failure to notice. A mail sync
of roughly 5,000 messages was enough to get there, because each `run()` cost four
references. Each execution now releases what it created before it returns, so a
connection stays usable for as long as you keep it. A read libgda can no longer
type throws instead of returning rows.

**`EXISTS (SELECT …)` did not run at all.** libgda does not execute the SQL text
it is given: it parses it into a statement tree and the SQLite provider re-renders
that tree, so a statement can parse and still be rejected downstream on SQL Node
accepts. `SELECT EXISTS (SELECT 1 FROM t)` was exactly that — it rendered as
`SELECT EXISTS ((SELECT 1 FROM t))`, and the double parenthesis is a syntax error.
The predicate is now restated in a form libgda can carry, and `S` is copied byte
for byte, so every parameter, literal and identifier inside it keeps its position.
Nesting and a comment between the keyword and its parenthesis are handled, and
the word is left alone inside a string literal, a quoted identifier or a comment.

### Native addons stay external in `--app node` bundles

An addon finds its `.node` binary relative to its OWN files — `node-gyp-build`,
`bindings`, napi-rs' `./x.linux-x64-gnu.node`. Bundled, that path is the bundle's
directory and the lookup misses: `@signalapp/libsignal-client` threw "No native
build was found" from a bundle that ran fine as source, and `bufferutil` fails
SILENTLY, swapping the native build for the JS one.

Addon packages are now detected from their manifest and layout (`binding.gyp`, a
`gypfile`, a `binary` field, a loader dependency, napi-rs, a `.node` file under
`prebuilds/` or `build/`) and kept external, so Node loads them from `node_modules`
as it would without a bundler. Only `@gjsify/node-gi` is still named explicitly,
because the injected globals shim has to mark it external before any package is
resolved. An `--app node` bundle of a native dependency needs `node_modules` at
runtime, like any installed program.

### `node-gi` marshals a `GType` inside a C array

A `GType` element in a C array fell through to the element predicate's default and
was refused. That made every `SELECT` throw on `node-gi` before SQLite ran, because
reading a column's type passes a zero-terminated `GType[]`. `GType` is now a sized
cell in a C array in both directions. Lists and hashes still refuse it, and the
refusal message names the actual tag instead of calling every unhandled tag a
nested container.

## `node:sqlite` reads 64-bit integers

libgda types an `INTEGER` column, and an expression whose first value is an integer,
as a 32-bit `gint`. Any value past 2,147,483,647 then failed the whole read, and on
0.49.0 the failure was reported as an empty result — a millisecond timestamp was
enough. Such columns are now read as their exact decimal digits and converted as
`node:sqlite` does. A value that fits `Number.MAX_SAFE_INTEGER` becomes a Number,
`readBigInts` returns a BigInt, anything larger throws `ERR_OUT_OF_RANGE`, and
`lastInsertRowid` handles rowids past 2^31.

## `gjsify install` installs required peer dependencies

npm 7 and later install every `peerDependencies` entry that `peerDependenciesMeta` does not
mark `optional`. The native install backend ignored `peerDependencies` completely, so an install
could exit 0 and still leave a package unable to run. The case that exposed it: a project with
`wxt` as a devDependency got no `vite`, and `wxt prepare` then failed with "Builder not found".

Required peers are now installed beside the package that declares them. If the tree already
holds a version in range, that copy is reused. If the slot holds a version outside the range,
the install prints a warning and keeps going, which is what npm does outside strict mode.
Optional peers are still skipped, the same as npm, so `@gjsify/cli` does not pull in its GJS
engine packages.

`gjsify-lock.json` now records each package's peer maps and a `peersResolved` flag. A lockfile
written by an older CLI has no flag, so the first plain `gjsify install` resolves it again.
Pinned versions are kept, and any missing peers are added. `--immutable` still installs such a
file exactly as it is, so run one plain install and commit the updated lockfile.

## Ed25519 and X25519 in `node:crypto` and WebCrypto

GJS now has the two Curve25519 algorithms that the Signal, WhatsApp and OMEMO protocols build
on. `crypto.subtle` handles `Ed25519` (generate, import, export as raw, spki, pkcs8 or jwk, sign,
verify) and `X25519` (generate, import, export, deriveBits, deriveKey), as browsers ship them.
`node:crypto` adds `generateKeyPair`/`generateKeyPairSync` for `'ed25519'` and `'x25519'`, the
one-shot `crypto.sign`/`crypto.verify` (including Ed25519ctx through `{ key, context }`),
`crypto.diffieHellman({ privateKey, publicKey })`, and KeyObject import and export for both key
types in PEM, DER and JWK.

The curve arithmetic comes from `@noble/curves`, an audited pure-JS library. Ed25519
verification follows OpenSSL rather than the library's default: small-order keys and `R` values
are rejected and the equation is cofactorless. That way GJS gives the same answer as Node on
the WPT small-order vectors. The tests check the RFC 8032 and RFC 7748 vectors and all 518 Wycheproof
X25519 cases. They run on both GJS and Node.

A library that picks its code path by checking `typeof crypto.diffieHellman === 'function'` now
takes the `node:crypto` path on GJS. npm `libsignal`, used by Baileys, is one of them.

## `gjsify link` hides its override in a git worktree too

`.gjsify-link.json` stays out of git through the repository's own `info/exclude`, which `gjsify
link` writes and `gjsify unlink` removes again. In a git worktree that file went to the wrong
directory: git SHARES `info/exclude` across a repository's worktrees, and the entry landed under
the worktree's own git directory, in `worktrees/daemon/info/exclude`, which git never reads. `git status`
in the worktree kept listing `?? .gjsify-link.json`, so the next `git add -A` committed the very
override `link` exists to keep out of every commit — measured on a worktree of a submodule.

Both commands now follow the `commondir` file that git records in the worktree git directory,
whether it holds a relative path (what `git worktree add` writes) or an absolute one. A plain clone
and a submodule have no `commondir` and behave exactly as before. A `commondir` that names nothing —
blank, a directory, or a path that is not there, all three of which real git exits 128 on — is
reported as `unreadable-git` rather than guessed at.

## `readline` echoes what you type

On GJS, a readline interface in terminal mode was silent. A fresh tty echoes a written byte —
verified against the pty itself — but an interface opened with `terminal: true` did not: raw mode
silences the kernel's echo, and nothing wrote the character back. The keypress events arrived
correctly all along (KEY "x", KEY "\r", KEY "\u0003" with `ctrl=true`); the handler simply acted
on none of them. So a person typed into the void, and ctrl-c went nowhere.

Printable characters are echoed, backspace erases on screen, return submits the assembled line, and
ctrl-c follows Node's rule: a SIGINT listener decides, and without one the interface closes.
Measured on a real pty, with 94 tests.

## `https` completes a handshake and serves the certificate it is given

Two halves of TLS on GJS, both measured:

**The client.** `tls.connect()` upgrades a `net.Socket` after its `connect` event, but `net`
starts a raw read loop right after emitting it, and that pending read collided with GnuTLS's own
handshake reads — `G_IO_ERROR_PENDING`, "stream has outstanding operation" — swallowing the
server's handshake bytes. The handshake now claims the loop, and it is restarted on the TLS
streams afterwards.

**The server.** `https.createServer({ key, cert })` returned an `http.Server` that ignored its
options and listened in plain text, so no GJS https server ever presented a certificate. The http
server now takes a TLS hand-off from `https`: it listens with Soup's HTTPS flag on the bridge's
`Soup.Server`, with the PEM pair as `tls-certificate`. `requestCert` maps to `tls-auth-mode`
(`REQUIRED` unless `rejectUnauthorized` is false) and `ca` to the trust store, as in Node.

## An `--app gjs` bundle finds its native addon at run time

`--app gjs` used to choose the platform `.node` at BUILD time, and all four shim shapes baked that
absolute path into the bundle. A GJS bundle carrying a third-party addon was therefore valid only
on the machine, and at the path, that built it: move the tree and the bundle starts, then dies at
the first addon command with `gjsify-napi: cannot resolve addon path`. Measured on a consumer.

The build now enumerates every `.node` the package ships, keyed by platform, and bakes that table
in; the shim picks the entry for the host it finds itself on and resolves the package root through
the bundle-URL banner.

## A native library that will not load now names itself

On macOS, `gjsify build` died with "Unsupported type void, deriving from fundamental void" whenever
Homebrew's json-glib was missing: the typelib resolved, the library it names could not be opened,
and nothing said which file or which dependency. Every typelib-backed bridge can fail that way, so
the probe is the shared one — `probeNativeLibrary` forces the namespace's library to load and, when
that fails, reports the file, the host loader's own message, and the leaf name of the dependency it
could not find. `NativeLibraryLoadError` is what the optional bridges raise, so a missing dependency
reads the same whichever bridge hit it.

## New

### `gjsify exec` runs an installed npm bin on the runtime gjsify runs on

`gjsify exec <bin> [args…]` is `npx <bin>` for a bin your project installed (ADR 0076). Under
Node, Bun or Deno the bin runs unchanged. Under GJS, which cannot load an npm bin, gjsify
rebuilds it `--app gjs` once, caches the result in `node_modules/.cache/gjsify/exec/`, and runs
it with `gjs`. The cache is reused until the package version, the lockfile or the gjsify
version changes. Arguments, the working directory, the environment, stdio and the exit code
pass through.

A rebuild that fails prints the bundler's diagnostics and runs nothing: `gjsify exec` never
falls back to Node on its own. `--runtime node` runs the bin on Node when that is what you want.

Not every Node bin runs under GJS yet. Measured when the command landed: `semver`, `json5` and
`wxt --version` run; `prettier` and `web-ext` do not, and the reason each one stops is written
down in `docs/bundled-toolchains.md`.

### Builds of ordinary npm packages that failed under `--app gjs`

Rebuilding real bins found build defects that affect every `gjsify build --app gjs`:

- A dependency that assigns `console = …` (node-forge does) no longer fails the build with
  `ASSIGN_TO_IMPORT: Cannot assign to import 'console'`.
- A dependency that has `"import.meta.url"` as a string, as vite's and wxt's `define` keys do,
  no longer fails with `PARSE_ERROR: Expected ':' but found Identifier`.
- `import.meta.dirname` and `import.meta.filename` in a dependency now work. GJS defines neither,
  so they were `undefined`.
- `require('fs')` from CommonJS is a mutable object, as in Node. graceful-fs (under fs-extra and
  many CLIs) patches it in place, and that failed at load with `setting getter-only property`.
- A `.cjs` entry point builds.
- Two modules in one directory that import the same `@gjsify/*` package at the same moment no
  longer lose that import to a race. The lost import came out as a bare specifier, and the
  bundle failed its load check or died at load.

### New Node APIs

`util.parseEnv`, `fs/promises.constants`, `stream.promises`, `dns.promises` and
`module.Module`.

## Web pages follow the desktop's accent

Pages styled with `@gjsify/adwaita-web` can now follow the accent colour and colour
scheme the user picked for the desktop, the way a native Adwaita window already does
(ADR 0078, #1821).

- **From a gjsify server.** `@gjsify/adwaita-app/appearance` reads the desktop without
  opening a window. On Linux it asks the XDG Settings portal, which answers on GNOME, KDE
  and inside a Flatpak, and falls back to GSettings. On Windows it reads the registry, and
  on macOS the global defaults. `renderAppearanceMeta()` turns the answer into two
  `<meta>` tags that adwaita-web applies on load. `watchDesktopAppearance()` reports each
  change, which the page applies with `applyDesktopAppearance(json)`.
- **From the browser alone.** `applySystemAccent()` follows the CSS system colour
  `AccentColor` where the engine resolves it. Engines differ here, and some report a fixed
  blue, so the server handoff ranks above it.

Every source is snapped to the nearest of libadwaita's nine accents with the new
`nearestAccent()` in `@gjsify/adwaita-core`. It is a port of libadwaita's own function,
tested against libadwaita's reference cases. Your own `applyAdwaitaAccent()` still wins
over all of it.

The Linux reader is measured, in CI too. The Windows and macOS readers have not yet run
on those systems.

## Browser extensions

`gjsify webext` builds a WebExtension for Chrome, Edge, Firefox and Safari from one source
(ADR 0077). You declare the extension in `package.json#gjsify.webext`, and one command writes one
folder per target:

- a `manifest.json` composed for that target, from a `manifest.ts` function or a JSON template
  with per-target overrides. gjsify converts no keys between Manifest V2 and V3,
- every script bundled once as a classic IIFE, so the same file runs as a content script, an
  injected file, an MV2 background script or an MV3 service worker,
- pages with their local scripts bundled and stylesheets copied,
- icons rendered from SVG to PNG through librsvg for Chromium, and the SVGs themselves for
  Firefox,
- `_locales/` and `public/` copied.

Before a zip is written, the build checks each folder the way the browser would. A file the
manifest names but the build did not write, a `manifest_version` that does not match the
target, or a `default_locale` without `_locales/` stops the build with the target named.

```bash
gjsify webext build   # .output/<target>/
gjsify webext zip     # plus <name>-<version>-<target>.zip, byte-identical across rebuilds
gjsify webext dev     # web-ext opens the browser, gjsify rebuilds in place on save
```

The build runs on GJS as well as Node, so an extension no longer needs Node or Vite to build.
Only `webext dev` still uses Node, because it launches the browser through `web-ext`. The
browser-global shim stays the author's choice; the guide recommends `@wxt-dev/browser`.
Signing and store submission come next. The guide is at
[Browser Extensions](https://gjsify.github.io/gjsify/guides/browser-extensions/).

## `https.request` honours `ca` and the other TLS options

On GJS, `https.request` never passed its TLS options to libsoup. A server whose certificate
chains to a private root failed even with that root passed as `ca`, and `rejectUnauthorized`,
`servername`, `checkServerIdentity`, `cert`/`key` and an `https.Agent`'s options were ignored
as well. Now `ca` (a string, a Buffer or an array of them) replaces the system trust store, as
it does in Node. A rejected certificate reports Node's error code, for example
`DEPTH_ZERO_SELF_SIGNED_CERT`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE` or
`ERR_TLS_CERT_ALTNAME_INVALID`. The TLS options of an `https.Agent` override the request's,
the same as in Node.

## `SharedBuffer` and WebRTC reach macOS

`@gjsify/sab-native` was Linux-only by design, so a Mac could not use `SharedBuffer` at all,
and `@gjsify/webrtc-native` had the same gap. Both now ship darwin prebuilds. The port is not a
copy: Darwin has no Unix-domain `SEQPACKET`, no `SOCK_CLOEXEC` or `MSG_CMSG_CLOEXEC`, reports no
count from `os_sync_wake_by_address_all` (so the shim wakes one waiter at a time until `ENOENT`),
defines no `CMSG_ALIGN` and aligns control messages to 4 bytes — which makes the musl-safe
`CMSG_NXTHDR` the Linux path carries walk the wrong header. The darwin source uses the system
macro instead. ADR 0013 recorded this gate in advance; this is its payload.

## `typeof window` tells the truth in `--app node` bundles

`--app node` used to define `window` as `globalThis` at build time. That rewrote every
`typeof window === 'undefined'` check in bundled libraries to `false`, so a Node program took
its libraries' browser branches. @mtcute/web, for example, passed when its source ran on Node,
but its bundle threw `globalThis.addEventListener is not a function`. The define is gone.

GJS defines `window` itself, so on `--app gjs` those branches still run. There the global is
now an EventTarget: a bundle that calls `addEventListener`, `removeEventListener` or
`dispatchEvent` on `window`, `self` or `globalThis` gets
`@gjsify/dom-events/register/global-event-target`. This is the same window-scope bus the DOM
registers already installed, and it no longer requires `@gjsify/dom-elements`. See ADR 0079.
