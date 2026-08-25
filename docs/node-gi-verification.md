# node-gi — build, test and verification (conformance, installed-tests port, display capstones)

> Contributor detail for [`packages/node-gi/node-gi/README.md`](../packages/node-gi/node-gi/README.md)
> and [`packages/node-gi/AGENTS.md`](../packages/node-gi/AGENTS.md).
> Paths are relative to `packages/node-gi/node-gi/` unless stated otherwise.

Why this lives here and verbatim: the capstone recipes below are the exact environment a
green run needs, and a display suite re-run with a different `GSK_RENDERER` / `GDK_BACKEND` /
`NODE_GI_NATIVE` measures something else and reports it as a node-gi defect. Each one also
records the engine gaps it exposed and how they were fixed — the part a shortened rule loses
first, and the part the next port needs.

## Build & test

```bash
npm install          # prebuild if one is staged, else node-gyp (scripts/install.mjs)
npm test             # node --test (full suite, Node — authoritative)
npm run test:gc      # node --test --expose-gc (toggle-ref GC-stress leg)
npm run test:bun     # conformance subset on Bun   (needs `bun`)
npm run test:deno    # conformance subset on Deno  (needs `deno`)
npm run build:prebuild   # node-gyp rebuild + stage prebuilds/<platform>-<arch>/
# or rebuild explicitly:
npm run rebuild
```

The load order prefers a staged `prebuilds/<platform>-<arch>/node_gi.node` over
`build/Release` (the consumer/Deno install path). Local verification always runs
the **just-built** addon instead: the Node test scripts pin `NODE_GI_NATIVE=build`
and the bun/deno runner defaults to it — without that, a stale staged prebuild
silently shadows your build. CI's cross-runtime job sets `NODE_GI_NATIVE=prebuild`
to keep validating the prebuild load path with a freshly staged binary.
`NODE_GI_NATIVE` accepts `build`, `prebuild`, or an explicit path to a
`node_gi.node`. That candidate order lives in `native-paths.js` and is shared
with the `install` script, so the binary the guard decides not to rebuild is
by construction the binary the loader looks for.

In a checkout `prebuilds/` is gitignored, so `npm install` here always runs the
source build — as do the `npm install --foreground-scripts` steps in
`node-gi.yml` and the `node-gi-prebuild-*` legs in `release.yml`, which need
`build/Release/node_gi.node` for `scripts/stage-prebuild.mjs`. Set
`NODE_GI_BUILD_FROM_SOURCE=1` to force it regardless of a staged prebuild.

Two debug-only env vars instrument the toggle-ref / teardown machinery (both
parsed once at first use, zero cost when unset — never set them in production):

- `NODE_GI_TOGGLE_DEBUG=1` — stderr tracing of the GC bridge: owner-env claim,
  drain-TSFN create/release, shutdown-flag flips, teardown enqueue/drop, drain
  runs/skips (with JS-availability), and the C→JS trampoline skips at env
  teardown; each line carries the emitting thread.
