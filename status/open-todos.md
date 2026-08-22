<!-- Authored Open-TODO sections — THIS FILE is the tracked source of truth (the
     rendered STATUS.md view is generated and gitignored). One `### <title>` per open item.
     A RESOLVED item is DELETED (its record is the commit + CHANGELOG that closed
     it) — the status-data check rejects struck-through / ✓ / "Completed"
     headings, so the done-log cannot regrow. -->

### No CI leg ever LAUNCHES a template on node, bun or deno

`gjsify.example.runtimes` on the seven templates declares four runtimes, and
`run.ts:238` validates `--runtime` against exactly that list, so the declaration
has teeth for the user and none for us. The BUILD half is now machine-checked (a
static case in `tests/e2e/create-app/run.mjs` holds every template to the
dependency closure its `--globals` list implies, which is what caught the pnpm and
Deno build failures). The LAUNCH half is still hand-verified: all sixteen
template x runtime combinations were run by hand, and one was confirmed end to
end, a deno-built `adw-canvas2d` with a real mapped toplevel.

Why nothing covers it today: `scripts/showcase-smoke.mjs` derives its matrix from
`packagesUnder(showcases/)` with `BOOTSTRAPPED_COLUMNS = ['gjs']`, and templates
are not under `showcases/`; `verify-package-outputs.mjs` skips them because all
seven are private. The two ways to close it, teaching showcase-smoke to derive
from `templates/` as well, or adding twelve GUI launch legs to the create-app
e2e, are both CI-matrix work with real flake surface: private D-Bus, Xvfb, dwell
timers, runaway GUI processes.

Deferred rather than half-built, and the two halves are not equally urgent: the
build half had a live blocker behind it, this one has a verified-true claim.

### The BUILD still does not name a discarded CSS side-effect import

`gjsify/no-css-side-effect-import` (oxlint) catches the shape in THIS tree, on
every PR. A consumer building through `gjsify build --app browser` does not run
our lint config, and for them the discard is still a silent exit 0:
`cssAsStringPlugin` returns `export default "<css>"`, tree-shaking removes it,
nothing is emitted and nothing is said. Measured on 0.41.0: a probe entry whose
only statement is `import '@gjsify/adwaita-fonts';` produces a **0-byte bundle
with zero `@font-face`**.

Why it is not in the plugin already, which is where it belongs. The hooks that
can see "this module was loaded and then dropped" are
`generateBundle`/`renderChunk` payloads and `this.getModuleInfo(id).importers`.
None of them exists on the `@gjsify/rolldown-native` bridge:
`packages/infra/rolldown-native/src/ts/plugins.ts` invokes every lifecycle hook as
`handler.call(ctx)` with NO arguments, `renderChunk` receives only
`{fileName,name,isEntry}`, and the plugin context exposes `resolve`/`warn`/`error`
and nothing else. A diagnostic built on any of them would fire under npm rolldown
and silently not exist under GJS — a green gate that checked nothing, on the
runtime this repo targets.

The engine-symmetric hooks are `resolveId` and `transform`, and both are
per-import / per-module: under the native bridge that is one extra IPC round trip
per specifier, or every module's source across the GI boundary, paid by every
build. That is the trade to make deliberately, with a measurement of what it costs
a real build (`dist/cli.gjs.mjs` is the honest subject — thousands of modules),
and probably alongside extending the bridge so `generateBundle` carries its
bundle. Until then the class is held by the lint rule, and this note is the record
that the consumer-facing half is missing rather than solved.

### `@gjsify/adwaita-fonts` ships desktop TTFs, which is why the web font is opt-in

The package vendors `adwaita-sans-400.ttf` (880 KB) and its italic (910 KB) — the
upstream DESKTOP faces, unsubsetted, not web fonts. That decides the shape of
everything downstream. Inlined as base64 (the only form that survives a
`--app browser` build, which emits one file and no assets):

| | bytes | gzip -9 |
|---|---:|---:|
| `@gjsify/adwaita-web` stylesheet | 190 731 | 25 891 |
| `+` sans 400 | 1 363 795 | 594 177 |
| `+` sans 400 + italic | 2 577 599 | 1 205 683 |

So the faces travel behind an explicit `applyAdwaitaFonts()`
(`@gjsify/adwaita-web/fonts`) rather than in the root entry, and
`status/stylesheet-font-families.json` carries that as the reason the stylesheet
names a family it does not carry. A fontsource-style **woff2, subsetted per
unicode-range**, is 15-40 KB a slice — at which point inlining by default stops
being a question and the ledger entry retires itself.

What blocks it is not code: producing woff2 means committing NEW font binaries
(or adding a font toolchain to the build), and that is a licensing and repository
decision, not a fix. Same call for **Adwaita Mono**, which this package does not
ship at all: `refs/adwaita-fonts/mono/` carries four faces of 1.4-1.5 MB each,
`--monospace-font-family` heads with `'Adwaita Mono'` for the GNOME hosts that
have it installed, and everything reading that token — `.monospace` labels, the
data-grid mono cell, `<adw-source-view>` — falls through to `ui-monospace`
everywhere else.

### `@gjsify/adwaita-storybook` still ships no typeface

The seven DOM showcases now call `applyAdwaitaFonts()`. That was this entry's own
recommendation — they are browser artifacts served to whatever opens them, so they
are exactly the place the size decision belongs, and an app may make it where a
library barrel may not.

Measured on `showcases/dom/canvas2d-fireworks/dist/browser.js`, rebuilt either way:

    before   18 033 980 B   0 @font-face   names "Adwaita Sans" twice
    after    20 421 448 B   2 @font-face   2 data: URIs      (+2 387 468 B, +13.2%)

and in real Firefox against the served artifact, `document.fonts` holds two faces
(`weight: 100 900`, normal + italic) with the normal one `status: "loaded"`. That
reading is host-independent by construction: a system-installed family never
appears in `document.fonts`, which is why the assertion is made there and not
against a computed font — on this Fedora box every one of these pages looked
correct before the change and will look identical after it. The difference is on
macOS, on Windows, and on any Linux that is not GNOME.

What still does not opt in is `@gjsify/adwaita-storybook`, whose whole purpose is
to look like Adwaita. Its entry is a barrel, and 1.18 MB gzip inside a library is
the size decision a consumer should be making, so it wants either a host that
calls the opt-in or a subsetted woff2 (the entry above) before it changes.

NO GATE holds "a showcase that renders Adwaita chrome must call the opt-in", and
that is deliberate: `applyAdwaitaFonts` is a VALUE export precisely so the silent
form cannot be written — an import that is never called does not compile away into
a green build, it simply is not an opt-in. What remains is an omission, which is
the ordinary shape of a missing feature rather than a check that passed while
nothing was verified. A gate for it would cost an incident header in a `scripts`
tree with ten lines of budget left, to catch someone not adding something.

### `<adw-source-view>` has no browser suite

It is an opt-in subpath, so `test.browser.mts` never imports it and nothing in
CI renders it. That is how `source-view/theme.ts` kept a second monospace stack
in a TS literal for its whole life while `_variables.scss` claimed the stack had
ONE home — measured on one page, `.cm-scroller` resolved to 'Adwaita Mono',
'Cascadia Code', 'JetBrains Mono', … and a `.monospace` label beside it to the
token's shorter stack. The editor now reads `var(--monospace-font-family, …)`,
verified by hand in Firefox, but nothing HOLDS it: the `stylesheet-font-families`
conformance rule reads `.css`/`.scss`, so a new literal would be invisible again.
Registering a source-view suite pulls CodeMirror into the browser test bundle,
which is why it is a note rather than part of the fix.

### `tests/browser/test-results/.last-run.json` is tracked and rewritten by every run

Every `npx playwright test` in `tests/browser` rewrites it, so verifying any
browser-facing PR the way its description says it was verified dirties the tree,
and a red run leaves a committed-looking failure record behind. Either gitignore
`tests/browser/test-results/` and `git rm --cached` the file, or — if the
last-run record is deliberately committed — say so where the browser-test
workflow is described in `tests/AGENTS.md`. Pre-existing; noticed while running
the Firefox suite for the fonts work.

### Two CI comments still say rolldown-native has no Apple target

`.github/workflows/main.yml:736-739` says it "does not compile for Apple targets
at all (its Rust core wakes the GLib loop with `eventfd(2)`)", and
`prebuilds.yml:1029-1040` lists it under "WHAT IS DELIBERATELY NOT HERE" as "not
in the REQUIRED matrix". Both are contradicted by `prebuilds.yml:1225-1570`, where
`build-prebuilds-macos` builds, stages and load-tests it on both darwin arches
with `exit $rc`, and by `prebuilds.yml:1701`, which records the promotion and says
the load test was made FATAL there.

The website prose that repeated this has been corrected, so a reader is no longer
misled. These are the upstream source of that claim, and a stale comment is how it
grows back. Left for a commit of its own because both files path-filter CI job
selection, and editing them from a docs branch is churn where it is riskiest.

### ADR 0024 §8 is unblocked: `gjsify flatpak` + `generate-installer` move under `ship`

The ADR sequenced the flatpak migration as stage 6 and gated it on one condition:
"the migration lands only once `ship` can actually stage, so the tree never carries
two staging models." Stages 2 and 3 have landed, so that condition is now met and
nothing else is holding this.

Scope, as decided 2026-08-17:

- The nine subcommands under `packages/infra/cli/src/commands/flatpak/` (build,
  check, ci, deps, diff, init, release, scaffold, sources, sync-flathub) become
  `gjsify ship flatpak <sub>`.
- `gjsify generate-installer` becomes `gjsify ship installer`. The ADR does not
  cover it, and it is not a packer: it scaffolds an `install.mjs` INTO the
  consumer's repo, which they commit, rather than reading the staged payload. It
  moves anyway because it is one of the six distribution channels the website's
  "Pick your distribution channel" table lists, and the CLI should agree with that
  table. Same category as `flatpak init` / `flatpak scaffold`, which §8 also moves.
- `gjsify build --shebang` does NOT move. It is a build output mode, not a
  packaging channel, so the line is: `ship` owns the channels, `build` owns the
  bundle shapes.

Two costs §8 names and this must pay:

- `gjsify.flatpak` is a **published config contract**. The keys move behind a
  deprecation window in which both spellings resolve and the old one warns.
- `gjsify flatpak …` is in published releases and in the Flathub sync automation,
  so the old command path needs a warning ALIAS, not a removal.

Already done, so do not redo it: the AppStream and desktop-entry renderers moved
out of `commands/flatpak/scaffold.ts` into `utils/app-metadata.ts`, and
`ConfigDataFlatpak` extends a shared base. That was §8's "the metadata half is the
app's, not Flatpak's" half.

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

### `@gjsify/sqlite` reads three value shapes back wrong

Found while adding the parameter-binding regression suite; all three are in the READ
path (`data-model-reader.ts` / libgda's data model), none of them in what gets bound, so
they were deliberately left out of the binding fix rather than bundled into it.

1. **An integral REAL past 2^53 throws instead of reading.** `convertValue()` treats any
   integral JS number over `Number.MAX_SAFE_INTEGER` as an out-of-range INTEGER and raises
   `OutOfRangeError`, but a SQLite REAL that happens to be integral — `1e21` — is not one.
   Telling them apart needs the column's storage class, which the reader never consults.
   Declared as `it.failing` in `param-binding.spec.ts`, so it retires itself when fixed.
   Node returns `1e21` here.

2. **A typeless column holding mixed types reads back as strings.** libgda types a data
   model column ONCE, so a column holding `'text'`, `42.0` and `NULL` comes back with the
   number as the string `"42.0"`. Node reads each value with its own storage class. The
   affected spec asserts `typeof(a)` per row instead, which is a homogeneous text column
   and therefore reads the same on both runtimes.

3. **`CAST(x AS TEXT)` yields an unconverted `Gda.Text` boxed value.** `convertValue()`
   has no branch for it, so it falls through and the caller gets `{}` instead of a string.

None of the three is reachable from `postbote`'s index today, which is why the binding fix
did not wait for them.

### Every callback-form `fs` entry point calls the callback from INSIDE its try

The shape, repeated across `callback.ts`, `fd-ops.ts` and `utimes.ts`:

```ts
Promise.resolve().then(() => {
    try {
        mkdirSync(path, options);
        callback(null);          // <- inside the try
    } catch (err) {
        callback(err);           // <- so a THROWING callback lands here
    }
});
```

A user callback that throws is therefore re-entered immediately with its own
exception as the `err` argument — one call the caller never made, and the second
one looks to them like the operation failed. Node calls the callback once.

Found while closing #1046: the new `mkdtemp` copied the pattern, and its K-19 case
(`calls` must be 1) is what exposed it. `mkdtemp` now computes inside the try and
calls outside it; the siblings are unchanged, because it is a behavioural change to
~10 entry points and belongs in its own measured pass rather than riding an
unrelated PR.

Whoever takes it: the repair is mechanical, but the ASSERTION is the interesting
half — the test has to prove the callback is entered exactly once, which means
letting it throw. On the GJS leg that surfaces as an "Unhandled promise rejection"
warning, so a suite that treats warnings as failures cannot express this rule.

### `fs.cp` and `fs.rm` were measured beside #1046 and deliberately left alone

Both came up while closing #1046's four divergences and neither belongs in that
change. The numbers are here so the next reader does not re-measure them, and so
nobody "fixes" `cp` by copying `copyFile`'s new set-ID mask into it.

**`cp` is already right, and Node is inconsistent with itself.** Measured on node
v24.15.0, source mode 4755:

| call | destination | result |
|---|---|---|
| `copyFileSync` | absent or present | `0755` — set-user-ID and set-group-ID dropped |
| `cpSync(file, file)` | absent | `4755` — KEPT |
| `cpSync(file, file)` | present | `0755` |
| `cpSync(dir, dir, {recursive:true})` | either | `0755` for every file inside |

So `cp` preserves the bits exactly when the destination did not exist, and
`@gjsify/fs` — which lets `Gio.File.copy` reproduce the whole mode — already
matches that case. Masking in `cp.ts` would INTRODUCE a divergence rather than
close one. Reproducing the other two rows means teaching `cpOneSyncFile` whether
it is the top-level entry or a recursive descendant, which is a change to the
walk, not to a mask. It is also not the security shape `copyFile`'s was: an
existing destination means the file was already there.

**`fs.rm` with no callback CRASHES Node rather than validating.** Every other
callback entry point throws `ERR_INVALID_ARG_TYPE` synchronously (measured across
all of them while writing K-20); `fs.rm(path, {force:true})` returns and then dies
inside `node:internal/fs/rimraf:51` at `callback(err)`. `fs.close(fd)` is the only
one that is genuinely silent-and-fine, and K-16 pins it.

`@gjsify/fs` therefore leaves `rm` unvalidated too — matching Node — which means a
missing callback there is still an unhandled rejection GJS cannot report. Adding
`requireCallback` to it would be strictly better behaviour and a deliberate
divergence from the reference; that is a decision, not a bug fix, so it is not in
#1046's PR. Nothing can depend on the crash, so the decision is cheap whenever
someone wants to take it.

### `pathToFileURL` does not resolve a RELATIVE win32 path against the current drive

Left over from the #1143 fix, which closed the win32 ABSOLUTE paths (drive-letter and
UNC, both directions, both matching native Node character for character). Node runs
`path.win32.resolve()` on the input first, so on win32 a relative `app\dist` picks up
the current drive and becomes `C:\app\dist`; `@gjsify/url` still joins a relative path
to the CWD with `/`.

Not folded into the fix because it needs `path.win32.resolve()`, and `@gjsify/path`
never selects the win32 half at all — that is #1146, whose blast radius is every
consumer of `node:path` under GJS and which therefore wants its own measurement pass.
Do this one after it, not before: the resolve is one line once the flavour is
selectable.

Scope note for whoever picks it up: absolute paths are covered and tested, so this only
affects a caller that hands `pathToFileURL` a relative path ON win32. `node:url` is
`native` on the node target, so the gap is GJS-on-win32 only.

### sass under GJS: the SCRIPT path is closed, the BUNDLER path is not (#1053)

The bootstrap chain itself is closed: `gjsify run --node-script <file>` bundles an
unbundled `.mjs` that imports `node:*` and runs it, `ensureGjsifyShimOnPath()`
puts a `node` on a package script's PATH that re-enters it when the host has none, and `build:infra`
now goes end to end with no `node` at all — measured by putting `node`/`npm`/`npx`
on PATH that exit 127 and announce themselves, then running the whole chain under
`gjs -m …/cli.gjs.mjs`: exit 0 warm, and exit 0 COLD with both native facades
deleted, which rebuilt them through the global CLI's own engine.
`process-template.mjs`, `set-bin-mode.mjs`, `build-assets.mjs` and
`bootstrap-native-facades.mjs` all run there now. The manifests still spell
`node scripts/x.mjs` deliberately — `writeNodeShim` records why a NEW flag in a
manifest cannot be bootstrapped by the previous release's CLI.

**RESOLVED for the script path** (2026-08-12). `build:scss` runs under GJS and emits a
byte-identical `dist/adwaita-web.css`, `.css.map` and `src/styles.generated.ts` —
compared against the Node run of the same commit. Both the diagnosis below and the
remedy it proposed were wrong, so both are kept: the `require` wall was real, but it
was never the cause, and clearing it needed no `require` at all.

**What the earlier measurement saw.** With the script bundled `--app gjs` and run
under gjs it died at load:

```
JS ERROR: Error: Calling `require` for "url" in an environment that doesn't
expose the `require` function.
  __require@…/node-scripts/build-scss.mjs-20a74433.mjs:114:8
  _cliPkgExports$1.load@…:13496:95
```

**Why that line ran at all.** `sass.dart.js` opens with

```js
var dartNodeIsActuallyNode = typeof process !== "undefined" && (process.versions || {}).hasOwnProperty('node');
```

and the `require("url")` sits inside `if (dartNodeIsActuallyNode)`. `@gjsify/process`
answers that test with `node: '20.0.0'` — on purpose, and documented, for the npm
packages that gate an API LEVEL on it (`packages/node/process/src/internal/detect.ts`).
dart-sass gates its HOST STRATEGY on the same key. Believed, it takes a Node path a
bundled ESM artifact cannot serve; not believed, it takes the browser path, which is
pure computation. Three further walls stood behind it, each only visible once the one
in front fell:

- `document.scripts` — dart2js probes for its own `<script>` element unconditionally,
  and the injected `document` polyfill has no `scripts`. Registering no `document` is
  what makes it take the `typeof document === "undefined"` branch instead.
- `Uri.base` — Dart reads `location` for it, so `location` must STAY registered. The
  build-time note recommending the opposite is over-broad (see the entry below).
- `fileExists() is only supported on Node.js` — sass resolves relative loads from a
  `file:`-canonical stylesheet through its OWN filesystem importer, so a custom
  importer on a `file:` entry is never asked. It was dead code under Node too, which
  is why swapping it in changed no byte. Canonical URLs in a private scheme
  (`gjsify-fs:`) are what force every load back through `load()`; `sourceMapUrl` hands
  the real `file:` URL back so the map still names the sources by their real paths.

So the fix is: an Importer supplying CONTENTS (as this entry always said), plus a
globals policy — `package.json#gjsify.nodeScript.excludeGlobals`, honoured by
`gjsify run --node-script` via `Config.forNodeScript`. No global `require`, and no
change to what `@gjsify/process` reports by default.

**The bundler's own sass path fails too, EARLIER and for a different reason —
measured 2026-08-12, and it was never written down.** An ordinary
`import './x.scss'` built with `--app gjs` dies at
`UNLOADABLE_DEPENDENCY: Could not load style.scss`, while the identical input under
`--app node` compiles and lands `color: red` in the bundle. The cause is NOT the
`require` wall above: `css-as-string.ts` reaches dart-sass through
`import('sass')`, a BARE specifier resolved at RUNTIME, which GJS's ESM loader
cannot do (`Module not found: sass`), and `dist/cli.gjs.mjs` carries no inlined
dart-sass either (grep: zero `dartNodeIsActuallyNode`). Its comment claimed the
opposite — "the `dart-sass` JS API is pure JS, so it loads under GJS + Node alike"
— and is corrected. So there are TWO sass paths and one fix answers neither by
itself. `tests/e2e/scss-under-gjs` now holds both halves: the Node case asserts the
compiled output, the GJS case asserts the exact failure shape and goes RED the day
it starts working.

**What remains, and what it would cost.** Making `import './x.scss'` work under GJS
means the CLI's own GJS bundle carrying dart-sass INLINED — there is no runtime
resolve that can work, because `sass.default.js` itself imports a bare `immutable`.
Measured: a minimal `--app gjs` bundle of nothing but `import('sass')` is 3.6 MB
minified, against a 6.6 MB `cli.gjs.mjs`. That is a >50% growth of an artifact loaded
on every GJS invocation, to serve a file type most builds never import — so it wants
a lazy, separately-published carrier (the shape `@gjsify/lightningcss-native` already
has for CSS), not an unconditional inline. Until then the tripwire holds the current
answer and reports the day it changes.

### The GI-backed globals note over-claims for a GRANULAR register subpath

`describeGiBackedInjection` decides which `gi://` namespaces an injected register
drags in by PREFIX-matching `GJS_GI_BACKED_REGISTERS`, and its own docstring calls
that deliberate: "one entry per package covers every granular subpath". That was true
when only whole-package registers existed. It is not true now.

Measured 2026-08-12 while porting `build-scss.mjs`: a bundle whose only DOM register
is `@gjsify/dom-elements/register/location` is announced as requiring `gi://Gdk`,
`gi://GdkPixbuf`, `gi://Pango`, `gi://PangoCairo` at load — and imports NONE of them
(the bundle's only `gi://` imports are GLib, Gio, GioUnix), and runs. The note then
advises dropping `location`, which is the one global dart-sass genuinely needs there
(Dart's `Uri.base` reads it). Following the tree's own advice breaks the build.

`@gjsify/dom-elements` exposes nine `./register*` subpaths and the table declares one
answer for all nine. What is missing is not the entries but the MEASUREMENT: a gate
that bundles each declared register on its own and compares the `gi://` imports it
actually emits against what the table claims, so the answer is checked rather than
asserted. Longest-prefix matching (a specific subpath overriding its package) is the
mechanical part; deciding it per subpath needs that measurement first.

### Which `node scripts/*.mjs` calls are UNMEASURED on a Node-less host

The shim is indiscriminate WITHIN its scope: on a host with no `node`, EVERY
`node <file>.mjs` in every package script now re-enters the CLI (the CLI's own
internal spawns are deliberately out of reach — see `nodeShimDir`). That is right
for the build chain, whose four scripts are measured. It says nothing about the
rest, and some of them cannot work there at all:

| Call site | Expectation |
|---|---|
| `scripts/stage-prebuild.mjs` (13 sites), `scripts/check-refs-pin.mjs` (3) | plain `node:fs`/`node:path` — should work; reached only from `build:prebuilds` / `build:meson`, which need meson + a compiler anyway, so nobody has run them on such a host |
| `packages/node-gi/**` `scripts/{install,stage-prebuild,gimarshalling,conformance,cross-runtime}.mjs`, `packages/napi/napi/test/*-gate.mjs` | CANNOT work, and should not: they drive node-gyp or EXIST to exercise node/bun/deno. The shim will bundle them and they will fail further in — a worse message than "no node" |
| `packages/node-gi/gtk-runtime-*/scripts/build-gtk-runtime*.mjs` | assemble the darwin/win32 GTK bundles; those hosts have Node |
| root `install-git-hooks` | runs on a fresh clone BEFORE the CLI exists, so the shim is not on PATH yet either way |
| `.release-it.json` hooks | release-it is a Node program; its hooks run inside it |

Worth deciding rather than discovering: whether the shim should REFUSE for the
second row (a name-based deny-list is ugly; a `gjsify.nodeOnly` manifest flag is
honest) or whether "fails further in" is acceptable. Nobody has hit it yet
because every host that runs those has Node.

### `systemGiLibraryDirs()` lives in two places, pinned by a test rather than shared

The darwin bare-leaf `dlopen` gap is one rule with THREE consumers now:
`@gjsify/node-gi` re-execs itself with the host's GI libdirs on
`DYLD_FALLBACK_LIBRARY_PATH`, `@gjsify/cli`'s `buildNativeEnv()` puts the same
dirs on the gjs CHILD's copy of that variable (Homebrew's `gjs` has an rpath into
GLIB's keg alone, so a plain `gjs -c "imports.gi.Gtk; Gtk.init()"` reproduced the
failure with no gjsify in the process — the trace is in
`packages/infra/cli/src/utils/system-gi.ts`), and — since ADR 0022's follow-up —
`prebuilds.yml`'s macOS **load-test step**, which had CLAIMED in a comment to
mirror `buildNativeEnv()` while carrying only the `DYLD_LIBRARY_PATH` half. The
omission was invisible for as long as no bridge in that step needed a host GNOME
library by bare leaf: every one of the eight either binds a portable C library or,
like `Gwebgl`, reaches GL without Gtk. `@gjsify/webkit-native` is the first whose
typelib references `libgtk-4.1.dylib`, and it failed on the arm64 leg with GJS's
own `overrides/Gtk.js` unable to load — a THIRD hand-written copy of the same
rule, found by adding coverage rather than by a consumer. It is now spelled the
way the other two are; the shared-helper question this entry is about applies to
it as well.

The CLI cannot IMPORT node-gi's copy: ADR 0005 Decision 2 forbids a Tier-1 package
taking a `dependencies`/`optionalDependencies` edge on `@gjsify/node-gi`, and the
audit (`scripts/manifest-conformance/rules/tier.mjs`) names it explicitly. So the
module is a **pinned mirror**: `packages/infra/cli/src/utils/system-gi.spec.ts`
imports node-gi's `system-gi.js` by relative path (legal in a spec — it is bundled
only into `dist/test.node.mjs`, never into the published `lib/`, so no dependency
edge exists) and asserts both implementations return identical arrays over a table
of ten injected host shapes. That is the repo's own sanctioned shape for a
deliberate duplicate, the same one `impliedExampleNodeEntry()` uses against the
CLI's `resolveNodeEntry()`.

What is still owed is the lift to ONE home — a small shared package both may
depend on (`@gjsify/system-gi`, Tier 1, no GI and no addon, so nothing about ADR
0005 is weakened by it). Not done here because a NEW npm name is the expensive
path in this repo: a manual first publish plus the Trusted Publisher bootstrap,
and the `@gjsify/tls-native` incident showed a half-bootstrapped name stalling
60+ packages. Do it on the next release cut that already has that ceremony open,
delete both copies and the agreement suite in the same change.

