<!-- Authored Open-TODO sections — area: Bundler and build tooling.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### One package, two module instances — a "singleton" the bundle duplicates

`@gjsify/adwaita-nativescript` is bundled **TWICE** into the NativeScript storybook
showcase: 31 of its `lib/esm/**` modules appear under two `//#region` paths in
`.ns-vite-build/vendor.mjs`, once as `node_modules/@gjsify/adwaita-nativescript/…` and
once as `node_modules/@gjsify/storybook-nativescript/node_modules/@gjsify/adwaita-nativescript/…`.
Both are symlinks to the SAME directory (`packages/nativescript-bridge/adwaita`); the
resolver keys modules on the specifier path it walked, not on the realpath, so it never
learns they are one package.

The cost is not size. `window-insets-source.android.ts` is a deliberate singleton —
`packages/nativescript-bridge/AGENTS.md` records "ONE broadcast — the platform takes one
listener" as load-bearing, because `ViewCompat.setOnApplyWindowInsetsListener` REPLACES
the previous listener rather than adding to it. The bundle constructs **two**
`WindowInsetsBroadcast` instances with two `installed` flags, so both copies install, the
second replaces the first, and every subscriber of the first copy keeps `NO_INSETS`
forever. Measured on emulator-5554: the shell's panes (reached through the storybook
package's copy) receive the reading; a story's own `AdwToolbarView` (Layout/Toolbar View,
reached through the top-level copy) renders with no inset at all. It looks right there
only because that widget is not at a window edge.

`host-insets.android.ts` now guards against the consequence — it refuses to hand the top
edge back to the page unless it holds a non-zero reading to pay it with — but that is a
guard around the duplication, not a fix for it. The fix belongs in resolution: make the
bundler realpath a workspace symlink before keying the module, or hoist so only one path
exists. Any other per-package singleton in this tree has the same exposure and nothing
currently detects it.


### The Vue plugin's virtual suffix is coupled to deepkit's filter, and nothing checks it

`@gjsify/rolldown-plugin-vue` mints module ids ending in `VIRTUAL_SUFFIX =
'.gjsify-vue.ts'` so rolldown's extension-based parser selection reaches TypeScript.
That tail also decides something nobody wrote down until now:
`@gjsify/rolldown-plugin-deepkit` filters on `/\.(m|c)?tsx?$/`, so the id lands
inside it and an SFC's `<script setup>` gets reflected — measured, an SFC carrying
`typeOf<Reflected>()` emits its `__ΩReflected` table. Rename the tail to `.js` and
reflection switches off for **every** `.vue` file in the project, with no diagnostic:
`typeOf()` with no argument throws `No type given` at runtime, from a build that
exited 0.

The coupling is now stated at the constant, which is enforcement by review. The
mechanism it deserves is small but not free, which is why it is here rather than done:

- export a predicate from the deepkit plugin (`reflectsModuleId(id)`, wrapping the
  `FILTER` that is private today), and
- assert `reflectsModuleId('/a/App.vue' + VIRTUAL_SUFFIX)` from the vue plugin's own
  suite.

That costs a new public export, a `workspace:^` devDependency edge and a lockfile
change — all defensible, none of them something to slip into a docs-correction PR.
Whoever picks it up: the A/B is renaming the suffix to `.gjsify-vue.js` and watching
the new case go red. Related: the same `order: 'pre'` collision in the SOLID plugin
was a real defect, fixed in #1296 by splitting `GjsifyConfig.prePlugins`.


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


### A plugin hook's `moduleType` is js/json/text only on the native bundler bridge

`@gjsify/rolldown-native`'s `plugin_proxy.rs::parse_module_type` maps `js`/`ecmascript`,
`json` and `text`, and answers `Err("rolldown: unsupported moduleType '<x>'")` for
everything else. Rolldown's own `ModuleType` also has `ts`, `tsx`, `jsx`, `base64`,
`dataurl`, `binary`, `empty`, `css`, `asset` and `copy`.

The consequence is a **runtime-parity defect, and it points the wrong way**: a plugin
that compiles a foreign extension into TypeScript builds fine under Node and fails
under GJS, which is the primary target. Measured on one fixture (a `.vue` importer,
a plugin whose `transform` returns `const x: number = 41` with `moduleType: 'ts'`):

| engine | result |
|---|---|
| `node packages/infra/cli/lib/index.js build … --app gjs` | exit 0 |
| `gjsify build … --app gjs` (CLI under GJS) | exit 1, `plugin \`probe-moduletype\` threw … unsupported moduleType 'ts'` |

`@gjsify/rolldown-plugin-vue` was written around it — it renames the module id to
`<path>.gjsify-vue.ts` in `resolveId` and compiles in `load`, so rolldown's
extension-based parser selection does the job and no `moduleType` is claimed. That
works on both engines and the plugin does not depend on this being fixed. But the
next plugin will hit the same wall, and `moduleType` is the *designed* mechanism —
rolldown 1.1.4 ships it in `SourceDescription`, so the field is documented API, not a
guess.

