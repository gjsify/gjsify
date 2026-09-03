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

**A React Native application can now grow a desktop target on all three operating systems
without the Node bridge losing objects between runs, and without an environment variable
standing between the web view and its own typelib.**

---

### The bridge stopped dropping objects it still owned

Running a real React Native GTK4 application through `@gjsify/node-gi` gave exit
139 / 134 / 0 / 139 over four consecutive runs — two distinct signals and one clean
completion, which is the shape of a lifetime bug rather than a logic one. The core dump
carried no application frame at all: the thread-safe-function drain handed
`g_object_get_qdata` a pointer that was no longer a live GObject.

The cause is a window nobody owns. V8 nulls a weak persistent during garbage collection,
in the first-pass weak callback, but Node defers the actual finalizer to a `setImmediate`.
Code that read an empty `napi_ref` and concluded "already finalized" was wrong for the
length of that gap — and when the record was freed inside it, the allocator handed the
*same block* to the next instance. Measured: an identical address on every run. The stale
finalizer then read a live record, saw no queued teardown, and queued one for a wrapper
that was still in use. It disappeared under `NODE_GI_TOGGLE_DEBUG=1`, because logging
allocations recycle the block — the signature of a use-after-free rather than a race in
the queue.

Ownership of the free now follows the finalizer instead of the collector (#1475).

A second crash in the same seam turned out to rest on a GLib behaviour nobody had written
down: `g_object_run_dispose` notifies every weak reference on an object that goes on
LIVING. The net read that as "C finalized it", nulled its pointer, and the teardown then
skipped the qdata detach it does under that pointer — leaving a LIVE GObject holding a
qdata pointer to a record the teardown went on to free. The detach happens inside the weak
notify now, the one moment the pointer is guaranteed addressable. Reproduced
single-threaded, with no race window to hit: SIGSEGV before, never after (#1489).

Its residual is open and printed rather than implied: an object that SURVIVES a dispose
loses its wrapper identity, JS instance fields go with it, and the re-wrap installs a
second toggle ref glib notifies for neither, so wrapper and GObject both go immortal — the
old code leaked the same ref and took a use-after-free with it. Narrower than it sounds —
`gtk_window_destroy()` is not a dispose caller on GTK 4.22.4, measured, so the reach is an
explicit `run_dispose()` and `gtk_native_dialog_destroy()` — but it is silent data loss
where the old code had none, so it is pinned by an executable case rather than a note.

### An `IN` array of structs or enums marshals now, so accessibility exists on Node

`Gtk.Accessible.update_property()` threw `IN struct/union/enum element parameters are not
yet supported` on every Node host, which meant **no** ARIA property, state or relation on
macOS or Windows — the two operating systems where Node is the only host there is. It was
not one method: measured against every installed typelib, **140 `IN` parameters** hit the
same gap, `Gio.ActionMap.add_action_entries`, `GObject.Object.newv` and
`Gsk.LinearGradientNode.new` among them.

Two halves, because they fail differently. Pointer elements landed first (#1473). By-value
elements needed a separate write path (#1482): the eight-byte `GIArgument` union cannot be
`memcpy`-ed into a 24-byte `GValue` cell, so element size and cell addressing are computed
from the C array rather than from the union. The regression test writes distinct contents
into every element and reads them back, because a stride bug produces the right *number*
of values and the wrong values.

The read path — dereferencing by-value interface elements *out* of a C array — is still
gated off rather than wrong, and says so.

### A GStreamer error is readable now

`Gst.Message.parse_error()` threw `OUT type tag 20 parameters are not yet supported`, so an
application could see that playback stopped and never learn why. Every bus-error accessor
of all three GStreamer message APIs sat behind that one gate.

`GError` marshals in every direction now — the explicit one an API declares, as distinct
from the implicit `throws=1` error the invoker already turned into a thrown `GLib.Error`.
The conversion it needed existed all along and was simply unreachable, refused before the
invoke. An OUT slot the callee left alone reads back as `null` rather than an empty error,
and an IN argument honours its transfer, borrowed or copied. Reach, measured over 264
typelibs and 91 444 callables: 18 OUT/INOUT parameters, of which ten are those accessors
(#1496, closes #1495).

### A class answers for its own signals and properties now

A class nothing had referenced reported none of its own signals, because GObject installs
them in `class_init` and GLib defers that to the first class reference — so
`GObject.signal_lookup` answered 0 where GJS answers a real id. And a class-struct static
ran on the type its name was READ from rather than the one it was CALLED on, which made an
inherited `Subclass.list_properties()` answer the base's. Two causes with one symptom
shape: a wrong answer and nothing thrown (#1488, closes #1438).

The React Native layer's claim for macOS and Windows stays `partial` rather than being
promoted, and the reason is worth one sentence: the OS suites pair this checkout's
JavaScript with the PUBLISHED addon on purpose, so a fix living in the addon's C++ is
invisible there until a release ships it. This is that release.

### The web view on macOS was built, and only declared broken

`@gjsify/iframe` declared `runtimes.node: "none"`. On darwin and win32 that is the only
host an application has (ADR 0024 § 4), so the WebView pillar was marked unusable on
exactly the two darwin arches `@gjsify/webkit-native` exists to serve. Measured on darwin-x64
under Node 24 against the published closure: `load_html()` reaches `LoadEvent.FINISHED`,
and `evaluate_javascript` reads the title, an element's text and a computed value back out
of the document. The slot is now `polyfill`, with a Node leg in CI behind it (#1487).

Two things that looked like the honest limits of that change were defects instead.

The `/register` suite was gated to GJS with a condition written while the slot was `none`;
under `--app node` the same WebKit chain resolves through `requireGi()`. Both legs now run
the same 291 tests.

And the build alias that made the Node leg green was covering a broken shipping path, not
pinning a test corpus. Without it, `--app node` puts **Node's own `MessagePort`** in the
shipped bundle — and `@gjsify/iframe` needs the seam: the bridge transport hooks onto our
port, `_registerTransferredPort()` reads a partner Node's port does not have, and port
substitution identifies ports by `Symbol.toStringTag`, which Node answers `EventTarget`.
Port transfer across the WebKit bridge was dead on that target and the suite was green over
it. `@gjsify/message-channel` now exports the seam at `./core`, the specifier the alias
layer does not rewrite, and the alias is gone.

### The typelib resolves without an environment variable

A prebuilt typelib and the library it names sit in the *same* directory. GI's own install
layout puts the typelib one level below, in `lib/girepository-1.0`, and the library
directory was derived as the parent of wherever a typelib was found — correct for the
install layout and wrong for every staged prebuild. The symptom is worth naming because it
does not look like a path problem: the typelib loads, the namespace resolves, and
constructing the class fails with `WebKit.WebView is not a constructible GObject type`.

The basename is now read as a positive signal. Where it says `girepository-1.0` the parent
is the answer; where the layout is unknown both readings are offered and only directories
that exist survive (#1492). Measured on darwin with a guard that runs before the bridge
loads and prints which loader variables carry the staged directory: none of them do.

### Eighteen npm surfaces answer for themselves

A real React Native application does not import only `react-native`. Sixteen of its other
imports had no answer at all, and the failure was worse than a refusal: the bundler could
not resolve the package, so the error named npm rather than this layer, and a porter
learned nothing about whether a desktop answer existed. Each answered surface is now a
subpath of `@gjsify/react-native` — `expo-status-bar`, `async-storage`, `vector-icons`,
`safe-area-context`, `expo-linking` among them — behind one registry that the gate, the
runtime and the generated support table all read (#1458, ADR 0036).

### Adwaita widgets, and two things a screen written as a column needs

`@gjsify/adwaita-react-native` gained its chrome, content, boxed-list, preferences and
navigation widgets (#1469, #1470, #1471, #1478, #1479), and two layout answers landed
beside them: `Animated` over `Adw.TimedAnimation` (#1443), and `flex-wrap` as a
`Gtk.FlowBox` intent (#1439). Router fixes went with them — `router.push` takes the object
form (#1457), a label centres where React Native does not (#1456), a view-stack page is
hidden before it is removed (#1484), and a tab page the stack has not got is no longer
retried forever (#1485).

There is no layout engine here and there is deliberately not going to be one. Yoga is used
as an *oracle*: every GTK default is recorded against React Native's, with the source
cited. The loudest disagreement is the one that would have been invisible —
`Gtk.Box.orientation` is horizontal, Yoga's `flex-direction` is `column`, so without
normalisation every screen written as a column would have come out as a row.

### The per-prop answers are published, because a refused prop was only visible at render time

`support-table` answered whether an import is answered; the per-prop answers were not an
entry point at all. Measured on a real application, that gap ends a whole tree: three
`<Text onPress>` rows, correctly refused because a `Gtk.Label` emits no `clicked`, and
because the tab stack mounts every tab from the root the uncaught refusal took four
uninvolved screens with it. The build, the typecheck and the consumer's own import gate
were all green.

`@gjsify/react-native/prop-table` publishes those answers as data, with a generated
`PROPS.md` held byte-exact against its generator, so the same question becomes a failing
assertion in a second and with no GTK. `TextInput` also gained the instance type and ref
handle React Native code expects, and `accessibilityLiveRegion` is answered on `Text`
through `Gtk.Accessible.announce()` (#1493, ADR 0039).

The throw stays, and what that leaves is stated rather than implied: a refused prop is loud
on stderr and silent on screen, so until `AppRegistry` carries an error boundary an
unguarded refusal still ends the tree it is mounted in. That is its own change.

### The widget vocabulary is generated from the GIR

`@gjsify/gtk-host` now takes its widget table from the `@girs` vocabulary rather than a
hand-kept list (#1449), and the web and NativeScript renderers were named from the same
source (#1459, #1462). One vocabulary, three renderers, and a check that fails when they
disagree.

### `gjsify ship`

**Windows no longer opens a console window, and the macOS bundle is sealed.** The launcher
was a `.cmd` executing `node.exe`, a console-subsystem image with no `nodew.exe` beside it,
so every GUI start showed a black window — and no CI leg can see that. Ship now stages a
generated GUI-subsystem executable that RUNS the `.cmd` rather than replacing it. The
reason for that over patching `node.exe`'s subsystem field is measured: started with no
console, a log still carries `console.log`, `stderr` and the whole uncaught-exception
report, which the patch would have thrown away.

On macOS `codesign` had stopped at the Mach-O images, so `_CodeSignature` did not exist to
survive a zip. The seal covers every image and then the bundle root, with hardened runtime
and entitlements — and two assertions that had sat behind a failing line ran for the first
time, one of them `codesign --verify --strict` accepting the BUNDLE, which is Apple's own
reader rather than ours. Notarisation, stapling and `signtool` are wired with correct
arguments and have run on no machine; that is printed rather than claimed (#1497, ADR 0040).

**An application can ship its own fonts.** This layer claimed it already could — "ship the
font with the application, `gjsify ship` installs it where fontconfig looks" — and nothing
in the command had ever touched a font. On Windows the cost of that is silent: Pango falls
back to a system face and the application merely looks wrong. One payload path,
`share/fonts/<app-id>/`, and three different readers, because the backends differ rather
than the packaging: a fontconfig directory on Linux, `ATSApplicationFontsPath` in the
`Info.plist` on macOS, and on Windows a handed-over directory, since `pangocairo` selects
the win32 backend and populates from DirectWrite alone (#1491, ADR 0038). The Linux and
Windows halves are measured; the macOS one is NOT, because no leg here starts an `.app`.

### A web view exists on Windows, headlessly and provably

`@gjsify/iframe` needs `gi://WebKit` 6.0. On Linux that is the system WebKitGTK, on macOS
Apple's WKWebView behind a shim answering to the same namespace — and on Windows there was
nothing, and not for packaging reasons: WebKit's GTK port targets X11 and Wayland, and
gvsbuild has no WebKit at all. Measured on a Windows 11 guest, the shipped closure carries
45 typelibs and none of them is WebKit.

So the engine is WebView2, Chromium, behind a backend that squats the same namespace on
purpose and says so in its first paragraph. The consumer keeps
`import WebKit from 'gi://WebKit?version=6.0'` verbatim; which typelib answers is decided
by packaging, not by a branch in shipping source (#1494, ADR 0035).

Thirteen assertions on a `windows-latest` runner, each returning a value rather than a
signal: `load_html` reaches `LoadEvent.FINISHED`, `evaluate_javascript` reads a marker back
out of the DOM, `get_snapshot` returns an encodable 640×480 texture at 5966 bytes of PNG,
and the page's own `postMessage` arrives through `script-message-received`. The Win32
message pump reports ATTACHED, which is the loop bridge the whole design turns on.

**What that does not say.** The probe never presents a toplevel — on a service session
`present()` dies with an access violation — so all of it ran against a hidden parking
window. Re-parenting the child window under a real GTK toplevel, tracking its bounds,
hiding it when unmapped, and "input, focus and accessibility come from the OS" are
untested. Stage 2, which would put the view inside GSK's scene graph, is not begun. The
honest claim is that a full-page document loads, evaluates and captures on Windows — not
that a web view is a widget there yet.

### `https:` streams have a source and a TLS backend

The runtime bundles shipped `playbin3` and `uridecodebin3` while
`Gst.ElementFactory.make('souphttpsrc')` returned `null` and
`Gio.tls_backend_get_default().supports_tls()` returned `false` — so every network stream
failed, and failed as `Internal data stream error` rather than as a missing element.
`libgstsoup` and the glib-networking TLS module now travel with the darwin and win32
closures (#1476, ADR 0037). Both halves are required: without the TLS module the
element exists and every `https:` URI still fails.

### One project, GJS on Linux and Node on macOS and Windows

Everything above needs a Node runtime, and until now saying so said it about the whole project.
`gjsify ship darwin --stage` reported `formats (none — macos-app and macos-app-zip need
gjsify.app: "node")`, and setting that field produced the bundle **and moved the Linux dependency
with it**: `Depends: gjs (>= 1.86)` became `Depends: nodejs (>= 24)`, which apt refuses on Debian
trixie, Ubuntu 24.04 and Ubuntu 26.04. Asking for a `.app` made the `.deb` uninstallable.

One field was answering two questions — which runtime the application needs, and which formats a
target can build. It is per target now:

```jsonc
{
  "gjsify": {
    "app": "gjs",
    "ship": { "app": { "darwin": "node", "win32": "node" } }
  }
}
```

`gjsify.app` stays the default and each target may override it, keyed `linux` / `darwin` / `win32`.
Every generator reads the runtime of its own target — the launcher, the emitted `Depends:`, the
carried interpreter and GTK closure, the format list — so the Linux package of that project still
depends on `gjs` and still execs `gjs -m`. An override is printed at stage time, and a key outside
those three is refused by name rather than silently leaving the target on the project default.

---

### Breaking

- **`@gjsify/adwaita-web` no longer exports the flat widget classes** (#1467). They are
  reachable under their `Gtk`/`Adw` namespace, which is what the vocabulary convergence
  decided (ADR 0034); a flat name shadowing a namespaced one gave two answers to one
  question.
- **`@gjsify/iframe` now declares `node: "polyfill"`.** Nothing changed for a GJS
  consumer. A Node consumer reaches it through `gjsify build --app node` as before — a bare
  `import` from `node_modules` was never supported and still is not, the source carrying
  literal `gi://` specifiers.
