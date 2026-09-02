# ADR 0035 — `@gjsify/iframe` on Windows: WebView2 behind the same `gi://WebKit` 6.0 namespace

- **Status:** Proposed (2026-09-02) — the design is settled and measured; the win32 half is not yet built. In this repository `Accepted` tracks the IMPLEMENTATION, not the draft (ADR 0022 reached it once darwin ran), and this ADR was briefly raised to it before anything had compiled. **What exists and is checked, on every pull request:** the portable C compiles on Fedora, `g-ir-scanner` builds and runs its dumper, the resulting GIR carries `load-changed` / `load-failed` / `script-message-received` plus the four properties and `parent="Gtk.Widget"`, `probe-types.js` passes 24 assertions under gjs (enum numbering, the boxed positional `UserScript`, `WebView` subclassable, `Gio._promisify` on both async pairs, the `Settings` property set, two divergence warnings), and `check-def-exports.mjs` holds the module-definition file to the header at 34/34. **What does not exist:** no `win32-x64` artifact has ever been built or loaded — the MSVC job failed on its first run — so `scripts/probe-win32.mjs`, the one thing that says a page loads, has never executed. Raise this to `Accepted` when it has.
- **Scope:** `@gjsify/iframe` (Framework pillar) and its `WebKit.WebView` dependency on `win32-x64`; a new per-target package set (distribution per ADR 0017, OS axis per ADR 0018, artifact dependencies per ADR 0024). Sibling of [ADR 0022](0022-webkit-on-darwin.md), which decided the same question for darwin.
- **The spike has run.** It was written before the code, because ADR 0022's Proposed draft got two of its own decisions wrong and only measurement overturned them; § *What the spike answered* now carries the results, measured on a `windows-latest` runner on 2026-08-31. The staging below survives them, with one refinement it did not anticipate. What remains unmeasured is stage 2's frame transport, and it is marked as such.
- **Stage 1 is WRITTEN, not yet demonstrated**, as `@gjsify/webview2-native`; stage 2 is unstarted. What landed, what has been verified and where, and what stage 1 deliberately does not do, are in § *Implementation*.

## Context

ADR 0018 makes Linux, macOS and Windows a declared, checked target set, and
ADR 0024 stages 4 and 5 now produce a `.app` and an `.msi` that carry their own
Node and their own GTK closure. So an application built on the GTK host can be
handed to a stranger on all three operating systems — except that one of its
widgets does not exist on one of them.

`@gjsify/iframe` requires `gi://WebKit` version **6.0**, the GTK4 port. On Linux
that is a system package. On darwin ADR 0022 supplied it: Apple's `WKWebView`
behind a GObject shim that **answers to the same namespace**, so the consumer
keeps `import WebKit from 'gi://WebKit?version=6.0'` verbatim and carries no
backend seam and no OS branch. Which typelib answers to that name is decided by
packaging.

On Windows there is no answer at all, and unlike darwin the gap is not one
formula away:

| | fact | consequence |
|---|---|---|
| 1 | WebKit's **GTK port** targets X11/Wayland; there is no Windows GTK port upstream | `gi://WebKit` 6.0 has no win32 provider, and not for packaging reasons |
| 2 | WebKit's **WinCairo** port does exist and does build | but it ships no GObject-Introspection typelib and no GTK widget — the same two halves darwin was missing |
| 3 | `gvsbuild`, the project that builds GTK for Windows, has no WebKit | the runtime closure `@gjsify/gtk-runtime-win32-x64` stages cannot grow one by adding a name |
| 4 | Windows ships a complete, supported, already-installed web engine: **WebView2** (Chromium), Evergreen on Windows 11 and on Windows 10 wherever Edge is | the engine half is solved before we start, exactly as `WebKit.framework` solved it on darwin |

So this is the darwin situation with one substitution and one inversion. The
substitution: WebView2 in place of `WKWebView`. The inversion is the interesting
part and it decides the staging.

### The inversion: the two backends are expensive at opposite ends