- `NODE_GI_TOGGLE_TEARDOWN_DELAY_MS=<n>` — test-only latency seam (clamped to
  10s): the drain defers queued idle teardowns younger than `n` ms (re-waking
  itself), which deterministically parks teardowns — with a pending drain wake —
  across the event loop's exit. That is the regression vehicle for the
  env-cleanup drain race (`test/gc-cross-thread.test.mjs`, "teardown drain
  during env cleanup never aborts").

## Conformance (golden-diff)

The exactness oracle for GJS parity: small self-contained `gi://` programs
under `conformance/programs/*.conf.mjs` run UNCHANGED on all four runtimes —
gjs natively (`gjs -m`, ambient `print`), node/bun/deno via a lightweight
generated runtime twin (the `globals.js` shim + `requireGi`, no bundler) — and
every runtime's **stdout must be byte-identical to the committed golden**
(`conformance/golden/<name>.txt`). **gjs is the reference**: the goldens ARE
the gjs output, and a gjs↔golden drift fails loudly (either GJS changed or the
golden is stale — never paper over it).

```bash
npm run test:conformance                          # full matrix (gjs × node × bun × deno)
node scripts/conformance.mjs --runtimes=gjs,node  # runtime subset (gjs/node never auto-skip)
node scripts/conformance.mjs --filter=variant     # program subset
node scripts/conformance.mjs --update-golden      # regenerate goldens from gjs
```

Adding a program: drop `conformance/programs/<name>.conf.mjs` — default
imports of the exact shape `import Gio from 'gi://Gio?version=2.0';` only
(regex-rewritable to `requireGi`), output via the GJS-ambient `print()`,
strictly deterministic (no versions, paths, hostnames, timing; the runner sets
`LC_ALL=C`), ends cleanly — then `--update-golden`, eyeball the golden for
determinism, and commit both. Every feature PR extends this suite.

The ledger contract (`conformance/ledger.json`) is strict: every known-failing
program×runtime combo is a **committed entry**
`{ "program", "runtime", "reason", "issue"? }` — a failing combo *not* in the
ledger fails the run, and a passing combo still *in* the ledger fails as a
stale entry (remove it). Exit 0 means zero unexpected results; there are no
silent exclusions (bun/deno merely report `skipped` when not installed — gjs
and node never skip).

### Tier B — GJS installed-tests port

The breadth oracle: GJS's own installed-tests
(`refs/gjs/installed-tests/js/testGIMarshalling.js`) encode GJS's marshalling
behavior against the purpose-built `GIMarshallingTests-1.0` typelib.
`gimarshalling/testGIMarshalling.port.mjs` is a near-verbatim port of that
file to `node:test` via a minimal jasmine shim
(`gimarshalling/jasmine-shim.mjs`), mapping the WHOLE upstream surface:
already-green sections run live, everything else is a `describeSkip` stub
naming the upstream section. Assertions are never weakened.

```bash
npm run test:gimarshalling   # builds the pinned typelibs if missing, then runs the port
```

`scripts/build-gi-test-typelibs.mjs` builds the test typelibs reproducibly
from GNOME's gobject-introspection-tests project at the **pinned revision**
GJS itself tests against (`PINNED_REV`, copied from
`refs/gjs/subprojects/gobject-introspection-tests.wrap`) into the gitignored
`.gi-tests/` (meson + ninja required; cairo disabled; Regress builds too).
The launcher (`scripts/gimarshalling.mjs`) sets `GI_TYPELIB_PATH` /
`LD_LIBRARY_PATH` before spawning `node --test` — dlopen cannot pick up late
env changes — and pins `NODE_GI_NATIVE=build`. The port files are named
`*.port.mjs` so the default `npm test` glob never picks them up.

**Skip contract (strict, mirrors the tier-A ledger):** every skipped
spec/suite carries a reason — a phase-2.x roadmap item from the taxonomy at
the top of the port file (e.g. `phase 2.1 BigInt-64-bit`), an upstream issue
URL, or a `FIDELITY-BUG: …` note — and the reason is reported in the
`node:test` output (`# SKIP <reason>`). A bare skip throws (`pending()`,
`itSkip`, `describeSkip` all require the reason; `xit` must chain
`.pend(reason)`). Later marshalling PRs un-skip their sections — this port is
phase 2's acceptance gate.


## Display capstones — local/dev verification

Each capstone answers one question no headless program can: does a REAL toolkit surface
realize, react and render through node-gi? They are local/dev suites, not CI gates (except
where noted): they need a display, the addon, and a WORKSPACE-built `@gjsify/cli`, so they
self-skip everywhere else. The `NODE_GI_*_SKIP_GJS` variables drop the second, `gjs -m` leg
that re-proves the committed golden IS gjs's own output.

### The live `@gjsify/event-bridge` dispatches DOM events on node-gi

The GTK→DOM event bridge (`@gjsify/event-bridge`'s `attachEventControllers`) —
which attaches GTK4 `EventControllerMotion`/`GestureClick`/`EventControllerScroll`/
`EventControllerKey`/`EventControllerFocus` to a widget and dispatches W3C DOM
events (Mouse/Pointer/Keyboard/Wheel/FocusEvent) — runs UNCHANGED on node-gi. The
shared fixture presents a `Gtk.DrawingArea`, attaches the controllers, and drives a
SYNTHESIZED event through each live `Gtk.EventController*` via `emit(signal, …)`
(the same path the GJS `event-bridge.spec.ts` drives), then asserts the dispatched
DOM event's type / coords / `getModifierState` / key / code. The `Gdk.ModifierType`
flags and `Gdk.keyval_name`/`Gdk.keyval_to_unicode` marshalling produce
byte-identical DOM events under node-gi and `gjs -m` — the same source builds
`--app gjs` and `--app node` and prints the committed golden
(`test/event-bridge.test.mjs` + `fixtures/event-bridge-app.ts`). Every golden line
is deterministic + display-independent (coords clamp to a fixed 400x300 allocation;
key/code/modifiers derive from the Gdk marshalling), so byte-parity is stable.

**`instanceof` across the GObject hierarchy (GJS parity):** `instanceof` for GObject
wrapper classes is wired through the GObject type system — each per-GType wrapper
carries a `Symbol.hasInstance` that resolves via `g_type_is_a` (native
`isInstanceOf`), so `new Gtk.EventControllerMotion() instanceof
Gtk.EventControllerMotion` is `true`, and so is a base class (`… instanceof
Gtk.EventController`), an implemented interface (`simpleAction instanceof Gio.Action`)
and a `registerClass` subclass against its leaf / base / interface — while a sibling
type, an unrelated class, a boxed/`Variant` handle, `null` or a plain object stay
`false`. `test/instanceof.test.mjs` + the cross-runtime golden
`conformance/programs/instanceof-hierarchy.conf.mjs` (gjs/node/bun/deno byte-identical)
guard it. The event-bridge fixture retrieves controllers by ADD ORDER off
`widget.observe_controllers()` as a stylistic choice (identity is preserved and
`emit()` resolves the signal by the live GType) — no longer forced by a gap.
(A second gap the fixture originally routed around — `new
Gdk.Rectangle()` threw `no static method 'new'` — is FIXED: `new <BoxedStruct>()`
now zero-allocates with GJS `gi/boxed.cpp` semantics when the struct has no `new`
constructor (`Graphene.Rect`/`Point`, `Gdk.Rectangle`, `Gdk.RGBA` — the
`@gjsify/devtools` screenshot chain), routes to `new` when it exists, and throws
a clear error for args without one; `test/struct-construct.test.mjs` guards it,
gjs-parity included. The fixture still reads the presented window's real
allocation — simpler and display-truthful.)

**Run it (needs a display + a built workspace + the `gjsify` CLI; self-skips
otherwise):**

```sh
# node-gi (--app node) — the authoritative check vs the committed golden:
export GJSIFY_BIN="$(git rev-parse --show-toplevel)/packages/infra/cli/lib/index.js"
xvfb-run -a dbus-run-session -- \
  env GSK_RENDERER=cairo GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1 GTK_A11Y=none \
      NODE_GI_NATIVE=build NODE_GI_EB_SKIP_GJS=1 GJSIFY_BIN="$GJSIFY_BIN" \
  node --test test/event-bridge.test.mjs
# Drop NODE_GI_EB_SKIP_GJS to additionally re-prove the golden IS gjs's own output
# (builds + runs --app gjs; needs the workspace CLI, not the published one).
```

`GJSIFY_BIN` must point at the WORKSPACE-built `@gjsify/cli` (`packages/infra/cli/lib/index.js`),
not the published `@gjsify/cli` — the fixture is built with current source, which
carries this session's bundler fixes the published `0.18.0` predates.

### WebGL / `Gtk.GLArea` (the gwebgl seam)

**Definitive: a `Gtk.GLArea` realizes and hands JS a LIVE, CURRENT GL context
under node-gi on a headless software-GL display.** Verified end-to-end by
`test/webgl-glarea.test.mjs` + the ONE dual-runtime source
`fixtures/webgl-glarea-app.ts`: a presented `Gtk.ApplicationWindow` holding a
`Gtk.GLArea` configured exactly like `@gjsify/webgl`'s `WebGLBridge`
(`set_use_es(true)`, `set_required_version(3, 2)`, depth + stencil) realizes
with `get_error() === null`, an **OpenGL ES 3.2** context
(`Gdk.GLContext.get_current()` non-null in both `realize` and `render`), and
the `gwebgl` Vala bridge (`new Gwebgl.WebGLRenderingContextBase()` — the native
class `@gjsify/webgl` wraps) works through it: `getString(GL_VERSION/…)`, a
`getParameterx` **GVariant** round-trip, and a real WebGL draw —
`clearColor(1,0,0,1)` + `clear` + `readPixels` reading back the exact
`255,0,0,255` pixel. The committed golden is byte-identical between `gjs -m`
and `node` (the gjs gold-standard leg re-proves it wherever `gjs` is present;
`NODE_GI_WEBGL_SKIP_GJS=1` skips that leg).

The GL/display env the golden is pinned to (software GL, no GPU needed):

```bash
# X11 (Xvfb or a real display) + mesa llvmpipe + GTK compositing off GL:
xvfb-run -a dbus-run-session -- \
  env GSK_RENDERER=cairo GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1 GTK_A11Y=none \
    NODE_GI_NATIVE=build node --test test/webgl-glarea.test.mjs
# GL under llvmpipe: "OpenGL ES 3.2 Mesa …" / "llvmpipe (LLVM …)".
```

**The FULL `@gjsify/webgl` `WebGLBridge` runs too** (same test file, second
fixture `fixtures/webgl-bridge-app.ts`): the complete TS WebGL stack UNCHANGED —
`WebGLBridge` (a `registerClass` `Gtk.GLArea` subclass), `onReady` handing out
`HTMLCanvasElement` + `WebGLRenderingContext` (constants GHashTable, the
`_init()` `getParameterx` GVariant reads, eager WebGL1+2 context construction),
and browser-standard `clearColor(0,0,1,1)` + `clear` + `readPixels` reading the
blue clear back (`bridge-pixel(0,0): 0,0,255,255`), byte-identical gjs ↔ node.
Shader/buffer/texture breadth (a three.js triangle/teapot) is the remaining
follow-up — the seam + context stack are proven.

The tests self-skip without a display, without a `gjsify` CLI, or without the
committed `Gwebgl-0.1` prebuild (`packages/framework/webgl-linux-*/prebuilds/`,
which the test itself puts on `GI_TYPELIB_PATH`/`LD_LIBRARY_PATH`); the bridge
test additionally skips when `@gjsify/webgl` is not built. The fixture build
needs a WORKSPACE-built `@gjsify/cli` (point `GJSIFY_BIN` at
`packages/infra/cli/lib/index.js` after
`gjsify workspace @gjsify/cli build --with-dependencies`), like
`canvas2d-bridge`; the gjs gold-standard leg additionally needs the workspace
register libs built (`--app gjs` force-inlines `<pkg>/register`). Two engine
gaps this spike fixed on the way (headless regression coverage in
`test/gerror-return.test.mjs`): GError-typed RETURNS
(`Gtk.GLArea.get_error()` — `GI_TYPE_TAG_ERROR` → a field-readable GLib.Error
boxed) and literal-first method-name resolution (Vala GIRs carry camelCase
names — Gwebgl's `getString` — which the unconditional camelCase→snake_case
alias destroyed; the engine now resolves the literal name first, alias second).

### Excalibur.js renders through WebGL on node-gi (the GTK-bridge capstone)

**Definitive: a REAL WebGL game engine — Excalibur 0.32, the engine behind the
`excalibur-jelly-jumper` showcase and the PixelRPG map-editor — boots, runs its
clock, and renders frames through `@gjsify/webgl`'s `WebGLBridge` UNCHANGED
under node-gi** (`test/excalibur-webgl.test.mjs` + the ONE dual-runtime source
`fixtures/excalibur-webgl-app.ts`). `new ex.Engine({ canvasElement })` builds
against the bridge's `HTMLCanvasElement` (WebGL2 context), `engine.start()`
resolves, the engine's real render pipeline runs (shader compile/link,
`bufferData`, VAOs, `vertexAttribPointer`, `drawArrays`/`drawElements`,
`clearBufferfv` at `RenderTarget.blitToScreen`) for 5 frames, and the committed
golden asserts the pixels read back off the GL framebuffer — the screen-centered
blue Actor and the red engine clear color — **byte-identical between `gjs -m`
and `node`**. The DOM surface (document/HTMLCanvasElement/ResizeObserver/
matchMedia/XHR) comes from the SAME `@gjsify/*` registers the gjs build injects,
via the `--app node` explicit-`--globals` reverse-bridge injection.

Excalibur's real GL + engine usage exposed four core gaps, all fixed at the
engine (each with regression coverage):

- **`GVariant 'ay'` rejects `null`** (`src/variant.cc`) — GJS packs
  `new GLib.Variant('ay', null)` as the EMPTY byte array (`GLib.Bytes(null)`);
  node-gi threw. Exposing call: Excalibur's `texImage2D(..., null)`
  blank-texture allocation at renderer init (`Uint8ArrayToVariant(null)`).
- **Unknown members must be `undefined`, not a throw-on-call thunk**
  (`src/calls.cc` `hasMethod` + the L1 wrapper `get`) — real consumers
  feature-detect optional native methods (`typeof gl.clearBufferfv ===
  'function'` gates `@gjsify/webgl`'s clearBuffer emulation, hit at
  `blitToScreen`); the old always-a-function proxy made that detection lie,
  then threw mid-frame. `hasMethod(handle, name)` resolves through the SAME
  literal-first/snake-alias walk `callMethod` uses.
- **Signal dispatch now runs the microtask checkpoint at its boundary**
  (`src/signals.cc`, `napi_make_callback`) — GJS drains the promise-job queue
  when the outermost JS frame exits; promise chains resolved inside a
  loop-dispatched signal handler (Excalibur's whole `engine.start()` boot,
  queued from the GLArea `render`/`onReady` dispatch) previously lingered
  until the libuv↔GLib bridge's prepare-phase drain.
- **The uv co-pump source must not outrank GTK painting** (`src/loop.cc`) —
  at the default `G_PRIORITY_DEFAULT` a busy Node loop STARVED
  `GDK_PRIORITY_REDRAW`: Excalibur's `requestIdleCallback` polyfill (a
  self-re-arming 1 ms `setTimeout`, run perpetually by its GarbageCollector)
  kept the UvLoopSource ready on every GLib iteration, so ticks/renders/rAF
  froze while plain GLib timeouts kept firing. The source now sits below
  redraw (`G_PRIORITY_HIGH_IDLE + 30`): rendering outranks Node timers,
  browser-like, and Node I/O still runs in every frame gap.