Why it is not fixed here: the change itself is a few lines of Rust, but the artifact
is a committed prebuild for four platforms (`linux-x64`, `linux-arm64`,
`darwin-arm64`, `darwin-x64`). Building it needs `valac` plus a `refs/rolldown`
checkout at the pinned commit, and shipping one platform's `.so` while three go stale
is the "declared target with no loadable artifact" shape this repo refuses. So it
belongs in a change that goes through `prebuilds.yml`.

Closing it means extending `parse_module_type` to the full `rolldown_common::ModuleType`
set (both `into_load_return` and the transform path share it), and adding an e2e case
next to `tests/e2e/plugins-by-name-gjs` that returns a `moduleType` from a plugin and
asserts the bundle on BOTH engines — the asymmetry above is exactly what a
single-engine test cannot see.

A second, smaller gap sits beside it: rolldown's `moduleTypes` INPUT option works
(measured, `{'.vue': 'ts'}`, exit 0 under Node), but the CLI has no passthrough for
it. `gjsify.loaders` is a text/dataurl plugin, not a module-type map. Worth adding
only once the hook half above is honest, since a config key whose value the GJS engine
cannot honour would be the same defect one level up.


### sass under GJS: the SCRIPT path is closed, the BUNDLER path is not (#1053)

The bootstrap chain itself is closed FOR A TREE THAT IS ALREADY BUILT:
`gjsify run --node-script <file>` bundles an unbundled `.mjs` that imports `node:*`
and runs it, `ensureGjsifyShimOnPath()` puts a `node` on a package script's PATH
that re-enters it when the host has none, and `build:infra` goes end to end with no
`node` at all — measured by putting `node`/`npm`/`npx` on PATH that exit 127 and
announce themselves, then running the whole chain under `gjs -m …/cli.gjs.mjs`:
exit 0 warm, and exit 0 with both native facades deleted, which rebuilt them
through the global CLI's own engine. **That last measurement is NOT the cold case
it reads as** — deleting the facades leaves every workspace `lib/esm` in place. On
a tree that has none the same chain used to fail at its first `node scripts/*.mjs`;
#1232 closed that, and what is left is that nothing measures it — see
"Nothing runs `build:infra` on a cold tree with no `node`" above.
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


### `--app node` genuine-GJS-source detection is narrower than the reverse bridge it gates

`nodeGiGlobalsInject` keys on BARE ambient globals (`print`/`imports`/`ARGV`), so a genuine GJS source that uses `gi://` but logs via `console.log` — and passes no explicit `--globals` — is not recognised: its `@girs/*` value imports are emptied (`class extends undefined`) **and** its `/register` imports route to `@gjsify/empty`. Verified with both probes. This pre-dates ADR 0012 and hits `@girs/*` and registers equally; ADR 0012 only brought the two into parity via the single `isGjsSourceBuild` gate in `app/node.ts`. Fix by widening the SIGNAL itself — e.g. treat "a `gi://` specifier survived in the bundled graph" as a reverse-bridge build — which closes both at once.


### Regenerate the register-globals closure map after a `GJS_GLOBALS_MAP` change

`node packages/infra/cli/scripts/generate-register-closure.mjs` (`--check` reports staleness). A stale map is fail-soft — builds stay correct but pay extra `--globals auto` analysis passes. (The related hazard — the committed CLI bundle inlining a stale map — is closed: `.githooks/pre-commit` triggers on `packages/infra/resolve-npm/lib/` and `packages/infra/rolldown-plugin-gjsify/src/`.)


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

### `@gjsify/vite-plugin-gettext`'s msgfmt plugin carries both gettext defects

The two defects fixed in `gjsify gettext` (see `packages/infra/cli/src/commands/gettext.ts`)
exist unchanged in `packages/infra/vite-plugin-gettext/src/msgfmt.ts`, which is a second
implementation of the same wrapper:

  * **Bulk mode, silent.** `msgfmtPlugin`'s `format === 'xml' && templateFile` branch builds
    `['--output-file=' + outputFile, '--xml', '--template=' + templateFile, '-d', poDirectory]`.
    With no `LINGUAS` file beside the `.po` files that exits 0, prints `<podir>/LINGUAS does
    not exist`, and writes the template back untranslated. Measured on a probe tree with
    gettext 0.26.
  * **Per-language mode, impossible — for EVERY format, the default included.** The other
    branch builds ``['--output-file=' + outputFile, `--${format}`, poFile]`` with no guard,
    so it passes `--desktop`/`--xml` without a template
    (`--desktop requires a "--template template" specification`, exit 1) and, for the
    plugin's DEFAULT `format = 'mo'`, passes a flag that does not exist:
    `msgfmt --mo` → `unrecognized option '--mo'`, exit 1 (gettext 0.26). The CLI's version
    of this loop carried the `if (format !== 'mo')` guard; this copy never did, so the
    plugin cannot have compiled a `.mo` either. It has no test and no in-repo consumer —
    only `resolve-plugin-by-name.ts` documents the `{ "export": "msgfmtPlugin" }` spelling
    — which is how a wrapper that works for none of its formats stayed in a published
    package. Nor could a gate have said so: `scripts/audit-test-scripts.mjs` asks whether a
    package's `test` script RUNS the per-runtime legs it ships, so a package with no `test`
    script at all (this one has `clear`/`check`/`build` and nothing else) is outside its
    question. Which fixes the ORDER of the repair: the test entry is the first commit, not
    the wrapper. Without one `gjsify foreach test` never reaches the package, and the fix
    would be green because unrun — the class it is repairing.