### A globally installed GJS launcher still cannot load a system GTK on macOS

`buildNativeEnv()` repairs the loader path for everything that runs THROUGH the
CLI (`gjsify run`, `showcase`, `storybook`, `tsc`, `info`). A launcher written by
`gjsify install -g` for a package whose `gjsify.bin` is itself a GTK app `exec`s
the bundle directly, with no CLI in the loop, and therefore still hits the
bare-leaf `dlopen` on macOS.

**The mechanism is measured, not assumed** — and it is a finer point than
`buildNativeEnvPreamble`'s existing MACOS CAVEAT implies. SIP strips an INHERITED
`DYLD_*` at the `/bin/sh` exec (confirmed again:
`DYLD_FALLBACK_LIBRARY_PATH=/usr/local/lib /bin/sh -c 'echo $DYLD_FALLBACK_LIBRARY_PATH'`
prints nothing), but a value the preamble exports ITSELF survives the following
`exec gjs`, because Homebrew's `gjs` is unprotected: a hand-written `/bin/sh`
script whose body is `DYLD_FALLBACK_LIBRARY_PATH=/usr/local/lib:/usr/lib; export
DYLD_FALLBACK_LIBRARY_PATH; exec gjs -c '…imports.gi.Gtk; Gtk.init(); print("GTK
OK")'` prints `GTK OK` on the macOS 15.7.8 VM when invoked under
`env -u DYLD_FALLBACK_LIBRARY_PATH -u DYLD_LIBRARY_PATH -u GI_TYPELIB_PATH`.

So the preamble COULD carry it, and was deliberately left alone anyway, because
neither available shape is right: baking `systemGiLibraryDirs()` in at write time
reintroduces exactly the snapshot that function exists to remove (a launcher is
routinely written before `brew install gtk4`), and re-deriving it in shell is a
third copy of a two-copy rule — expressible for only one of its three sources, in
the one language nothing here type-checks. The right fix is to make such a
launcher defer to the CLI rather than re-derive; that is a launcher-shape change
and belongs in its own PR, ideally the one that lifts `system-gi` to a shared
package (above).

**A THIRD SHAPE EXISTS, and it needs no launcher at all — measured 2026-08-13 on
the macOS 15.7.9 x86_64 VM.** Neither of the two shapes above is the only option,
because the repair does not have to reach the process from OUTSIDE. GI takes it at
runtime, from inside the process, in three lines:

```js
const repo = imports.gi.GIRepository.Repository.dup_default();
repo.prepend_search_path(dir);   // replaces GI_TYPELIB_PATH
repo.prepend_library_path(dir);  // replaces DYLD_/LD_LIBRARY_PATH
```

Measured, plain `gjs`, under `env -u DYLD_FALLBACK_LIBRARY_PATH -u
DYLD_LIBRARY_PATH -u GI_TYPELIB_PATH`:

| | |
|---|---|
| no prepend | `Failed to load shared library 'libgtk-4.1.dylib'` — dlopen tried only gjs's own rpath, `…/Cellar/gjs/1.88.1/bin/../../../../opt/glib/lib`, i.e. **glib's keg alone**, confirming the mechanism this entry describes |
| with prepend | **`OK gtype: GtkWidget`** |

`Repository.dup_default()`, `prepend_search_path` and `prepend_library_path` are
all present under gjs 1.88.1 (checked on darwin AND linux). The linux control that
isolates which call does what: prepending only the SEARCH path finds the typelib
and then fails with `Failed to load shared library 'libgwebgl.so' referenced by the
typelib`, so `prepend_library_path` is load-bearing and not redundant.