ADR 0022's finding was that on darwin *the engine half maps 1:1 and the widget
half is the expensive one* — `WKWebView` is an `NSView`, GTK4 has no foreign-window
embedding, so the widget had to be **built, not bound**: offscreen render,
`Gdk.Texture` in the `snapshot` vfunc, and a second track for input forwarding
that re-synthesises every `NSEvent` by hand.

On Windows the same constraint holds — GTK4 still has no foreign-window
embedding, and a `GdkWin32Surface` is one `HWND` per toplevel, not one per widget
— but WebView2 offers three documented hosting modes, and the cheapest of them
hands back for free the three things darwin had to build:

| hosting mode | who owns input, focus, accessibility | web content is |
|---|---|---|
| **Windowed** | the OS | a child `HWND` |
| **Window to Visual** | the OS | an `IDCompositionVisual` hosted in an `HWND` (env var `COREWEBVIEW2_FORCED_HOSTING_MODE=COREWEBVIEW2_HOSTING_MODE_WINDOW_TO_VISUAL`) |
| **Visual** | **the app** — spatial input routing, coordinate transforms, rasterization scale, focus, drag and drop | a visual the app parents anywhere |

A child `HWND` under the GTK toplevel's own `HWND` is a working web view in an
afternoon. What it is *not* is a widget: it is composited by the OS **above** the
GTK surface, so it is outside GSK's scene graph. It cannot be clipped by a
scroller's rounded corner, nothing can be drawn over it, and it has to be hidden
by hand when its notional widget is unmapped or scrolled out of view.

That is the whole trade, and it is the reverse of darwin's. There, stage 1 was
correct-but-slow. Here, stage 1 is fast-and-correct-but-not-in-the-scene.

### What Windows does not offer, measured against the darwin design

The darwin design's interchange currency is `IOSurface`: `WKWebView`'s
`takeSnapshotWithConfiguration:` yields an image that binds zero-copy as a GL
texture or a Metal texture, at 15.8 ms for 1024×768 on the slowest host in the
fleet.

WebView2 has **no equivalent read API**. Its only capture surface is
`CapturePreviewAsync`, which encodes **PNG or JPEG** — an image-codec round trip
per frame, not a texture. There is no shared-surface, no shared-handle and no
frame-callback API in the documented surface.