`getOutputExtension` also returns `.xml` for the xml format, which trips a third measured
constraint: gettext finds ITS rules by filename PATTERN (`/usr/share/gettext/its/*.loc`,
AppStream's being `pattern="*.metainfo.xml"` + `localName="component"`), so a component not
named `*.metainfo.xml` fails with `cannot locate ITS rules for <file>`.

The fix is the one the CLI now uses: chain one `msgfmt --locale=<lang>` call per catalogue,
each output becoming the next template, writing through intermediates so the template and
the output are never the same path. msgfmt truncates `--output-file` before reading the
template, so chaining in place destroys it: measured, `--desktop` writes a 0-byte file and
exits 0, `--xml` prints `cannot read <file>: Document is empty` and dies on SIGSEGV
(exit 139). Only the first is invisible to a caller that checks the exit code, which is the
same shape as the `-d` defect above.

Not folded into the CLI fix because it is a separate package with its own build and
consumers; doing both in one change would have made the diff harder to review than the
defect is to describe.


### A developer who picks Vue gets the desktop and nothing else

`packages/framework/gtk-host/src/adapters/` holds React, Solid and Vue over one widget table no
adapter may duplicate, and all three reach GTK only. `@gjsify/adwaita-web` ships its custom
elements and `@gjsify/adwaita-nativescript` its widgets, and neither has a framework binding: on
those surfaces a tree is written against the DOM API or as NativeScript XML by hand.

This is recorded as a GAP, not as a proposal. ADR 0051 Decision 5 already sets the policy —
nothing more is extracted than the second driver needs — and its rejected alternatives name the
inverse outright: "extract a `host-core` package first, then find a consumer". 0051 also measured
that the three adapters carry no runtime `gi://` import at all, so a second renderer behind the
same ops would be a parameterisation of the node type rather than a rewrite. A consumer that needs it is what would start
this, per the policy above. No estimate of the web leg's cost belongs here until someone
measures one: a browser binding that resolved custom elements directly would bypass the
gtk-host ops entirely, so it would not even be evidence for the parameterisation above.

**A long-term GOAL was stated for this gap on 2026-09-14, and is recorded as a goal — not a
plan, not a promise, nothing scheduled**: a developer who writes Vue should reach MOBILE
through NativeScript, the way React, Solid and Vue reach GTK today through `gtk-host`. What
writing it down changes is only that the gap has a direction, so a measurement bearing on it
is worth keeping. What it does NOT change is the gate: ADR 0051 Decision 5 still says a
consumer that needs it is what starts the work, and a stated direction is not one.

Its preconditions, measured ones only:

- **A renderer DRIVER is not a framework binding, and one arriving does not move this
  entry.** A driver builds an AUTHORED tree through a renderer and holds it against the
  `adwaita-core` vectors; a binding reconciles a framework's component tree onto that
  renderer's ops. ADR 0051 § Amendment 1 is why the distinction is load-bearing rather than
  pedantic — it withdrew the NativeScript tree driver of its own stage 2 on the measurement
  that every widget there extends an `@nativescript/core` base, that the package ships no
  platform-neutral module for one (9.1.1 has `index.android.js` / `index.ios.js` and no
  `index.js`), and that installing the optional peer does not repair it. Whatever a driver
  for that surface establishes, it is a claim about what the PORT can build.
- **The element door is unmeasured.** `registerElement`, how a NativeScript framework
  binding resolves a custom element, is not in `@nativescript/core` at all — measured on 9.1
  under ADR 0033 § Consequences, where the identifier is absent from the package and belongs
  to `@nativescript/angular` / `nativescript-vue` — and the port's own documented way in is
  NativeScript's rule that an `xmlns` IS a module, over an app-local barrel. Which of those
  two doors a Vue binding here would use has not been measured, and the answer decides
  whether this is a parameterisation of the gtk-host ops or a second reconciler.
- **The same caveat as the web leg above applies twice over**: a binding that resolved the
  port's classes directly would bypass the gtk-host ops, so it would be no evidence for the
  parameterisation either.