This is the same call `activateGiLibraryPath()` (#1132) makes in C for node-gi —
`dup_default()` is node-gi's `DupDefaultRepository()`. What is new is that a GJS
BUNDLE can make it too, which removes the launcher from this path entirely rather
than making it smarter.

**It has no snapshot problem** (it runs at app start, so `systemGiLibraryDirs()` is
evaluated then) and **no shell copy** (same TypeScript, type-checked). Both
objections above dissolve.

**What it does NOT cover, so the launcher does not disappear wholesale:** a library
pulled in through ANOTHER library's link closure (`LC_LOAD_DYLIB` / `NEEDED`). The
loader resolves those and GI never sees them, so only `@rpath`/`$ORIGIN` in the
binaries reaches them — the same distinction ADR 0023 § 4 draws, and the reason
#1144 is not fixed by this.

**The open decision is now MADE, and it came out the other way round.** It read:
the two app-relative sources (gjsify's own `prebuilds/<target>` dirs, a chosen GTK
bundle's `libDir`) "need nothing new", only the SYSTEM dirs are awkward because
`systemGiLibraryDirs()` lives in `@gjsify/node-gi`. Both halves were wrong.

The system dirs need no lifting at all: what a bundle can carry is not that
function's ANSWER — it measures the BUILD host, and answers `[]` on the Linux
runner that builds most releases — but the CANDIDATE table it probes, which
`@gjsify/cli` already mirrors (`utils/system-gi.ts`, held to node-gi's copy by an
output-comparing agreement suite). So the candidates travel and the probe moves
into the bundle, gated on TWO markers: each prefix's own `girepository-1.0`, and a
path that says the running host is darwin at all. The second one is not
belt-and-braces — the table is keyed BY PLATFORM and `systemGiLibraryDirs()` is
empty off darwin on purpose (ld.so's system-wide cache already resolves these
leaves), while `/usr/local/lib/girepository-1.0` is a perfectly normal Linux shape
(`meson setup --prefix=/usr/local`, jhbuild). A bundle cannot read
`process.platform`, so that scope has to travel as a marker path too; without it
every such Linux host would get `/usr/local/lib` prepended ahead of its distro
typelibs AND libraries, which is the two-stacks precedence ADR 0023 § 4 describes.
The marker is the plist `@gjsify/child_process`'s `detectPlatform()` already
probes, so the two cannot drift into two answers.

The app-relative dirs are the ones that do not work. Measured in this workspace,
`detectNativePackages()` answers with ten paths shaped
`../../../../node_modules/@gjsify/webgl-linux-x64/prebuilds/linux-x64` — the BUILD
host's target twice over (ADR 0017 gives every target its own package) at the BUILD
tree's depth, so on the macOS install this entry is about it names nothing, and
baking it would make `dist/affected.gjs.mjs` — a `--app gjs` bundle
`scripts/verify-committed-bundles.mjs` rebuilds and compares byte for byte — encode
which platform siblings the committing machine happened to have. They are left out;
`activateNativePrebuilds()` already handles them where the fact is true, inside the
running process.

**Landed:** the prologue ships in every `--app gjs` bundle, carrying the system
candidates only (`packages/infra/cli/src/utils/gi-runtime-paths.ts`, e2e
`gi-runtime-prologue`).

**And it reaches less than this entry assumed — measured, gjs 1.88.1, linux.** A
banner is the entry chunk's BODY, and ESM evaluates a module's imports before its
body, so every STATIC `import … from 'gi://Ns'` in a bundle has already loaded its
typelib — and failed or not — before byte 1 of the prologue runs. Pinned in
`tests/e2e/gi-runtime-prologue`: with the banner text FIRST and `import
'gi://NoSuchNamespace'` after it, the banner's `print` never appears. `data:` module
URLs, which would let one file still import a prologue ahead of them, are rejected
by GJS (`Unsupported URI scheme for importing: data`).

So the prologue covers what loads LATER — `await import('gi://…')`, the established
gjsify shape for exactly the optional namespaces this is about (`@gjsify/fetch`'s
Soup, `@gjsify/dom-elements`' PangoCairo, `@gjsify/gamepad`'s Manette, the prebuilt
`gi://Gjsify*` bridges) — and NOT a GTK app whose `gi://Gtk` is a static import.

**Still open here**, in the order they gate each other:

1. Make the prologue precede the static imports. Every shape found so far changes
   how a `--app gjs` bundle acquires GI namespaces (a second emitted file imported
   first, or lowering the externals to `globalThis.imports.gi.Ns` accessors in the
   body), which also moves the ground under `ship/gi-namespaces.ts` — it reads the
   `gi://` specifiers off the emitted bundle to compute package dependencies. ADR
   first, per § Governance.
2. A darwin end-to-end run: the PREPEND is macOS-measured (the table above) and the
   wiring is measured on linux — against a stand-in host for the darwin side, since
   this workspace has no Mac in it — but no Mac has yet run a bundle carrying it.
   That covers the host marker too: its absence is what a Linux run measures.
3. The link-closure half below, which no prologue can reach.

### Bun DID hard-crash in the N-API teardown class — the first one, and the note that predicted it asked to be told

**Cross-reference (added 2026-08-06): #925 files the same `test/arrays.test.mjs` occurrences as a TEST FLAKE, while this entry files them as an N-API teardown crash class (`free(): invalid pointer`, a glibc abort). Same file, two theories. Whichever is right, the next occurrence should be read from the RAW job log for a `----- Native stack trace -----` block, which is what tells the two apart.**

`scripts/cross-runtime.mjs` carves Deno out of exit-code gating for the
post-pass teardown abort (#47) and deliberately does NOT carve out Bun, on
measured grounds: *"~7000 Bun runs (arrays + the GObject/boxed-heavy files …,
full 37-file suite ×40, a probe holding 30k live boxed handles to process exit,
random `--smol` GC pressure) produced 0 crashes / 0 cores"*, and it closes with
an instruction — **"if Bun ever hard-crashes here, re-confirm with a gdb
backtrace (the Deno determination's bar) first."**

It has now happened, twice, on PR #923's CI (`ci-fedora:44`, bun 1.3.14,
`NODE_GI_NATIVE=prebuild`):

```
test/arrays.test.mjs:
  (pass) GStrv return → string[] … 8/8 assertions pass
free(): invalid pointer
  ✗ arrays
```

Note the marker: `free(): invalid pointer` is a **glibc heap abort**, not the
`SIGSEGV` inside `g_boxed_free` that the Deno determination is built on, and not
Bun's own `panic(main thread)`. Same family (a corrupt pointer reaching the
allocator at teardown, after every assertion has passed), different
manifestation — so the mechanism argument for Bun (deferred finalizers, run
single-threaded on the JS thread under `DeferGCForAWhile`, `napi_internal_remove_finalizer`
dedup) does not obviously cover it and should be re-checked rather than assumed.

Nondeterministic, and independent of that PR's contents: attempt 1 failed on
bun, attempt 2 on **deno**, attempt 3 passed, all on one commit; the job runs
`npm install` + node-gyp inside `packages/node-gi/node-gi` (sole dependency
`node-addon-api`), so nothing in that PR is reachable from it; the CI images
either side of the first failure are package-identical (797 packages, empty
`diff`, same `glibc-2.43-6`); 10 local `--only arrays` runs on unmodified `main`
were green.

**The RATE has changed, and that is the part the "~7000 runs / 0 crashes"
baseline no longer describes.** Three further hits inside one afternoon
(2026-08-02), all on `deno`, all on `arrays`, all on PRs that touch nothing
under `packages/node-gi/`:

| run | PR | outcome |
|---|---|---|
| 30751987456 | #935 | `✗ arrays`, re-run on the SAME commit → green |
| 30754859011 | #935 | green (the re-run above) |
| 30757696374 | #929 | `✗ arrays`, re-run on the SAME commit → green |

Every one stops at the identical place — nine assertions `ok`, then the process
disappears part-way through `INOUT byte-array container is handled, not
deferred: GLib.base64_decode_inplace()`, with no `ok`, no failure text and no
crash marker in the job log. That is a THIRD manifestation: not the
`SIGSEGV` in `g_boxed_free` of the Deno determination, and not the
`free(): invalid pointer` glibc abort recorded above — just a vanished process.
The absent marker is itself information: whatever kills it is not reaching the
glibc allocator's own check.

Two things follow. First, "nondeterministic" is now too weak a word for
planning — at roughly one hit per two runs on deno it is frequent enough to
reproduce deliberately rather than opportunistically, which removes the main
practical obstacle to the gdb step below. Second, anyone reading the 7000-run
baseline should know it was measured on BUN; nothing of that size has been run
against deno.

Next step is the one the note names, not a carve-out: reproduce under gdb (the
Deno case took ~8 cores on a loop of the boxed-heavy files) and get a backtrace.
Until then Bun stays on exit-code gating — a `pass>0 && fail===0 && <crash
marker>` carve-out added now would mask exactly the real Bun teardown bug this
might be, and the runs above show the marker is not even reliably present.

### The prebuild glibc floor is OBSERVED, never CHOSEN (#924)

The gate half is CLOSED (#1009): `scripts/check-staged-prebuild-libc.mjs` now
runs as "Gate on the glibc floor of what this leg just built" in both build legs
of `prebuilds.yml` (native `:722`, QEMU `:967`), both of which run on
`pull_request`, and the legs carry `nodejs` in their `dnf install`. The staging
question that blocked it is settled too: legs stage via `stage-prebuild.mjs .
--scratch` into the bridge's own scratch directory while the committed binaries
live in the platform packages, so the gate measures the NEW bytes rather than
the old committed ones. A green PR predicts a green main here now.

The #897 incident that produced all of it is preserved where it can still act:
a 33-line banner at `prebuilds.yml`'s `container:` line records that the 43 → 44
bump moved the measured floor 2.39 → 2.43 (glibc 2.43 re-versions
`acosf`/`asinf`/`atan2f`, which lightningcss's colour conversion calls) and
red-lined main for three consecutive `commit-prebuilds` runs. It is pinned to
`fedora:43` for that reason, not by habit.

**What is still open is the deeper half, and it is a policy question, not a
patch.** The floor is a number someone reads off the build image. Even pinned to
`fedora:43` it moves the day that image's glibc re-versions something else.
Choosing it means building the three Rust bridges against a DECLARED baseline —
an old-glibc container (manylinux/RHEL-derived) or `cargo-zigbuild --target
<triple>.<glibc>` — so that `gjsify.glibcRequires` becomes an input the build
satisfies rather than a result it reports. The question underneath is "how old a
distro do we support?", which is why #924's own comment notes its title no
longer describes the state.

### Bundle determinism is unmeasured now that nothing is byte-compared against a commit

ADR 0002 untracked `cli.gjs.mjs` and `tsc.gjs.mjs`, which retires the failure this
entry used to track — a committed bundle that does not rebuild from its own source.
Four mechanisms produced it and all four are gone with the artifact: the
module-order `$N` minifier drift, a stale dependency closure, a release cut
restaling every open PR through the version baked into `buildHeaders()`'s
user-agent, and a rebase silently 3-way-text-merging two minified bodies with no
conflict and no size anomaly.

**What is left is the residual none of those explained**: whether a FULLY rebuilt
closure still emits a different `$N` suffix assignment on a different host. It was
observed once (a local 6595935 B variant matching neither the committed 6594685 B
nor CI's 6594347 B, provenance never established) and never reproduced after the
stale-closure cause was found. With the bundles untracked there is no longer a
committed copy to compare against, so the question has to be asked a different way:
build twice on ONE host with the build cache cleared in between, and compare. That
is the `--determinism` mode owed to `release-cut.yml` per ADR 0002 § Do not.

Its honest limit, which must be stated wherever it lands: it catches a
re-emergence of the ordering class on one host. It does NOT catch cross-host
divergence, which is what the original symptom actually was. Closing that needs
two hosts building the same commit, which nothing in CI does today.

`affected.gjs.mjs` IS still byte-compared (`scripts/verify-committed-bundles.mjs`),
so the guard exists — it just covers 248 KB instead of 10 MB.

### `@gjsify/http2` lazy native-dispatcher loads still use a bare `require`

Two sites load the optional native HTTP/2 dispatcher through a bare `require(...)` from ESM source — `src/client-session.ts` (`_setupNativeClient`, reached from `connect()`) and `src/server/http2-server.ts` (`_startNativeListen`, reached from `listen()`). This is the class documented in AGENTS.md § CJS-ESM Interop → "Our source is ESM": the call resolves at build time inside a bundle and is a `ReferenceError` from the unbundled `lib/` we publish. Neither obvious fix applies as-is:

- a **static import** would pull `native-{client-,}dispatcher`'s static `gi://GLib` / `gi://Gio` / `@gjsify/http2-native` imports into EVERY http2 consumer, defeating the optional-native-package design;
- **`await import()`** (the ESM way to lazy-load) requires making both call paths async, i.e. changing `connect()` / `listen()` — and Node's `listen()` contract is synchronous.

So it needs a real design decision inside `@gjsify/http2` (e.g. resolving the dispatcher during an already-async phase, or an explicit async opt-in), not a lint fix. Both sites carry an `oxlint-disable-next-line typescript/no-require-imports` with the reason inline; they are the only sanctioned disables of that rule in the tree.

### Manifest-conformance follow-ups

The five standalone declaration-vs-reality scripts are now one rule registry (`@gjsify/manifest-conformance` + `scripts/manifest-conformance/`). Three things were deliberately left out of that refactor so it stayed a refactor.

- **`gjsify manifest-check` is designed but not shipped.** The portable rules (`package-outputs`, `prebuild-artifacts`, `headless`, `field-coverage`) are already extracted into a package with a hand-written `lib/index.d.ts`, so the command is a thin wrapper over `selectRules({ scope: 'portable' })`. It was held back because it carries two costs a refactor must not smuggle in: the package has to flip from `private` to published, which needs the manual first-publish + Trusted-Publisher bootstrap BEFORE the next release train, and adding a command rebuilds `dist/{cli,affected}.gjs.mjs`, coupling the change to the committed-bundle gate. The name is settled: `manifest-check` — a sibling of `system-check` (machine has what the project needs) and distinct from `check` (types compile). Evidence it is worth doing: downstream consumers already declare `gjsify.storybook` (buchhaltung, pixel-rpg/map-editor) and `gjsify.prebuilds` (buchhaltung's ERiC package, which declares a prebuilds directory with NO `gjsify.platforms` — a hard failure in this repo, unchecked in theirs).
- **Five `gjsify.*` declaration kinds have no rule** and are deferred with a written reason in `scripts/manifest-conformance/unchecked-fields.mjs`, printed on every audit run. All four remaining are judged unverifiable-by-construction (`defineFromPackageJson`, `flatpak`, `buildCache`, and `nativescriptPlatforms` until there is a per-platform artifact to compare against). The one entry that was a real FINDING — `gjsify.storybook` — is CLOSED: the portable `storybook` rule now resolves the declared directory the way `gjsify storybook` does and fails a path that does not exist or holds no `*.story.*`. Its ledger wording had gone stale as well: the 'empty browser, not an error' shape is the pre-#879 behaviour, when a bare `process.exit(1)` was deferred under GJS and the no-stories path fell through into the build and exited 0. That incident moved into the rule's header rather than being deleted with the entry. `gjsify.main` and `gjsify.example` left the ledger when `package-outputs` claimed them.
- **`gjsify pack`'s own shipped-vs-declared guard is still types-only, and the same `private` flag is why.** `assertTypeDeclarationsShipped` refuses to pack a `types`/`typings` file it can see but would not ship (the #655 guard) — the right place, because it fires at the moment of packing and protects CONSUMER trees too. The superset (every declared entry point, not just the type fields) lives in `scripts/verify-tarball-outputs.mjs` instead, because it needs `declaredPaths()` from this package and a published `@gjsify/cli` cannot depend on a `private: true` one — the same blocker as `gjsify manifest-check` above, and it closes with the same npm bootstrap. Measured gap while it stands: narrow a package's `files` so only `lib/esm/register.js` is excluded and `gjsify pack` exits 0 and writes a tarball whose declared `exports["./register"].default` is absent (13 type files shipped, so the existing guard stays quiet); the script catches it. Fold the script's check INTO the packer when the package is published, and keep the script as its repo-wide sweep.

### Toolchain hygiene follow-ups

- **`scripts/node-gi-consumer-harness.mjs` still resolves `gjsify` the broken way, knowingly.** `resolveGjsify()` returns `node_modules/.bin/gjsify` on an `existsSync` hit, which on Windows is the `sh` member of npm's shim trio and the one member the OS cannot execute — `execFileSync` gets ENOENT. `scripts/resolve-gjsify.mjs` is the fix and both other callers now use it; this one is not a one-line change. The working Windows form is `%COMSPEC% /d /s /c "<shim> <escaped args…>"`, which embeds the ARGUMENTS inside the quoted line, so the resolved command cannot be threaded through this file as the bare string that `runPackage`, `stageTestAssets` and the rest pass around — each site has to build its own invocation (`execGjsify(args, opts)` instead of `exec(gjsify, args, opts)`). Left because the harness drives `@gjsify/node-gi`, which needs GObject-Introspection and is Linux-only in practice, so there is no Windows run to repair; rewriting the threading blind on a harness this host cannot exercise would trade a known unreachable bug for an unmeasured change. Do it when the harness is next touched anyway.

- **A repo-relative path spelled in the HOST separator — CLOSED.** The entry asked for "either a documented rule … or a helper the call sites must go through"; both now exist. HELPER: `posixRelative()` / `toPosixPath()` are exported from `@gjsify/manifest-conformance`, so the one rule every repo-relative path in this tree depends on has exactly ONE definition — `audit-runtimes.mjs`'s local `toPosixRel` was byte-identical to `context.mjs`'s normalisation and is now an alias of the shared one. RULE: `docs/code-anti-patterns.md` carries it with both incidents intact (`classifyAxis` reading a `\`-separated path as a single segment, so five infra packages were reported as missing a declaration they must not carry; `platforms-ci` compiling a `\`-separated path into a regex in which `\n` is a NEWLINE, so node-gi's macOS leg read as a declared platform CI never builds) — both red on win32 and green on Linux for the same commit. The five `scripts/` sites that used the `replaceAll` spelling now go through the helper; that spelling is not merely uglier but WRONG, since a backslash is a legal POSIX filename character, so it trades a Windows bug for a POSIX one. Deliberately NO separate check watching for a raw `relative()`: a guard watching another mechanism is the named smell, and it could not distinguish a display string (where the host separator is arguably right) from a value about to be split. `windows-suites.yml` is what would catch a re-break, this whole class being invisible from Linux.

- **Testing "on Windows" from git-bash reports false greens, and nothing enforces the distinction.** Git for Windows puts `C:\Program Files\Git\usr\bin` on PATH, which supplies a real `chmod`, `cp`, `rm`, `sed` and `which`; every process spawned from that shell inherits them. npm, however, runs package scripts through `%COMSPEC%` (cmd.exe), where none of those exist. The two disagree on the same tree at the same commit — measured: `gjsify run build:infra` completed under git-bash and failed at `@gjsify/create-app` under cmd.exe, and `detectPackageManager()` in `utils/check-system-deps.ts` probes with `which`, which is ENOENT under cmd.exe (it returns the honest `unknown` there, but by accident rather than by construction). Any Windows claim therefore has to name the shell, or it means nothing. The reproducible check is to strip every `\Git\` entry from PATH and drive the command through `%COMSPEC%`; that is what the measurements behind 293a9a1 and this entry used. Worth a scripted harness in `tests/` if a Windows CI leg ever lands, since the runner images have Git on PATH too.

- **"744 files are committed with CRLF" — CLOSED, and it was NOT true at the commit that recorded it.** The entry claimed a fresh `git -c core.autocrlf=true clone --depth 1` reports 744 modified files immediately, by a mechanism it also stated: *"those blobs already contain CRLF"*. Re-measured on the win11-gjsify VM at `main`, two ways that agree:
  - **no tracked blob contains a CR byte at all.** `git grep -I -l $'\r' HEAD` → 0 of 4778 files; `git ls-files --eol` → 4294 `i/lf`, 381 `i/-text`, 95 empty, 8 `i/none`, and **zero** `i/crlf` or `i/mixed`.
  - **the reproduction produces nothing.** `git -c core.autocrlf=true worktree add --detach <tmp> HEAD` followed by `git -C <tmp> -c core.autocrlf=true status --short` → **0 modified files**, over all 4781 entries.

  The stated mechanism REQUIRES CR in the blobs, so with zero CR blobs it cannot occur — the two measurements are not independent confirmations, they are the claim and its precondition, both absent. Nothing in the history between then and now renormalises anything (`git log --all --grep` over renormal/line-ending/crlf/eol finds only the doc commits themselves), so the original measurement was most likely taken against a working tree rather than the index. Recording that here rather than deleting silently: the entry was about to justify a repo-wide `* text=auto` + `git add --renormalize .` sweep, a project-wide policy change with a one-time 744-file diff, and **that work does not need doing.**

  What remains TRUE and is worth keeping: `.gitattributes` (a9fa31a) pins the byte-verified artifacts with `-text`, and that is load-bearing — `core.autocrlf=true` would rewrite them and `verify-committed-bundles.mjs` would report them stale for files nobody touched. Since ADR 0002 untracked both `*.gjs.mjs` bundles the exposure is smaller, but `packages/infra/tsc/lib/**` and the prebuild payloads still need it.

- **`release.yml`'s two `napi-prebuild-*` legs staged by hand — CLOSED.** Both now call `node ../../../scripts/stage-prebuild.mjs .`, so the release path gets the extension match and `checkPrebuildDir()` like every other staging site, and `tests/e2e/prebuild-change-gate` scans `release.yml` too — the exemption cannot come back. The same change added the load test those legs were missing: they ended at `cp` + `upload-artifact` while `publish-napi` checked four files with `test -f`, so nothing proved a released artifact could be opened. Landing it after a release, not beside one, was the reason it waited.
- **Nine fixtures re-implement the prebuild-target name instead of importing it.** `resolvePrebuildDirName()` / `prebuildDirCandidates()` (`packages/infra/cli/src/utils/detect-native-packages.ts`) are pure functions and already the single source of truth for `prebuilds/<os>-<arch>/` — but every e2e that needs that directory composes the name itself, and several translated `process.arch` into the `uname -m` machine on the way. The `<os>-<arch>` unification had to fix all nine by hand, and one (`tests/e2e/self-host/run.mjs`) was missed on the first pass precisely because the composed string never appears as a literal. Export a small test helper (or let fixtures import the CLI's built `lib/utils/detect-native-packages.js` directly, the way `tests/e2e/dlx-native-prebuilds` already imports `run-gjs.js`) so the name has exactly one definition, and delete the per-fixture copies. Until that lands, any change to the target vocabulary must be swept for BOTH shapes — the literal path AND the computed one.

### CI coverage follow-ups

- **`prebuilds.yml` covers every Linux target on a PR; `darwin-arm64` is still proven for the first time AFTER the merge.** The workflow runs its BUILD legs on `pull_request` (native x64 + arm64 and the ppc64/s390x/riscv64 QEMU legs, Vala *and* the three Rust bridges — the break that motivated it, #827, was in the Rust dependency graph). Under real qemu-user (10.2.2, ppc64le): dependency install ~6 min, the Vala/GI packages compile in minutes; `@gjsify/lightningcss-native`'s Rust cdylib is the one expensive step — if a leg's total makes it the PR critical path, drop THAT package from the emulated legs rather than the architecture. `build-prebuilds-macos` remains the one PR-skipped leg (10x billing + the shared macOS concurrency pool); label a PR `ci:macos` to opt in. `prebuilds-summary` names the skipped legs per run. Closing the macOS gap permanently means either paying 10x per PR or a nightly full-matrix run. Pairs with the "nothing byte-compares a committed prebuild against a CI-built one" item below.

### Cross-runtime reachability follow-ups (ADR 0014)

- **Nothing byte-compares a committed prebuild against a CI-built one.** `scripts/check-refs-pin.mjs` (wired into every `build:meson`) catches the three ways a locally-built native artifact diverges from its pinned source — checkout drift, version skew against the npm engine, and a stale `build/` dir ninja will not invalidate. What it cannot catch is a binary that was simply never rebuilt: the `rolldown-native` prebuild had drifted BEHIND its pin for an unknown number of commits and only surfaced when a rebuild finally happened. Close it by having `prebuilds.yml` rebuild and diff the committed artifact (or publish the CI-built one as the source of truth and stop committing hand-built binaries).
- **Three browser bundles are ledgered as NON-GATING in the `browser` CI job.** The axis runs (`main.yml` `browser` job: Playwright/Firefox over the bundles the Fedora `build` job stages, 51 discovered, 48 gating-green), but `$BROWSER_PROBE_GREP` carves out three that were red the moment it was first executed. (a) **`@gjsify/events`** and (b) **`@gjsify/util`** both declare `src/test.browser.mts` as `export * from './test.js'` — re-running the GJS/Node spec files in a browser, which AGENTS.md explicitly forbids (`events` hangs; `util` dies on a bare `process.env` read in one spec). (c) **`@gjsify/web-streams`** feeds STRING chunks into `new Response(stream).text()` in three cases; per the Fetch spec a body stream must yield `Uint8Array`, and Firefox enforces it where Chromium and undici are lenient — the spec needs `TextEncoderStream` in front of the `Response`. **The same forbidden `export * from './test.js'` shape is in 11 packages** (`assert`, `async_hooks`, `buffer`, `constants`, `diagnostics_channel`, `events`, `path`, `querystring`, `string_decoder`, `sys`, `util`); the other nine pass only because their specs happen to be pure logic. Rewrite all 11 to browser-globals-only entries, then delete the ledger.
- **`@gjsify/worker_threads` ships a `src/browser.ts` with NO browser-axis test coverage.** No `index.browser.spec.ts` backs its `test.browser.mts`, so nothing ever asserted against that entry — which is how the exported `workerData` stayed permanently `null` (fixed, found by reading rather than by a failing test). `@gjsify/zlib`, `@gjsify/vm` and `@gjsify/http` show the pattern to copy. Worth doing before the package is considered for `partial` → `polyfill`, since export parity alone would have passed that bug.
- **The ten `browser:"partial"` slots are RESOLVED as partial — the residual work is per-package, not a slot sweep.** All ten were audited against the `platform-entry-parity` gate; none is promotable, because in every case a NAMED export is unavailable on the browser platform itself (the blocking export per package is recorded in each package's status entry / AGENTS.md row). Parity is necessary but not sufficient — it passes `sqlite`, whose `DatabaseSync` throws from its constructor; treat a green parity gate as permission to look, not a mandate to promote. Still open, per package: **`fs`** — close the 34-export gap over the in-memory `Volume` (does NOT unblock promotion while `FSWatcher` is a never-firing stub); **`sqlite`** — add a `./browser-worker` subpath declared `polyfill` backed by OPFS `createSyncAccessHandle`, leaving `./browser` at `partial`; **`ws`** — the only one of the ten without a `src/test.browser.mts` (its browser entry is 93 LOC; a small spec asserting the `WebSocketServer` ENOTSUP shape + CJS-compat statics closes it); **`crypto`** — only 2 of its 25 root modules have a platform dependency (`GLib.Checksum` in `src/hash.ts`, the `imports.gi` fallback in `src/random.ts`); replacing those makes the ROOT browser-clean with full synchronous Node semantics — the one path that would actually earn `polyfill` — and retires the 1,774-LOC `src/browser/` duplicate.
- **The `native` runtime slot means two different things, and the NativeScript bridge packages use the wrong one.** The routing rule reads `native` as "the RUNTIME provides this API — resolve to `<pkg>/globals`", but `packages/nativescript-bridge/*` declare `nativescript: "native"` in the sense "this package IS the native implementation". None of them ships a `globals.mjs`. The SHIPPING half of this is fixed: the missing-`globals.mjs` fallback no longer rewrites to `@gjsify/empty` (which had made `--app nativescript` unable to build the bridge tree at all — held now by e2e `ns-bridge-bundles`), it leaves the specifier alone and keeps the warn-once. What remains is the VOCABULARY: the declaration still says the opposite of what these packages mean. It also blocks `ALIASES_NODE_FOR_NATIVESCRIPT` from being composed through `withDerivedSlotRouting`. Fix by settling the vocabulary (either a new slot value for "this package is the runtime-native impl", or re-declaring the five as `polyfill`) — an ADR-sized decision because it changes a published `package.json#gjsify.runtimes` contract and `scripts/audit-runtimes.mjs`. Compose the NS table in the same change.
- **23 `native` slots ship a `globals.mjs` NARROWER than their root entry — 152 export names that are a `MISSING_EXPORT` waiting for a consumer.** A `native` slot routes the package ROOT to `@gjsify/<X>/globals`, exactly as `polyfill` + a declared subpath routes it to `src/<target>.ts`, so the `platform-entry-parity` invariant applies verbatim — and nothing checked it: the `globals-broken` probe only validates the `export … from '<spec>'` SOURCES a `globals.mjs` names, so every hand-written `export const X = globalThis.X` file passed it vacuously. Found when a `--app browser` build of `@gjsify/gamepad`'s OWN README example died with `"hasGamepadBackend" is not exported by "packages/web/gamepad/globals.mjs"`. `audit-runtimes --check` now REPORTS the whole set every run (`globals-entry-parity`, check 5 in `auditReachability`); making it fatal is a separate, cross-cutting change (AGENTS.md exception (c)) because the tree cannot pass it today. A further 17 packages are deliberately NOT compared and the skip is printed with them: their `globals.mjs` star-re-exports a runtime module (`export * from 'node:util'`), which surfaces the whole runtime surface and is not statically enumerable — reading those as gaps was the first version of this check crying wolf on 17 packages that are in fact complete, and `tests/e2e/runtimes-routing` disproves it by importing `format`/`inspect` through exactly that file. The skip carries a residual blind spot: a `globals.mjs` that stars a runtime module AND has a root export that module does not carry is skipped too, so a real gap there is invisible. Closing it means asking the runtime for the star target's export set — runtime EVALUATION, which `audit-runtimes` deliberately does not do (it must not crash on a browser-only re-export), so it needs its own decision rather than a quiet widening of this check. Two shapes hide in the remaining 152, and only one is a re-export away: names the RUNTIME provides (`@gjsify/assert`'s `strictEqual` from `node:assert`, `@gjsify/webcrypto`'s `Crypto`) versus names it does not (`@gjsify/gamepad`'s Manette→W3C mapping tables) — no `globals.mjs` in the tree imports its own package body, so the second shape needs a platform entry, i.e. a slot decision, not a line in `globals.mjs`.
- **Rolldown 1.1.4 emits the `keepNames` helper AFTER its first use.** With `output.keepNames = true` (gjsify's default whenever `minify` is on) a minified bundle can contain `__name(fn, 'x')` at byte ~200 while the helper declaration appears ~9 kB later; `var` hoisting makes the early call `TypeError: __name is not a function`. Reproduced on `--app node` with the `@gjsify/module` node-gi test bundle (the `\0gjsify-gi-node:*` virtual module is ordered first); `--minify false` runs. Upstream (`refs/rolldown`, pinned `v1.1.4` in lockstep with `@gjsify/rolldown-native`) — needs a minimal reproducer filed, or a chunk-prelude workaround if the pin cannot move.

### `--app node` genuine-GJS-source detection is narrower than the reverse bridge it gates

`nodeGiGlobalsInject` keys on BARE ambient globals (`print`/`imports`/`ARGV`), so a genuine GJS source that uses `gi://` but logs via `console.log` — and passes no explicit `--globals` — is not recognised: its `@girs/*` value imports are emptied (`class extends undefined`) **and** its `/register` imports route to `@gjsify/empty`. Verified with both probes. This pre-dates ADR 0012 and hits `@girs/*` and registers equally; ADR 0012 only brought the two into parity via the single `isGjsSourceBuild` gate in `app/node.ts`. Fix by widening the SIGNAL itself — e.g. treat "a `gi://` specifier survived in the bundled graph" as a reverse-bridge build — which closes both at once.

### The darwin loader repair still leans on an env variable outside GI's reach

`activateGiLibraryPath()` now tells GI itself where a typelib's bare-leaf backer lives, which is what makes bun and deno work on macOS at all. It cannot cover everything: a dylib pulled in by ANOTHER dylib's own link closure never passes through GI, so `maybeReexecForGtkRuntime()` (Node) and the launcher preamble (`bin-shim.ts`, every runtime) stay as the belt for that class.

Two consequences worth closing later, neither blocking: the Node re-exec is now redundant for everything GI resolves and could be narrowed to the closure case once a darwin CI leg proves it; and `hostGtkIsWorthTrying()` on an Apple-silicon host still answers from `systemGiLibraryDirs()`, whose `/opt/homebrew/lib` probe was never in dyld's default fallback — measured only on x86_64 so far.

### `@gjsify/node-gi` — an UNANNOTATED pointer array field still marshals EMPTY in silence

The annotated half is CLOSED. `GstMapInfo.data` is `<array length="3" c:type="guint8*">` with field 3 being `size`; `FieldArrayLength()` in `src/marshal.cc` now reads that sibling, and `test/struct-field-array-length.test.mjs` holds it against gjs as the oracle (32 == 32, contents compared, A/B-proved: three of its four cases fail on the previous build).

This entry once opened "a dependency GI cannot express for a struct-field READ". **That was wrong, and it is why the defect lived so long** — the annotation is in the GIR, it survives into the typelib, and the call-argument path in `calls.cc` had been resolving it all along. Only the field reader passed a hard `-1`. Worth keeping as the shape of a mistake: the entry stated an impossibility and then, one sentence later, described the fix for it, and the impossibility is the half people read.

Two cases remain, and the second one bites harder.

**No annotation at all.** `GIArrayToJs` falls through to `length = 0` when the field is neither zero-terminated nor fixed-size, so a pointer array whose length the GIR never states comes back empty and successful — the same silence, one branch over. Prefer failing loudly; the judgement to make first is whether any real GIR field hits it, because a throw on a shape nobody produces is a worse trade than the silence.

**INLINE (by-value) record elements are still unreadable, and the length is now deliberately declined for them.** `ReadCElement` dereferences a `GI_TYPE_TAG_INTERFACE` element as a pointer and `CElementSize` reports `sizeof(gpointer)` instead of the record's size, so resolving a length for such a field walks garbage: `new Pango.GlyphString(); gs.set_size(3); gs.glyphs[0].glyph` SIGSEGVs the process. `ElementsAreReadable()` gates the new path so those fields keep returning empty, and `test/struct-field-array-length.test.mjs` holds the process-survival assertion (it fails with the gate removed).

That is the SAME deferred work `calls.cc` already records at its CALLER_ALLOCATES site — "a struct-by-value element array would need `gi_struct_info_get_size` per element + field-access read-back (a later PR)". One piece of work with two entrances, now both closed to it. Doing it means teaching `CElementSize` the record size for non-pointer interface elements and `ReadCElement` to hand back a borrowing sub-handle at `src` rather than dereferencing it — `refs/gjs/gi/arg.cpp` is the reference. Affected fields include `Pango.GlyphString.glyphs`, `GObject.EnumClass.values`, `Gio.InputMessage.vectors`; `GObject.SignalQuery.param_types` is the adjacent `GI_TYPE_TAG_GTYPE` gap, which `ReadCElement` answers with `undefined`.

### `@gjsify/node-gi` — `GTK_IS_EVENT_CONTROLLER` assertion failures on the reverse bridge

Running any GTK app through node-gi intermittently produces `Gtk-CRITICAL **: gtk_event_controller_handle_crossing: assertion 'GTK_IS_EVENT_CONTROLLER (controller)' failed` and can take the process down mid-frame. NONDETERMINISTIC, which is the trap: single runs prove nothing in either direction. Measured on the showcase — node 1/6/1 criticals over three consecutive runs, bun likewise, deno clean in the same sample. It is INDEPENDENT of audio (still occurs with audio gated off, and on code predating the GValue marshalling fix). The event controllers are attached by `@gjsify/event-bridge` via `attachEventControllers`, so the likely shape is the JS wrapper for a controller being collected while GTK still holds the C object — a toggle-ref/lifetime question, not a GStreamer one.

### `@gjsify/node-gi` — the `$gtype` surface is incomplete

gjs exposes `$gtype` uniformly (`[object GType for 'X']`); node-gi does not, and the three shapes fail differently — measured against gjs on the same source: `Gio.ApplicationFlags.$gtype` is `undefined` (`makeEnum` freezes a plain member object, no lazy getter); `GLib.Variant.$gtype` is a static-method THUNK (`$gtype` falls through the struct proxy to method resolution); `String(Gio.Application.$gtype)` throws `Cannot convert object to primitive value` (the GType handle is a bare tagged External). The handle works fine as an ARGUMENT (`GObject.Value.init(GObject.TYPE_STRING)` round-trips), so this is a surface gap, not a marshalling one. Fix shape: attach the same lazy `$gtype` getter `defineLazyGType` gives classes to `makeEnum`'s frozen object and to the struct path that misses it, and give the GType handle a `toString`/`Symbol.toPrimitive` + `.name` so it prints like gjs's GType object.

### `@gjsify/node-gi` — nothing in CI runs the bridge against MUSL, or against the declared gjs floor

The arch axis is covered: `node-gi.yml`'s `arm64` leg builds the addon on a native `ubuntu-24.04-arm` Fedora 44 container, runs the gjs/node/bun/deno golden-diff plus the tier-B typelib oracle, and re-verifies the STAGED prebuild with `test:bun`+`test:deno`. Two other axes are not, and a 2026-08-03 hand run on a OnePlus 6T / postmarketOS (aarch64) is currently their only evidence:

- **musl.** Every CI image is Fedora/glibc, and the one leg that would cover it is not wired: `prebuilds.yml`'s `build-prebuilds-musl` (which runs `.github/prebuild-toolchain/musl-build.sh`, including its `dlopen(RTLD_NOW)` assertion, in `alpine:3.24`) carries `if: github.event_name == 'workflow_dispatch'` — the workflow header documents it and `build-prebuilds-macos-experimental` as dispatch-only with nothing depending on them, since each builds a target no `gjsify.platforms` declares yet. The COMMITTED bridge prebuilds have since left that hole: `musl-committed-check.sh` was split out of the build leg and now runs on PRs and pushes as `check-committed-musl` (one native runner per arch) and again inside `commit-prebuilds`, over the staged tree. It cannot reach node-gi — this entry's subject commits no binary at all, its addon being published from `napi.yml`/`release.yml` — so for THE BRIDGE nothing still asserts musl loadability on a PR or a merge. That the assertion is `RTLD_NOW` is not incidental and must not be "simplified": measured with `@gjsify/sab-native`'s pre-#955 prebuild on aarch64 musl and in `alpine:3.24` x86-64, a plain/lazy load LOADS the broken library and the two unresolvable symbols (`fcntl64`, `__cmsg_nxthdr`) only surface at the first call — which is why its suite lost exactly two fd-passing tests and `@gjsify/worker_threads` four cross-process tests instead of everything, and GI's own `G_MODULE_BIND_LAZY` is that lazy path. A load-only gate using default flags would have passed that library; `RTLD_NOW` fails it at load. Both arches behave identically here. Wiring options, cheapest first: run `musl-build.sh` (or just its `dlopen(RTLD_NOW)` step over the committed prebuilds) on `pull_request`; add an Alpine leg driving the existing `test:bun` for real execution coverage; and keep the glibc-floor `SHT_GNU_verneed` audit (#963) as the check that needs no musl machine at all — it is what caught this one. Deno cannot participate in a musl leg: it publishes no musl build.
- **gjs 1.86.0, the declared floor.** Fedora 44 ships 1.88.x, so the floor this repo advertises is never exercised. Measured green through `org.gnome.Platform//49` (glibc 2.42, gjs 1.86.0), and it immediately caught a test encoding an unstated GLib ≥ 2.88 assumption (`GLib.Bytes.new_from_bytes` static-vs-instance introspection, fixed in the same change). A flatpak-runtime leg would be the honest gate; the GNOME runtime is a stable, pinnable image.

Also unmeasured on aarch64 specifically, in CI and by hand: the display legs (`gtk-smoke`, `adw-smoke`, `gtk-template*`, `strv-construct`, `interface-props`) and the `--expose-gc` toggle-ref stress leg — `gtk-smoke` is `ubuntu-latest` (x64), and the device is driven over SSH with no display. Note the GTK TYPELIB path itself is fine there: `Gtk`/`Gdk`/`Adw`/`Pango`/`Graphene` all resolve and `Gtk.DrawingArea` subclasses with NO `GI_TYPELIB_PATH`/`LD_LIBRARY_PATH` help, on musl and inside the flatpak — the darwin "Failed to load shared library … referenced by the typelib" class is dyld-specific (no rpath on a plain `node`), not a Linux exposure.

### `@gjsify/node-gi` — the LOW-LEVEL `registerClass` still drops an unresolvable signal param type in silence

The L1 `GObject.registerClass` no longer does: an entry `signalSpecToNative` cannot turn into a type name now THROWS, naming the signal and the index (that silent drop is what made the GJS-canonical `param_types: [GObject.TYPE_INT]` register a zero-param signal and deliver an `undefined` payload). The engine's own loop is the second copy of the same mistake and is still there: `src/class.cc` reads each `paramTypes` entry with `TypeNameToGType(NodeGiToUtf8(...))` and does `if (t != G_TYPE_INVALID && t != G_TYPE_NONE) push_back(t)` — so `registerClass(name, ns, parent, { signals: [{ paramTypes: ['bogus'] }] })` from `@gjsify/node-gi` (the native passthrough, not the L1) still yields a signal with fewer parameters than declared and says nothing. Same for `returnType`. Fix shape: accept a GType HANDLE there too (`ReadGTypeHandle` first, name lookup second — the L1 already round-trips through the name, so this is only about the direct callers) and throw a `Napi::TypeError` naming the signal instead of skipping. Not folded into the L1 fix because it needs a native rebuild, and the host that measured the defect (aarch64 postmarketOS, deliberately node-free) cannot run `node-gyp`.

### `@gjsify/napi` — a tsfn claim nobody hands back still leaks its control block

`finalize_env_tsfns` (`src/cc/tsfn.cc`) partitions `thread_count` by owner; only the claims a foreign thread demonstrably holds are joined (2 s deadline). Whatever is still outstanding afterwards makes the tsfn DETACH — its JS-side resources are freed and the control block is handed to whichever thread returns the last claim, which then frees it. That is Node's `MaybeDelete()` posture and it closes the force-free UAF window for good, but it inherits Node's consequence: **if no thread ever returns the claim, ~840 bytes leak for the process lifetime** (measured: 264 direct + 576 indirect, valgrind, 0 memory errors). Both outcomes warn unconditionally. Two residuals worth a decision later: an unattributed claim a foreign thread genuinely holds is not joined (safe, but the warning can only say "never attributed" — closing it needs an ownership signal N-API does not expose); nothing reclaims a detached control block at process exit (a per-env registry of detached tsfns would trade the leak for a much harder lifetime question; today the leak is accepted because Node accepts it). Measured on every CI run by `test/tsfn-teardown-gate.mjs` (Linux + macOS legs).

### Regenerate the register-globals closure map after a `GJS_GLOBALS_MAP` change

`node packages/infra/cli/scripts/generate-register-closure.mjs` (`--check` reports staleness). A stale map is fail-soft — builds stay correct but pay extra `--globals auto` analysis passes. (The related hazard — the committed CLI bundle inlining a stale map — is closed: `.githooks/pre-commit` triggers on `packages/infra/resolve-npm/lib/` and `packages/infra/rolldown-plugin-gjsify/src/`.)

### `@gjsify/webgl` on darwin — WebGL2 content draws; HiDPI and two GLES 3.0 API gaps do not

First rendering proof on darwin, measured 2026-08-03 on the Intel macOS 15.7.8 test VM
(`docs/workstation/macos-test-vm.md`): the committed `darwin-x64` prebuild draws real pixels onto
the desktop through `Gtk.GLArea` + libepoxy + CGL — a `clearColor`/`scissor`/`clear` pattern,
`gl.getError()` 0, screenshotted. Everything before this proved a `dlopen`, not a pixel. The
`set_use_es(true)` defect that made it impossible is fixed (§ Bridge pattern).

**Read every measurement below with one precondition stated.** Each one was taken with
`DYLD_LIBRARY_PATH=/usr/local/lib` exported by hand, because without it the `Gtk-4.0` typelib's bare
`libgtk-4.1.dylib` leaf does not resolve on this host at all — the darwin loader defect #973 fixes.
So these results describe the GL stack ONCE libgtk is loaded; they do NOT say a user who runs
`gjsify showcase` on macOS gets that far, and the darwin webgl claim is contingent on #973 or an
equivalent. Worth naming explicitly because it is the same masking pattern #973 found in CI, where
the workflow exports `DYLD_FALLBACK_LIBRARY_PATH` itself and thereby hides the defect from every
job: a loader variable supplied by the harness rather than by the user's environment turns "it
works" into "it works for us". SIP makes it worse than a normal env var — `DYLD_*` is stripped when
exec'ing a protected binary, so putting `nohup`/`env` in front of `gjs` silently drops it and the
failure comes back looking like a broken prebuild.

What is still open:

- **GLSL ES 3.00 does not exist on macOS — but the WebGL2 route through GL 4.1 is now MEASURED,
  and it is option (b), far cheaper than this entry assumed.** `#version 300 es` needs
  ARB_ES3_compatibility (core in GL 4.3) and macOS caps CGL at 4.1, so the dialect is genuinely
  refused: `version '300' is not supported`. What was never measured is how much of the SHADER has
  to change once the version line does, and the answer is **nothing**. On macOS 15.7.9 / GL 4.1
  core / GLSL 4.10, a three.js-shaped GLES 3.00 pair — `layout(location=)` attributes AND fragment
  outputs, a `layout(std140)` uniform block, `texture()`, `isampler2D` + `texelFetch`,
  `textureLod`, MRT, `precision highp` statements — compiles clean after swapping ONLY
  `#version 300 es` → `#version 410 core`. So do all eleven constructs probed separately for being
  the likely breakers: `invariant gl_Position`, a fragment shader with no precision statement at
  all, `gl_FragDepth`, `sampler2DShadow` + `texture(vec3)`, `uint`/`uvec4`/bitfield ops,
  `gl_VertexID`/`gl_InstanceID`, `textureGrad`/`textureOffset`, `mediump` on a struct member, a
  dynamically-indexed sampler array, and even `#extension GL_OES_standard_derivatives : enable` /
  `GL_EXT_shader_texture_lod : enable` (an unknown extension with `: enable` is specified to warn,
  not fail — only `: require` would error, which is the one directive form a translator must
  rewrite). **The premise the old entry rested on — "this is what ANGLE does and it is not small" —
  does not survive the measurement**: ANGLE is large because it targets the whole GLES conformance
  suite from a D3D/Metal backend, whereas the gap between GLSL ES 3.00 and GLSL 4.10 on a desktop
  GL backend is a version line. That the route EXISTS was never in doubt: Safari and Chrome both
  ship WebGL2 on macOS, on a stack capped at the same 4.1. **Decision: (b)** — rewrite the dialect
  in the Vala layer at `shaderSource()` time for a desktop-GL context, NOT (a) declaring darwin
  WebGL1-only and not (c) shipping ANGLE. **DONE**, and measured end to end on macOS 15.7.9 /
  GL 4.1 core through the real library: an unmodified `#version 300 es` pair compiles, links,
  draws, and `readPixels` returns the shader's colour — the first WebGL2 CONTENT this repo has
  drawn on darwin. `#version 100` comes back byte-for-byte unchanged in the same run.
  **The predicate is the EXTENSION, not the OS**: `ARB_ES3_compatibility` (core from GL 4.3) is
  what makes a desktop compiler accept the ES dialect, so Mesa's `4.6 (Compatibility Profile)` on
  win32 has it and is deliberately NOT rewritten — rewriting a context that never needed it would
  be changing a consumer's shader for nothing. The mirror of that extension is why WebGL1 worked
  here first: `ARB_ES2_compatibility` is core from 4.1, and the ONE version between the two is the
  whole of what separated WebGL1 from WebGL2 on this platform.
  Deliberately NOT done, with the reason rather than a shrug: `: require` → `: enable` is not
  rewritten, because three.js 0.185 emits exactly two `require` directives
  (`GL_ANGLE_clip_cull_distance`, `GL_ANGLE_multi_draw`) and only when the context ADVERTISES
  those extensions, which a desktop GL context does not — so the case cannot arise from the
  consumer that motivated the work, and silently downgrading a shader's stated hard requirement
  to a warning behind its back is worse than the failure it would hide.
  Still open: the API-level GLES 3.0 features desktop GL 4.1 spells differently —
  `GL_PRIMITIVE_RESTART_FIXED_INDEX` (4.3 on desktop; 4.1 has `glPrimitiveRestartIndex` +
  `GL_PRIMITIVE_RESTART`, which is what ANGLE emulates with) and the mandatory ETC2/EAC formats
  (absent on desktop, unused by three.js/Excalibur). Neither is reached by the showcases, so
  neither is claimed as working; both are shader-independent and would surface as a draw-time
  error, not a compile failure.
- ~~**`getSupportedExtensions()` trips a GLib assertion on every desktop-GL context.**~~ **CLOSED**
  (#1101). A core profile makes `glGetString(GL_EXTENSIONS)` return NULL, and the split
  dereferenced it — `g_strsplit: assertion 'string != NULL' failed` here, a silent process death on
  win32. `webgl-rendering-context-base.vala` now reads the indexed form
  (`GL_NUM_EXTENSIONS` + `glGetStringi`). **Decided from `GL_VERSION`, NOT by trying the old call
  and recovering from NULL**, which is what the issue proposed: measured on this host, the invalid
  call QUEUES `GL_INVALID_ENUM` (0x500), so the obvious fix would have traded a crash for a
  phantom error reported to the next consumer that calls `getError()` — the exact class of defect
  the entry below was filed about. `getString()` and `getParameter`'s `GL_EXTENSIONS` branch went
  through the same guard; they had the same unchecked return. Verified against the real built
  library on a GtkGLArea 4.1 core context: 46 extensions, 0x0 queued afterwards.
- ~~**A `GL_INVALID_OPERATION` (0x502) is pending before the first draw**~~ **CLOSED — it was the
  first candidate, and it is now measured rather than suspected.** A desktop GL core profile has NO
  default vertex-array object; GLES keeps object 0 as a real one, so every WebGL consumer draws with
  nothing bound and macOS is the platform that reaches a core profile (CGL offers no GLES profile at
  all, so GDK hands out desktop GL 4.1). Measured per profile on this VM through CGL, same call
  sequence: `legacy 2.1` → `enableVertexAttribArray` 0x0, `drawArrays` 0x0; `4.1 core` → **0x502 on
  both**; `4.1 core` with any VAO bound → clean. `WebGLRenderingContextBase.construct` now generates
  and binds a stand-in (`ensureDefaultVertexArray()`, a no-op wherever `GL_CONTEXT_PROFILE_MASK`
  does not report core — so Mesa's `4.6 (Compatibility Profile)` on win32 correctly gets none), and
  `WebGL2RenderingContext.bindVertexArray(0)` maps onto it so "back to the default vertex array"
  does not restore the broken state. **It is done in the Vala constructor and not from the JS
  `_init()` beside `_gtkFboId`** because `@girs/gwebgl-0.1` is a PINNED published package: a new
  method is not callable from TypeScript until ts-for-gir regenerates it, so routing the fix through
  JS would have made it wait on a types release to reach the platform it fixes. Since a draw that
  raises 0x502 draws nothing, this is also the most likely half of the BLACK WINDOW — but the
  second candidate is untouched and unproven either way: whether the `_gtkFboId` captured from
  `GL_FRAMEBUFFER_BINDING` is the framebuffer GTK presents on this backend. Re-run the
  `Adw.Application` reproducer before calling the black window closed.
- **The HiDPI path stays unproven on darwin.** The VM reports scale factor 1 (its LaunchAgent pins
  `res:1920x1080 scaling:off`), so `clientWidth × devicePixelRatio === canvas.width` holds
  trivially and this host cannot falsify the drawing-buffer bug class. Only a real HiDPI Mac can.

Host diagnosis is repeatable: `gjsify run packages/framework/webgl/scripts/probe-gl-host.js`
(negotiated API/version, scale factor, logical-vs-device sizes, shader-dialect matrix, shader-free
pattern; exits non-zero when the GLArea does not realize). It needs a display, which is why it is a
script and not a spec — no CI runner here has one.

### `@gjsify/gamepad` on a platform without libmanette — OBSERVABILITY DONE, backend still missing

The observability half is closed. `packages/web/gamepad/src/backend.ts` is now the one place the
package decides whether a backend exists: `hasGamepadBackend()` (barrel-exported, answerable with no
monitor and no connected device, the `isSecureRandomSource()`/`hasNativeSab()`/`hasOcspSupport()`
pattern) and a SPLIT classification. The QUERY is silent and the diagnostic is emitted by the USE —
`GamepadManager._init()`, once per process — mirroring `isSecureRandomSource()` (pure) vs.
`fillRandomBytes()` (warns) in `@gjsify/webcrypto/random`; the recommended usage is to CALL the
predicate, so it must not cost a stderr line on every macOS/Windows start. Three outcomes, three
voices: **absent** = no `Manette` typelib, or no `@gjsify/node-gi` in a `--app node` process (a
supported configuration, so a warn naming what to install — not a fault), or `gi://` stubbed by
design on the `--app browser`/`--app nativescript` builds (nothing to install ⇒ SILENT, and on those
targets the runtime's own `navigator.getGamepads` is the implementation anyway); **fault** = a
library that will not `dlopen`, a version or ABI skew (`console.error` carrying the original);
**monitor fault** = everything past the probe (`new Monitor()`, the device walk, `connect()`) failing
on a host whose backend loaded fine — a sandbox without udev / `/dev/input` — which gets its own
report rather than being labelled a failed load.

`getGamepads()` answers the spec's `[[gamepads]]` and MUST NOT be made to throw: the list "is
initially the empty list" and grows only when an index is selected for a connected device, so a host
with no backend gets `[]` — the W3C steps only ever return a list (their one throw is the
`"gamepad"` permission-policy `SecurityError`), and a browser on a driverless machine answers
identically: WebKit compiles `EmptyGamepadProvider::platformGamepads()` returning a static empty
vector. Throwing would break `navigator.getGamepads().length`. The pre-filled four-slot array this
package used to return was CHROME's shape, and that is measured rather than assumed — one machine,
`about:blank`, no controller attached: Firefox `[]` (length 0) vs. Chromium `[null,null,null,null]`
(length 4). WebKit agrees with Firefox in source: `NavigatorGamepad::gamepads()` returns
`m_gamepads` unchanged when it `isEmpty()`. The four slots made `length` report four ports that do
not exist; they are gone.

The suite is runnable on a host with NO Manette typelib, and that is checked by running it there:
`bwrap --ro-bind / / --ro-bind <copy-of-girepository-1.0-minus-Manette> /usr/lib64/girepository-1.0
gjs -m test.gjs.mjs` → `138 completed`, identical to the same bundle on this machine WITH libmanette,
with the one-time "No gamepad backend on this host" line on stderr only in the first case. Keeping
that true is a constraint on the test bundle, not just on the source: `register.spec.ts` must not
reference `globalThis.GamepadEvent` / `globalThis.navigator`, because `--globals auto` reads those as
free globals and injects the GTK/GNOME-backed register set, which announces `gi://Gdk, gi://GdkPixbuf,
gi://Manette, gi://Pango, gi://PangoCairo at load`. Wiring an ad-hoc Manette-less CI leg is NOT
proposed here — the general answer is the per-namespace availability contract below.

Still measured, still true: no GTK-runtime bundle carries the Manette typelib or libmanette, so on
macOS and Windows that import has never succeeded. Deliberately NOT fixed by seeding libmanette into
the bundles. There is nothing to seed FROM: homebrew-core has no `libmanette` formula
(`formulae.brew.sh/api/formula/libmanette.json` → 404) and `GTK4_Gvsbuild_2026.6.0_x64.zip` contains
zero manette/evdev entries, so the seed pattern would match nothing and — with the typelib-symmetry
rule in place — a Manette typelib could not ship anyway. And a hypothetical port would not help:
libmanette's backend reads Linux `/dev/input/event*` via evdev/udev, so a `Manette.Monitor` on
macOS/Windows would enumerate nothing while satisfying every symmetry check. That is the same "looks
available, does nothing" shape, moved one layer down.

What is left is the BACKEND, and the generalisation. Same shape as the ten other namespaces the
workspace imports and no bundle ships (`gi://Gst` ×17, `gi://WebKit` ×4, `Soup`, `Gda`,
`JavaScriptCore`, `X`): the generalisable answer is a per-namespace availability contract — the
`backend.ts` probe (classify absent vs. broken, warn once, expose a `has*` capability) is the first
instance of it and is currently hand-rolled per package. The three concrete follow-ups are the next
three entries.

### A darwin gamepad backend is the only route to macOS support, and it is a separate project

`GameController.framework` alone is NOT sufficient, and the reference implementations both say so by
shipping two paths. WebKit's `Source/WebCore/platform/gamepad/` holds `cocoa/`
(`GameControllerGamepadProvider.mm`) AND `mac/` (`HIDGamepadProvider.mm`, plus per-device
`Dualshock3HIDGamepad` / `StadiaHIDGamepad` / `LogitechGamepad` / `GenericHIDGamepad`), combined by
`mac/MultiGamepadProvider.mm` — which calls `HIDGamepadProvider::ignoreGameControllerFrameworkDevices()`
and gates GCF on `GameControllerGamepadProvider::willHandleVendorAndProduct()`, a hardcoded
vendor/product allow-list. The comment that explains the allow-list is narrower than "GCF is too
aggressive" in general — verbatim, and note its first three words
(`cocoa/GameControllerGamepadProvider.mm:104`, inside
`#if HAVE(MULTIGAMEPADPROVIDER_SUPPORT) && !HAVE(GCCONTROLLER_HID_DEVICE_CHECK)`): *"On macOS 10.15,
we use GameController framework for some controllers, but it's much too aggressive in handling devices
it shouldn't. So we check Vendor/Product against an explicit allow-list to determine if we should let
GCF handle the device. (We have the opposite check in HIDGamepadProvider, as well)"*. So the
allow-list is the fallback for builds without the newer HID-device check, not a standing verdict on
GCF. The conclusion — a darwin backend needs BOTH paths — does not rest on that comment: it rests on
`mac/MultiGamepadProvider.mm` existing and driving both providers
(`HIDGamepadProvider::singleton().ignoreGameControllerFrameworkDevices()`), and on the per-device HID
classes next to it. SDL ships both paths too —
`src/joystick/apple/SDL_mfijoystick.m` (GameController/MFi) and
`src/joystick/darwin/SDL_iokitjoystick.c` (IOKit HID).

Second, larger piece of work: `packages/web/gamepad/src/button-mapping.ts` maps raw evdev codes
(`BTN_SOUTH: 304` … `BTN_DPAD_RIGHT: 547`, the kernel `linux/input-event-codes.h` constants
libmanette 0.2 actually transmits) to W3C indices. Nothing on macOS produces those numbers — GCF
gives named `GCControllerButtonInput` properties, IOKit gives HID usage pages — so a darwin backend
needs a SECOND source vocabulary mapped to the same `W3CButton`/`W3CAxis` targets, not a new row in
the existing table. `hasGamepadBackend()` returning `false` is the honest interim answer.

### libmanette is not portable and upstream has never considered it

Verified against `gitlab.gnome.org/GNOME/libmanette` (tag `0.2.13` and `main`):

- `meson.build` has `libevdev = dependency('libevdev', version: '>= 1.4.5')` and
  `hidapi = dependency('hidapi-hidraw')` — neither carries a `required:` argument, so both are hard.
  The only toggle in `meson_options.txt` under "Dependencies" is `gudev`.
- there is no `host_machine` conditional in ANY `meson.build` in either revision (checked all six in
  `0.2.13`, all of `main`).
- `hid_enumerate()` is never called anywhere in the tree. `manette-hid-backend.c` does
  `hid_open_path(self->filename)`, and `filename` comes from the monitor's gudev walk
  (`manette-monitor.c`: `g_udev_client_new({"input", "hidraw"})`,
  `g_udev_device_get_device_file()`, `DEV_DIRECTORY "/hidraw"` prefix test). So the hidapi backend
  only ever receives `/dev/hidraw*` paths a Linux-only monitor found — hidapi being cross-platform
  buys nothing.
- all 51 issues and 155 merge requests (GitLab API `x-total`, tracker open since 2017-12-03) scanned
  for macos / mac os / darwin / osx / portab* / windows / win32 / freebsd / cross-platform in title
  and description: **zero relevant hits** in nine years (the one keyword match, MR !104, is a
  comment about SDL button mappings).

And the dependency it hard-requires is not available: homebrew-core's `libevdev` formula carries
`depends_on :linux` with `arm64_linux`/`x86_64_linux` bottles only, MacPorts has no `libevdev` port
(ports API exact-name query → `{"count":0}`), and nixpkgs declares
`platforms = lib.platforms.linux ++ lib.platforms.freebsd`. Porting libmanette is therefore a
libevdev port first; that is why the darwin work above is a NEW backend, not a build fix.

### A forced migration is coming: `Manette-1`

libmanette `main` is `version: '1.0.alpha'` with `libmanette_api_version = '1'`, i.e. the typelib
becomes `Manette-1` and `@gjsify/gamepad`'s current `gi://Manette` (0.2) namespace is a different
one. The API is not source-compatible:

- `ManetteEvent` is DELETED (`src/manette-event.c` + `manette-event-private.h` removed in commit
  `3255105` "Remove ManetteEvent", part of MR !126 "Bump API version and revamp API", merged
  2025-04-01). Every `event.get_button()` / `get_absolute()` / `get_hat()` call in
  `gamepad-manager.ts` goes away with it.
- the device signals are renamed and re-typed: `button-pressed` / `button-released` /
  `absolute-axis-changed` (plus `unmapped-*` variants) instead of
  `button-press-event` / `button-release-event` / `absolute-axis-event` / `hat-axis-event`.
- typed `ManetteButton` / `ManetteAxis` enums (`src/manette-inputs.h`,
  `MANETTE_BUTTON_DPAD_UP` … `MANETTE_BUTTON_TOUCHPAD`, `MANETTE_AXIS_LEFT_X` …
  `MANETTE_AXIS_RIGHT_TRIGGER`) replace the raw kernel codes — which is exactly what
  `button-mapping.ts`'s `LinuxButton` table exists to decode, so that table is retired rather than
  extended. Note there is no `hat-axis` signal any more: the d-pad is four buttons.

`@girs/manette-0.2` does not bind the `Manette-1` namespace, so this needs a `ts-for-gir` run for the
new version before any code change. Independent of the macOS work above and independent of the
observability fix already landed: the migration is required on Linux the moment distros ship 1.0.

### The GTK-runtime bundle precedence question is still open

`resolveGtkRuntimeBundle()` probes four candidates in order (`GJSIFY_GTK_RUNTIME`, node-gi's own
`prebuilds/<target>/gtk/`, the sibling monorepo dir, then `require.resolve('@gjsify/gtk-runtime-<target>')`),
and an INSTALLED bundle satisfying candidate 4 is why the bundles must NOT be dependencies of
`@gjsify/node-gi`: #910 made the arm64 bundle a dependency and #920 reverted it, because a job that
built the addon against Homebrew GTK then re-execs onto the BUNDLE's typelibs with native code
linked against a DIFFERENT GTK — wrong method entries, then a 29-minute timeout. The same trap now
applies to a second darwin arch. What is missing is a rule that makes the mismatch VISIBLE rather
than a timeout: the bundle's `manifest.json` records its build prefix and dylib set, and the addon's
`otool -L`/`LC_RPATH` records what it linked against, so a load-time check could refuse the
combination outright. Until then the answer is the install-time one — the bundles stay manual
installs, documented in node-gi's README.

### `os.cpus().times` on darwin needs a Mach call GJS cannot make

`@gjsify/os`'s darwin reader reports the documented all-zero `times` — every field present and numeric, none of them meaningful — and `package.json#gjsify.os.darwin` is `"partial"` with that as its printed reason. Linux reads the per-CPU tick counters from `/proc/stat`. The macOS equivalent is Mach's `host_processor_info(PROCESSOR_CPU_LOAD_INFO)`, the same call libuv makes, and it is unreachable from GJS without a native bridge; no userland tool prints the cumulative per-core totals Node returns (`top -l 1` and `iostat` give an INSTANTANEOUS aggregate percentage, which is a different quantity — deriving one from the other would be fabrication, not degradation). Closing it means a native bridge, so it is a scope decision rather than a task. `src/index.spec.ts` carries `it.failing('cpu times should have non-zero values', …, { when: isDarwin() && gjs })`, which runs the assertion and fails the day a reader exists — so this entry retires itself rather than needing to be remembered.

### Two copies of the process-memory reader, and the `@gjsify/v8` node slot is why

`@gjsify/utils/core`'s `host-process` module and `@gjsify/v8`'s `heap/{linux,darwin,win32}.ts` read the same figures from the same sources with the same degraded contract (`ps(1)` has no data/peak column, so both report `0` there). The lift was made and REVERTED, and the reason is worth having written down before someone makes it again: routing v8's reads through `/core` removes the last `@girs/*` value import from that package, `audit-runtimes --check` then derives `runtimes.node: "native"` from the source signals instead of the declared `"none"`, and `Detect runtime-triplet drift` is one of the three checks that block a merge. Promoting the slot is a change to published ADR-0014 routing (a `native` slot sends the package root to `<pkg>/globals`, which `@gjsify/v8` does not ship), not a comment. So the question to answer FIRST is what `@gjsify/v8`'s node slot should be — `none` (this package does not serve Node) or `native` (Node has its own `node:v8`) — and the deduplication follows from it. Both files name the shared contract so it cannot drift silently in the meantime.

### A loopback teardown race survives on darwin, on the native-Node leg only

`@gjsify/net`'s `server.spec.ts` still reports 1-2 of 381 failing under NATIVE Node on darwin (`read ECONNRESET`), against 381 green under GJS on the same host. It was 2-4 before `withServer` took ownership of the accepted sockets and the affected specs learned to tolerate exactly `ECONNRESET`, so what is left is narrower, not closed. The mechanism is the kernel's: BSD resets a connection that is closed while unread data is buffered where Linux delivers a FIN, and an `'error'` event with no listener is re-thrown. The remaining failures wander between `close event after end` and `localPort after connect`, which is the signature of a socket outliving the spec that made it — the next thing to try is owning the CLIENT sockets' lifecycle the way the server's now is. Per this repo's testing rules a native-Node failure is a statement about the TEST, and our implementation is the one that is green.

### `@gjsify/sqlite`'s GJS suite ABORTS the process, and the trigger is a GC window

Not a failing assertion — `SIGABRT`. Measured on darwin-x64 / gjs 1.88.1 / libgda 6.0, running `database-sync.spec.ts` alone under the real harness:

```
DatabaseSync.prototype.close()
GLib-GObject:ERROR:../gobject/gobject.c:6103:_weak_ref_set:
  assertion failed: (weak_ref_data_list_find (new_wrdata, weak_ref) < 0)
Bail out!   gjs exited with code null
```

It stayed invisible until the `/var` vs `/private/var` fix landed, because the node leg failed first and the `&&` chain never reached the gjs one.

**Ruled out, each by measurement rather than by reading:** bare libgda (`Gda.Connection.new_from_string` + `open()` + `close()`, nothing of ours in the process) does not abort · leaked connections plus an explicit `system.gc()` do not abort · the same operations driven through the real `DatabaseSync` API outside the harness do not abort · a specific test is not responsible, and neither is a leaked connection from the constructor block — the constructor validates (`parsePath`, `validateOptions`) BEFORE it opens, so a throwing construction never creates one.

**What the bisect says.** Keeping the first N `it()` rows of the constructor block and rebuilding: N=0 ok, **N=1 CRASH**, N=2 ok, N=3 ok, **N=11 CRASH**. Non-monotonic — the number of preceding rows perturbs *when* the collector runs relative to the libgda objects' lifetimes, and nothing more. That is the signature of a GC window in the interaction between GJS's object-wrapper machinery (toggle refs / `GWeakRef`) and libgda's objects, not of a condition in our code. It is therefore NOT fixable by editing a spec, and a fix that appeared to work by adding or removing a test row would be luck.

Next step is instrumentation, not more bisecting: run under `GJS_DEBUG_ALL`/`G_DEBUG=fatal-warnings` with a breakpoint on `_weak_ref_set` to see which object is being re-registered, and whether the second registration comes from GJS's wrapper or from libgda. If it is GJS's, this joins the libgda row already in `upstream-patch-candidates.md`; if it is ours, the owner is `DatabaseSync`'s lifecycle. Until then there is no workaround to maintain, which is why this is here and not in that table.

### Two packages have no darwin target at all, and their specs say so by failing

`@gjsify/webrtc` dies at `Requiring GjsifyWebrtc … Typelib file for namespace 'GjsifyWebrtc' not found` and `@gjsify/sab-native`'s positive control `hasNativeSab() returns true when prebuild is loaded` cannot pass, because no `webrtc-native-darwin-*` package exists and `@gjsify/sab-native`'s `gjsify.platforms` declares `linux-*` only. Both are honest failures of a promise nobody made — the declarations are correct and the artifacts genuinely do not exist. Recorded so a macOS run's red is READ correctly: it is a missing target, not a broken port. Closing either means adding the darwin legs to `prebuilds.yml` and the targets to the manifests, at which point the same specs become the check. The sibling bridges (`http2-native`, `tls-native`, `terminal-native`, `http-soup-bridge`, `webgl`, `lightningcss-native`, `oxfmt-native`, `rolldown-native`) all already ship `*-darwin-{x64,arm64}`, so the pattern is proven — these two were simply never extended.
### `@gjsify/webkit-native` — what the darwin WebKit backend still owes

ADR 0022 landed the backend and `@gjsify/iframe`'s 291 tests pass on darwin. **Input forwarding, named script worlds and user-script allow/block lists have since landed too**, and the two entries that stood here for the latter pair were not deferrals but MISTAKES OF FACT — the ADR asserted "WKWebView has no public isolated-world API" when `WKContentWorld` has been public since macOS 11, and it warned-and-ran a script whose allow/block list said not to. Both are worth remembering as a shape: an Apple API that looks absent deserves a check of its availability annotation before a design is built around its absence. What remains:

**The namespace is squatted, and one host shape gets it wrong.** The shim's typelib IS `WebKit-6.0` (ADR 0022 decision 3, with the measurement that forced it). On a macOS host that built WebKitGTK 6.0 from source, two providers would compete on `GI_TYPELIB_PATH` and ours — a subset — could shadow the real one, where a missing class reads as `undefined` rather than as an error. Bounded today by the artifact shipping only in an `os: ["darwin"]` package and by macOS having no packaged provider; if that ever changes, the fix is a synchronous backend selector in `@gjsify/iframe`, which GJS does not currently offer in a form this repo permits.

**Three things the input work reached the end of the public API on, all measured rather than assumed** (`docs/poc/webkit-input-darwin.m` prints each): `document.hasFocus()` is permanently `false`, so `window.onfocus`/`onblur` never fire and no caret blinks — it is derived from a responder chain the windowless view has no place in, and an offscreen `NSWindow` was built and does NOT fix it. The pointer cursor never changes over links, for the same reason. And App Sandbox stays unanswered: `webkit-hardened-runtime-darwin.sh` shows the hardened runtime working with `com.apple.security.cs.allow-jit`, while the sandbox case dies at process start because `com.apple.security.app-sandbox` needs a bundled app with an `application-identifier` an ad-hoc signature cannot issue. Answering it needs a real Developer ID, not more code.

**The input path has no CI coverage on any platform, and that is the honest state.** It is held by two by-hand probes — `webkit-input-darwin.m` (NSEvent → WebKit → page) and `webkit-input-widget-darwin.m` (the widget's own controllers → page, driven by emitting the controller signals). Both need a display, which is the same wall as the DISPLAY-gated-GTK entry above, and `@gjsify/iframe`'s 291 unit tests instantiate no live WebView at all. Two routes into GTK's real event translation were tried and are dead ends worth not re-trying: `-[NSApplication postEvent:atStart:]` is never picked up (GTK4's macOS backend does not drain the posted-event queue — measured with a plain `GtkGestureClick` and no WebKit anywhere, 0 hits), and `CGEventPostToPid()` is dropped because `AXIsProcessTrusted()` is false and Accessibility is not a permission CI can grant itself.

### `--platforms` credits an artifact from the WORKING TREE while its legend says "committed"

`collectNativePackages()` derives `shipped` from `readdirSync(<pkg>/prebuilds)` — presence on disk. The matrix legend renders that as **"artifact committed"**. For every bridge but one those agree, because their `prebuilds/` directories are tracked. `packages/node-gi/node-gi/.gitignore` ignores its own, and `stage-prebuild`/install leave one behind, so the same command prints a different table depending on whose machine it runs on:

    with a staged prebuilds/:  | `@gjsify/node-gi` | 2 | ○ | ○ | ○ | · | · | · | ✓ | ○ |
    without (clean checkout):  | `@gjsify/node-gi` | 2 | ○ | ○ | ○ | · | · | · | ○ | ○ |

Found by committing the generated Platform Support matrix and having a review notice the `✓` did not reproduce. The immediate hole is closed by not committing that file at all (`website/.gitignore`), which is why this is a ledger entry rather than a fix: the audit itself still answers a question it does not ask.

The fix is to credit from git rather than from the filesystem. What makes it more than a one-liner: `tests/e2e/prebuild-declaration-invariant` drives this code against SYNTHETIC packages, which are by construction untracked, so a tracked-ness requirement has to be a matrix-side credit rather than a change inside `collectNativePackages()`. Alternative, cheaper and honest: leave the measurement alone and change the legend to say "artifact present", which then no longer answers "can I install this there?" — the question the page exists for.

### Nothing exercises the NODE-FREE toolchain on macOS, and the prebuild's arrival hid that

The engine half is DONE — `@gjsify/rolldown-native` declares all four of `linux-x64`, `linux-arm64`, `darwin-arm64`, `darwin-x64`; `packages/infra/rolldown-native-darwin-{arm64,x64}` hold committed artifacts; `--platforms` marks every darwin cell `✓` for it and for `@gjsify/lightningcss-native` / `@gjsify/oxfmt-native`; all three are on npm at the train version.

What no leg covers is the path those engines exist FOR. Both darwin jobs in `macos-suites.yml` install, bootstrap and build by invoking the CLI **under Node** (`node "$RUNNER_TEMP/bootstrap-cli/…/lib/index.js"`, then `node packages/infra/cli/lib/index.js run build`) — correct for proving the Node pillar on darwin, and blind to `gjs -m install.mjs` → `gjsify build` on a box with no Node at all. `tests/e2e/node-free-bootstrap` exercises that shape only on the Linux runner.

This entry previously read "no native macOS build has been promoted … until that leg is green the docs must keep describing the Node-free toolchain as Linux-only". The build was promoted; the instruction outlived it, and three pages of the website went on telling macOS users to install Node because a ledger entry told them to. **The lesson is the shape of the sentence**: a ledger item that instructs the DOCS to keep saying something has no retirement trigger — the docs do not fail when the code changes underneath them. State the condition to measure, not the prose to keep.

The work: a darwin leg whose install+build steps go through the bootstrap the way the Linux node-free leg does, with `node` off PATH for the duration so the leg cannot pass by accident.

### Follow-up — adwaita-web style isolation (ADR 0010)

The style-isolation boundary reset (`scss/_reset.scss`) landed. Remaining: document the `--adw-*` / `--*` token set as the public theming contract on the website (the sanctioned external-override API — the counterpart to the isolation); if a second light-DOM Adwaita renderer ever appears, lift the boundary reset into `@gjsify/adwaita-core` (headless) so both share it; keep `$adw-components` in `_reset.scss` in sync with `src/elements/*` (guarded by `style-isolation.spec.ts`). Shadow DOM stays a documented FUTURE option, not adopted.

### Three NS widgets hand-roll a sheet lookup the tree already solved

`Dialogs.action()` returns the chosen STRING, so every NativeScript widget that
substitutes a sheet for a popover has to map that string back to an entry. The
tree has a correct answer for it and does not use it three times.

`widgets/split-button.ts` exports `menuSheetActions()` + `resolveMenuChoice()`:
the first seeds the used-label set with the dismiss text and appends zero-width
spaces until every action is distinct, so a second entry with the same label and
an entry literally called `Cancel` both stay addressable; the second returns `-1`
for a dismissal. Both are spec'd (`split-button.spec.ts:144-174`, incl. the
`Cancel` case). `adw-alert-dialog.ts` solves the same problem the other correct
way, delegating to core's `resolveLabel`.

`adw-menu-button.ts:85`, `adw-combo-row.ts:132` and `adw-drop-down.ts:116` each
call `labels.indexOf(chosen)` over the raw labels with a bare
`cancelButtonText: 'Cancel'` instead — the addressing core documents as wrong in
`SplitButtonState.activateMenuEntry` ("silently dispatches the first of two
identically named entries and cannot tell an entry called `Cancel` from a
dismissed sheet"). `adw-menu-button` also carries its own `entry.id ?? entry.label`
fallback, which the browser twin repeats at `adw-menu-button.ts:229`.

Deferred rather than done here because the home is NOT the local helper: both
renderers need it, so `menuSheetActions`/`resolveMenuChoice` belong in
`@gjsify/adwaita-core` beside `parseMenuEntries`, with conformance vectors, and
the web copies of the id-fallback go at the same time. That is a widget-behaviour
change to four files across two renderers; it was found during a pass on the
widget-coverage READER, and landing it there would have moved the published
core-backed count for a reason that has nothing to do with how the count is read.

It does move that count when it lands: `split-button.ts` imports
`@gjsify/adwaita-core` for `splitButtonArrowIcon`, so `adw-menu-button` reaching
the shared helper gives it the value edge the matrix asks for — flipping its row
because it became true, not because a marker said so.

### Follow-up — adopt `@gjsify/adwaita-app` in the shell consumers (ADR 0009)

Adoption is opportunistic, not a rewrite — wire each consumer onto the shell package on its next shell touch: `@gjsify/storybook` (re-base `StorybookApplication` onto `AdwaitaApp`/`runAdwaitaApp`), buchhaltung (`app/src/frontends/desktop` — replace its hand-rolled application/nav/loadIntoStack/toast/dialog code; follows the release train), eco-retrofit (`cli/src/app` — same; also fixes its latent `Adw.Application.run(null)` → `runAsync()` hang class).

### Stale PixelRPG maker bundle — rebuild + recommit with `installDevtools`

`@gjsify/devtools` exports `org.gjsify.Devtools` correctly in every app config (verified rigorously, guarded by `tests/e2e/devtools-export`), and the css-as-string bare-`@import` gap that blocked the maker's rebuild under the global GJS CLI is fixed at the core (native `bundle()` path resolves + inlines bare-specifier `@import`s via `cssBundleResolver`; unresolvable imports fail loudly; `tests/e2e/css-as-string-bare-import`). Residual (map-editor repo, not gjsify): the committed `apps/maker-gjs/org.pixelrpg.maker` bundle predates the `installDevtools(this)` call — rebuild + recommit it. `installDevtools` logs `[gjsify-devtools] exported …` so "did devtools come up?" is answerable from the app's stderr.

### `Screenshot(scope)` is routed, but two of its four scope shapes are unproven

The dead in-arg is fixed — `ScreenshotAsync` reads `params[0]` and resolves it
through the same `_resolveRootWidget` the path methods use. Two of the four
shapes that fix needs are asserted headlessly in `peer-transport.spec.ts`: the
active-window vocabulary (`''`/`window`/`active`) still answers, and an
unresolvable path now raises `not-found` instead of silently returning the
active window's pixels. That second one is what makes the argument's routing
OBSERVABLE at all — it is the only input whose read and unread readings differ.

The other two — a NON-ACTIVE toplevel, and a CHILD widget — cannot be asserted
where the suite runs. Both need a realised, laid-out window, and the devtools
specs run on plain gjs with no display precisely so they cover the busless path
on every PR. So what is unproven is not the routing (the resolver is shared with
`DumpTree`/`GetProperty`/`ActivateWidget`, which are covered) but that
`captureWidgetPng` on a CHILD returns that child's pixels rather than its
window's, and that presenting `widget.get_root()` warms up the right toplevel.

Where it would go: `tests/e2e/devtools-export/`, the one suite that drives a real
GApplication — which is itself unlisted today for an unexplained name loss in the
containerised runner (its own entry below). Same environmental hole, so this
waits on that rather than adding a second suite that would skip for the same
reason.

### Architecture backlog — ADRs 0001–0008

Decisions in [docs/adr/](../docs/adr/README.md), prioritized backlog in [docs/reports/2026-07-01-architecture-review.md](../docs/reports/2026-07-01-architecture-review.md). Remaining open work (resolved sub-items are recorded in the commits/CHANGELOG that closed them):

- **ADR 0001 (P1)** — install non-destructive invariant: the Phase D.8 dedup pass is still open (the e2e guards, per-prefix lock, atomic writes and conflict warning have landed).
- **ADR 0006 (P1)** — per-package build cache: **CI wiring DEFERRED** — enabling it on the `main.yml` build steps timed out the serial `Build examples` step (cold cache + per-package closure re-hashing at scale). Remaining: (a) memoize input hashes across a single `foreach` before re-enabling in CI; (b) phase 2 = source-direct workspace-consumption spike.
- **ADR 0003 (P1)** — tiering shipped; the website still lacks a per-package tier index (the tier model is documented on the versioning page).
- **ADR 0002 (P1) — DONE.** Both big bundles are untracked; CI and a fresh clone
  bootstrap from the published gjsify. Read the **second amendment** (2026-08-06):
  it withdraws decision 1 (no `bootstrap/bootstrap.gjs.mjs`) because the
  lockfile-reader wedge that required a same-commit installer is closed and
  machine-checked by `scripts/check-lockfile-reader-lead.mjs`. #1002 is closed as
  superseded; the one measurement worth keeping from it lives in the ADR.
  Residual: the `--determinism` mode owed to `release-cut.yml` (see the bundle
  determinism entry above).
- **ADR 0007 (P3, easy6502)** — superseded into the full Learn6502 app-web rewrite (own project). Foundation pieces (phone-shell trio, `<adw-source-view>`) have landed on adwaita-web; remaining: the app-web view implementations over these + the classic-tutorial removal + the learn-package HTML target.

(ADRs 0004, 0005 and 0008 are fully implemented.)

### N-API host in GJS (`@gjsify/napi`) — Phase 2+ follow-ups

Phase 0 (full `js_native_api.h` + module loader; better-sqlite3 byte-identical to Node, valgrind-clean; conformance green with every divergence carrying its Phase-0 reason in `conformance/ledger.json`) and Phase 1 (tsfn surface; node-gi-under-shim byte-identical to native `gi://` across node-gi's whole conformance suite, nothing ledgered — a CI test oracle, NOT a production path) are complete; the transparent `.node`→`loadAddon` build integration has shipped (`napiNodeAddonPlugin`, e2e-gated byte-vs-Node on all four addon-loading conventions). Open:

- **implement the deferred non-experimental stubs** — `napi_*_bigint_words`, `node_api_create_external_string_{latin1,utf16}`, `napi_create_external_arraybuffer` (currently loud stubs → several of the 8 ledgered conformance programs).
- **crash-class hardening (deferred, non-blocking)** — null `state->wrap` via a back-pointer to close a theoretical teardown-finalizer sibling-unwrap UAF; Node-parity, not a graduation gate.
- **the 4 `NAPI_EXPERIMENTAL` conformance addons** — `node_api_post_finalizer` / `node_api_create_object_with_properties` / `node_api_is_sharedarraybuffer`.
- **node-gyp golden drift watch** — the node-gyp goldens were generated on Node 24 but CI runs Node 22; watch the first CI run for golden drift.
- **cross-platform prebuilds** — macOS darwin-arm64 SHIPPED incl. the tsfn gate (conformance/consumer/valgrind widening deferred; no maintained arm64-macOS valgrind). **Windows (win32-x64): ATTEMPTED, blocked at gjs-on-Windows** — shim-side portability is done and Linux-verified (`.def` exports, `LoadLibraryEx` loader, manual-dispatch `windows` job); a prebuilt MSVC mozjs-140 now exists (servo/mozjs `mozjs-sys-v140.13.0-0`), but no prebuilt libgjs exists for Windows and servo's patched static-lib layout is not the pkg-config `mozjs-140` gjs's meson consumes, so gjs must still be source-built (clang-cl) — and behind that waits the delay-load host-binding wall (no POSIX global symbol namespace; an unmodified node-gyp `.node` binds `napi_*` against the host `.exe`, which `gjs.exe` does not export). Unblocks when a prebuilt libgjs-win32 appears OR gjs builds against the servo mozjs AND the delay-load host-binding is solved.

### GI/GObject runtime for Node (Axis 5) — deferred limitations

`@gjsify/node-gi` graduated Tier 3→2 per ADR 0005 (2026-07-14) — the four gate items landed (teardown crash, vfunc OUT/INOUT, GTK/Cairo layer, second real consumer), the GIMarshallingTests oracle sits at 370 pass / 0 fail, the Excalibur-WebGL and Adwaita-window/storybook GTK capstones render byte-identically to `gjs -m`, and the cross-runtime legs (Bun full core parity, Deno conformance subset) ship from one N-API binary. The step-by-step roadmap provenance lives in git/CHANGELOG. Known gaps left for follow-up PRs (each surfaces a clear error or is benign; none is silently wrong):

- **Cross-runtime consumer survey — prioritized backlog.** `scripts/node-gi-consumer-harness.mjs` generalizes the consumer proof (a package's OWN GJS suite runs `--app node` on node/bun/deno); the `consumer-suites` CI job gates the proof set `sqlite`+`http2`+`zlib` under `--require-pass`. Full survey + gap report: `docs/reports/node-gi-consumer-survey.{md,json}` — 17 packages already run unchanged. Remaining blockers, priority order: **P3** — GLib/GObject marshalling-helper gaps (`ByteArray.fromGBytes`, `GLib.filename_from_uri` undefined; blocks `child_process`/`os`/`module`); **P4** — `normalizeEncoding`/`checkEncoding` unresolved when a polyfill is `--alias`ed onto Node (`crypto`/`string_decoder`). Follow-ups: full 22-package `test:gjs-on-node` rollout + a non-gating full-survey CI job that publishes the table.
- **Bun/Deno conformance is a curated subset, not the full suite.** Excluded from `test:bun`/`test:deno`: the display/GTK tests (CI Xvfb leg), the `--expose-gc` toggle-ref stress leg (Node's GC-safety gate), and the mainloop/runasync/pump uv-integration cases (they assert the Node-only libuv↔GLib bridges; Bun/Deno drive the non-blocking case via `startMainContextPump`, and `async-gio-await` is ledgered for them accordingly).
- **Reverse-bridge polyfill routing over runtime natives** — on Node the global `fetch` stays the NATIVE undici one (the register convention never overrides an existing native), so `@excaliburjs/plugin-tiled`'s fetch-based fileLoader cannot load the root-relative `/res/…` asset paths our GJS fetch/XHR resolve against the program dir. This is what blocks the FULL `excalibur-jelly-jumper` on `gjsify run --runtime node` — everything else boots. Needs an opt-in GJS-parity-globals mode for reverse-bridge builds (route `fetch`/friends to the `@gjsify/*` polyfills over the runtime natives).
- **Gst audio decode/playback on node-gi is PROVEN on node, bun and deno; the residual is the bun/deno pump requirement.** The former nondeterministic decodebin SEGFAULT was the `(transfer full)` GObject IN-arg ownership bug in `marshal.cc`, fixed; measured clean against PipeWire (a real sink-input owned by the runtime pid, 0 crashes/CRITICALs over repeated runs). The harness verdict: node `pass 62/62`, bun/deno `partial 61/62` — the one failure is `onended` not firing in a BARE script, the already-ledgered no-auto-pump property (`ended` rides a `Gst.Bus` watch on the GLib main context; with the context advancing it fires on bun and deno too). Deciding whether `@gjsify/webaudio` should drive the context itself (it cannot import node-gi — ADR 0005 forbids the hard dep) or whether bun/deno should gain node's auto-pump is a separate cut. No CI leg exercises this (needs a sound device); the harness is the reproducible check. Related test-harness fix already landed: `@gjsify/webaudio`'s `test.mts` awaited the spec directly instead of routing through `@gjsify/unit`'s `run()`, so a broken assertion still exited 0 — the same shape is worth checking on any package whose `test.mts` does not call `run()`.
- **`@gjsify/xmlhttprequest` — on DENO every XHR stalls at `readyState 3`, so an asset loader never completes.** Reproduced on the jelly-jumper showcase (`--app node`, `--runtime deno`): all 26 resource requests reach readyState 3 within 10 ms and then NOTHING — no readyState 4, no load/error events, for the whole run. **Bun runs the identical bundle to completion**, so this is deno-specific. Ruled out by measurement (do not re-investigate): GLib sources fire, microtasks drain inside the blocking `Adw.Application.run()`, `Gio.File.load_contents_async` completes, and the two primitives `readFileUrl()` is built from return correct bytes on deno. The stall is inside `send()`'s `Promise.resolve().then(doFetch)` chain and needs instrumentation INSIDE `@gjsify/xmlhttprequest` (its `__GJSIFY_DEBUG_XHR` logs go through `console.log`, which the `--app node` bundle routes somewhere the terminal does not see — fixing that visibility is step one).
- **struct gaps** — struct *construction* (`new Ns.Struct({…})`), array-of-struct-by-value element field reads, and GValue BLOB (byte-array) marshalling (surfaced by the sqlite consumer — a bound `Uint8Array` doesn't persist and a BLOB return comes back as a raw boxed handle).
- **`worker.terminate()` mid-native-call** — the `Error::New` `SIGABRT` funnel is CLOSED (every fallible chain checks the swallowed-failure residue; stress: 0 aborts / 200 terminates on both loop shapes, guarded by `test/worker-terminate.test.mjs`). RESIDUAL: a lower-rate SIGSEGV (12/200 ≈ 6%, identical pre-fix) when the terminate lands while the worker OS thread is inside a blocking GLib C call — the terminating isolate racing an OS thread in native code, with no napi frame; pre-existing, the textbook "terminating a worker mid-native-call is documented-hazardous in Node generally" case. Closing it would need Node/V8 to quiesce in-flight native calls before freeing the worker isolate.

### child_process instant-exit pid — upstream GIO gap (issue #503; rewrite scoped + rejected)

`@gjsify/child_process`'s `spawn()`/`exec` read `child.pid` from `Gio.Subprocess.get_identifier()`, which returns `null` once GSubprocess's child-watch (GLib worker-thread context) reaps the child — so an instant-exit child on a saturated runner can lose its pid (Node always reports one). **Resolved at the test layer** (deterministic alive-when-checked process) + **documented as an upstream GIO limitation** (see Upstream GJS Patch Candidates). The `GLib.spawn_async_with_pipes_and_fds` + `DO_NOT_REAP_CHILD` rewrite was scoped and **rejected for now**: it regresses `child.kill()` to a `/bin/kill` shell-out and reimplements env/cwd/stdio/wait-status reaping on a critical path. Revisit IF: (a) a real consumer needs a reliable pid for instant-exit children, or (b) upstream GIO exposes a spawn-time pid. **Filed upstream: [GNOME/glib#3981](https://gitlab.gnome.org/GNOME/glib/-/work_items/3981)**; maintainer verdict: accessor "would be OK" but de-prioritised in favour of pidfds, so the deterministic alive-process test + spawn-time capture (`_capturePidAtSpawn`) is our stable, permanent posture, not a temporary workaround.

### The `process.exit()` guards are right, and five comments explain them wrongly

`packages/node/process`'s `exitProcess` is declared `never` and blocks in
`for (;;) context.iteration(true)` after idle-scheduling `system.exit(code)`
(`internal/exit.ts`), landed as `ba64356b6e fix(process): make process.exit() not
come back`. Before that it was genuinely deferred and RETURNED under GJS, and
several `return process.exit(…)` guards were written with that as their stated
reason.

The guards are still correct — `return` marks the end of control flow for the
reader and the type checker, and `run.ts` additionally propagates through
`process.exitCode` because `gjsify run <script>` dispatches a nested
`gjsify run <bundle>` IN PROCESS. What is stale is the REASON printed beside
them: `commands/run.ts:319,342,439,467`, `commands/test.ts:85,185` and
`utils/node-script.ts:81` still say a bare exit "falls through" or "is deferred".

Deliberately not swept in the PR that added the spawn-teardown gate: that PR
rewrote the two runners and left no stale premise in the code it touched, and a
comment sweep belonging to `ba64356b6e` does not belong in a review about spawn
routing. Each site needs its own sentence — the guards do not all stand for the
same reason — which is why this is a task and not a find-and-replace.

### A pruned prefix still cannot prove what it was assembled from

ADR 0025 landed the platform rule: `gjsify prune` and the automatic pass after an
install remove what npm's own `os`/`cpu`/`libc` say this host cannot use. Measured
on a real 638 MB user-global prefix, that is 75 packages and 420.5 MB.

**What it cannot decide is reachability** — "no installed package points at this any
more". `@rolldown/binding-wasm32-wasi` is the worked example: unusable on any host
this CLI runs on, declares no platform at all, and is not in the dependency set of
the `rolldown` beside it. The platform rule correctly keeps it, and only a walk from
a ROOT LIST could retire it.

No prefix carries that list. The global prefix has no lockfile, no `package.json`
and no record of the specs it was installed from — `installPackages` writes a
lockfile only when its caller asks, and neither global writer does. So the record
has to be created before the rule can exist: something like a `gjsify-global.json`
naming the specs each `install -g` / `self-update` placed, written atomically beside
`node_modules`, plus a recovery path for a prefix that predates it (walk the bin
launchers back to their packages) whose incompleteness is REPORTED rather than
assumed away — a root with no bin leaves no trace, which is exactly why an orphan
sweep on a recovered list must stay an explicit request.

Two smaller consequences wait on the same record:

- `gjsify uninstall` does not prune. An uninstall is precisely when a closure
  becomes unreachable, which is this rule. Its handler is also synchronous and takes
  no install lock, so wiring anything in there is a change to that command first.
- The report cannot distinguish "installed on purpose, nothing depends on it yet"
  from "left over". Without the record those look identical, and deleting the first
  kind is the failure that makes a prune untrustworthy.
### Two e2e suites still owe the shared harness, for different reasons

Sixteen of the twenty suites that stood up a private `node:http` registry now use
`startMockRegistry`, and `check-e2e-harness-duplication.mjs` has a
`registry-server` rule so a twenty-first copy fails. Its ALLOWED ledger is
self-retiring, so each remaining entry has to be answered rather than forgotten.

**`install-script` — the registry half is deferred, not exempt.** Its subject is
the bootstrap downloader (SHA-256 digest routes, the content-addressed cache, the
retry on a dropped connection), which `onRequest` expresses; the packument
registry beside it is ordinary and would migrate with no option at all. It was
NOT migrated because it could not be verified: on the workstation the migration
was written on, two of its nine cases fail before any change, with
`No version of @gjsify/cli satisfies 0.0.99-test` from a run that has its own
`XDG_CACHE_HOME`, its own global prefix and its own registry. CI is green on
`main`, so this is local — but a migration verified only by "the same two still
fail" is not verified, and that is the whole reason the other sixteen were
believed. Find the local cause first; the migration is then mechanical.

**A SECOND duplication class sits in the same files and is deliberately not
ruled on yet.** A spawn-and-collect helper — `runChild` / `runHarness` — is
`runCli` minus the hardcoded CLI entry, and appears in eleven suites, only five
of which were in this migration. `native-install`'s copy genuinely cannot fold
in: it runs a temp harness file with `--no-warnings`, not the CLI entry. So the
fix is a shared `runNode(file, args)` that `runCli` itself delegates to, and a
checker rule for it would touch six suites unrelated to the registry work —
which is why it is a task and not a line in that PR.

### `@gjsify/sqlite` exec() compound-statement (CREATE TRIGGER) splitting

`DatabaseSync.prototype.exec()`'s `#splitStatements()` is comment/quote-aware, but still a token-level scanner, not a parser — a compound statement whose body carries inner semicolons is shattered: `CREATE TRIGGER t … BEGIN INSERT …; … END;` splits at the `;` after the inner `INSERT`, yielding `incomplete input`. node:sqlite gets this right because SQLite's real parser knows `BEGIN…END`. **Clean fix = let libgda's own statement tokenizer do the splitting** — currently blocked because `Gda.SqlParser.parse_string()` used iteratively hits a double-free under GJS and `parse_string_as_batch()` returns `Gda.Batch` objects rather than `Gda.Statement`s. A heuristic port of SQLite's `sqlite3_complete()` state machine was considered and NOT taken (mis-handles `CASE…END;`, adds risk to the transaction `BEGIN; … COMMIT;` path). Revisit when the libgda `parse_string` limitation is resolved (then the hand-rolled splitter can be retired entirely).

### oxlint native path — deferred (JS-plugin host needs Node)

`gjsify lint` still spawns the npm `oxlint` Node launcher even under GJS. A `@gjsify/oxlint-native` GI bridge (mirroring `@gjsify/oxfmt-native`) could only run the Rust rule subset: the JS-plugin host that executes `.oxlintrc.json` `jsPlugins` (the internal `gjsify/register-class-order` rule) lives in the Node launcher, so a native lint would silently skip that rule — a worse failure mode than requiring Node. Options when picked up: (a) native lint as an explicit opt-in subset (`GJSIFY_OXLINT=native`, warn when jsPlugins are configured); (b) port `register-class-order` to a Rust rule upstream; (c) wait for oxlint's plugin host to become embeddable without Node. Until then: `gjsify format`/`fix`'s oxfmt half is Node-free under GJS, `gjsify lint` (and the oxlint half of `fix`) needs Node.

### gjsify on Flatpak — remaining roadmap

The `org.freedesktop.Sdk.Extension.gjsify` SDK extension (toolchain under `/usr/lib/sdk/gjsify`, no network and no Node at app-build time, x86_64 + aarch64, `gjsify-tsc` included, e2e-gated incl. a real `flatpak-builder` tier) and the Node-free self-build (the committed GJS bundle rebuilds the CLI itself via native rolldown; e2e `tests/e2e/self-host`) have both landed. Open:

- **Flathub-grade offline-sources build** — vendor via `gjsify flatpak sources` instead of `../` file paths; only needed for an actual Flathub submission, which is itself gated on Flathub's Generative-AI policy (extensions/runtimes are in scope → discretionary "mature, well-maintained" exception; a gjsify-owned OSTree remote sidesteps it).
- **Remaining Node touchpoints for a FULLY Node-free self-build** — oxc lint (oxlint's JS-plugin host needs Node — see the oxlint entry above) + switching the build-orchestrator entry from the Node CLI to `gjs -m cli.gjs.mjs`.
- **`gjsify install --offline`** — a fail-fast-on-cache-miss flag so a no-network sandbox install errors clearly instead of attempting (and slowly failing) a network fetch. Complements `gjsify flatpak sources`.

### `gjsify ship` — remaining roadmap (ADR 0024, amended 2026-08-21)

Stages 2 and 3 have landed: one staged payload, `.deb` and `.rpm` packed by hand-written writers (no `dpkg-deb`, no `rpmbuild`, no vendored `nfpm`), proven end to end by `tests/e2e/ship` against `rpm`, GNU `ar` and GNU `tar`.

**The framing changed.** A format this Linux workstation cannot produce is not a format to defer — it is produced on the host that owns it, in CI, the way this repo already builds per-platform prebuilds (ADR 0024 § A1-A7). Host-boundness becomes a declared `HostRequirement` on the format descriptor, with the independent oracle as a REQUIRED field: `selfReading: true` is legal to declare and illegal to release.

**Four claims this section carried that are measured FALSE** — corrected here rather than deleted, because three separate design passes reasoned from them:

- ~~"Assembly is cross-platform … so a Linux host can build both."~~ True of the `.app` tree, false of the `.dmg`: no HFS+/APFS writer exists anywhere in this tree and `hdiutil` is macOS-only. The line falls between assembly and CONTAINER.
- ~~"No in-tree app declares `gjsify.ship` yet, so the rule is vacuous."~~ `packages/infra/cli/package.json` declares it (`{binaryName: "gjsify", bundle: "dist/cli.gjs.mjs", targets: ["deb","rpm"]}`) and `release-cut.yml:349` runs `ship --skip-build` against it on every cut. The same sentence is in `tests/e2e/ship-declaration/run.mjs`'s header and is wrong there too.
- ~~"an unsigned file that Gatekeeper or SmartScreen will refuse."~~ Gatekeeper blocks; SmartScreen only WARNS until per-file-hash download reputation accrues, signed or not.
- The two certificates are not one open question. **Apple is the binding constraint**: Developer ID has no OIDC route, so stage 4 introduces this repo's first long-lived signing secret. (And the "no long-lived credential today" baseline is itself false — `PREBUILDS_DEPLOY_KEY` is a repo-write SSH key on the ruleset bypass list.)

**Measured, so nobody re-runs it** (2026-08-21, from Linux, `manifest-conformance/lib/binary.mjs`'s `readLibrary()` over the published `@gjsify/gtk-runtime-darwin-arm64@0.41.0` + `@gjsify/node-gi@0.41.0` tarballs): **106 of 106** Mach-O images already carry `LC_CODE_SIGNATURE`; **0** non-system dependencies unresolved inside the closure; **2** images carry an absolute rpath (`/opt/homebrew/lib`), which `checkPrebuildDir` already rules a working fallback. Consequence: a stage digest set cannot survive a Developer-ID re-sign, so arrival must be checked with a Mach-O-aware comparator (identical outside `LC_CODE_SIGNATURE`/`LC_UUID`), not with `sha256`.

Open, in order — each independently mergeable, each with its proof:

1. ~~**`fail_on_unmatched_files` on the release upload.**~~ **DONE (#1252).** `release-cut.yml` globbed the `.deb`/`.rpm` onto the release with the flag absent, so a glob matching nothing uploaded nothing and left the cut green — while the gate that follows checked only `install.mjs` and `cli.gjs.mjs`, and `gjsify self-update` sends system-prefix installs to exactly those assets. Landed: the flag, an install-URL gate that COUNTS what `ship` wrote (the names carry the version and the arch label, so they are read off disk), and `scripts/check-workflow-release-globs.mjs`, wired into both `audit-runtimes` jobs because `release-cut.yml` never runs on a pull request. Correcting a number this list carried: `if-no-files-found: error` appears **33** times, not 37 — the 37 was inherited from a draft and never remeasured.
2. **`kind: 'app'` was dead under the shipped GJS bin, and the cause was TWO gates deep.** Being fixed in #1257; one of its six sites was already fixed at the call site by #1251, which moved that template into source. What the first reading of this entry got right: `rewrite-node-modules-paths.ts`'s `shouldRewrite()` returns false unless the path contains `node_modules`, and it guards the only production call site of `inlineStaticReads`, so the CLI never offered its own reads to the inliner. What it MISSED, and what makes opening that gate insufficient on its own: the inliner parsed with acorn, **which cannot read TypeScript**, and its `catch` returns `inlined: 0` — a value indistinguishable from "this file has no static reads". An installed package ships JS, so the scope kept the parser limitation invisible; measured, the same expression returned 1 as `.js` and 0 as `.ts`. Also worth keeping: the obvious repair is a trap. Rolldown's own oxc parser links npm `rolldown` — a Rust napi crate that cannot run under GJS — into a module that must load under GJS, and the CLI bundle then died at startup with `createRequire: Cannot require builtin module "fs" synchronously in GJS`. The published 0.41.0 still ENOENTs on `generate-installer`, `flatpak scaffold` and the two oxc config templates until #1257 lands.
3. **Pack from a stage alone** (`--from-stage` + `.gjsify-ship-stage.json`). The sidecar is a closure — `{settings (arch resolved at stage time), staged, overlay, namespaces, mtime}` — not a settings dump: measured, dropping `staged` packs the launcher 0644, dropping the overlay omits the Debian-Policy copyright file, dropping `namespaces` loses `gir1.2-gtk-4.0` and `gir1.2-adw-1` from `Depends`, all silently at exit 0. `readStage` must fail on a staged path the plan does not name AND on a planned path the stage lacks (its `?? 0o644` fallback inherits the open `download-artifact` MERGE hazard). Never `writeStage` onto an arriving stage — it opens with `rmSync(root, {recursive: true})`. *Proof, and the deletion IS the discriminator:* stage into a tmpdir, **delete the project tree**, pack from the stage, assert byte-equality with the single-host artifact.
4. **`ship-pack-linux` on a bare `ubuntu-latest`** (no container), downloading a stage and packing deb+rpm. First real `dpkg -i --dry-run` this project has ever run, plus `rpm` via `docker run --rm fedora:44`, on a free runner — it closes the `dpkg` gap below and exercises the whole cross-host handoff with formats that already exist, before any darwin runner is involved. Fold in binding `FORMAT_IDS` to `manifest-conformance/lib/rules/ship.mjs`'s `TARGETS = new Set(['deb','rpm'])`, a second source of truth that will reject the first legitimate new declaration.
5. **Stages 4/5 proper** — macOS `.app` + zip and the Windows program directory + zip (`finishOn: 'any'`), then `.dmg` on `macos-latest`/`macos-15-intel` and `.msi`. Blocked on 2 and 3. Windows launcher is unresolved and is a VM measurement, not a design argument: `node.exe` is a CONSOLE-subsystem image (Subsystem=3 at offset 0xd4, v24.19.0), `nodew.exe` does not exist, and every Windows CI leg starts the app from a shell and therefore inherits a console — so no CI leg can observe the defect. Instrument is `win11-gjsify`.
6. **Stage 6 — Flatpak as a target under `ship`.** The metadata half already moved (`utils/app-metadata.ts`); what is left is the staging path (`buildsystem: simple` + `cp -a stage/.`, which is what removes meson from inside the sandbox) and the deprecation window for the `gjsify.flatpak` config keys. Sequenced AFTER the descriptor refactor: Flatpak's whole content is one prefix-layout row, and writing it first means writing it twice.
7. **Bundled Node for `--app node`** — still undecided between a ship-time fetch and a platform package (ADR 0017's shape). Stages 4/5 need it: an unsigned artifact is a legitimate output, an artifact with no interpreter is not.
8. **`dpkg` is on no CI runner this project uses**, so the `.deb` is never verified by a real `dpkg -i`. What IS verified: GNU `ar` and GNU `tar` (independent readers of the container and of both inner tars), every `md5sums` digest recomputed, and the data member unpacked and compared byte-for-byte against the staged tree. The `.rpm` half has no such gap — `rpm` is on every Fedora image and `rpm -i --test` runs there. Item 4 closes this for free. Also undeclared while it stands: `tests/e2e/ship` makes `ar` required on Linux, but `binutils` appears nowhere in `.docker/ci-fedora.Dockerfile` — it is present only transitively via `gcc`.
9. **Two docs sentences become false** with host-bound formats: `website/src/content/docs/ship/index.mdx` promises the packers "run anywhere" and that there is "no packaging file to keep in your repo". Both need replacing when `--format dmg` and `gjsify ship ci` land.
10. **A scaffolded workflow is verified by nothing.** The only scaffolder in the tree (`flatpak ci`) is asserted by four `assert.match` regexes on raw text — never parsed as YAML, never actionlint'd (which discovers only this repo's `.github/workflows/**`), never run. ADR 0024 names this exact class for `ship`; it already exists one command over. Minimum bar for `ship ci`: emit into gjsify's own workflows directory too, and `bash -n` every extracted `run:` block.

### Upstream PRs in flight (NativeScript) — track until merged

Two fixes contributed upstream so NS apps work without gjsify-side workarounds. **Both OPEN as of 2026-06-04.** Revisit when either merges + ships in a NativeScript release: drop the corresponding workaround, then bump the version floor / re-validate.

| PR | Fixes | Our interim workaround | Drop when merged + released |
|---|---|---|---|
| [NativeScript/NativeScript#11259](https://github.com/NativeScript/NativeScript/pull/11259) — `fix(vite): support Vite 8 / Rolldown` | `@nativescript/vite`'s function-replacement `resolve.alias` + `@rollup/plugin-commonjs` that Vite 8 / Rolldown reject | `@gjsify/nativescript-vite`'s `applyVite8Fixes()` drops both at compose time | When `@nativescript/vite` ships Vite-8 support, `applyVite8Fixes` can shrink to (or drop) the two fixes — gate on the `@nativescript/vite` version |
| [NativeScript/nativescript-cli#6056](https://github.com/NativeScript/nativescript-cli/pull/6056) — `fix(bundler): copy the vite bundle to native in non-watch builds` | NS CLI copies the Vite bundle into the APK only in watch mode; `ns build` / `ns run --justlaunch` leave `assets/app` empty → SBG fails | `tests/integration/nativescript/scripts/run-on-device.mjs` does `ns prepare` → manual copy → `gradle assembleDebug` | When the fixed NS CLI ships, the runner can use plain `ns build` / `ns run --justlaunch` again |

Check status: `gh pr view 11259 --repo NativeScript/NativeScript --json state` / `gh pr view 6056 --repo NativeScript/nativescript-cli --json state`. No CLA required on either repo; both are auto-reviewed by CodeRabbit — address only blocking findings.

### NativeScript apps that pull web-API third-party deps — eval-time global injection (Welle 5 follow-up)

On-device teapot re-validation confirmed the css-tree fix, but the teapot still does not render on NS V8: its third-party deps (`@nativescript/canvas-polyfill`, `@xmldom/xmldom`, `three`) instantiate web globals at module-evaluation time (`new TextEncoder()` / `new XMLHttpRequest()` / `new FileReader()` at top level) and NS V8 doesn't provide those globals that early. The same class as the `@gjsify/buffer` eager-`TextEncoder` bug, but in deps gjsify doesn't own. The gjsify-side fix is a composer feature: inject/seed the web-API globals (or hoist canvas-polyfill's registration) at the very top of the NS bundle, before any module evaluates — analogous to the GJS `process-stub` `renderChunk` prepend. Design open (which globals; seed-from-`@gjsify/web-*` vs hoist canvas-polyfill; `optimizeDeps`/`renderChunk` prepend). Until then, NS apps whose dependency graph instantiates web globals at eval time (canvas/WebGL/three.js stacks) build but crash on launch; headless logic packages run fine. Related open items:

- **NS CLI 9.0.6 Vite bundle-copy is watch-mode-only** — `compileWithoutWatch` never calls `copyViteBundleToNative`; the smoke runner works around it (manual copy after `ns prepare`); the real fix is the upstream NS-CLI PR above.
- **iOS smoke test** — only Android was validated on-device; the platform path is symmetric (`.ios` extensions, `__IOS__`/`__APPLE__` defines) but unproven; add an iOS build smoke test when a macOS runner is available.
- **Conditional-export precedence** — `resolve.conditions` keep upstream's `browser` active alongside `nativescript`; a package with divergent `browser` vs `nativescript` conditional exports may resolve its `browser` variant. Decide a policy (drop `browser` for NS, or document) + add a regression test.
- **Worker builds** — the upstream `worker` config is passed through verbatim; gjsify transforms are not propagated into `worker.plugins`. Validate + propagate when a worker-using NS showcase lands.
- **Full ownership (Level 3)** — the composer keeps `@nativescript/vite` as an optional peer. Owning the NS-runtime plugins outright remains the larger goal — gated on whether the peer proves a maintenance burden + the upstream NS-CLI pluggable-`bundler` PR.

### NativeScript pillar coverage (Welle 5+, parallel implementations)

The slot backfill (all 80 declarable packages), `@gjsify/native-fs-bridge`, the `@gjsify/crypto` NS entry and the on-device integration suite have landed. Remaining Wellen (each a separate PR/worktree):

- **Welle 5-D — `@gjsify/stream` + `@gjsify/http`-client** (M): client-side over NS' native `fetch()`; server-side (`createServer` etc.) throws ENOTSUP; `runtimes.nativescript: 'partial'`.
- **Welle 5-F — extend `tests/integration/nativescript/`** per pillar as 5-D lands (CI runner may need a privileged container for the NS emulator stack).
- **Welle 5-G — `gjsify create-app --template nativescript-*`** (M): mobile-app scaffold templates. Adwaita-feel-on-mobile is an open design question — could use NS' native UI with gjsify polyfills providing the data layer.

### NativeScript build-feature ownership — Level 3 (gjsify as a first-class NS production bundler)

Level 2 (platform file resolution + platform defines) is owned by gjsify. **Level 3 (north-star, L, multi-week):** make `gjsify build --app nativescript` (or the Vite preset) produce a standalone NS-loadable production bundle, replacing `@nativescript/{webpack,vite}` for the JS-bundling step. The NS-runtime subset still to replicate: main-entry + bundle-emit to NS's expected dist layout (≈150 LOC sans HMR), static-copy of `App_Resources`/fonts/assets, the `@NativeClass()` transform (≈43 LOC), optionally app-components/XML page registration (≈278 LOC — skippable for code-only canvas apps) + CSS/theme-core. HMR is the bulk of `@nativescript/vite`'s complexity and is NOT needed to ship (production-only target). **Hard blocker:** NS's CLI bundler dispatch is a hardcoded `webpack|rspack|vite` switch — `bundler: 'gjsify'` needs an upstream NS-CLI PR for a pluggable bundler, OR gjsify masquerades under the `vite` name (current Level-1 path). The spawn contract is discoverable (`node <bundler>/bin build --config=<path>`, `NATIVESCRIPT_BUNDLER_ENV` JSON env, dist copied into APK assets).

### Website & docs follow-ups

Collected user-tracked items — every one turns existing engineering work into something visible / measurable for users.

- **Test + extend the new showcases, then embed them on the website.** Each showcase needs: (1) a manual smoke-test on GJS (`gjsify showcase <name>` end-to-end), (2) gaps turned into fixes or tracked follow-ups, (3) a `website/src/content/docs/showcases/<name>.mdx` page embedding the browser entry for live demo + describing the GJS counterpart.
- **Bridge widgets docs on website.** `@gjsify/canvas2d` / `@gjsify/webgl` / `@gjsify/iframe` / `@gjsify/video` are documented inline in AGENTS.md but there is no user-facing doc explaining the pairing matrix (DOM element ↔ Bridge class ↔ GTK widget) and the `installGlobals()`/`onReady()` lifecycle. Target one Astro page under `website/src/content/docs/framework/bridges.mdx` with a minimal worked example per bridge.
- **Web/Node compat as progress bars on the website.** The Summary table is consumed by `website/scripts/generate-coverage.mjs` → `src/data/coverage.ts`; extend the same treatment per package on the detail pages.
- **Ship `gjsify` and `ts-for-gir` themselves as Flathub CLI apps.** The `gjsify flatpak --cli-only` path already produces the right shape; take both CLIs through the full Flathub-submission flow (manifest in `flathub/<app-id>`, `flatpak-builder` validation, appstreamcli + `flatpak-builder-lint`, screenshots/release notes).

### WebGL deferred items (Workstream D)

- **Optional headless drawing-buffer pre-allocation.** `_init()` (`webgl-context-base.ts`) leaves the headless-gl-style `_allocateDrawingBuffer` call commented out because `GtkGLArea` owns the surface. Re-enable if/when a non-GTK output path is added.

### Flatpak helper subcommands — downstream adoption (PR3–PR6)

`gjsify flatpak {init,build,deps,ci}` and the bundler-side primitives they lean on have landed. Remaining downstream work: PR3 (ts-for-gir-cli adopts `defineFromPackageJson`), PR4 (app-gnome Vite → `gjsify build`), PR5 (app-gnome flatpak workflow on top of `gjsify flatpak`), PR6 (CLI-flatpak example docs page — the documented `org.gjsify.TsForGir` shape: GNOME Platform runtime + read-only `/usr/share/gir-1.0` mounts).

### TLS gaps that Gio does not surface (Workstream B follow-up)

Server-side SNI, session resumption and channel binding are resolved (see the `@gjsify/tls`/`tls-native` status entries). Remaining gaps map to GnuTLS/OpenSSL features Gio's GI bindings do not expose:

- **OCSP stapling.** Neither client- nor server-side OCSP is exposed by Gio (`gnutls_ocsp_status_request_*` has no GI binding), so `tls.connect({requestOCSP})` / the `'OCSPResponse'` event cannot be implemented end-to-end without a native bridge wiring `request_ocsp_status` into `Gio.TlsConnection`. Partial unblocker shipped: `@gjsify/tls-native` Phase 1 `parseOcspResponse(bytes)` (RFC 6960 DER parser), surfaced via `@gjsify/tls` with the `hasOcspSupport()` graceful-degradation gate — consumers can fetch OCSP responses themselves (e.g. via the cert's AIA responder URL) and validate status without bypassing Gio's TLS stack. The Gio-side `request_ocsp` wiring (responses arriving automatically over the handshake) stays open.
- **DH params / explicit ECDH curves / ticket-key rotation.** Gio does not expose `g_tls_server_connection_set_dh_params` or equivalent. Server tuning happens via `GIO_USE_TLS=gnutls` env at process level; not per-connection.

### SharedArrayBuffer constructor opt-in (Mozilla pref)

- **`SharedArrayBuffer` constructor is unavailable in stock GJS** (`typeof SharedArrayBuffer` is `undefined` on GJS 1.88): Mozilla disables it unless the SpiderMonkey embedder opts in, and GJS does not. Upstream patch candidate: enable the SharedMemory pref in `gjs/engine.cpp` + the matching `Atomics.wait`/`notify` capability bits. Workaround landed: `@gjsify/sab-native`'s `SharedBuffer` (method-accessor API + free-function `atomics` namespace over memfd/mmap/futex) does not require the constructor at all and is wired into `Worker.postMessage`.
- **Generic `ArrayBuffer` cross-process transferList.** `Worker.postMessage(value, transferList)` for a plain `ArrayBuffer` (not a `SharedBuffer`) still goes through JSON IPC and stays a deep-clone, not a zero-copy hand-off — the SCM_RIGHTS side-channel only carries memfd-backed regions; arbitrary ArrayBuffers would need a generic binary IPC frame format (or a SharedBuffer-as-ArrayBuffer wrapper the structured-clone layer recognises). Lower priority — SharedBuffer covers the high-bandwidth workloads.

Use `@gjsify/worker_threads` `MessageChannel` (in-process) for zero-copy / pure-`ArrayBuffer` workloads today; cross-process SharedBuffer for shared-memory workloads across subprocess workers.

### ts-for-gir — extend integration suite beyond Phase 4b

Strategic goal: `ts-for-gir` runs unmodified on GJS. Phases 1–9 have landed (see the integration-coverage notes). Remaining:

- **Phase 6 / gjsify run:** runtime npm-package resolution for GJS bundles (GJS has no node_modules resolver; would need a C-level patch).
- **Phase 8 / GVariant type-inference:** full port of `gvariant-validation.test.ts` — requires `@girs` ambient declarations resolvable by the TypeScript compiler.

`refs/ts-for-gir/` is pinned at the commit corresponding to `@gi.ts/parser@4.0.0-rc.9`; bump the submodule alongside the published-package version when porting future phases.

### Universal DOM Container (`@gjsify/dom-bridge`)

Architectural vision for unified DOM-in-GTK: `document.createElement("canvas")` + `getContext("2d")` automatically creates the right GTK widget behind the scenes; `document.body` maps to a real GTK container hierarchy; each child element gets its own bridge transparently — making browser code "just work" in GTK without explicit bridge creation. Deferred from the initial bridge architecture — requires deeper integration between `Document`, `Element.appendChild`, and the GTK widget tree.

### Autobahn — wire into CI

Full Autobahn suite (core + permessage-deflate + performance 9.\*) is part of the committed baseline. Remaining: (1) the `6.4.x` NON-STRICT fragmented-text timing needs an upstream libsoup change (fragment-level UTF-8 validation — see Upstream GJS Patch Candidates); (2) Podman-in-CI needs privileged containers (or socket sharing) the Fedora-based CI doesn't currently grant — until then the suite is a manual opt-in run + baseline-commit workflow. Plan: wire the autobahn scripts into a nightly CI job once Podman-in-CI is unblocked.

### Autobahn driver — `System.exit()` bypass in bundled driver context

`System.exit(0)` called from the bundled driver's `Promise.then` continuation silently returns without terminating the gjs process (the GLib main loop `ensureMainLoop()` starts for Soup keeps the process alive after `main()` resolves), even though the same call works from a standalone script or a MainLoop idle callback. `scripts/run-driver.mjs` compensates with a watchdog (waits for the `Done.` marker, 3 s grace, then SIGKILL — no data loss; the report is flushed before `Done.`). Next steps to remove it: isolate whether the block is in `@gjsify/process`'s `exit()` shim, the `globalThis.imports` patching, or an interaction with `@gjsify/node-globals/register`; write a minimal reproducer outside the Autobahn pillar; fix root-cause and inline `gjs -m dist/driver-*.gjs.mjs` back into the package scripts.

### `@gjsify/sqlite` — expand API surface

Libgda does not expose session/changeset, WAL-mode toggles, backup or VFS APIs, so those are open gaps beyond the current DatabaseSync/StatementSync coverage. The closest paths: (a) wrap sqlite3 directly via libsqlite3 GI bindings (expensive — no upstream GIR), or (b) live with the libgda-shaped subset and document the gaps per API. (b) is the current direction; `sqlite.constants` (SQLITE_CHANGESET_\*) remains unimplemented until (a).

### WebRTC showcases (extended)

`webrtc-loopback` is a published showcase. Open follow-ups: `webrtc-video` could be a second showcase (getUserMedia + media pipeline; needs camera-permission UX — separate workstream); `webrtc-dtmf` / `webrtc-states` / `webrtc-trickle-ice` remain private reference implementations for specific spec behaviors, not end-user showcases.

### The baked CI image is `linux/amd64` only, so three arm64 jobs still `dnf install` every run

`build-ci-image.yml` publishes `ghcr.io/gjsify/ci-fedora:<major>` for
`platforms: linux/amd64`, with the comment "When we add aarch64 runners we'll
grow this list". They were added. Three jobs run on `ubuntu-24.04-arm` —
`node-gi.yml/arm64`, `prebuilds.yml/build-prebuilds` (arm64 leg) and
`release.yml/node-gi-prebuild-linux` (arm64 leg) — and have no image to move to,
so each still pays a full `dnf install` from Docker Hub on every run. One of the
three is on the RELEASE path.

That cost is not hypothetical: during the v0.26.0 sweep `napi` failed outright
when `docker pull fedora:44` timed out against registry-1.docker.io three times
before the container existed, and the storybook bundle job was killed by its
45-minute timeout TWICE with ~41 of those minutes inside a single `dnf install`
— a step whose normal cost is 22 seconds. Neither failure had anything to do
with the code; the same commit was green on the PR.

The earlier version of this item claimed the switch needed a SECOND baked image
because "several of these jobs are minimal ON PURPOSE (the Node-free install
proof, 'no system GTK' conformance)". That premise was checked and is FALSE —
every one of them installs gjs and the GNOME devel set itself, and no job
asserts that a system library is absent. Ten of the thirteen have since switched
to the one image with no property lost.

Remaining work is therefore a single edit with a real cost attached: add
`linux/arm64` to that `platforms:` list. Building it under QEMU on an x64 runner
would be slow enough to matter for a weekly cron plus every Dockerfile PR, so
the shape worth measuring first is a native `ubuntu-24.04-arm` build leg joined
into one manifest. Nothing needs to be remembered afterwards:
`scripts/check-ci-image-packages.mjs` DERIVES the exemptions from the published
arch list, so widening it turns all three from "excused" into "must switch" on
the next run, and its hand-written ledger is already empty.

### Nothing byte-compares a committed prebuild, and macOS re-commits noise

AGENTS.md already records that committed `prebuilds/**` binaries are unguarded
(provenance proves the inputs; nothing compares the bytes). The v0.26.0 sweep
showed the other half of that gap: `commit-prebuilds` pushed six darwin-arm64
dylibs whose sizes were IDENTICAL to their predecessors (37144 -> 37144, and so
on) but whose bytes differed — non-reproducible Mach-O output (timestamps,
UUIDs). So every macOS prebuild run commits binary churn with no semantic
change, and that push moved `main` out from under an already-verified sweep
mid-release. Worth fixing at the source (reproducible flags) rather than by
suppressing the commit, since byte-reproducibility is what would let a future
check compare a committed prebuild against a CI-built one at all.

**Now measured to the byte, because the same non-reproducibility killed the
commit channel outright** (fixed separately, by removing the rebase — see the
sync script). Diffing two consecutive bot commits of unchanged sources
(`7f4e81291` -> `a03206649`): all **16** committed darwin dylibs changed, every
one at an identical size, and no linux `.so` changed at all — the ELF legs
reproduce exactly. Per file, on darwin-x64, EVERY differing byte is one of two
things: the 16-byte `LC_UUID` payload, and the `n_value` of the `N_OSO`
debug-map stabs, which is each intermediate object file's mtime (e.g.
`libgjsifytls.dylib`: 25 of 44264 bytes — 16 UUID + 9 spread over three
`N_OSO` timestamps, and nothing else). darwin-arm64 adds one more block, its
ad-hoc `LC_CODE_SIGNATURE` blob, whose hashes cover the header those bytes are
in. Zero bytes of `__TEXT`, `__DATA_CONST`, the string table, the chained
fixups or the exports trie differ in any of the sixteen.

That names the fix precisely rather than as "reproducible flags": the UUID needs
`-Wl,-no_uuid` (or a `--build-id`-style deterministic value) and the `N_OSO`
timestamps need the object mtimes normalised — `ZERO_AR_DATE=1` handles the
archive case, but these are direct `.o` references from meson's per-target
directory. The arm64 signature follows automatically once the bytes it hashes
are stable. Worth doing: it is the last thing standing between this repo and a
byte-comparison of a committed prebuild against a CI-built one.

### A gate whose fixture reads what the gated job writes — SECOND instance

`gate-pushed-tree.sh` exists because `tests/e2e/platform-exemption-clearing`
seeded its fixture from a `gjsify.platformsUncommitted` value that the bot then
CLEARED, and `main` was red for every open PR for hours (f5d250b32, 2026-08-03).
The same shape reappeared inside the fix for it, and was caught in review rather
than in production: `tests/e2e/prebuild-declaration-invariant` copied the
missing-`.gir` ledger out of the checkout and asserted it had at least two
entries — while the clearing script that runs earlier in the same job exists to
reduce that file to `{}`. The first `main` run to land the ten `.gir` files would
have cleared all ten, failed the gate on the ledger it had just correctly
emptied, and discarded every downloaded binary. That fixture is hermetic now.

Twice is a class. What is missing is a check on the GATE LIST itself: no suite in
`gate-pushed-tree.sh`'s `node --test` list may read repository state that the
steps before it write (the two clearing scripts' outputs, the staged
`prebuilds/` directories, the manifests the generator rewrites). The awkward part
is that some of those suites read committed artifacts ON PURPOSE —
`prebuild-loader-path` asserts exact glibc floors of bytes this job replaces — so
the rule cannot be "fixtures may not read the tree". A first cut that would have
caught both instances: fail a gate-listed suite that reads a path the same job's
clearing scripts print on stdout, which is a set the job already computes.

**Measured 2026-08-16, before building it: the naive form of that cut is 3-for-3
false.** The mutated set is derivable without running anything — both clearing
scripts take `--dry-run`, and what they WRITE is fixed (`clear-satisfied-gir-gaps`
→ `scripts/manifest-conformance/prebuild-gir-gaps.mjs`; `clear-committed-platform-exemptions`
→ the package manifests). But matching those paths as strings against the five
gate-listed suites flags `platform-exemption-clearing`, `prebuild-declaration-invariant`
and `prebuild-change-gate`, and all three are hermetic: the two known instances were
FIXED by moving to synthetic trees, and a fixed suite still names the path it builds a
copy of. A check with a 100 % false-positive rate gets disabled, and then protects
nothing — `check-workflow-inline-scripts.mjs`'s header records the same lesson from its
own first draft ("23 findings, 21 false").

So the discriminator is not the path, it is the ROOT: a read anchored at the
repository (`MONOREPO_ROOT`, `ROOT`) versus one anchored at a tmpdir the suite
made. That is what the check has to see, and it is why this is not a grep.

### What still writes to `main` unverified, after the bot push got a gate

`commit-prebuilds` now runs the checks that read its own output on the tree it is
about to push (`Gate the tree being pushed`), which closed the incident where
f5d250b32 cleared `gjsify.platformsUncommitted` under a CI-skip directive and left
`tests/e2e/platform-exemption-clearing` red on every open PR for hours. A sweep
done while fixing it found five more holes in the same write path. THREE are now
fixed and deleted from this list: `packages/napi/napi-linux-x64/prebuilds/` is no
longer committed (it had no producer, so the honest shape was the
`gjsify.platformsUncommitted` entry its darwin sibling already carried); the
committed `.gir` files are validated on every target rather than only darwin; and
a rejected `git push` no longer discards the run's binaries. Two remain verified
reads with nothing done about them:

- **`download-artifact` MERGES and nothing prunes.** Each step extracts into an
  existing `prebuilds/<target>/` without clearing it, `git add` only adds, and the
  staging script's deletion refusal forbids removal — so a `meson.build` change
  that renames a library or drops a `.gir` leaves the stale file beside the new
  one, and `files: ["prebuilds"]` publishes both. One direction of the `.gir` half
  is closed (a directory with NO `.gir` now fails `prebuild-artifacts`); a STALE
  extra file is still silent, and that is the half this entry is about — no rule
  enumerates the expected file set, only its minimum.
- **`prebuild-artifacts`' dlopen probe degrades to a NOTE on `ubuntu-latest`,**
  which is the runner that gates the push: no libsoup3 / GStreamer / GTK4 /
  libepoxy, so the linux-x64 artifacts of http-soup-bridge, http2-native, webgl and
  webrtc-native are never actually loaded there. The gate proves declarations and
  file shape, not that an artifact loads.

Adjacent, same cause — and the release half is now CLOSED: `commitlint.yml` triggers on `push` to
`main` as well, so the release cut's direct `chore: release v${version}` commit is linted, which
matters because `@release-it/conventional-changelog` walks exactly those commits. The prebuild push
stays unlinted and NO trigger can change that — `[skip ci]` skips the workflow run itself, so
dropping it (the lever below) is the only route, and that is its own deliberate cost decision.

The one lever not pulled is **dropping the CI-skip directive from the prebuild
push**. Checked: it cannot loop (`prebuilds.yml`'s own `push` paths list sources,
meson files and scripts — not `packages/*/*/prebuilds/**`), and it would buy the
only coverage the new gate structurally cannot reach: the two specs that genuinely
LOAD a committed prebuild under GJS in `main.yml`'s `test` job. It costs one full
`main.yml` run per landing, which is rare. It detects rather than prevents, so it
is a complement to the gate, not a replacement — decide it deliberately.

### `@gjsify/lightningcss-native` references `gnu_get_libc_version`, which musl lacks

The committed glibc build declares no npm `libc` filter, so npm installs it on
musl hosts, where `ldd` reports `gnu_get_libc_version: symbol not found` on both
of its libraries. GI binds lazily, so this is not a load failure — it is an
unbound relocation that crashes if and when that path is called, the same shape
that hid `sab-native`'s `fcntl64`/`__cmsg_nxthdr` until the musl leg started
checking committed artifacts.

Unlike `sab-native`, the reference is not ours to remove: it comes from a
crates.io dependency of the pinned `refs/lightningcss` build. So the fix is
either an upstream/dependency change, or a musl-built sibling package with
`libc: ["musl"]` beside a `libc: ["glibc"]` parent — which needs the target
vocabulary to carry a libc component it deliberately does not have today, plus
two new published npm names. Until then it is an ACCEPTED gap in
`musl_gap_reason()` in `.github/prebuild-toolchain/musl-committed-check.sh`,
printed on every musl run, and that entry FAILS the check the day the symbol
stops appearing — so it cannot outlive the problem. Since the check left
`musl-build.sh` it also runs on every PR and push touching the native paths, so
the gap is now re-measured continuously rather than only on a dispatch.

### `@gjsify/webrtc` cannot work on Alpine / postmarketOS — no `webrtcbin` element

Separate from the libc axis and easy to mistake for it. The musl leg's
committed-prebuild check reports `webrtc-native` as fully resolving, which is true
and misleading: `gst-plugins-bad` provides `libgstwebrtc-1.0.so.0`, so every
relocation binds, while `gst-inspect-1.0 webrtcbin` on the same image finds
nothing. GStreamer 1.28's nice plugin requires libnice >= 0.1.23 and Alpine ships
0.1.22, so the `webrtcbin` element and the `nice` plugin are not built at all.
Measured on `alpine:3.24`: library present, element absent, nice plugin absent.
Installing `libnice` does not help and that is measured too — with
`libnice-0.1.22-r0` genuinely installed from community, `/usr/lib/gstreamer-1.0/`
still contains no nice plugin at all, so `nicesrc`/`nicesink`/`webrtcbin` remain
missing. Alpine's libnice package simply does not build the GStreamer plugin, and
the phone does not even have libnice installed.

`@gjsify/webrtc` is built entirely on `webrtcbin`, so it is non-functional on
Alpine and on postmarketOS regardless of the prebuild. Layering the postmarketOS
repositories on top of Alpine does not help, and that is measured, not assumed:
on a real postmarketOS v26.06 device with the pmOS mirrors active, `libnice` is
still 0.1.22-r0 (taken from Alpine community unchanged) and
`Gst.ElementFactory.find()` finds no `webrtcbin`, `nicesrc` or `nicesink`, while
`dtlssrtpenc` and `rtpbin` are both present — exactly the shape a libnice-gated
nice plugin produces. Nothing to fix here; the blocker is a distro package
version, and the upstream threads say a maintainer MR bumping libnice plus a
`gst-plugins-bad` rebuild is all it takes:

- https://gitlab.postmarketos.org/postmarketOS/pmaports/-/work_items/4443
- https://gitlab.alpinelinux.org/alpine/aports/-/work_items/18092

Worth tracking because it is the one bridge whose prebuild can be perfect and
still unusable on a whole libc's worth of hosts, and because the reflex fix —
teaching the musl check to verify GStreamer elements — would be an accepted gap
from day one. Revisit when Alpine's libnice reaches 0.1.23; the right check then
is a real element probe, which would go green rather than being born red.

### `@gjsify/webgl` on win32-x64 — PROMOTED; what it did NOT close

`prebuilds.yml` carries the PAIR — `webgl-vala-c-win32` (Linux, emits the Vala C
+ GIR) and `build-prebuilds-win32` (windows-latest, compiles that C with MSVC and
load-tests it through `@gjsify/node-gi`) — behind the package's
`prebuilt_vala_c` meson option. Both halves ran `workflow_dispatch`-only for as
long as it took to answer the questions below; they now run on every event,
`@gjsify/webgl` declares `win32-x64`, `@gjsify/webgl-win32-x64` holds the
artifact and `commit-prebuilds` lands it. The declared-vs-built invariant is
symmetric, which is why those four arrived in ONE change. The researched
rejection of valac-on-Windows/MinGW and the measured MSVC result live in that
block's header comment — do not duplicate them here.

**Two findings from the exploratory phase are kept because the guards they
produced are the only thing between them and a repeat.**

- **A DEBUG-CRT artifact went green, and "what remains is a DECLARATION
  decision, not an engineering unknown" was written here while it did.**
  `meson setup` ran without `--buildtype`, meson defaults to `debug`, and MSVC's
  reading of `debug` is `b_vscrt=mdd`. Measured on the win11-gjsify VM against
  the published artifact of the green run, `gwebgl.dll` imported
  `VCRUNTIME140D.dll` and `ucrtbased.dll` — images that ship only with Visual
  Studio and that Microsoft's terms forbid redistributing. Every other import
  (`epoxy-0`, `gdk_pixbuf-2.0-0`, `glib-2.0-0`, `gobject-2.0-0`) resolved from
  the batteries-included GTK bundle, so the library was two files short of
  working and said so as `Failed to load shared library 'gwebgl.dll'` — naming
  the dependent, never the missing dependency. The load test could not see it
  because `windows-latest` HAS Visual Studio: the one artifact no user could
  load is exactly the one the runner is equipped to load. Fixed by
  `--buildtype=release` plus an import-table assertion that runs BEFORE the load
  test, because the property is about redistribution and is answered by reading
  the file rather than by loading it. The general lesson is not "pass
  --buildtype": a CI host provisioned as a DEVELOPER machine silently satisfies
  developer-only dependencies, so any artifact leaving that host needs at least
  one check that INSPECTS rather than executes.
- **The blocker was one layer BELOW webgl, and a display-less runner cannot see
  that layer at all.** The load test proves `dlopen` + `…_get_type`, never
  RENDERING — the same gap the darwin note in
  `build-prebuilds-macos-experimental` records. Measured on the win11-gjsify VM,
  `Gdk.Display.create_gl_context()` failed with `No GL implementation is
  available`, so `three-geometry-teapot` opened a fully correct Adwaita window
  and painted that string where the teapot belongs — a `Gtk.GLArea` failure, not
  a `gi://Gwebgl` one. Cause (a) was the VM: a QEMU/QXL adapter with no OpenGL
  ICD registered under `HKLM\...\OpenGLDrivers`, so Windows offered only the GDI
  generic OpenGL 1.1 that GTK4 rejects. CLOSED by registering Mesa 26.1.6 as a
  system ICD (`mesa-dist-win`'s `systemwidedeploy.cmd 1`:
  `HKLM\…\OpenGLDrivers\MSOGL` → `mesadrv.dll`, the inbox `opengl32.dll` kept as
  the loader — no System32 binary replaced, uninstall is option `10`), which
  gives that VM **OpenGL 4.6, non-legacy**, and `three-geometry-teapot` RENDERS.
  **The `4.6 (Compatibility Profile)` this file once predicted for Mesa/win32 is
  not what apps get**: GDK asks for a CORE profile, so `is_legacy` is false and
  the `ensureDefaultVertexArray()` / `ARB_ES3_compatibility` reasoning in the
  WebGL entries applies on win32 exactly as it does on darwin.

**The prebuild's runtime closure is bigger than its tarball, and that is
DELIBERATE.** `gwebgl.dll` imports `epoxy-0.dll`; Windows has no system
libepoxy, so unlike the Linux and macOS artifacts this one is not loadable from
the host alone. It is not duplicated into the tarball either: the epoxy that
satisfies it already ships in `@gjsify/gtk-runtime-win32-x64` (GTK4 links it),
which every win32 consumer of `@gjsify/webgl` already has, because it is how
`@gjsify/node-gi` gets GObject at all. Two libepoxy images in one address space
is a worse failure than the one being solved, so the closure is DOCUMENTED (in
`@gjsify/webgl`'s README) rather than packaged around.

STILL OPEN, and NOT this prebuild's to close:

- **The batteries-included win32 bundle ships no GL implementation** — its DLLs
  include `epoxy-0.dll`, which is the GL *dispatch* layer and resolves nothing on
  its own. So on a Windows host WITHOUT a vendor or Mesa ICD (a GPU-less VM, an
  RDP session, CI) the GL showcases stay dark, and that is a property of the
  bundle, not of the webgl prebuild. The windowing builder's ANGLE seeds
  (`/^libEGL.*\.dll$/i` + `/^libGLESv2.*\.dll$/i`) matched NOTHING — the gvsbuild
  GTK4 release ZIP carries no ANGLE — which is how a bundle came to promise
  "windowing" while shipping no GL. **The proposed fix was wrong twice over**:
  the gvsbuild `epoxy-0.dll` is built with NO EGL support at all (measured on the
  shipped 0.34.0 bundle: no `epoxy_has_egl`, no `egl*` entry point), so
  `gdk_win32_display_get_egl_display()` can never engage no matter what
  `libEGL.dll` is present — that path needs libepoxy rebuilt with
  `-Degl=enabled`, a gvsbuild-side change. And the desktop-GL family is inert for
  a second, independent reason: epoxy resolves it with a bare
  `LoadLibraryA("OPENGL32")`, which Windows answers from the **application
  directory** then **System32**, never from `PATH` — the only search the loader's
  bundle wiring controls. Measured three ways on the VM: bundle-local
  `libEGL`+`libGLESv2`+`libgallium_wgl` → still none; bundle-local `opengl32.dll`
  preloaded by absolute path via `process.dlopen` → still none (Node *unloads* a
  DLL that fails to self-register, so the base-name-match trick needs the addon,
  not JS); the same `opengl32.dll` beside a copied `node.exe` → **GL 4.6, works**,
  which is what proves the mechanism is placement and nothing else. A bundled ICD
  therefore requires the ADDON to opt the process into
  `SetDefaultDllDirectories(…)` + `AddDllDirectory(<bundle>/bin)` — process-wide
  DLL-resolution surgery that would also stop other native modules resolving
  their deps from `PATH`, so it is a decision, not a detail. The
  positive-assertion half is DONE: the windowing builder probes the FINISHED
  `bin/` for a GL implementation, records it as `manifest.glImplementation` (with
  `dispatch` listed separately so epoxy's presence can never be misread as GL),
  and warns naming every pattern that matched nothing. `--require-gl` makes it
  fatal; it is off by default only because no gvsbuild prefix satisfies it yet,
  so the promotion that ships a GL implementation flips it in the same change.
  Tracked as #1097.

The two-job split generalises past webgl: every other Vala bridge in this
repository has the same "valac does not run on Windows" problem, and
`prebuilt_vala_c` is a per-package option today rather than a shared mechanism.
Lifting it is premature until a second bridge wants it — but the second one is
where the helper gets lifted, not the third.

### `win32-arm64` is blocked UPSTREAM, not on effort — measured

Asked directly after the `win32-x64` promotion landed, on the reasonable
assumption that a second Windows arch is the same change with one token
swapped. It is not, and the blocker is one project we do not own.

**gvsbuild has no arm64 target.** Measured 2026-08-11 against
`wingtk/gvsbuild`: the last five releases (`2026.3.0` … `2026.8.0`, the newest)
publish exactly two assets each — `GTK3_Gvsbuild_<v>_x64.zip` and
`GTK4_Gvsbuild_<v>_x64.zip` — and `gvsbuild/utils/base_project.py` hardcodes
`self.platform = "x64"`. There is no arm64 ZIP to download and no `--platform`
to ask for one. The 14 issues matching `arm64` in that repository are all
dependabot noise; nobody is asking for it there either.

Everything Windows in this repository stands on that ZIP, so the consequence is
not "webgl needs a leg":

- there is no GTK4/GLib/gdk-pixbuf/**epoxy** to compile `gwebgl.dll` against, and
  no `.pc` files for meson to resolve;
- there is no `g-ir-compiler.exe` to turn valac's GIR into a typelib;
- there is nothing to build `@gjsify/gtk-runtime-win32-arm64` OUT OF — and on
  Windows that bundle is the only GTK there is, so even a hypothetical artifact
  would have nothing to load next to;
- `@gjsify/node-gi` declares `win32-x64` only, so `gi://` does not resolve on
  Windows/ARM at all, with or without webgl.

**Do NOT add the token to unblock work.** `win32-arm64` is a valid
`PLATFORM_RE` token, so it would go in cleanly and then fail
`audit-runtimes --check` in the direction that reads "declares `win32-arm64`
but no CI job produces that target" — correctly, and that failure is the guard
working. An exploratory dispatch-only leg is the sanctioned way to prove a new
target first, but one CANNOT be written here: its first step downloads a ZIP
that does not exist, so it would be red by construction, which is worse than
absent (the `--require-gl` note above is the same shape).

**The one known route, and why it is a DECISION rather than a leg.** MSYS2 ships
a `CLANGARM64` environment with mingw-w64 GTK4, which is the only Windows/ARM
GTK anyone builds today. Taking it means the whole stack goes MinGW — GTK,
`gwebgl.dll` AND the node-gyp addon — because a MinGW DLL against MSVC-ABI GLib
mixes CRTs while GLib routinely allocates what the consumer frees. That is the
ABI hazard `prebuilds.yml`'s win32 header and `napi.yml`'s `windows` job both
record, and it is the reason the x64 leg is MSVC end to end. So a Windows/ARM
port is not this pair plus a runner label; it is a second, parallel toolchain
for one architecture, and it starts at `@gjsify/node-gi`, not at webgl.

Revisit when gvsbuild publishes an arm64 ZIP — at that point the split-build
shape transfers unchanged, since nothing in it is arch-specific: the Linux half
emits arch-independent C + GIR, and the Windows half needs only a
`windows-11-arm` runner and an arm64 prefix. Tracked as #1117.

### 17 of 32 `@girs/*` packages cannot be version-checked against the installed library

`gjsify system-check` now compares each `@girs/*` package's declared
`libraryVersion` against `pkg-config --modversion` and reports a `major.minor`
skew — which caught two real ones on the first host it ran on (`@girs/gtk-4.0`
4.23.0 vs GTK 4.22.4, `@girs/adw-1` 1.10.0 vs libadwaita 1.9.2, the second of
which nothing had ever surfaced).

It structurally cannot cover the rest. `libraryVersion` is only an upstream
release where the GIR declares a `<package version>`; otherwise ts-for-gir falls
back to the NAMESPACE version, which is shaped like a version and carries no
information. Measured across 32 installed packages: **12 real, 17 degenerate, 3
absent**. `@girs/gdk-4.0` declares `4.0.0` while GDK ships inside GTK 4.22.4, so
comparing it would report an 18-minor skew that does not exist — the check skips
those by construction rather than guessing, which is a false negative it takes
knowingly.

The 17 include `gdk-4.0` and `gsk-4.0` (GTK's own namespaces), `cairo-1.0`,
`graphene-1.0`, `gdkpixbuf-2.0`, `pangocairo-1.0`, the five `gst*-1.0`
satellites, `libxml2-2.0`, `gudev-1.0`, `gmodule-2.0`, `giounix-2.0`,
`freetype2-2.0`, `gda-6.0`. Several are exactly the libraries a canvas or media
path depends on, so this is not a tail of exotica.

Two ways out, and they are not equivalent:

1. **Fix it at the source.** ts-for-gir could emit a distinguishable value — the
   real `<package version>` when the GIR has one, and an explicit null (or a
   `libraryVersionSource` field) when it does not — instead of silently
   substituting the namespace version. That removes the guess from every
   consumer at once and is the smaller change, but it only helps namespaces whose
   GIR carries the version at all.
2. **Ship the `.gir` beside the artifact.** For the batteries-included bundles
   this is the only exact answer: the installed library's own GIR states its
   version, and `prebuild-artifacts` ALREADY requires a `.gir` next to every
   `.typelib` for packages declaring `gjsify.prebuilds` — for exactly this
   reason, quoting its own header, "it breaks regenerating that bridge's types
   from the artifact it ships". The `@gjsify/gtk-runtime-*` packages declare no
   `gjsify.prebuilds`, so that requirement does not reach them and they ship 37
   typelibs with no `.gir` at all. Bringing them into scope is the follow-up; it
   also unlocks generating types from the shipped artifact, which is the only
   route to types that cannot be skewed rather than merely checked.

### `devtools-export` loses its DBus name in the containerised runner

`tests/e2e/devtools-export/` had never run in CI. Listing it in `test:e2e` (PR #984) gave it a
first run, which failed — and the measurement points at the environment rather than at
`@gjsify/devtools`:

```
APP_ON_BUS=yes            the fixture DID own org.example.reprotest
INSTALL_RETURNED=null     installDevtools returned null
EXPORT_LOG=no             the "exported org.gjsify.Devtools" line never printed
GETSTATUS  -> GDBus.Error:...ServiceUnknown: The name org.example.reprotest
                          was not provided by any .service files
```

with, in between, `dbus-daemon` activating `org.freedesktop.portal.Desktop` on the fixture's
request and `xdg-desktop-portal` then failing on `Document portal fuse mount point unknown`.
So the app owned its name, lost it, and devtools never installed. The same suite passes on a
normal desktop session.

WHAT IS NOT KNOWN: why the name goes away. Candidates worth separating before touching any
code — the app exiting early (a GApplication with no window and `HANDLES_COMMAND_LINE` can
return from `run()` sooner than the driver's 20 s polling window suggests), the portal
activation churn interfering with name ownership, or `installDevtools` genuinely getting no
`app.get_dbus_connection()` at `startup` in that environment. The driver already captures the
app's own log (`APP_LOG_BEGIN`/`APP_LOG_END`); the CI run printed the KEY=value block but the
app log itself is the next thing to read.

THE FIX IS NOT A LEDGER ENTRY. It is currently in `scripts/e2e-unlisted-suites.mjs` so #984
could land honestly, but the entry says so: the right repair is a precondition in the suite's
own SKIP gate — it already carries nine of them — so it skips where an Adwaita GApplication
cannot complete startup and keeps running where it can. Removing the ledger entry in the same
change is what `check-e2e-suite-coverage.mjs` will then require.

### `logSignals` has no test

The one survivor of the twelve parked test sites `gjsify/todo-needs-anchor`
found on its first run. The other eleven are retired: two `on([])` gates became
`it.failing` (with their reason), four commented-out assertions went live and
three of them promptly failed — see below — two markers named nothing above a
complete statement and were deleted, and the worker-stress one was never a
deferral at all (its sentence says the test CLOSES a todo; `TODO` merely opened
a comment line, and an anchor had been bolted on to satisfy the rule).

**Why this one could not be converted.** `packages/gjs/utils/src/log.spec.ts`
holds a fully commented-out spec for `logSignals`, and `it.failing` is the wrong
tool for it: the spec deliberately produces an UNHANDLED REJECTION
(`createUncaughtException()` called without `await` — that is the event under
test), which is raised outside the callback's promise chain. `it.failing` cannot
catch it, and Node's default handler terminates the process, so reviving it
as-is would make the whole `@gjsify/utils` suite non-deterministic rather than
parking a failure.

What it needs is a test to WRITE, not a marker to convert: install a temporary
rejection handler, assert the signal fired, restore. Until then `describe(
'logSignals')` is an empty suite in the run output, which reads as coverage that
does not exist.

**What the retirement cost, recorded because it is the argument against parking
an assertion in the first place.** Three of the four revived assertions failed
immediately, each on a real defect now fixed at the source: `EventTarget`'s
listener map was TypeScript-`private` (a compile-time marker only, so at runtime
an ordinary ENUMERABLE own property that every subclass leaked into `for…in`,
`Object.keys` and `JSON.stringify`); `AbortSignal.reason` was a public class
field where the platform has a prototype getter, found by the same enumeration
spec one line after the first fix landed; and `AbortController` carried no
`Symbol.toStringTag`, so `String(controller)` said `[object Object]` while its
`AbortSignal` sibling had one all along. Four commented lines had been hiding
three shipped bugs.

### 13 integration suites are held out of the CI gate, each for a measured reason

The gate half now exists: `main.yml`'s `integration` job runs the measured-green subset on the
`run-integration` output the classifier had been emitting into a step summary and nothing else.
What remains open is the other 13 suites. This entry is what is left of "35 suites run on no
event" after the per-suite measurement that entry asked for.

MEASURED, per suite, in `ghcr.io/gjsify/ci-fedora:44` with a cold bootstrap (published cli →
`install --immutable` → `build:infra` → `build`, all green): 21 green with assertions executed,
13 held out, 1 (`devtools-cdp`) exiting 0 while asserting nothing. Sequential wall time for the
21 is under four minutes on a 20-core host; the CI runner has four cores, so the job is budgeted
at 20 minutes. Per-suite causes are recorded beside each suite in
`status/integration-coverage.md` — that file, not this entry, is where a suite's status belongs.

The blanket phrase this entry set out to test, "CI-incompatible preconditions", is retired: it
holds for four suites (podman for `autobahn`, an Android device for `nativescript`, the native
`node_datachannel.node` for `webtorrent`, `openssl(1)` for `tls-session`) and covered nine others
that had simply never been run and are failing. Of the four, only `tls-session`'s is retired —
`.docker/ci-fedora.Dockerfile` bakes `openssl`, and the suite rejoins `main.yml`'s `--include`
once `build-ci-image` has republished the tag; see its note in `status/integration-coverage.md`.

The remaining work, in the shape it should be done:

- **Seven suites are genuinely red** — `axios`, `chalk`, `debug`, `mcp-typescript-sdk`,
  `socket.io`, `ts-for-gir`, `undici`. One cause per commit, and each returns to the allowlist in
  the commit that makes it green. They are SEVEN causes, not one: a single shared defect was the
  first hypothesis and the measurement refuted it. Two of them (`chalk`, `ts-for-gir`) fail on the
  NODE leg, which by this repo's own rule means the test is wrong rather than the implementation.
- **`undici` should be looked at first, and at the BUILD rather than the suite.** Its failures
  read `me is not a function` — a mangled identifier reaching a call site is a bundling symptom,
  and if it is one it will not be confined to this suite.
- **`mcp-inspector-cli` needs no fix, only an ordering.** It reads an example's `dist`, which
  `build:examples` produces and `build` does not.
- **Do not delete `run-integration`.** Still true, and now for the opposite reason: it gates a job.

### Some small API gaps are declared only in a source comment

Also from `todo-needs-anchor`'s first run. None is a defect — each is a known
edge the implementation does not cover yet, written down at the call site and
tracked nowhere, so none of them can be prioritised against anything else.

| Site | Gap |
|---|---|
| `packages/gjs/utils/src/error.ts:37,38` | `Error.stackTraceLimit` / `Error.prepareStackTrace` unimplemented |
| `packages/gjs/utils/src/fs.ts:16` | path argument does not accept `Buffer` or `URL` |
| `packages/gjs/unit/src/index.ts:1076` | `on(runtime, version)` takes no wildcard (`16.x.x`) |
| `packages/gjs/unit/src/index.ts:1091` | no `Browser` runtime in the matcher, though `tests/browser/` exists |
| `packages/gjs/unit/src/index.ts:1418` | only part of `node:assert` is wrapped |
| `packages/node/fs/src/browser/stream.ts:225` | `FSWatcher` is a stub; the in-memory volume is single-process |
| `packages/node/querystring/src/error.ts:3` | node-error classes duplicated per package instead of shared |
| `packages/framework/webgl/…/uniform.ts:117,169` | `@girs/gwebgl-0.1` types reject `Uint32Array`/`Float32Array`, worked around by a cast |

The two `uniform.ts` casts and the `webtorrent-augment.d.ts` DefinitelyTyped note
are the only ones whose repair is in ANOTHER repo (ts-for-gir and
DefinitelyTyped); the rest are ordinary in-tree work.

**The heading no longer carries a count, and that is the fix rather than a
tidy-up.** #1014 implemented two of the original ten — `config.ts`'s log-level
merge and `dlx-cache.ts`'s `cleanupStalePrepareDirs`, the latter with five tests
— and rewrote this file in the same commit without pulling the rows it had just
invalidated. A reader was then sent to two file:line references pointing at
shipped, tested code. A count in a title is a second copy of the table's length
that nothing checks; the anchor in each source comment is matched by CONTAINMENT
(`scripts/generate-status.mjs`), so a number-free heading means closing the next
gap costs one row deletion and nothing else.

### win32 `Adw.init()` — measured NOT to fault; two narrower gaps remain

#997's second finding (an `0xC0000005` access violation in `Adw.init()` on
win32) did not reproduce. Measured on the win11-gjsify VM with the published
`@gjsify/node-gi` 0.30.0 prebuild plus `@gjsify/gtk-runtime-win32-x64`, on a
host where `checkMsvcRuntime()` reports the Visual C++ runtime PRESENT: GLib
2.88.1 resolves, `Gtk.init()` returns, `Adw.init()` returns, exit 0. Per the
issue's own decisive test that makes it a DUPLICATE of the first finding — the
undeclared MSVC prerequisite, surfacing at first real use rather than at load.
Full write-up, including the session characterisation, is in ADR 0018.

What is NOT closed by that run, stated so neither reads as covered:

- **Session 0.** The probe was non-interactive (`isTTY` false on both ends,
  stdin on the null device — the condition the original report named) but ran in
  the interactive user session (`SESSIONNAME=Console`). A service / session-0
  context is the one place the original symptom could still live, and it is also
  what some CI agents look like.
- **The GTK bundle did not arrive with `npm install @gjsify/node-gi`.** The
  install script reported *"using the shipped prebuild for win32-x64"* and
  nothing else; `@gjsify/gtk-runtime-win32-x64` (78 MB) had to be installed
  EXPLICITLY before any namespace would resolve. That may be npm 11 declining to
  run install scripts by default (`npm warn allow-scripts`, which did fire here
  and forced the script to be run by hand) rather than a gap in the package —
  the two are not separable from this one observation. Worth one deliberate
  measurement on a clean host with scripts approved, because "install node-gi and
  it works" is what the win32 story currently promises.

### This ledger goes stale silently, and the two obvious guards were measured and rejected

Two entries here — the `on('Display')` X11/Wayland gate and the DISPLAY-gated GTK
skips — described a tree that had not existed for days. `capabilities.ts`
(`canRealizeSurface`/`canRealizeGl`, #1133) and `node-gi`'s `test/display-gate.mjs`
had already landed the exact shape the second entry ASKED for, down to lifting the
copy-pasted predicate into one shared helper, and five macOS GTK job families
including a windowing proof were green on both arches. Both entries were deleted in
the change that added this one. The cost is not tidiness: an agent asked for the
next development steps read this file, believed it, and proposed work that was
already merged.

The generate-status corpse check cannot see this class. It matches the SHAPE of a
resolved heading (`~~`, `✓`, `Completed`), and a stale entry has none of those — it
reads exactly like live work, because it was.

Two guards suggest themselves. Both were measured against this file, and both are
worse than nothing:

- **Flag an entry that references a CLOSED issue.** 34 distinct issue references
  across 92 sections; 6 point at closed issues (#503, #655, #997, #1002, #1101,
  #1107). Every one of the six is legitimate provenance — *"Found closing #1107"*,
  *"the #655 guard"*, *"issue #503"* naming an upstream GIO bug in another tracker,
  and #1002's own text already says *"is closed as"*. Six false positives, zero
  findings. It would also have missed both stale entries, which carried no issue
  reference at all.
- **Flag an entry naming a path that does not exist.** 23 of 92 sections name one,
  and they are overwhelmingly correct prose using package-relative shorthand
  (`lib/esm/index.js`, `src/index.ts`, `test/arrays.test.mjs`). Failing on those
  would train everyone to bypass the check within a week.

What the two stale entries had in common is not an anchor, it is a QUOTE: each
one quoted a source fragment (`` `!!(DISPLAY || WAYLAND_DISPLAY)` ``) from a
repo-rooted file it named. A check that held such a quote to still occurring in
that file would have failed the day `capabilities.ts` landed, offline and with no
network.

**That measurement has now been made, and it is the third guard worse than
nothing.** Implemented as described — sentence-scoped, pairing each backticked
fragment with each repo-rooted path named in the same sentence — it produced 98
checkable pairs over this file and flagged 42 of them (2026-08-16). The sampled
flags are false without exception, and they fail in one way: **the check cannot
tell a QUOTE from a MENTION.** `` `packages/node-gi/**` `` is a glob,
`` `build:prebuilds` `` is a script name, `` `DYLD_LIBRARY_PATH` `` is an
environment variable — none of them claims to be text occurring in the file the
sentence also names, and a ledger is mostly mentions. Narrowing the pairing does
not reach the class: what would have to be recognised is the difference between
"this file CONTAINS this string" and "this file is ABOUT this thing", which is
the judgement the guard was supposed to replace.

So all three obvious guards are measured and rejected, and the two genuinely
stale entries in this round were again found by READING the tree against the
file — the licence entry (all three `gtk-runtime-*` manifests declare
`SEE LICENSE IN gtk/THIRD-PARTY-NOTICES.md`, and `bundled-license.mjs` holds
them there) and the doc-revert entry (`scripts/check-doc-revert.mjs` exists,
wired advisory into `audit-runtimes.yml`, and its header records that the
signature THIS FILE proposed was measured backwards — the entry was not merely
closed, it was still publishing a wrong instruction). Both deleted in the change
that added this paragraph.

The honest state of the art is therefore: no guard, and a reading pass whenever
this file is used to plan work. What stays buildable is far narrower than a quote
check — a JSON or YAML FRAGMENT an entry pastes verbatim can be held to still
parsing out of the file it names, because a pasted structure is unambiguously a
quote rather than a mention. There is about one such fragment here, so that
machinery would be honest and nearly idle, which is the correct size for it.

### `<adw-about-dialog>` opens on its sheet, not on its close button

`AdwModalSurface.present()` focuses the first focusable control inside the
surface, falling back to the surface itself. For `<adw-about-dialog>` built and
opened in ONE task the fallback is what runs, because the close button is
appended from a `queueMicrotask` — `<adw-header-bar>` builds the section it goes
in from its own `connectedCallback`, so it does not exist yet
(`adw-about-dialog.ts`, `_buildPage`). Measured: `document.activeElement` is
`div.adw-about-dialog-sheet`. A dialog that was already in the markup gets the
button, so the two paths differ.

Nothing is broken by it — focus is inside, Escape works, and Tab from the sheet
reaches the button, which is the browser's own order. It is the one place in the
four dialogs where initial focus is not the control the user wants, and the fix
is in `<adw-header-bar>`: build the sections synchronously so a consumer can
append to them in the same task, which removes the microtask from every consumer
rather than adding a second one here.
`packages/web/adwaita-web/src/keyboard-operable.spec.ts` awaits that microtask
and says why.

### `<adw-toggle-group>` is upstream's fifth roving widget and has none of it

The row-family half of this entry is CLOSED: `<adw-action-row>` (while `activatable`),
`<adw-button-row>`, `<adw-expander-row>`'s header and `<adw-switch-row>` are tab stops that
activate on Enter and Space, `<adw-preferences-group>` declares
`GTK_ACCESSIBLE_ROLE_GROUP`, and `<adw-switch-row>`'s slider stopped being a focus target
the way `adw_switch_row_init` does it. `<adw-combo-row>` was measured NOT to need it — its
native `<select>` is already the combobox, already arrow-navigable, and already `disabled`
at one option or fewer, which is `adw-combo-row.c:194` without a line of our own.

What remains is the same blind spot from the other side. Upstream `<adw-toggle-group>` is
the fifth member of the roving family: `AdwInlineViewSwitcher` builds exactly this widget
with `GTK_ACCESSIBLE_ROLE_TAB_LIST` (`adw-inline-view-switcher.c:702`), and
`adw_toggle_group_focus` (`adw-toggle-group.c:1045`) is the citation
`elements/roving-focus.ts` is built on. The web element has none of it — no role, no roving
tabindex, no arrow keys. Measured in Firefox: three toggles report `tabIndex` `[0, 0, 0]`,
the host has no `role`, and ArrowRight/ArrowLeft/Home/End all leave `document.activeElement`
exactly where it was.

It stays OPERABLE, every toggle being its own tab stop, so it is not the defect class
`scripts/check-adwaita-keyboard-contract.mjs` was written against — and that gate
structurally cannot see it either, since there is no negative tabindex to trigger on. Its
zero finding there is a scope limit, not a clean bill. Closing it means giving the group the
tab-list role and one roving tabindex, which turns three tab stops into one: a visible
change to anything that tabs through a toggle group today.

### adwaita-core modules with no conformance vector table

`breakpoint.ts`, `color-scheme.ts`, `scrolling.ts` and `toast.ts` export shared
behaviour and are covered by nothing in `@gjsify/adwaita-core/conformance` — no
vector table names them, and no conformance file imports them. Three of the four
are what `packages/web/AGENTS.md` advertises as the core's flagship shared
behaviour ("Breakpoints (grammar/parser/evaluator + transition-only
`AdwBreakpoint`), color-scheme observable, toast queue").

They were invisible rather than under-covered: `check-adwaita-conformance-drivers.mjs`
is keyed by TABLE, so it reported "156 vector tables, every one driven or
explained" over a set none of these four is in. The gate now carries a
module-keyed arm and these four are its declared exceptions
(`MODULE_REASONS`), which is what makes them countable.

Each needs its own vectors before a renderer can be held to it, and each is a
different shape of work: the breakpoint grammar wants a parse/evaluate table
against `refs/libadwaita/src/adw-breakpoint.c`; scrolling wants the undershoot
and overshoot arithmetic; the toast queue wants a scheduler seam both renderers
already have. `color-scheme` is entangled with the divergence below and should be
vectored after it is decided, not before.

The heading carries no count on purpose. It named "Four" while four
`MODULE_REASONS` entries matched it as a literal string, so closing one gap
would have made the heading false and correcting it would have required editing
`scripts/check-adwaita-conformance-drivers.mjs` in the same change — a live
count, load-bearing inside a required check.

### adwaita-core modules whose only vector table is core-only

`easing.ts`, `glib.ts` and `length-unit.ts` DO have vectors — respectively
`SPINNER_ARC_PHASE_VECTORS`, `GLIB_CLAMP_VECTORS` and `ADW_LENGTH_UNIT_VECTORS`
— but every one of those tables is itself `CORE-ONLY:`, so no renderer suite is
held to any of the three modules. `length-unit.ts` was worse than invisible: the
module arm counted it covered because `conformance/split-view.ts` carries
`import type { AdwLengthUnit } from '../length-unit.js'`, a type-only import
that borrows a name for a field and proves nothing about vectors.

Not the same gap as the four above, and it should not be filed under their
heading: those modules have no table to drive, these have one nobody drives.
`glibClamp` is the sharpest case — `adw-progress-bar.ts` calls it directly in
the browser, so the seam exists; what is missing is a spec row that varies the
bounds far enough to tell `CLAMP` from `Math.min`/`Math.max`. The
`resolveNavigationSidebarWidth` path already does that through
`SIDEBAR_WIDTH_VECTORS`, which is why `GLIB_CLAMP_VECTORS`' own exemption is a
chain rather than a gap; the module is still held to nothing under its own name.

### A table can be "driven" while the rows that matter are skipped

`consumersUnder()` counts a table driven when a renderer's `*.spec.ts` names it
outside a comment. That cannot distinguish iterating the table from importing it
and filtering the interesting rows away, and six tables are only ever referenced
through a `.filter(` today: `ABOUT_DIALOG_DETAILS_VECTORS`,
`ABOUT_DIALOG_SUPPORT_VECTORS`, `ABOUT_DIALOG_CREDITS_LEGAL_VECTORS`,
`BUTTON_STYLE_CLASS_VECTORS`, `CAROUSEL_PAGE_ALLOCATION_VECTORS` and
`CLAMP_ALLOCATE_VECTORS`. Both renderer suites filter `CLAMP_ALLOCATE_VECTORS`
to `params.childMin === 0`, and three `CLAMP_*` tables are exempted as an
internal step of the pipeline it composes — a chain that does not carry the
non-zero-`childMin` rows. Two of the three now say so in their own reason
(`CLAMP_THRESHOLD_VECTORS`, three rows; `CLAMP_CHILD_SIZE_VECTORS`, one);
`CLAMP_SIZE_FROM_CHILD_VECTORS` needs nothing, every row of it runs at
`childMin: 0`. `adw-about-dialog.spec.ts` does the same thing with a `continue`
guard rather than a filter, which no textual rule sees at all — that is what put
the `g_strsplit ("")` translator-credits trap behind a false chain, now re-filed
as a GAP.

The measurable half (`X_VECTORS.filter(`) is about six lines of gate. It is
deliberately NOT implemented yet, because it catches the filter form and not the
`continue` form that motivated the finding, and a rule that covers two of three
shapes of a class reads as covering the class. Closing this means deciding per
chain whether the conceded rows matter, then either widening the specs or
narrowing the reasons to the rows they really carry — reason work, not gate work.

### adwaita-web does not use the color-scheme singleton at all

`packages/web/adwaita-core/src/color-scheme.ts` documents itself as "the single
source of truth for the current Adwaita color scheme plus a change notifier,
shared by every renderer (ADR 0004)". Measured 2026-08-21: `adwaita-web` calls
none of its seven exports — not `adwaitaColorScheme`, `setAdwaitaColorScheme`,
`toggleAdwaitaColorScheme`, `onAdwaitaColorSchemeChanged`, `themeIconColor`,
`isThemeIconColor`, nor either `DEFAULT_ICON_COLOR*`. It answers the question
itself in `src/accent.ts:55` (`isAdwaitaDark`), reading `.theme-dark` /
`.theme-light` and falling back to `matchMedia('(prefers-color-scheme: dark)')`.
The NativeScript bridge, by contrast, re-exports all of it and subscribes from
`adw-icon` and `adw-image-button`.

So `setAdwaitaColorScheme('dark')` is a no-op in the browser, and the two ports
disagree about where the scheme lives while the core claims to be that place.
Not obviously a bug in adwaita-web: a browser renderer that ignored
`prefers-color-scheme` and the stylesheet's own manual override classes would be
the wrong thing, and the core's own header already concedes that "applying the
scheme to a surface is the renderer's job". What is wrong is the core's claim to
be the SOURCE, which nothing holds it to on the browser side.

The decision to make is which way the singleton points: either the browser
element learns to seed and follow it (`isAdwaitaDark` becomes the platform half
that feeds `setAdwaitaColorScheme`, media-query listener included), or the core
docblock stops calling itself shared and the field narrows to the NativeScript
theming path it actually serves. Deferred out of the gate PR that measured it,
because either direction is a behaviour change and would make a review of the
gate impossible.

### `AdwToastOverlay`'s `timeout` option means seconds on one port and milliseconds on the other

Measured 2026-08-21, while checking a reported "the toast default is 5000 in the
core and 5 in the browser element" — which is NOT a defect. `refs/libadwaita`
settles the units: `adw-toast.c:385` documents `AdwToast:timeout` as "the timeout
of the toast, **in seconds**" and `adw-toast.c:475` sets `self->timeout = 5`.
adwaita-core counts MILLISECONDS and says so on every field, so
`DEFAULT_TOAST_TIMEOUT = 5000` is 5 s and is right; `adw-toast-overlay.ts` takes
SECONDS as its public unit, `DEFAULT_TIMEOUT_SECONDS = 5` mirrors
`Adw.Toast:timeout` exactly, and it converts once at the boundary (`* 1000`,
line 142) — also right. Nothing vanishes in 5 ms or lingers for 5000 s.

The real divergence is one level out, between the two RENDERERS. Both export a
class called `AdwToastOverlay` taking an options bag whose field is called
`timeout`, and the two mean different things:

- `adwaita-web` — `addToast(title, { timeout })` is SECONDS (its own
  `AdwToastOptions` interface). Its spec writes `{ timeout: 3 }` for three seconds.
- `@gjsify/adwaita-nativescript` — `showToast(title, { timeout })` passes the
  bag straight to `new AdwToast(...)`, so it is the CORE's `AdwToastOptions`,
  i.e. MILLISECONDS. This wrapper has NO spec of its own: `widgets/adw-toast-overlay.ts`
  is untested, and the `{ timeout: 3000 }` at `index.spec.ts:731` constructs
  `AdwToast`/`AdwToastQueue` directly, never reaching the overlay. That makes the case
  stronger, not weaker — the diverging wrapper is the untested one.

`{ timeout: 5 }` is therefore a five-second toast in the browser and a five-
MILLISECOND toast on NativeScript. Each suite is internally consistent, which is
why neither catches it, and no conformance vector table covers `toast.ts` at all
(see the module-gap entry above), so nothing holds the two ports to one answer.

Fixing it is a public-API change on one of the two ports and wants a decision
first: libadwaita's own spelling is seconds, which argues for the browser being
right and the NativeScript wrapper growing the same `* 1000` boundary — at the
cost of breaking anyone passing milliseconds today. Deferred out of the gate PR
that measured it; a behaviour change would have made that PR unreviewable.

### Nothing holds `adwaita-web`'s data grid to the shared data-grid vectors

`DATA_GRID_TRACK_VECTORS`, `DATA_GRID_COLUMN_CLASS_VECTORS`,
`DATA_GRID_VARIANT_VECTORS`, `DATA_GRID_CELL_TEXT_VECTORS` and
`DATA_GRID_INTERACTIVE_VECTORS` are driven by
`packages/nativescript-bridge/adwaita/src/data-grid.spec.ts` alone. The string
`DATA_GRID` occurred exactly once anywhere in `adwaita-web`, in a comment
claiming "Both ports are held to `DATA_GRID_*_VECTORS`" — corrected in the same
change as this entry, since the browser half is held to none of them.

`adw-data-grid.ts` does delegate correctly (it imports `dataGridTracks`,
`dataGridColumnClasses`, `dataGridCellText`, `dataGridRowInteractive` and both
normalisers from the core), so this is missing coverage rather than a known
drift. Closing it is a browser-side spec over the five tables, in the shape
`split-views.spec.ts` already uses.

The correction BLINDED the gate that ledgered this, for one commit. Spelling the
five names out in an `adwaita-web` comment made all five read as browser-driven,
because "driven by X" was a plain text scan over every `.ts` under X — comments
included. The original defect was caught only because it used the glob spelling
`DATA_GRID_*_VECTORS`, which contains no individual name. Fixed by resolving
drivers from usage: names outside a comment, in a `*.spec.ts`.

### Adwaita renderer asymmetries with no verdict yet

`scripts/check-storybook-widget-coverage.mjs` demands a verdict for every widget only
one renderer ships (#1195): a `decision` with its reason, or a `gap` pointing here.
Most are decisions with a reason next to them. These are the ones nobody has settled
from outside the port — each is a product question, not scheduled work, which is
exactly why they must not be written as decisions.

- **`adw-checkbox` and `adw-radio` on NativeScript.** The headless half already
  exists: `@gjsify/adwaita-core` carries `RadioGroupState` and `RADIO_GROUP_VECTORS`,
  driven today by core's own spec (`checks.spec.ts`) and the browser suite, by no
  NativeScript spec. What does not exist is the decision. `@nativescript/core` ships no
  checkbox view (nothing under its `ui/`), and libadwaita's own phone idiom for a
  boolean is `AdwSwitchRow`, which this port already has — so the question is whether
  a checkbox belongs on a touch target at all, not how to build one.
- **`adw-progress-bar` on NativeScript.** libadwaita styles the GtkProgressBar node in
  `stylesheet/widgets/_progress-bar.scss` and the browser ships the element; the
  NativeScript port has no progress widget. The PLATFORM half is not what is missing:
  `@nativescript/core` ships a determinate `Progress` (`value`/`maxValue`, `ui/progress`),
  exported from the same package root this port already takes `Switch`, `Slider` and
  `ActivityIndicator` from — unlike the checkbox above, this is not a platform survey.
  What is open is the Adwaita EXPRESSION: `progressbar > trough > progress` has no
  equivalent in the NativeScript CSS subset this theme is confined to, and `.osd`, the
  text label and the fraction have no counterpart at all. So the question is what a
  determinate Adwaita progress bar should even look like there, not whether one is
  buildable.
- **`adw-dialog` on NativeScript.** `AdwDialog` is a real upstream widget
  (`adw-dialog.h`) and the port has the three SPECIALISED dialogs — alert, about,
  preferences — but no generic one. Every NativeScript dialog here is deliberately the
  platform sheet ("There is NO custom in-app modal here", `adw-alert-dialog.ts`), and
  a content-agnostic dialog has no platform sheet to be. Whether it becomes an in-app
  card over the `AdwBottomSheet` overlay machinery, or is not offered at all, is the
  open decision.
- **`adw-carousel-indicator-lines` on NativeScript.** `AdwCarouselIndicatorLines` is a
  public widget upstream (`adw-carousel-indicator-lines.h`). The NativeScript carousel
  builds a DOT row inline and has no lines variant in any form.

When an issue is opened for one of these, its ledger entry points at `#<number>`
instead and the bullet is deleted from here.
### `@gjsify/domparser` has no "in select" insertion mode

A `<select>` may contain only `option`, `optgroup`, `hr`, `script` and `template`;
the HTML spec's "in select" insertion mode IGNORES every other start tag and keeps
the text. This parser has no such mode — it only pops `option`/`optgroup` against
one another — so `<select><div>d</div></select>` keeps the `div` where a browser
drops it and keeps `d`.

Found by ablation, not by reading the spec: the seeded fuzz in
`tests/integration/domparser/src/fuzz.spec.ts` diffs generated markup against
parse5, and with the three algorithms ADR 0026 § 6 already scopes out excluded
from its generator, `<select>` was the last construct still diverging — 451 of
4000 cases. Zero of the 47 real pages in the local corpus hit it, which is why it
survived the authored fixture corpus: real markup does not put a `<div>` in a
`<select>`.

What it costs to close: a `MODE_IN_SELECT` plus the spec's "reset the insertion
mode appropriately" algorithm, which this tree builder does not have — its modes
are a flat enum with `MODE_IN_BODY` as the workhorse. The `in select in table`
variant needs table awareness on top.

Pinned rather than noted: `select-with-foreign-markup` is a `divergent` fixture,
so it asserts BOTH our committed golden AND that parse5 differs from it. The day
the mode lands, that assertion fails and this entry has to be deleted.

### `@gjsify/domparser` does not parse SVG/MathML foreign content

ADR 0026 § 6 scopes out the foreign-content insertion mode and the
adjusted-attribute tables, on the reasoning that they are "only needed to select
*into* SVG". Measured against parse5 over 47 real pages (~91,400 canonical tree
lines) that boundary is exactly where the ADR says it is — **every** divergence is
inside an `<svg>`/`<math>` subtree and there are **none** outside one — but it is
wider than the sentence suggests, because inline SVG icons are on most pages:

- attribute and element names are lowercased, so `viewBox` becomes `viewbox`,
  `clipPath` becomes `clippath`, `xlink:href` becomes `href`, and a selector
  naming any of them finds nothing;
- a self-closing child (`<path/>`, `<circle/>`) is honoured in foreign content and
  ignored in HTML, so `<circle/><rect/>` NESTS here where a browser makes them
  siblings — which moves the subtree a document-wide `*` or `[class]` walks.

On the corpus that costs 90 of 940 selector comparisons, all of them on pages with
inline SVG. The parser is correct for HTML and wrong inside SVG, and nothing in
the output says which one a caller is looking at.

Pinned rather than noted: `tests/integration/domparser/src/fixtures.ts` carries
`svg-foreign-content` as a `divergent` fixture, which asserts BOTH our committed
golden AND that parse5 differs from it — so the day this lands, the assertion
fails and this entry has to be deleted rather than quietly outlived.

### `@gjsify/domparser` walks a tree recursively, so depth is bounded by the stack

The tokenizer and the tree builder are iterative — a 10,000-deep document PARSES
fine. Everything that READS the resulting tree is not: `textContent` overflows at
about 2,000 levels, `innerHTML`/`outerHTML` at about 4,000, and
`querySelectorAll`/`canonicalize` at about 10,000, each with a bare
`RangeError: Maximum call stack size exceeded`. parse5 handles all of them.
`closest()` and `matches()` are iterative and unaffected.

Not a regression and not urgent, which is why it is here rather than fixed in the
PR that measured it: `origin/main` has the same limit and a WORSE one for
`innerHTML` (it threw at 2,000 where the current serializer survives to 4,000),
and the deepest tree in the 47-page real corpus is **29 levels** — a margin of
about seventy. The shape that reaches it is a page with thousands of unclosed
`<div>`s, which a hostile or generated page can produce.

The fix is mechanical (an explicit stack in `DOMNode.textContent`,
`dom/serialize.ts` and `selectors/query.ts`), and it is worth doing the day
anything here runs on untrusted input without a depth cap in front of it.

### One node model for `@gjsify/domparser` and `@gjsify/dom-elements`

The two describe the same world and disagree about it: `tagName` casing,
attribute-name case sensitivity, `attributes` as plain records versus a
`NamedNodeMap`. The fix is not a dependency in either direction but lifting the
platform-free node classes out of `dom-elements` into a leaf both consume — which
changes what `@gjsify/dom-elements` *is* and needs its own ADR (0026 § Deferred).
Until then the `Adapter` seam is what keeps the disagreement from multiplying:
one selector engine, two trees.

### Case-preserving XML in `@gjsify/domparser`

The XML mode lowercases `tagName` and uppercases `nodeName`; both are wrong for
XML and both are frozen, because `@excaliburjs/plugin-tiled` dispatches on
lowercase tag literals at 24 sites and TMX/TSX grammar is lowercase throughout
(ADR 0026 § Decision 4). Pinned by the golden in
`packages/web/domparser/src/xml-shape.spec.ts`, so changing it is a visible edit
rather than a surprise. Doing it properly means giving the XML path its own
casing rule and moving the one measured consumer at the same time.

### Fragment parsing — the `innerHTML` setter and a context element

`@gjsify/domparser` serializes a tree to markup but cannot parse markup INTO an
existing element: the `innerHTML` setter and the `DOMParser`-adjacent fragment
APIs need the insertion-mode machinery ADR 0026 § 6 scopes out (a fragment is
parsed with a context element that selects the initial mode). The getter side
landed with the serializer; only the setter is missing.

### `@gjsify/devtools-cdp` parses HTML with a regex

`packages/framework/devtools-cdp/src/target-discovery.ts:10` says so in a comment
and explains that `DOMParser` was not usable for it. It is usable now — HTML mode,
real selectors, entity decoding, all reachable from the same Node run that suite
already has. Collecting it is a change against a different pillar, so it did not
ride along with ADR 0026.