Run it (a LOCAL/dev verification like the other display suites — self-skips
without a display / CLI / prebuild / built workspace):

```sh
export GJSIFY_BIN="$(git rev-parse --show-toplevel)/packages/infra/cli/lib/index.js"
xvfb-run -a dbus-run-session -- \
  env -u FORCE_COLOR GSK_RENDERER=cairo GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1 \
      GTK_A11Y=none NODE_GI_NATIVE=build GJSIFY_BIN="$GJSIFY_BIN" \
  node --test test/excalibur-webgl.test.mjs
# Drop NODE_GI_EXCALIBUR_SKIP_GJS to additionally re-prove the golden IS gjs's
# own byte-output (builds + runs --app gjs).
```

The FULL `excalibur-jelly-jumper` showcase builds `--app node`
(`gjsify run build:node`; `gjsify.example.runtimes` includes `node`) and gets
remarkably far on node-gi: the GTK window presents, the devtools control plane
exports over DBus, `Gst.init` runs and every `ex.Sound` constructs its
Gst-backed `AudioContext` (this exposed + fixed the nullable-array `null`
marshalling — `Gst.init(null)`), and Excalibur boots into resource loading.
The remaining blocker is POLYFILL ROUTING, not marshalling: on Node the
GLOBAL `fetch` is the native undici one (the register convention never
overrides an existing native), and `@excaliburjs/plugin-tiled`'s fileLoader
feeds it the root-relative `/res/…` paths that only OUR GJS fetch/XHR resolve
against the program dir — undici rejects them (`Failed to parse URL`), the
Tiled map never loads, and scene init fails. Making the reverse bridge route
`fetch` (and friends) to the `@gjsify/*` polyfills over the runtime natives is
the follow-up that unlocks the full game. (`jsdom` — plugin-tiled's node-side
DOMParser fallback — is aliased to `@gjsify/empty` in `build:node`, mirroring
the plugin's own `"browser": { "jsdom": false }`.)

### A real Adwaita WINDOW realizes + renders (the GTK-GUI capstone)

Beyond the display-free conformance: an UNCHANGED `Adw.Application` +
`Adw.ApplicationWindow` (HeaderBar / WindowTitle / StatusPage) not only
constructs + presents but **realizes and RENDERS a surface** through the GSK
renderer on node-gi — the same in-process capture path `@gjsify/devtools`'
`Screenshot` uses: `Gtk.WidgetPaintable` → `Gtk.Snapshot.to_node()` →
`Gsk.Renderer.render_texture` → `Gdk.Texture.save_to_png_bytes`. A non-empty PNG
is the unambiguous proof that a `GdkSurface` was allocated + a GSK render tree
rasterised — not reachable by any headless program. Guarded by
`test/windowing.test.mjs` + `test/windowing-interactive.test.mjs` (an
`Adw.ApplicationWindow` that RESPONDS to a `Gio.SimpleAction` + a
`Gtk.Button::clicked` through the node-gi signal chain) + `test/widgets.test.mjs`
(the Adwaita widget breadth below) — all self-skip without a display on Linux (the
win32/darwin GDK backend supplies its own display, so they run there), wired into
the Linux `gtk-smoke` + the Windows windowing CI jobs. The
`showcases/gtk/node-gi-window` showcase runs the SAME single source on both GJS
and Node and screenshots the live window over the `org.gjsify.Devtools` DBus
surface.

This exposed one core gap, fixed at the engine:

- **Non-GObject GObject-fundamentals wrap through their introspected ref/unref,
  not `WrapGObject`** (`src/object.cc` `MakeFundamentalHandle` + the
  `src/marshal.cc` return branch). `Gtk.Snapshot.to_node()` returns a
  `GskRenderNode` — introspected as OBJECT_INFO but a GObject FUNDAMENTAL
  (`gi_object_info_get_fundamental`), ref-counted via `gsk_render_node_ref/unref`,
  NOT `g_object_ref`, with `G_IS_OBJECT` FALSE. Routing it through `WrapGObject`
  ran the toggle-ref/qdata dance on a non-GObject → a cascade of
  `g_object_*: assertion 'G_IS_OBJECT (object)' failed` criticals AND a leaked ref.
  It now gets a type-tagged External carrying the raw pointer + the introspected
  unref func as the finalizer hint (`isFundamentalHandle` / L1 `wrapFundamental`,
  an opaque round-trippable pass-through) — GParamSpec + GValue keep their
  dedicated branches, this catches the rest.

### Adwaita widget breadth realizes + reacts + renders

Beyond one window's chrome: a representative slice of the REAL Libadwaita widget
set constructs, RENDERS and REACTS on node-gi. `test/widgets.test.mjs` builds an
`Adw.PreferencesPage` / `Adw.PreferencesGroup` of `Adw.ActionRow`, `Adw.SwitchRow`,
`Adw.EntryRow`, `Adw.ComboRow` (a `Gtk.StringList` model), `Adw.SpinRow` (a
`Gtk.Adjustment`) and `Adw.ExpanderRow`, plus a `Gtk.ListBox` and a dismissible
`Adw.Toast` via an `Adw.ToastOverlay`. Two tiers, robust on a runner whose surface
may or may not realize:

- **DumpTree** — the widget tree contains every expected type (`AdwSwitchRow`,
  `AdwComboRow`, `AdwEntryRow`, `AdwSpinRow`, `AdwExpanderRow`, `AdwPreferencesPage`,
  `GtkListBox`, …), read via the runtime GType (`$typeName`) the `@gjsify/devtools`
  DumpTree uses — so each class constructs + parents correctly through node-gi.
- **Interaction** — toggling the switch, changing the combo selection, moving the
  spin value, expanding the expander and setting the entry text all drive
  OBSERVABLE property changes AND fire their paired `notify::<prop>` handlers, and a
  toast add → `dismiss()` fires `::dismissed`. This surfaces the `Gtk.StringList` /
  `Gtk.Adjustment` model marshalling (GListModel + object construct props),
  `notify::` property signals and the boxed-model paths — all display-independent, so
  the interaction + DumpTree tier holds headless on Windows CI.
- **Render** — when the surface realizes, the whole preferences surface rasterises
  through the GSK renderer (a non-empty PNG), the strong proof the broad widget set
  renders, not just constructs.

The same widgets back the `showcases/gtk/node-gi-window` "Settings" view (an
`Adw.ViewStack` page reachable from the bottom `Adw.ViewSwitcherBar`, beside the
counter). No engine change and no windowing-bundle change were needed: the rows are
core GTK4/Adwaita widgets backed by the already-bundled `gtk-4-*.dll` / `libadwaita-1`
and the full Adwaita icon theme + compiled schemas the `--windowing` bundle already
ships.

Scoped out of the capstone fixture itself (deliberately): the Gst audio
DECODE/playback path (`decodeAudioData`, `autoaudiosink`) — construction is
proven by the showcase run above, the streaming pipeline is its own follow-up
surface.
