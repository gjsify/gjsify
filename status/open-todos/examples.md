<!-- Authored Open-TODO sections — area: Examples and showcases.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### Excalibur's own renderer swap runs on GJS but never reaches the screen

Found closing #1107. `Engine.useCanvas2DFallback()` is `canvas.cloneNode(false)` →
`parentNode.replaceChild` → `getContext('2d')`, and all three now work (the clone and the
degenerate-transform fixes landed with #1107). Measured after that: it completes without
error and draws at 2–11 ms per frame for 840+ frames — into nothing. The replacement canvas
has no GTK widget behind it, so the GLArea simply stops being drawn into and the canvas area
goes blank (verified with an in-process GSK capture, not a desktop screenshot).

In a browser the compositor paints whatever canvas the DOM holds; here the WIDGET is the
canvas, and it is bound to the element it was constructed with. Making the swap visible means
the widget has to follow the canvas its DOM parent now holds. The shape that fits this repo is
a presenter-factory registry mirroring the existing `HTMLCanvasElement.registerContextFactory`
— `@gjsify/canvas2d` registers a Cairo presenter, `@gjsify/webgl` asks the shared DOM package
for one rather than depending on canvas2d directly. That is a new cross-package contract, so
it wants an ADR before implementation.

Until then a consumer that must degrade has to swap the GTK widget itself, which is what
`jelly-jumper-window.ts` already does on a `startGame()` rejection.


### jelly-jumper does not run in a browser

Its `--app browser` build renders the Adwaita chrome and nothing else; the canvas stays at the
default 300×150. Driven through safaridriver on the macOS test VM (Safari 26.6):

- `getContext('webgl2')` returns a context that is ALREADY lost (`isContextLost() === true`)
  on this GPU-less host, so `createShader()` returns null and Excalibur reports
  *"could not load webgl (Argument 1 ('shader') … must be an instance of WebGLShader)"*.
- Its constructor-time 2D fallback then fails too — it calls `getContext('2d')` on the SAME
  canvas that already has a webgl2 context, which can only return null: *"Cannot build new
  ExcaliburGraphicsContext2D"*. Only `useCanvas2DFallback()` clones the canvas; this path does
  not. That one is upstream Excalibur.
- Follow-on: `TypeError: undefined is not an object (evaluating 'this.clock.stop')`.

Not a polyfill leak — `WebGLShader`, `WebGL2RenderingContext`, `HTMLCanvasElement`,
`CanvasRenderingContext2D` and `Image` are all native in that bundle, checked. How much of this
is the GPU-less VM and how much would also fail on a real GPU is unmeasured, and deciding that
is the first step.

Two smaller things found alongside: `dist/index.html` links `./browser.css`, which neither
exists in `src/browser/` nor is produced by `build:assets` — a hard 404 on every load. And the
browser build failed outright until `@gjsify/adwaita-core` was rebuilt (129 `MISSING_EXPORT`s
from its stale `lib/esm/index.js`), which no `build:browser` run tells you to do.

Also worth knowing for anything that reasons about renderers: **Safari does not expose
`WEBGL_debug_renderer_info` at all**. The extension gjsify implements is the Chrome/Firefox
spelling; on Safari an app cannot learn its renderer by any means.


### Stale PixelRPG maker bundle — rebuild + recommit with `installDevtools`

`@gjsify/devtools` exports `org.gjsify.Devtools` correctly in every app config (verified rigorously, guarded by `tests/e2e/devtools-export`), and the css-as-string bare-`@import` gap that blocked the maker's rebuild under the global GJS CLI is fixed at the core (native `bundle()` path resolves + inlines bare-specifier `@import`s via `cssBundleResolver`; unresolvable imports fail loudly; `tests/e2e/css-as-string-bare-import`). Residual (map-editor repo, not gjsify): the committed `apps/maker-gjs/org.pixelrpg.maker` bundle predates the `installDevtools(this)` call — rebuild + recommit it. `installDevtools` logs `[gjsify-devtools] exported …` so "did devtools come up?" is answerable from the app's stderr.