The path that exists is a composition of two Windows APIs rather than one
WebView2 API: render through a `CoreWebView2CompositionController` into a
DirectComposition visual, then read that visual's output with
**`Windows.Graphics.Capture`** (`GraphicsCaptureItem`) into a D3D11 texture. This
is the documented-by-community route — Microsoft's own answer to
[WebView2Feedback#547](https://github.com/MicrosoftEdge/WebView2Feedback/issues/547)
is that offscreen rendering is not a supported feature — and it carries two known
holes worth naming before anyone designs around them:

- **Focus.** In the offscreen/visual case the app cannot set the web view's focus
  programmatically ([#3541](https://github.com/MicrosoftEdge/WebView2Feedback/issues/3541),
  [#4944](https://github.com/MicrosoftEdge/WebView2Feedback/issues/4944)).
- **Composition namespace.** `CreateCoreWebView2CompositionController` accepts
  `IDCompositionVisual`, `IDCompositionTarget` and `Windows.UI.Composition.Visual`,
  and explicitly **not** WinAppSDK's `Microsoft.UI.Composition` visuals.

### The one thing that may be cheaper than on darwin

The finding ADR 0022's draft was missing entirely was the run loop: `WKWebView`
delivers its callbacks as CFRunLoop sources, a `GMainContext` never looks at
them, and case [1] of `webkit-runloop-darwin.m` did not run slowly — it did not
run **at all**. Every API row was unreachable until a drain source existed.

Windows may have no such gap. WebView2 delivers its callbacks through the
thread's Win32 message queue, and GTK4's Windows backend already pumps that queue
from its own main loop. If that holds, the loop bridge is free.

**If** — and this is precisely the shape of the assumption that cost ADR 0022 a
release. It is spike question 1 below, and it is not to be assumed in either
direction.

## Decision

1. **The namespace stays `WebKit-6.0`; the package name does not say WebKit.**
   The namespace is the integration contract — it is what buys `@gjsify/iframe`
   "no backend seam, no OS branch, no `gjsify.os` declaration", and ADR 0022 § *One
   namespace* records that giving the shim its own name was built first and had to
   be reverted because the seam it forces needs a top-level await that deadlocks
   `@gjsify/unit`. That reasoning is unchanged by the engine behind it. But on
   Windows the engine is **Chromium**, so `@gjsify/webkit-native` does not extend
   here: the win32 backend is its own package, named for what it is, squatting the
   same namespace on purpose and saying so in its first paragraph.
2. **Two stages, split where they cost differently — and NOT the same split as darwin.**
   - **Stage 1: hosted, not composited.** Windowed or Window-to-Visual hosting, a
     child `HWND` (or `IDCompositionVisual`) under the GTK toplevel's `HWND`,
     positioned and clipped to the notional widget's allocation, hidden when
     unmapped. The OS delivers input, focus and accessibility. `WebKit.WebView`
     exists, loads, evaluates JavaScript and takes snapshots.
   - **Stage 2: in the scene graph.** Visual hosting plus `Windows.Graphics.Capture`
     into a `Gdk.Texture`, which restores the parity stage 1 gives up, and buys the
     input-forwarding, rasterization-scale and focus work darwin already paid for
     once.
3. **Stage 1 is honest about what it is not.** The widget reports, by a named API
   rather than a doc comment, that it is an OS-composited overlay: a consumer that
   puts it under a rounded clip or over another widget gets a diagnostic, not a
   surprise. GTK's failure mode is exit 0, and "my rounded corners do nothing" is
   indistinguishable from an application bug forever.
4. **The API subset is the consumer's, not the platform's** — counted over the 14
   files `@gjsify/iframe` ships: `WebKit.WebView` (23 occurrences), `LoadEvent`
   (5), `UserContentManager` (3), `UserScript` + `UserScriptInjectionTime` +
   `UserContentInjectedFrames` (2 each), `SnapshotRegion` (2), `SnapshotOptions`
   and `Settings` (1 each), and **six** instance methods —
   `evaluate_javascript` (14 call sites), `get_snapshot` (5), `get_uri` (2),
   `load_html`, `load_uri` and `get_user_content_manager` (1 each).

   **ADR 0022's count said four methods and it was wrong**, which is recorded
   here rather than quietly fixed: `get_uri()` and `get_user_content_manager()`
   are both live call sites in `iframe-bridge.ts` and `message-bridge.ts`, so a
   backend built to the literal list would have compiled, installed, and broken
   the consumer at run time — the same shape of mistake as a final `WebView`. A
   counted subset is only load-bearing if the count is right.

   Beyond that set, stage 1 ships **eight** further entry points, all of them
   WebKitGTK parity names carried so a consumer written against the real thing
   does not meet an `undefined`: `reload`, `is_loading`,
   `remove_all_scripts`, `unregister_script_message_handler`,
   `user_script_new_for_world`, and `Value.is_string` / `is_null` /
   `is_undefined`. Plus the three names decision 3 and the pump require
   (`get_hosting_mode`, `get_overlay_constraints`, `get_message_pump_state`) and
   the `Value` type itself, which stands in for `JSCValue`. Nothing wider than
   that, and nothing narrower than the measured consumer set.
5. **The Evergreen runtime is a declared dependency, not an assumption.** ADR 0024
   already emits honest floors for Linux packages and warns when no published
   distribution satisfies one. The `.msi` gains the same treatment for the WebView2
   runtime: declare it, detect it at install time, and name the Fixed Version
   redistributable as the opt-out for an application that must not depend on the
   machine. A silent failure to create the environment is the same class of defect
   as a typelib with no DLL behind it — a namespace that resolves, advertises its
   classes and dies in the constructor.

## Consequences

- `x64` only. `gvsbuild` publishes no arm64 GTK, so ADR 0024's `--arch arm64`
  refusal on Windows already forecloses the question; this package inherits it
  rather than restating it.
- `@gjsify/iframe` gains no code. As on darwin, that is the measure of whether the
  namespace decision was right.
- A third backend means the *behavioural* corpus, not the API surface, is where
  parity is decided. Per ADR 0030 the same claim runs once per backend, and the
  interesting rows are the ones where Chromium and WebKit legitimately differ —
  a user script's document-start timing, the snapshot's colour space and premultiplication,
  what `evaluate_javascript` does with a returned object.
- Stage 1 makes the reader-shaped use case (a full-page HTML document in a
  window) work on all three operating systems. It does not make a web view usable
  as an ordinary widget on Windows, and no roadmap should imply otherwise until
  stage 2 has a measurement behind it.

## What the spike answered

Run on `windows-latest` (WebView2 Evergreen **151.0.4129.101**) on 2026-08-31, in the
process shape this has to hold in: a **non-bundled console process**, no `WinMain`, no
application message loop. `docs/poc/webview2-win32-probe.cpp`, dispatched by the
`WebView2 probe (ADR 0035)` workflow.

| question | answer |
|---|---|
| 5 — is the Evergreen runtime present | **yes**, 151.0.4129.101, on a stock image |
| 1 — does the environment callback need a pump | **no** |
| 1 — does the controller callback need a pump | **no** |
| 1 — does `NavigationCompleted` need a pump | **YES** — timed out after 8000 ms without one, arrived immediately with one |
| 3 — `CapturePreviewAsync` at 1024×768 | first 56.9 ms, **mean 33.4 ms** over 10 runs, 10,397 bytes of PNG |

**The premise holds: the win32 backend owes a loop bridge.** A `GMainLoop` does not dispatch
Win32 window messages, and without that dispatch `NavigationCompleted` does not arrive at
all — not late, not slowly. That is the same shape as darwin's CFRunLoop finding, and it
means decision 2's staging stands rather than collapsing into "Windows needs nothing".

**The refinement this ADR did not anticipate: the requirement is not uniform.**
`CreateCoreWebView2EnvironmentWithOptions` and `CreateCoreWebView2Controller` both complete
their callbacks with **no pump at all**, and only content-level work needs the queue. So the
bridge is not "install a GSource before the first call" — a backend could construct an
environment and a controller in a process that never pumps, and only discover the gap at the
first navigation. That is a worse failure mode than needing the pump throughout, because it
puts the symptom a long way from the cause: the widget exists, the view exists, and nothing
loads. The GSource therefore belongs at the point a view becomes live, and its absence
should be a named error rather than a timeout.

**On the capture cost, the ADR was too pessimistic and the number needs its caveat.**
§ *What Windows does not offer* calls `CapturePreviewAsync` "an image-codec round trip per
frame" against darwin's zero-copy `IOSurface`, which is true, and implies it is hopeless,
which the measurement does not support: 33.4 ms is roughly **twice** darwin's 15.8 ms, or
about 30 fps, on a GPU-less hosted runner. For a reader view that is usable.

The caveat is the page. The probe renders a flat background with one heading, and the PNG is
**10 KB** — a best case for an encoder. A page carrying photographs encodes larger and
slower, and that number is not measured here. So: stage 1 does not need stage 2 to be
usable for document-shaped content, and stage 2's budget is still unestablished for
image-heavy content.

## What a real Windows desktop added

Four measurements from the win11-gjsify VM (Windows 11 build 26200) on
2026-09-02, none of which a hosted runner could have made. Each one is here
because it changes a decision rather than confirming one.

**The Evergreen runtime is present, at 152.0.4191.53** — a second data point for
question 5, one minor version ahead of the runner's, with 151.0.4129.107 still
beside it under `C:\Program Files (x86)\Microsoft\EdgeWebView\Application`.

**The Evergreen registry key exists ONLY in the 32-bit view, and that is a trap
for decision 5.** `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-…}`
has it; the 64-bit `HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\…` does not. So an
install-time detection that reads the 64-bit path reports "not installed" on a
machine that has the runtime — the class of check that is green in CI and wrong
at the user, which is the whole failure decision 5 exists to prevent. Detection
must read both views (or use `GetAvailableCoreWebView2BrowserVersionString`,
which is view-independent), and it must say in the code why. NB the backend does not
read the registry at all: it lets `CreateCoreWebView2EnvironmentWithOptions`
do the lookup and names `HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND)` when there
is none — so the installer's detection is new code, not a call the shim
already makes.

**There is no `gi://` substrate to wire up, confirmed rather than assumed.**
`@gjsify/gtk-runtime-win32-x64@0.45.0` ships **45 typelibs and none of them is
`WebKit`** — no `JavaScriptCore`, no `Soup` — and none of the 52 DLLs in
`gtk/bin` is a `webkit*` or `javascriptcore*`. The context table's row 3 said
`gvsbuild` has no WebKit; this is the same fact measured on the shipped bundle
rather than read off a project list.

**An SSH session on Windows lands in session 0, where `Gtk.init_check()` returns
true and lies.** The process survives until `present()` and then dies with
`0xC0000005`, which reads as a porting defect and is not one — window stations
are per-session. Reaching the interactive session needs
`Register-ScheduledTask -LogonType Interactive` (the PowerShell module, not
`schtasks`: `/IT` does not combine with `/NP`, and a quoted path in `/tr` breaks
the line). The consequence for this ADR is a design constraint, not a footnote:
**stage 1's verification must not depend on presenting a window**, which is
satisfied by the parking window — a view is fully usable, loadable and
capturable with no toplevel at all.

## What the spike asked

### The questions, as they were put

One probe, in the process shape the shim actually runs in — a **non-bundled
console process driving a `GMainLoop`**, not a WinMain app with its own message
pump, because that is what a `gjs` or a `node` is. This mirrors
`docs/poc/webkit-darwin-probe.m` and `webkit-runloop-darwin.m`, and like them it
must fail if either half of its finding stops holding.

1. **Does WebView2 reach `NavigationCompleted` under a bare `GMainLoop`?**
   The darwin answer was no, catastrophically and silently. Run it *without* any
   added message pumping first, and record the negative result even if it is
   positive — a drain that turns out to be dead weight is a finding too.
2. **Does `gdk_win32_surface_get_handle()` give an `HWND` that accepts a
   WebView2 child**, and does the web view survive the GTK window being resized,
   minimised and moved between monitors of different scale?
3. **What does the snapshot path cost?** `CapturePreviewAsync` (PNG/JPEG encode)
   at 1024×768, timed the way darwin's 15.8 ms was, so stage 2's budget is a number
   rather than an intuition.
4. **Can `Windows.Graphics.Capture` read a DirectComposition visual that is not a
   window?** This is stage 2's load-bearing assumption, it is not in Microsoft's
   documented WebView2 surface, and if it is false stage 2 needs a different design
   rather than a longer schedule.
5. **Is the Evergreen runtime present on a stock `windows-latest` runner and on a
   clean Windows 11 image**, and what exactly does `CreateCoreWebView2Environment`
   return when it is not?

No Windows machine is available in this session's environment — the workspace's
Windows VM lives on a different host — so the probe runs on a `windows-latest`
runner. That is a real constraint on the measurement and not just on the
schedule: a hosted runner has Edge, a developer SDK and no interactive desktop
session, and Windows window stations are per-session, so **`EnumWindows` from a
non-interactive context returns an empty list while a window is on screen**.
Any assertion about a visible window has to run inside an interactive session
or be replaced by an assertion that does not need one.

## Implementation

Steps 1 to 3 are WRITTEN as `@gjsify/webview2-native` +
`@gjsify/webview2-native-win32-x64` and step 2's half is verified on every pull
request; step 3's is not verified at all, because no win32 artifact has been
built. Steps 4 and 5 have not been started.

1. **The probe is written and HAS RUN** (§ *What the spike answered*) — `docs/poc/webview2-win32-probe.cpp`,
   built and run by `docs/poc/webview2-win32-probe.ps1`, dispatchable as the
   `WebView2 probe (ADR 0035)` workflow. It answers questions 1, 3 and 5, the three
   that need no widget, and it links no GLib on purpose: what decides the design is
   the one property `g_main_loop_run()` has — it does not dispatch Win32 window
   messages — and a `Sleep()` loop has that property while a second GLib pulled from
   MSYS2 or gvsbuild would measure a library the shipped bundle is not. It exits
   non-zero on the outcomes that invalidate this ADR (10: no loop bridge needed;
   11: no frame captured), so a red run is a result rather than a build to fix. It
   exited **0**: the pump is needed for navigation, and a frame was captured.
2. **The GObject shim.** `packages/framework/webview2-native/` — a pure-C header
   carrying every GIR annotation, a portable C GObject layer, and one C++ file
   holding all of the COM. The seam between them is
   `src/c/gjsify-webview2-backend.h`, and it exists for a reason worth stating:
   `g-ir-scanner` builds and RUNS a dumper against the library, which is where the
   signals and the installed properties come from, so the library has to LINK on a
   host that has a scanner. Fedora links it against
   `src/c/gjsify-webview2-unsupported.c` — no behaviour, one shared refusal — and
   the Windows half compiles the same portable C with the real backend and runs
   `g-ir-compiler` on the scanned GIR. Two jobs of ONE `prebuilds.yml` run, so
   drift between them is structurally impossible; the intermediate is gitignored
   and never committed. That is `@gjsify/webgl`'s win32 shape one tool along.
3. **Stage 1's widget.** Windowed hosting: a child `HWND` per view, re-parented
   under the GTK toplevel's `HWND` on map and under a hidden process-wide parking
   window otherwise, bounds tracking the allocation in device pixels, hidden by
   hand on unmap. The parking window is what makes a view usable with no display
   and no toplevel — which is what CI verifies and what session 0 forces (§ *What
   a real Windows desktop added*). Decision 3's named API is
   `WebKit.WebView.get_hosting_mode()` → `WebKit.HostingMode.OVERLAY` plus
   `get_overlay_constraints()`, which reports the arrangements the view is
   actually in that an overlay cannot honour and warns once per view for each.
   The pump is a `GSource` refcounted on live views, attached at construction,
   and `WebKit.MessagePumpState` + a named `GError` on every content-level call
   is what makes its absence loud instead of an eight-second timeout.
   **The page side of `script-message-received` is ONE preamble per view, not one
   shim per handler**, and that is an ordering finding rather than a style
   choice: WebView2 runs `AddScriptToExecuteOnDocumentCreated` scripts in
   registration order while WebKitGTK's message handlers are not scripts at all,
   so a per-handler shim runs *after* any user script registered before it — and
   `@gjsify/iframe`'s bootstrap script posts at document-start. One
   auto-vivifying `window.webkit.messageHandlers` installed ahead of everything
   else removes the question instead of answering it per call.

   **The load test is the assertion, not the build**: `scripts/probe-win32.mjs`
   loads a document through node-gi, waits for `LoadEvent.FINISHED`, reads a
   marker back out of the DOM with `evaluate_javascript` and captures a PNG — a
   `getGType` probe would have gone green on an artifact that cannot load a page.
   **It has not run yet.** The MSVC job failed on its first run, before staging,
   with `C1083` on the seam header: the library target carried no
   `include_directories`, so a quoted include from `src/cpp/` could not reach
   `src/c/` — invisible everywhere else, because `src/cpp/` is the one translation
   unit no other host compiles. `scripts/check-include-paths.mjs` now holds every
   quoted include to the target's include path on the Fedora job, which is the
   cheap half of that failure: the symptom needs MSVC, the cause is a path that
   does not exist.
4. `gjsify ship windows`: the runtime dependency from decision 5. **NOT DONE.**
   Read § *What a real Windows desktop added* before writing the detection.
5. Only then stage 2, as its own ADR amendment with its own measurements.

### What stage 1 does not do

Each fails loudly rather than silently, because that is the difference between a
subset and a lie:

- **A user script carrying an allow or block list is REFUSED**, with a warning.
  WebView2's injection point has no URL filter, and ADR 0022 records what
  warning-and-injecting-anyway costs: a script running on an origin the caller
  excluded is the exact failure a block list exists to prevent. Refusing narrows
  in the safe direction for both list kinds. Porting darwin's in-script guard is
  what closes it; it is outside decision 4's counted subset, and the two copies
  it would create is why it was not simply lifted.
- **Named script worlds are ignored**, with a warning from EVERY entry point that
  takes one. WebView2 has no public isolated-world API, where `WKContentWorld`
  gave darwin one — so the same call is isolated there and not here, which is why
  a warning and not silence. Three of the four entry points
  (`evaluate_javascript`, `register_script_message_handler`,
  `unregister_script_message_handler`) originally dropped the argument with a bare
  `(void) world_name;` on the reasoning that `UserScript` had already warned; a
  caller reaches any of them without ever constructing a `UserScript`, so nothing
  warned at all. One warner, once per world NAME, named by call site, asserted by
  `probe-types.js` (the two display-free paths) and `probe-win32.mjs` (the third).
- **`SnapshotOptions` other than `NONE` are ignored**, with a warning.
  `CapturePreview` has no transparent-background and no selection-highlighting
  option. This was the one divergence that fell SILENTLY — a bare
  `(void) options;` in the engine, in no list — and it stayed invisible because
  `@gjsify/iframe` only ever passes `NONE`.
- **`Settings.allow-file-access-from-file-urls` is not offered at all.** It was
  installed, readable and writable, and the value never crossed the seam, so
  setting it was a no-op with no diagnostic — which is what the type's own rule
  ("a silently-ignored setting is worse than an absent one") forbids. WebView2's
  equivalent is a browser-command-line switch on the process-wide environment
  rather than a per-view setting, so honouring it is not a one-line change. An
  absent property at least raises a GJS warning at the call.
- **`evaluate_javascript`'s `source_uri` is ignored WITHOUT a warning**, and that
  asymmetry is deliberate: `ExecuteScript` has no source-URI parameter, and the
  argument changes nothing observable except the text attributed to a script in
  an error. Warning for a cosmetic loss is how the behavioural warnings beside it
  get tuned out.
- **`SnapshotRegion.FULL_DOCUMENT` returns the viewport**, with a warning.
  `CapturePreview` captures what is laid out. Both snapshot divergences are
  reported by the PORTABLE layer at the call rather than by the engine: they are
  properties of the API contract, so a caller whose snapshot never arrives for
  want of an engine or a pump still learns that the arguments would not have been
  honoured either.
- **`Settings.enable-write-console-messages-to-stdout` is not honoured** —
  no console-forwarding API short of a DevTools Protocol session.
- **An unregistered script-message channel accepts `postMessage`** where
  WebKitGTK leaves the handler `undefined` and the page gets a TypeError. That
  falls out of the ordering fix below, and the host warns once per unknown
  channel rather than discarding the message in silence.

## Do not

- **Do not build WebKit for Windows because the namespace says WebKit.** The
  WinCairo port would still need the GI binding written and the widget built —
  every cost this ADR describes — *plus* a browser-engine build and a
  several-hundred-megabyte artifact per release, to arrive at the same
  architecture. The namespace is a contract about API shape. It is not a promise
  about the engine, and ADR 0022 already made the engine substitution once.
- **Do not start with Visual hosting because it is the one that matches darwin.**
  It is stage 2 for a reason: it moves input routing, coordinate transforms,
  rasterization scale and focus into our code, and focus specifically has no
  documented answer in that mode today.
- **Do not reach for `CapturePreviewAsync` as the frame transport.** It is an
  image encoder. It is the right tool for question 3's *number* and the wrong
  tool for every frame after the first.
- **Do not assume the Win32 message queue is pumped just because GTK4 runs on
  Windows.** That is the same assumption, one platform over, that made
  `didFinishNavigation` never fire on darwin — and measured here, it is false in the
  same direction: without a dispatch, `NavigationCompleted` never arrives. Do not
  read that as "everything needs the pump" either: the environment and controller
  callbacks arrive without one, so a backend can get a long way into its own setup
  before the gap shows.
- **Do not let stage 1 ship as "a web view widget on Windows".** It is an
  OS-composited overlay that happens to occupy a widget's allocation. Naming it
  accurately in the release notes costs one sentence; not naming it costs the
  first consumer who puts it in a scroller.
