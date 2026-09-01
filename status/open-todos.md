<!-- Authored Open-TODO sections — THIS FILE is the tracked source of truth (the
     rendered STATUS.md view is generated and gitignored). One `### <title>` per open item.
     A RESOLVED item is DELETED (its record is the commit + CHANGELOG that closed
     it) — the status-data check rejects struck-through / ✓ / "Completed"
     headings, so the done-log cannot regrow. -->

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

### A version stamp read off `@girs/*` is not the library that ran

Seven measurements in this tree were stamped `Adw 1.10`. Installed is **1.9.3**
(`rpm -q libadwaita`, and `Adw.MAJOR/MINOR/MICRO_VERSION` under gjs agree). The source is
`node_modules/@girs/adw-1/package.json`, whose `description` reads *"generated from library
version 1.10.0"* — so the number was taken from the TYPE package's declared upstream, not from
the library the probe actually called.

Six were corrected against the running library. **One deliberately was not**:
`docs/adr/0027-gtk-host-layer.md:37` ("across 29 containers"). It is a different measurement,
never reproduced here, and writing `1.9.3` there would assert a version for a run nobody
observed — which is the same defect one layer down. Re-run that probe or leave the stamp; do not
edit it.

The skew is already known elsewhere: `gjsify system-check` catches `@girs/adw-1` 1.10.0 against
libadwaita 1.9.2 (recorded further down this file). What was missing is the consequence — a
`@girs/*` version is a claim about the GIR the types came from, and a measurement must name the
library it ran against, which is `Adw.get_*_version()` and nothing else.


### A node:test FILE fails with no named test and no message, on a leg nobody watches

**`packages/node-gi` `test/bytes.test.mjs`** on the Windows batteries-included leg
(`no gvsbuild`, staged prebuild, bundled GTK): `tests 10, pass 9, fail 1` where all
NINE named tests are green and the tenth "test" is the FILE — `'test failed'`, no
message, no assertion, no stack, no abort or access-violation anywhere in the log.
Immediately before it: `(node-gi) warning: could not watch a GLib poll fd from
libuv; falling back to timed main-context polling`. Green on rerun.

A napi case used to sit beside this one, on the theory that the two shared a shape.
They did not, and the theory cost a wrong grouping: that one was a conformance program
awaiting something nobody resolves, which exits 0 with a truncated transcript. Nothing
about it was file-level or unattributable once the reference leg stopped reporting
success for a run that never finished.

**The shape is the finding.** A `node:test` file that fails at FILE level reports
nothing usable: node attributes a post-test process problem to the file, so the log
carries a name and a duration and no cause. An assertion failure would print a diff;
this prints `'test failed'`.

**And the baseline WAS unknown, which is worse than the flake.** node-gi.yml's `scope`
job narrows the OS matrix, so the Windows legs run only when `packages/node-gi/**` is
touched. Measured while chasing this: the leg is `skipped` on every recent `main`
push, so a green tick on `main` says nothing about it, and the last run that actually
EXECUTED it was two PRs earlier. Reading `main` as the baseline would have blamed the
wrong change — it nearly did. `ci-summary` now names, per job GitHub resolved to
`skipped`, the SHA at which that job last actually executed, so this half costs a
glance at the step summary.

What would make the next occurrence cost minutes instead of an afternoon, in order:

- **Make a file-level failure say something.** The two candidates are a `process.on('exit')`
  hook that prints the pending-handle set, and running the file with
  `--test-reporter=spec --test-force-exit` off so a hanging handle surfaces as a
  timeout with a name rather than as an exit code.
- Only then chase the cause. The `bytes` suite exercises GBytes ref lifetime across
  GC (`a callee that KEEPS the bytes stays valid after the engine drops its ref`), and
  it appeared in the run that first linked instance prototypes to their class
  (#1322) — a change that touches every wrapped instance. That is a hypothesis with
  no evidence behind it: the same leg passed on rerun with the same code.

### `@gjsify/gtk-host`'s generated table offers two Unix-only GTK classes on every OS

Found by `gtk-os-suites.yml`'s win32 leg on its first complete run (2026-08-31): the
suite reported **6 of 2264** on `win32-x64` against **2274/2274** on darwin-arm64 and
darwin-x64, all six on one root cause. Only the set-comparison assertion named it; the
other five dereferenced an `undefined`:

```
GtkPageSetupUnixDialog: Cannot read properties of undefined (reading 'list_properties')
GtkPrintUnixDialog:     Cannot read properties of undefined (reading 'list_properties')
```

Both are `…UnixDialog` — GTK does not build them on Windows. `src/generated/` is
produced from the GIR on a LINUX host, so it bakes in Linux-only classes and then
`generated.spec.ts` / `conformance.spec.ts` compare that table against the INSTALLED
typelib, where two rows have no class at all.

**A version skew is the obvious second hypothesis and it is ruled out.** The two
bundles' `Gtk-4.0.typelib` differ in size (559 728 win32 against 567 784 darwin) and
the win32 GTK is gvsbuild's against Homebrew's, so "the Windows GTK is older" reads as
the likelier story — and it would send someone to bump a version. The full
capitalised-identifier diff of the two typelibs is 12 names and they are ONE subsystem:
`GtkPageSetupUnixDialog`, `GtkPrintUnixDialog`, `GtkPrinter`, `GtkPrintJob`,
`GtkPrintCapabilities`, `PrintBackend`, `PrinterFunc`, `PrintJobCompleteFunc` — GTK's
Unix print stack, entire, and nothing else. An older GTK would be missing classes
scattered across unrelated subsystems. The portable replacements `GtkPrintDialog` and
`GtkFileDialog` are in BOTH, and both Unix dialogs are in the Linux system GTK 4.22.
Corroborating from the suite side: `refuses a type whose namespace it cannot import`
stays GREEN, so no namespace is missing — a class inside a present one is.

So the repair is to mark that subsystem Unix-only. A GIR bump would fix nothing. Nothing about it is the operating
system's fault or the bundle's: the published `@gjsify/gtk-runtime-win32-x64` verified
clean (33 backed typelibs, `windowing=true`, decode probe green) and
`check-batteries.mjs` passed before the suite started.

Two things to fix, and they are separable:

1. **The table.** Either the generator marks a row's platform availability, or the
   table stops offering a class the running GTK does not have. This is the one that
   makes the win32 leg gating again — the step is `continue-on-error` with that as its
   printed retirement condition.
2. **The diagnosis.** Five of the six assertions die as a bare `TypeError: Cannot read
   properties of undefined (reading '$gtype')`, which does not say WHICH row. A
   conformance test whose subject is "the table vs the installed typelib" should report
   an absent class by name rather than dereference it — otherwise the next OS finding
   arrives as six anonymous type errors, which is how this one nearly did.

### Two `@gjsify/react-native` image vectors assert a POSIX path where GLib returns a native one

Measured by `gtk-os-suites.yml`'s win32 leg, 2026-08-31. `primitives/widgets.spec.ts`
gives `Image` and `ImageBackground` a `source: { uri: '/nonexistent-gjsify-vector.png' }`
and then asserts

```
expect(picture.file?.get_path()).toBe('/nonexistent-gjsify-vector.png')
```

On win32 both fail with `Expected: /nonexistent-gjsify-vector.png` /
`Actual: \nonexistent-gjsify-vector.png`.

**The assertion owns this, not the layer.** `src/components.ts` builds the file with
`Gio.File.new_for_path(...)` for a `path`-kind source, and `g_file_get_path()` is
documented to return the NATIVE path — so on Windows GLib normalising the separator to
`\` is the correct answer and the POSIX literal is the wrong expectation. The competing
reading, that the value should be compared as a URI (where `\` would be wrong), is
excluded by the code rather than by preference: the assertion calls `get_path()`, not
`get_uri()`.

Fix is one of: compare against a host-shaped expectation, compare `get_uri()` on both
sides, or use a relative fixture with no leading separator.

**This is the MIRROR of a class the repo already guards.**
`docs/code-anti-patterns.md` carries "a filesystem path SPLIT on `'/'` alone" with
`scripts/check-posix-path-slice.mjs` behind it, from #1143/#1148 where five live sites
were found. That guard watches path *slicing*; nothing watches a POSIX-shaped EXPECTED
VALUE, which is the same assumption on the other side of an assertion and equally
invisible from Linux. Worth a rule once there is a second instance — one is a fix, two
is a class.

### The darwin GTK bundles ship no `GIRepository-2.0` typelib; the win32 one does

Noticed while diffing the two published 0.45.0 closures for the entry above, and
independent of it — nothing measured so far needs the namespace, which is why it is a
line here rather than a defect.

Typelib counts are 47 on darwin-arm64 and 45 on win32-x64. All but four of the
differences are platform-correct (`GdkMacos-4.0` / `GioUnix-2.0` / `GLibUnix-2.0`
against `GdkWin32-4.0` / `GioWin32-2.0` / `GLibWin32-2.0`). The remainder:

| only on darwin | only on win32 |
|---|---|
| `AppStream-1.0`, `Xmlb-2.0`, `GDesktopEnums-3.0` | **`GIRepository-2.0`** |

`GIRepository-2.0` being present on win32 and absent on darwin is the asymmetric one.
Both builders share `typelib-backers.mjs` and neither names it in `REQUIRED_NAMESPACES`
or `WINDOWING_REQUIRED_NAMESPACES`, so it arrives — or does not — through each
platform's closure walk rather than by decision. A consumer that introspects the
repository itself from `gi://GIRepository` would therefore work on Windows and fail on
macOS, and no check would say so. Either both should carry it or neither should; deciding
which is a question for whoever owns the bundle contract.

### The `os-axis` candidate set cannot see a package whose DATA is OS-specific

Exposed by the entry above, and it is a gap in the rule rather than in a package.

`os-axis` derives who owes a `gjsify.os` from shipping source that READS the host OS —
`process.platform`, `os.platform()`, `@gjsify/utils/core`'s `hostOs()` and friends
(`packages/infra/manifest-conformance/lib/rules/os-axis.mjs`). That is the right
question for ADR 0018's original ten, all of which branch on the OS. `@gjsify/gtk-host`
reads the host OS **nowhere** — verified, zero matches across `src/**` — so it owes no
declaration and correctly has none. Its generated widget table is nevertheless
Linux-shaped, and a Windows host is missing two of its rows.

So the axis is blind in the same direction ADR 0018 says the RUNTIME axis is blind:
"never let one axis answer the other's question" is satisfied, and both still miss this.
A package whose TABLE is derived on one OS is exactly a package that owes an OS claim.

Not closed here because the honest fix is a second derivation signal, not a widened
regex, and picking one is an ADR-shaped decision: candidates could be derived from
"generates code from a platform-specific source" (which `gjsify.widgetVocabulary` and the
generator scripts already mark), or the claim could be demanded of any package a
GTK-bearing OS leg runs. Both are defensible; neither should be guessed at in a CI PR.
The measurement above is the evidence either would rest on.

### node-gi: a class nothing instantiated has no realised class, so `signal_lookup` finds zero signals

Measured 2026-08-31 while wiring `gtk-os-suites.yml`, differentially against the gjs
oracle (ADR 0030) on Fedora 44 / gjs 1.88.1 / Node 24.19.0, GTK 4.22 + libadwaita 1.9,
node-gi's published `linux-x64` prebuild:

| read | gjs | node-gi |
|---|---|---|
| `GObject.signal_lookup('popped', Adw.NavigationView.$gtype)` | 84 | **0** |
| `GObject.signal_lookup('hidden', Adw.NavigationPage.$gtype)` | 90 | **0** |
| the same reads AFTER any class-struct static (`…list_properties()`) | 84 / 90 | 84 / 90 |

One root cause, and `src/calls.cc` already names it in the header of
`ClassStructInstance`: gjs keeps the invariant that "the GType class is referenced at
least once when the JS constructor is initialized", so signals registered in
`class_init` are findable off `$gtype` with no instance; **node-gi's class proxy takes
no such ref**, so `g_type_class_peek` is null and the class is unrealised. That comment
was written about a DIFFERENT call path (which does `g_type_class_ref` and is why the
third row above passes), so the gap is documented and unclosed rather than unknown.

The fix site is the `$gtype` read, which is JS — `gi.js`'s `defineLazyGType()` resolves
through `native.getGType()` and caches, so one realisation per GType would match gjs's
invariant exactly and cost nothing after the first read. It has to be guarded on
`G_TYPE_IS_CLASSED`, which is why the honest place is `GetGType` in C++ rather than a
JS `GObject.type_class_ref()` call that would be wrong for every struct and enum.
Proof that the JS route closes it at all: `GObject.type_class_ref(gt)` from JS turns the
first row from 0 into 65 in the same process.

Costs one assertion in `@gjsify/react-native`'s suite today
(`router.spec.ts` → "emits `popped` on the view and `hidden` on the page"), which is one
of the two things keeping that package's step in `gtk-os-suites.yml` a probe rather than
a gate.

### `@gjsify/react-native`'s list spec asks for pspecs in a spelling only gjs answers

The sibling of the entry above, and NOT a node-gi defect — recorded together because
they were found in the same differential run and only one of them is the engine's.

`lists.spec.ts` → "binds rows into a Gtk.ListItem, which is not a Gtk.Widget" reads
`GObject.Object.list_properties.call(Gtk.ListItem)`. Under gjs that answers `array(9)`,
because `gjs_define_static_methods` puts GObjectClass's methods on `GObject.Object`'s
CONSTRUCTOR and `Function.prototype.call` re-targets them down the prototype chain.
node-gi resolves class-struct methods per type instead, so the same expression answers
`array(0)` — GObject's own property count — and the spec's `child !== undefined` is
false. Measured: `Gtk.ListItem.list_properties()` answers `array(9)` on BOTH runtimes,
and that is the spelling `@gjsify/gtk-host`'s own `paramSpecs()` already uses.

So this is a non-portable spelling in a spec, and the repair is the portable static.
Left to the owner of `packages/framework/react-native/src/**` rather than fixed here
because it does not unblock anything on its own — the entry above blocks the same step.

### 31 package scripts still open a clause with a `VAR=x` prefix, which cmd.exe has no form of

`portable-scripts` catches a POSIX UTILITY in command position and says in its own
header that it cannot see shell SYNTAX. That header also said "None is present in the
tree today"; counted 2026-08-31, 33 scripts carried a `VAR=x` prefix. Two of them were
load-bearing — `@gjsify/gtk-host` and `@gjsify/react-native`'s `test:gjs-on-node`, the
entry point `gtk-os-suites.yml` calls on a cmd.exe leg — and both now take the variable
from the environment.

The remaining 31: `@gjsify/node-gi` (10) and `@gjsify/napi` (11), neither a workspace
member and both driven only by their own Linux legs, plus 10 private `examples/`.
Widening the rule before they are fixed lands a check with a 31-entry exemption ledger,
which the rule's own header argues against having shipped once already. Fix the 21
published-package ones, then add the pattern.

### node-gi: two callable shapes diverge from gjs in calling convention, and their arity with it

Found by the `callable-arity` conformance probe while closing the gtk-host node
leg (which is now green, 1934/1934 on both runtimes, and CI-wired — see
node-gi.yml's `gtk-host-node` job). A materialized method's `Function.length`
is derived from the SAME skip pre-scan the invoke loop consumes JS args with,
so where the length diverges from gjs, the CALL SHAPE diverges — the length is
the messenger, not the defect:

- **`Gio.InputStream.read`** — a variable-length caller-allocates OUT array.
  gjs reports length 2 (you PASS the buffer to fill); node-gi reports 1 and
  cannot take a caller buffer (the caller-alloc path covers fixed-size C
  arrays and structs only, see the "size=0 defers cleanly" branch in
  calls.cc).
- **`Gio.MemoryInputStream.add_data`** — a GDestroyNotify with no closure
  index. gjs reports 1 (the notify is not JS-consumed); node-gi reports 2 and
  consumes a JS function for it.

Both are deliberately NOT pinned by `callable-arity` — pinning the length
without aligning the call shape would make the reported arity lie about the
invoke. Fix the calling convention first; the arity then follows for free from
the shared pre-scan.

One string/object leniency measured in the same pass and also left open:
node-gi accepts BOTH `null` and `undefined` as a NULL utf8/object IN arg,
while gjs throws `Expected type string … got type undefined` for `undefined`
everywhere and refuses `null` for non-nullable args. Every gtk-host call site
spells `?? null`, so nothing observable rests on it today; tightening it is
regression surface for consumers that pass `undefined` through optional
params, so it needs its own conformance program when it moves.

### node-gi: a declared-but-unimplemented vfunc reads as absent instead of throwing

gjs 1.88.1 THROWS `Virtual function not implemented` at the PROPERTY READ of
`vfunc_notify` on a plain instance whose class declares but does not implement
the slot; node-gi reports the member absent (`undefined`). Making that
faithful means throwing from inside the prototype's materialize trap — a
descriptor read that throws is real regression surface for `in`-checks,
spreads and devtools over every wrapper, in exchange for a corner no consumer
has hit. Recorded rather than fixed, deliberately: the divergence is kept out
of the conformance corpus (nothing pins the current behaviour as correct
either), and the day a consumer needs the throw, the place to add it is the
`vfunc_` branch of `makeClassPrototype`'s `materialize` (gi.js), gated on the
engine addressing the slot.

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

### The one-vocabulary goal is checked by NAME, not yet by BEHAVIOUR

ADR 0027 § 9 makes one widget vocabulary across native GTK, Blueprint/XML, TSX/JSX,
Vue templates and the web pillar's `adw-*` elements an explicit goal. **Its named
obstacle is gone**: `adwaita-web` adopted `[slot=]` children exactly once, in
`connectedCallback`, and adoption is now live through `src/slotted-children.ts`. A
renderer mutates its tree after mount by definition, so that was an upstream fix and
it landed upstream.

**The name-agreement mechanism now exists**: `scripts/check-vocabulary-alignment.mjs`,
a step of the required `Detect runtime-triplet drift` job. It holds the four generated
maps against the runtime table and the test-only surface data (four artifacts, three
files), refuses a dialect surface that stops deriving its element list from those maps
or spells a widget itself, and holds every `adw-*` custom element against the GTK tag
set. Measured at the time it landed: 164 GTK tags, 65 `adw-*` elements, 43 sharing a
spelling exactly, 10 declared as the same widget under another name, 12 declared
web-only with a reason. The gjsify half of ADR 0029 is what made it cheap; it does not
depend on the `@girs` subpath.

What the check deliberately does NOT prove is BEHAVIOUR. Agreeing on `adw-action-row`
as a name says nothing about the two renderers producing the same tree, and sharing one
outright is weaker still: `<gtk-check-button>` now IS the tag `GtkCheckButton` carries,
and nothing here asserts that it behaves like one.

The criterion that closes the GOAL out is in ADR 0027 § 9 and is unchanged: the same
authored tree, rendered through the GTK host and through `adwaita-web`, satisfies the
same `@gjsify/adwaita-core/conformance` vectors with no per-surface markup branch.
Until that is measured the goal stays a direction, not a claim — and the longer
horizon it points at (NativeScript and browser builds from one native-authored
source) needs its own ADR.

Two things the slot work left for whoever picks this up. **Ten of the 23 re-homing
elements are deliberately not converted**: eight consume typed children into a state
model (pages, sections, selection, roving focus) where going live changes semantics
and wants its own vectors, `adw-checks` routes conditionally on its `label`
attribute, and `adw-bottom-sheet` unwraps its wrappers rather than moving children.
And `bindEmptySections` derives SYNCHRONOUSLY, so it must run AFTER the router's
`install` — routing first hides a section a declared child had already earned, and it
only un-hides a microtask later, after `_syncClasses` has measured a bar at
`offsetHeight` 0. That cost 8 real failures once; the three call sites now say so.

### One vocabulary is a rule for EVERY surface — clause 3 holds on all three renderers

**ADR 0034 stages 2, 3, 6 and 4 have landed** (in that order, ahead of stage 1; the
re-priced order is in that ADR's § Amendment and § Amendment 2).
`scripts/check-vocabulary-alignment.mjs` now reads every surface that DECLARES itself one,
holds widget names on three renderers and property names on one, and prints, every run:

```
4 declared widget surface(s), every one of them read. 168 GTK tags …; 65 adw-* web elements
— 44 share a spelling, 10 alias one, 11 declared web-only; 46 @gjsify/adwaita-nativescript
widgets — 38 share a spelling, 6 should converge, 2 declared own, 0 undecided; 2
@gjsify/adwaita-react-native widgets — 2 share a spelling, 0 should converge, 0 declared
own, 0 undecided. Properties, on @gjsify/adwaita-nativescript only: 44 widgets with a GIR
counterpart set 143 settable propert(y|ies) between them — 91 already agree with the
counterpart's ConstructorProps, 52 do not (25 should converge, 27 declared own, 0
undecided). Distance to one vocabulary: 6 widget name(s) and 25 property name(s).
```

Every one of those numbers is derived at run time. None of them is written in the check's
header any more, because the count that used to sit there (`164`) was quoted into ADR 0034
after it had already drifted.

Where each stands:

| surface | GIR naming | namespace export | declared |
|---|---|---|---|
| `gtk-host` | holds by construction (`src/tags.ts:18`) | n/a | declares `role: reference` |
| `adwaita-web` | **holds** — the 10 that violated it took the GIR name (ADR 0034 § Amendment 5) | absent | **held** — 12 web-only declarations, each with a reason |
| `adwaita-nativescript` | 4 violate it; 2 more have no counterpart | absent | **held** — 8 widget entries + 52 property entries, `gir`/`composes`/`own`, each with a reason |
| `adwaita-react-native` | holds (`AdwBin`, `AdwClamp`) | absent | **held** — declared, read from the base barrel, empty ledger |

**Enrolment is a per-package declaration now, not a list in the gate.** `gjsify.widgetVocabulary`
(`{ "role": "reference" | "renderer" }`) on each of the four, joined to the readers in
`scripts/widget-surfaces.mjs`; `scripts/manifest-conformance/rules/widget-vocabulary.mjs`
claims the key so `field-coverage` accepts it and calls the same pure rule, so the manifest
gate and the vocabulary gate cannot answer differently. A fifth surface joins the rule by
declaring itself: a declaration with no reader fails, a reader whose package stopped
declaring fails, and a declared renderer no half of the check compares fails.

**The clearest instance is closed**: `gtk-host` said `<gtk-entry>` for Solid, Vue and
React alike while `adwaita-web` said `<adw-entry>` for the same widget, both on the same
gallery page under one block titled `Gtk.Entry`. They differ in render target (GTK vs DOM)
and not in what the widget is, and both now spell it `<gtk-entry>`. What is left of clause
1 is the NativeScript port's six.

**[ADR 0034](../docs/adr/0034-widget-vocabulary-convergence.md) proposes the cut** — the
rule stated once and surface-neutral (named from the GIR · exported as a namespace · every
divergence declared with a reason), convergence with a DECLARED remainder rather than a
bijection, and the namespace as a re-export layer rather than a rename.

**The staging followed the cost curve, and the term that ordered it has expired.** ADR 0034
put React Native first because it had zero published versions and would acquire the
NativeScript rename's cost at the next cut. **It published at 0.44.0 on 2026-08-30T07:13:40Z**
(`npm view @gjsify/adwaita-react-native time --json`), so nothing is rising any more and
the ordering no longer follows from anything. Re-measured that morning: `adwaita-web` 137
versions / 5 006 downloads a month / 11 in-repo import sites; `adwaita-nativescript` 49 /
3 598 / 49 TS + 28 XML files; `adwaita-react-native` 1 / **no download record at all** (the
point endpoint 404s for a package published that morning — not a measured zero) / 0 import
sites outside the package.

**Stage 1 is down to its namespace export, and is still worth doing**, which is exactly the
risk ADR 0034 § Risks named ("the cheap stage is skipped because it is the least
urgent-looking"), so it is written down here with its price rather than left to be
re-derived. Stage 4 took the other two thirds: React Native declares itself a surface, its
widget set is read from the base barrel's `export { Adw… } from './widgets/…'` lines, and
its (empty) `RN_WIDGET_ALIGNMENT` is held against the GIR tag table. What is left is clause
2, the `Adw` namespace export. What stage 1 no longer buys: the guarantee that the rule
costs that package nothing it can ever undo. Both its names are already correct, so no
rename is in it at any price.

One thing whoever picks this up should not re-derive: `collectAdwaitaCoverage`
(`scripts/generate-status.mjs:223-225`) joins the renderers on the BARE name and says the
vocabularies agree on it; that join is true only because they all flattened, so any rename
has to carry it or the widget matrix grows false gaps. (The other one — that
`WEB_ELEMENT_ALIGNMENT`'s `gtk:` entries carried no reason field — is closed: all ten now
carry one, eight moved from the element headers and two derived from `generated/props.ts`
and the storybook coverage ledger, and an alias with no reason is a failing rule.)

**Two things ADR 0034 measured but deliberately did not change.**

*The docs file GTK widgets under an Adwaita heading.* `website/` has one top-level widget
section, `Adwaita`, and no `Gtk` one. `controls.mdx` carries **zero** `Adw.*` gallery
blocks and two `Gtk.*` ones; `buttons.mdx` carries 3 and 2. The section's own rename
comment (`website/astro.config.mjs:18-20`) already argues the rule — name it after the
thing that owns it, *"beside it rather than under it"* — and its premise ("only ever
covered Adwaita") has stopped holding. ADR 0034 stage 5: a `Gtk` section beside `Adwaita`,
`controls.mdx` moving whole, redirects the way the `/widgets/*` rename already did.

*Stale hand-written widget counts.* `grep -c "gtype: '" …/generated/widgets.ts` is **168**;
`164` (the count before ADR 0028's 2026-08-28 amendment admitted placement carriers) still
stands in `docs/adr/0028-widget-table-provenance.md:322,333` and
`packages/framework/AGENTS.md:66` — in a sentence that itself warns *"a literal here
drifted twice"*. The third site, `scripts/check-vocabulary-alignment.mjs:37`, is fixed: the
header carries no count at all now and the summary line derives every number it prints.
(`status/open-todos.md`'s own 164 above is framed "at the time it landed" and is fine.) The
GENERATED header is NOT drifted, and the constant 4-wide gap between it and
`grep -c '^export interface '` is not an off-by-four bug: `emit-types.mts:144` emits
`model.declarations.size` (194) and the file additionally emits four tag maps
(`WidgetPropsByTag`, `WidgetPropsByGType`, `WidgetPropsVueAliases`, `WidgetClassByTag`)
that the header's own sentence already excludes. 198 - 4 = 194, and the same subtraction
held at the previous revision (190 + 4). One real generator nit beside it: that header says
*"the **two** tag maps"* while it emits four — a one-word fix in `emit-types.mts`, worth
its own PR rather than a docs change.

*How this was nearly got wrong.* Both wrong readings came from a shared checkout sitting 43
commits behind `main` (branch `chore/refs-metro`), which reported 190/164 where `main` says
194/168. Every count in ADR 0034 now states where it was read, and the `@girs` type-surface
numbers pin `@girs/gtk-4.0@4.1.0` — `^4.1.0` resolves to 4.3.0 today and the counts move.

**A stronger oracle, priced, for whoever wants one.** `@ts-for-gir/lib` exports
`src/index.ts` with no build step (ADR 0019 § 1) and re-exports `./gir/index.ts` +
`./gir-module.ts`, so a gate could parse the `.gir` directly instead of reading our emitted
types — a second READER of the same source, not a second source, and it needs
`node_modules`, so it belongs in `tree-checks`. Shipping the `.gir` inside `@girs/*` is
already rejected by ADR 0019 § 2 (*"never with the type package"*), and the numbers back
it, with the denominator from the registry: `@girs/gtk-4.0@4.1.0` unpacks to 5.86 MB (4.3.0
to 6.12 MB) against a `Gtk-4.0.gir` of 6.20 MB, so bundling roughly doubles the package;
705 `.gir` files / 379 MB across a full pool. The capability is still real — nicks live only in the typelib and
documentation only in the XML — so if it is wanted the shape is a companion artifact and
the venue is `gjsify/ts-for-gir` (`gjsify/types` has issues disabled; no existing issue
found).

**Stage 6 prints the property distance now, and re-measuring moved it.** The figure this
section used to carry — 42 widgets, 137 settable properties, 92/45, split 16 with a
candidate spelling and 29 without — came from the TypeScript compiler API over
`@girs/gtk-4.0@4.1.0`. The gate reads the in-repo `generated/props.ts` instead, as stage 6
specifies, and counts what each widget CLASS declares settable: **44 widgets, 143
properties, 91 agree, 52 do not, 25 with a machine-checked convergence target and 27
declared `own`**. Three deliberate differences produce that, and ADR 0034 § Amendment 2
holds the table: the counterpart set grew because stage 3's ledger gave `AdwIcon` and
`AdwImageButton` one; "settable" is `set <name>(` in the widget's own class body, so a
read-only accessor like `AdwEntry.textLength` counts on neither side; and a "candidate
spelling" is now an entry whose target must be a key of that counterpart or the gate fails.
Re-run the gate before quoting any of it.

**What is still not measured**, said here because the printed line names one surface for
exactly this reason: `adwaita-web`'s attribute vocabulary and `adwaita-react-native`'s prop
types are two further property corpora with no ledger. Neither is hard in the way the
NativeScript one was — the shape is decided — but both are larger, and a distance printed
without its surface is a claim wider than its measurement.

A full `tsc` conformance check remains the right oracle on the wrong instrument —
`Gtk.Entry` is 509 members, and the gate job runs `checkout` + `setup-node` with no install.

### The `@girs/*` widget surface exists but gtk-host cannot consume it yet

ADR 0029 moves the GIR-derived widget vocabulary to `@girs/<ns>/surface`. The
ts-for-gir half is implemented and landed there (generator in
`packages/generator-typescript/src/surface/`, gate in `tests/widget-surface`). The
gjsify half — deleting `gtk-host/src/generated/props.ts`, replacing it with the
consumer dialect, and repointing `generated.spec.ts` at the published runtime data —
is blocked on a RELEASE, and is not attempted here rather than faked.

**What exactly is missing, and how to tell it has arrived.** `@girs/gtk-4.0@4.1.0`
(the installed version, and the newest published) has four `exports` keys: `.`,
`./ambient`, `./import`, `./gtk-4.0`. The subpath is a fifth.

Ask the REGISTRY, because that is the question — the local `node_modules` can be stale
either way:

    npm view @girs/gtk-4.0 exports --json

Or the installed copy, read as a FILE. Note what does not work and why: `require(
'@girs/gtk-4.0/package.json')` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`, because the
package does not export `./package.json` and asking a package about its own `exports`
through `exports` is circular — a probe that fails identically before and after the
release answers nothing:

    node -e "console.log(Object.keys(JSON.parse(require('node:fs').readFileSync('node_modules/@girs/gtk-4.0/package.json','utf8')).exports).join(' '))"

When either prints `./surface`, and the file it names carries a `Widgets` interface plus
the runtime constants (`OWN_PROPS`, `OWN_SIGNALS`, `DECLS`, `ENUM_NICKS`,
`SLOT_CANDIDATES`, `SINCE`), migration steps 3–5 of ADR 0029 § Implementation can
start. Until then a consumer-side branch could only resolve against a local
ts-for-gir checkout, which is not something CI can reproduce.

**Who unblocks it, and in what order.** Re-measured 2026-08-26: still four keys, so
nothing below has happened yet. The whole chain hangs off ONE human action in the
ts-for-gir repo — everything after it is automatic, and none of it is a gjsify action:

1. **A ts-for-gir maintainer cuts a release** from `main` on a clean tree
   (`yarn release:stable`; release-it has `requireBranch: main`). ts-for-gir is at
   4.1.0 and tag `v4.1.0` already exists, so the surface — merged as ts-for-gir#438
   on 2026-08-26 — is UNRELEASED code. #438 is a `feat`, so the cut is 4.2.0.
   `.release-it.json` has `npm.publish: false`; the cut only tags and opens a GitHub
   release.
2. The `release: published` event fires `release-types.yml`, which runs
   `build:types:release` and pushes the regenerated `@girs/*` to `gjsify/types@main`.
   Nothing needs enabling: the config it uses, `.ts-for-gir.packages-all.rc.js`, already
   sets `widgetSurface: true`, and `packages/templates/templates/package.json` emits the
   `./surface` key conditionally on `girModule.hasWidgetSurface` — so the key appears for
   the namespaces that declare a concrete `GtkWidget` descendant and nowhere else.
3. That push fires `gjsify/types`' own `Release CI` (`on: push: branches: [main]`),
   which publishes every `@girs/*` to npm. This is the step that makes the subpath
   installable, and it is triggered by the push rather than by the release — so a cut
   whose `release-types.yml` leg fails publishes `@ts-for-gir/*` and NO new `@girs/*`,
   which looks like a successful release from the tag.
4. Probe again. `npm view @girs/gtk-4.0 version` must read 4.2.0 AND
   `npm view @girs/gtk-4.0 exports --json` must show the fifth key. Both, because
   step 3 is where the two can come apart.

Only then do ADR 0029 steps 3–5 become gjsify work. Nothing here is a gjsify PR, and
there is no partial version of it worth landing first: a consumer-side branch pinned to
a local ts-for-gir checkout is not something CI can resolve.

**The same release retires a second thing.** `checkTypeSkew` in
`packages/infra/cli/src/utils/check-system-deps.ts` carries `isDegenerate()`, which
detects `@girs`' namespace-version-as-release fallback — the value ADR 0019 Decision 3
removed in ts-for-gir#436, also unreleased. Once a released `@girs` omits
`libraryVersion` where the library declares none, that detector is reading for a shape
that can no longer be published, and it goes away rather than moving anywhere.

**Two things to pin when it does arrive.** The `@girs` version must be EXACT, not a
caret: `@gjsify/gtk-host` declares eight `@girs/*` packages at `^4.1.0`, and a minor
`@girs` release moving the surface under a lockfile-less install is the hazard ADR
0029 § Risks 1 names. And `@girs` carries two cadences — package `version` 4.1.0 and
`libraryVersion` 4.23.0 — so the pin is on the former.

**One measured shape difference to expect in the diff, not a bug.** `props.ts` widens
every object-typed property with `| null`; the `@girs` surface prints the nullability
GIR states, because it reads the same model the main emitter does. Measured against the
generated Gtk-4.0 surface: **12 of its 418 dashed keys** — `action-target`, `cell-area`,
`cell-area-context`, `pointing-to`, `page-setup`, `print-settings`, `accel-size-group`,
`title-size-group` and the four `primary-`/`secondary-icon-gicon`/`-paintable` keys. So
the migration will surface fixtures that pass `null` to a property GIR does not mark
nullable. That is a real narrowing and wants a decision — widen in the consumer dialect,
or fix the fixtures — rather than a silent cast.

### What else could move to ts-for-gir, and the line that decides it

Asked directly: ts-for-gir is meant to be used as a LIBRARY (ADR 0019), ADR 0029 just
moved the widget vocabulary there, so what else in gjsify is really ts-for-gir's? Audited
2026-08-26 across every module in this repo that carries introspection knowledge. Code
lines exclude comments and blanks, because several of these files are 60 % comment and
counting prose measures the incident record, not the coupling.

**The line, stated once so it does not have to be re-argued per file.** ts-for-gir knows
**GIR as XML**: it parses `.gir` files headlessly, in CI, with no GTK installed and no
typelib loaded. gjsify knows **GI as a loaded runtime**: which libdir girepository will
search, what `gi://Gtk?version=4.0` resolves to on this host, whether the installed
library actually has the member the types promise. Everything below sorts cleanly on that
one question, and the sort is not a judgement call — a module that needs an installed
library cannot move to a generator that runs without one.

**Moves — and it is all one thing, already decided.** ADR 0029 steps 3–5, blocked on the
release above:

ADR 0029 § "The seam, measured" owns the per-module counts and they are not restated
here. What this audit adds is the second, different question — not "how many lines are
GIR-generic" but **"how many lines mention gjsify at all"**, which is what decides
whether a module can compile somewhere else:

| module | code (ADR 0029) | lines referencing gjsify | what holds it here |
|---|---:|---:|---|
| `generator/gir.mts` | 249 | 1 | `import { DOMParser } from '@gjsify/domparser'` |
| `generator/surface.mts` | 196 | 0 | nothing — imports only its two siblings |
| `generator/tsmap.mts` | 100 | 8 | the `@girs/*` package table, and see below |
| `generator/mini.fixture.mts` | 59 | 0 | nothing |
| `generator/emit-types.mts` | 156 | 5 | `tagOf` + the emitted `../attrs.js` import |
| `generator/emit.mts` | 103 | 0 | the runtime table is gtk-host's MODEL (ADR 0028 § 1) |
| `generator/main.mts` | 128 | 3 | `CURATED_DESCRIPTORS` + `methodsOf` wiring |

Read the two questions together and the split is sharper than either alone. The first
four modules are a closed subgraph — 604 code lines whose only edge outside `generator/`
is a single XML-parser import — while `emit.mts` mentions gjsify **nowhere** and still
must stay, because ADR 0029's own column shows only 13 of its 103 lines are GIR-generic:
it is gtk-host's model expressed in pure TypeScript. A module can be free of gjsify
imports and still be entirely about gjsify.

`tsmap.mts`'s 8 lines are worth naming separately, because they are the one case where
the reference points the other way: `GIRS_PACKAGES` maps `Gtk` → `@girs/gtk-4.0`, which
is **ts-for-gir's own naming convention, written down on the wrong side of the
boundary.**

**Does not move, and the reason is the same reason each time.** These read as candidates
because they are full of GI vocabulary, but every one of them needs something a headless
generator does not have:

| module | code | GIR-generic | why it stays |
|---|---:|---:|---|
| `gjs/utils/src/system-gi-dirs.ts` | 44 | 43 | `<libdir>/girepository-1.0` layout — a typelib-LOADING rule |
| `infra/cli/src/utils/system-gi.ts` | 77 | 77 | same rule, plus `DYLD_FALLBACK_LIBRARY_PATH` composition |
| `node-gi/node-gi/system-gi.js` | 70 | 70 | same rule, third copy |
| `infra/cli/src/utils/gi-typelib.ts` | 80 | 80 | finds `Ns-Ver.typelib` on this host |
| `node-gi/scripts/typelib-backers.mjs` | 170 | ~155 | parses the typelib BINARY header; ts-for-gir never opens one |
| `parseGiSpecifier` (two copies) | 9 + 13 | 22 | `gi://` is a GJS import specifier, not a GIR concept |
| `node-gi/src/repo.cc` | 245 | — | N-API binding; `gi_repository_require` IS the runtime |
| `gtk-host/src/conformance/`, `registry.ts` | 165 + — | 0 | walks the LIVE GObject type system, not GIR |
| `docs/gnome-mappings.md` | 12 | 0 | which GNOME lib backs which Node/Web API — a polyfill choice |

**One of those rows is a latent bug, found while sorting them.** `parseGiSpecifier`
exists twice under the same name with DIFFERENT accept sets:
`packages/infra/cli/src/utils/ship/gi-namespaces.ts` validates the namespace against
`/^[A-Za-z][A-Za-z0-9_]*$/` and returns `Ns-Version` as one string;
`packages/infra/rolldown-plugin-gjsify/src/plugins/gjs-gi-node.ts` only checks
non-empty and returns `{ namespace, version }`. So `gi://9Foo` is rejected by the
first and accepted by the second, and the second is the one on the BUILD path — it
would emit a `requireGi('9Foo', …)` shim for a specifier the ship path refuses to
declare a `Depends:` for. Both are Tier 1, so a shared home is legal; it needs a
decision about which accept set is right (the validating one, on the evidence that
GObject namespaces are C identifiers) rather than a mechanical lift. Not done here:
this audit was about the ts-for-gir boundary, and consolidating these is on the other
side of it.

`generated.spec.ts` belongs in this second list for the sharpest version of the reason:
it asks the *installed* typelib whether every emitted name is real. ADR 0029 § Consequences
already fixed it here, and that is what forces the surface to ship runtime data beside the
types.

**Three of those rows are a real duplicate, and ts-for-gir is not its home.**
`systemGiLibraryDirs()` exists three times because ADR 0005 Decision 2 forbids a Tier-1
package a `dependencies` edge on `@gjsify/node-gi` — a tier rule, not a technical
obstacle. The already-tracked fix (§ "`systemGiLibraryDirs()` lives in two places") is a
shared `@gjsify/system-gi`, and it stays right: the rule is about loading libraries.
Answering "can it move to ts-for-gir" with yes would export a runtime concern into a
generator to dodge a tier rule.

**The dependency-direction check, per ADR 0019, and one finding.** ADR 0019 Decision 1
keeps ts-for-gir build-step-free — `@ts-for-gir/lib`'s `exports` is literally
`{".": "./src/index.ts"}` — so a published `@gjsify/*` package taking a
`dependencies` edge on it would hand raw TypeScript to every consumer. Today all SEVEN
published `@ts-for-gir/*` edges in this repo are `devDependencies` on `@ts-for-gir/cli`,
which is the sanctioned seam; `@ts-for-gir/lib` itself appears only under the private
integration test, which declares no tier and publishes nothing.

Two things follow, and the first is the good news:

- **The prize costs no new dependency edge at all.** The surface arrives as generated
  `@girs/*` — `.d.ts` plus a runtime `.js` — and `@gjsify/gtk-host` already declares
  eight `@girs/*` packages. It is Tier 3, so the tier rule constrains it least of
  anything here. ADR 0029 steps 3–5 add zero `@ts-for-gir` dependency.
- **The rule that would catch the mistake does not exist.** `tier.mjs` collects only
  `dep.startsWith('@gjsify/')`, so an external `@ts-for-gir/*` edge in `dependencies` is
  invisible to it, and no other manifest-conformance rule inspects external dependency
  names. ADR 0019's boundary is discipline-only today. Closed in this change by extending
  the rule that already special-cases one package by name.

### An adopted composite offsets by its own internals

Surfaced while reviewing the Solid/Vue adapters, pre-existing in the host rather than
introduced by them, and recorded with the measurement rather than shipped quietly. Its
sibling — a removed element child not restoring the text it displaced — is FIXED; this
one is not, because its fix needs a curated descriptor field and a measurement round of
its own.

A fresh `Adw.PreferencesPage` has one direct child, its internal `GtkScrolledWindow`, so
`adopt()` records `foreign.length === 1` and every subsequent `index` is off by one.
Measured on gtk 4.22.4 / libadwaita 1.9.3: `mountRoot` into an `AdwPreferencesPage`,
insert a group "one", then prepend "zero" before it, and GTK renders **[one, zero]**;
the identical tree in a NON-adopted page renders **[zero, one]**. Exit 0, zero
diagnostics. Reachable from any `<For>`/`v-for` that prepends into the canonical Adwaita
settings page. Adder slots that are NOT composites are fine — an adopted
`AdwToolbarView` still renders `[app bar, host bar]`.

**Located.** `adoptedChildren()` (`src/host.ts`) branches on
`setterSlots(descriptor.children)`: with setter slots it asks each slot's GETTER, which
is why the one-child case is right, and with none it falls through to
`directChildren(container)`, a raw child-list snapshot. `AdwPreferencesPage` has no
setter slot, so its internal `GtkScrolledWindow` is counted as application content. The
second half of the bug is what the index MEANS: `Adw.PreferencesPage` is one of the few
Adwaita containers that really has `insert`, and its `position` addresses the page's
GROUPS, not its direct children — so a `foreign` of length 1 offsets every position by
one.

The shape of the fix follows, and it is a CURATED discriminator rather than a derived
one. For a container whose adder re-parents into an internal, the direct children are
never adder-addressed content — and nothing introspectable says which containers those
are, because the internal child comes from a `.ui` template. So it is a new descriptor
field in the ADR 0028 § 2 sense (what the GIR cannot express stays curated), plus the
measurement of which of the 26 curated containers need it. Deriving it by adding a probe
child and reading `get_parent()` back would mutate the very container being adopted,
which belongs to the application.

### Nothing runs `build:infra` on a cold tree with no `node`

The bootstrap ADR 0002 documents — `gjs -m install.mjs` → `gjsify install
--immutable` → `gjsify run build:infra` — used to die at its THIRD step on a host
with no `node`, from a fresh clone. Measured 2026-08-19 on postmarketOS v26.06 /
aarch64 (OnePlus 6T, gjs 1.88.1, musl, no node) against `3ad411530`, in a
`git worktree` with no `lib/esm` anywhere:

    gjsify run --node-script: failed to bundle …/create-gjsify/scripts/process-template.mjs
    [@gjsify/create-app] gjsify run build exited with code 1

**Mechanism, and why the defect is closed.** `@gjsify/create-app`'s `build` runs
`node scripts/process-template.mjs`. With no `node`, `ensureGjsifyShimOnPath()`
re-enters the CLI as `gjsify run --node-script`, which bundles the script
`--app gjs` under `--globals auto` — and auto-globals RESOLVES a
`@gjsify/<pkg>/register[/…]` subpath per injected global (`--verbose` prints
`closure map expanded 1 → 21 global(s)` for a one-line `export {}` entry, spanning
`web-globals`, `abort-controller`, `buffer`, `web-streams`, `dom-exception`,
`formdata`, `perf_hooks`, `webcrypto`). In a cold clone the workspace copies have
no `lib/esm`, so every injection was unresolvable and `unresolved-workspace-import`
(correctly) failed the build. #1232 closed that: a TOOLCHAIN bundle now falls back
to the CLI's OWN directory once workspace resolution returns null. All 23 register
packages sit in `@gjsify/cli`'s transitive dependency closure, so a self-contained
install can answer — checked against `~/.local/share/gjsify/global`, where all 23
are present and built.

**What is still open is the MEASUREMENT.** No suite executes that third step.
`bootstrap-cold-tree` asserts the `--print-plan` BRANCH and exits without
spawning; `node-free-bootstrap` covers the install and a manifest invariant;
`node-script-cold-workspace` (#1232) drives the real `--node-script` path against
ONE planted unresolvable package rather than a whole cold tree. Every CI host has
`node`, so these scripts run natively and are never bundled at all. Until a leg
really runs `build:infra` on a tree with no `lib/esm` and `node` off PATH, the fix
is argued rather than observed — and the failure returns unseen.

It is worth recording what this is NOT, because both wrong turns were taken once.
It is not a `build:infra` ORDERING bug: `create-app` is merely the first
`node scripts/*.mjs` the chain reaches, and the same failure hit
`check-refs-pin.mjs`, so `build:prebuilds` could not start either. And it is not
fixable by dropping the EXPANDED half of the closure set — `auto-globals.spec.ts`
("closure-map expansion vs generator bypass") pins that the expansion is a seed the
pure iterative loop reaches anyway, so an expanded global is one the injected
register genuinely references. Dropping it trades a build error for a runtime
`ReferenceError`.

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

### What `check-doc-fences.mjs` cannot see on an Adwaita doc page

The fence gate now compiles every `blueprint` block, resolves every glyph identifier
and icon name, and refuses an `adw-` class no stylesheet declares — four arms, all
A/B-proven, and the slot rule proven in BOTH directions (a web-only glyph fails in a
`gjs` slot and passes in a `web` one). Three classes from the same audit sit outside
it, and the honest answer for each is different:

- **Whether a preview is INTERACTIVE.** `navigation.mdx` says "click **Open contact**
  to push the detail page"; the button carries no handler and `<gtk-button>` has no
  action attribute. It needs a browser to see, so no cheap static gate exists. The
  storybook wires it in JS (`navigation-view.web.ts:63-65`) and that line was dropped
  when the sample was written. The bottom sheet's "Toggle sheet" button had the same
  shape plus a `data-adw-toggle-open` attribute NOTHING in the repository read — one
  grep hit, the doc itself — and that one is gone: the preview markup is now the
  snippet, so a dead attribute would have been shipped to every reader who copied the
  tab, and it was deleted rather than documented.
- **Whether the remaining surfaces build the SAME widget set.** The `web` fence is
  gone — the preview's own markup is what the browser window shows, so preview and
  markup can no longer disagree, and `check-website-adwaita-gallery.mjs` arm 8 refuses
  a second copy unless it is ledgered (one is: `Adw.Toast`). What is left is the four
  remaining surfaces: markup, `@girs` TypeScript, Blueprint, NativeScript. A
  per-`<AdwWidget>` reader could compare the tag/class set each fence constructs and
  demand a ledger line for a difference — that catches the counts (the Preferences
  Group block builds three rows in its markup and its Blueprint, two in its TypeScript
  and its NativeScript) but not semantics: nothing static sees that
  `Adw.Clamp { maximumSize: 400 }` under a child with `widthRequest: 520` cannot
  demonstrate clamping, because the child's own minimum raises all three thresholds
  to 520.
- **Prose that inverts a shipped behaviour.** `layout.mdx` had the clamp's tightening
  region backwards; upstream tightens ABOVE the threshold. There is no gate for a
  sentence. What IS reachable is the subset the ELEMENTS already mark themselves:
  `MODIFICATION:`, `DEVIATION:` and `DELIBERATE DEPARTURE` appear in the sources, and
  requiring each to be named on the page documenting that widget would hold five or
  six of them — the same decision/gap ledger `check-storybook-widget-coverage.mjs`
  already runs, one level down from widget presence to widget behaviour.

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

### `gjsify ship --sign`: three things M6 did not prove, each with what WAS measured

The signing interface landed whole (ADR 0024 § A12-§ A17) and its darwin half is
proven ad-hoc in CI with no certificate anywhere. Three gaps are left, and each is
here rather than in a comment because each has a plausible wrong answer:

1. **Windows is UNVERIFIED.** `signtool` has no ad-hoc mode, so the flag, the
   config default, the loud skip and every refusal are covered while the
   INVOCATION has never run. `SIGNERS.win32.args` is unit-tested and that is all
   it is: an argv nobody has executed. § A5 already records that Gatekeeper
   genuinely blocks while SmartScreen only WARNS until per-file-hash reputation
   accrues, signed or not — so the cost of the gap is smaller here than the
   darwin one would have been, which is why it is a gap and not a blocker.
   Closing it needs a certificate on a Windows runner and nothing else.

2. **Notarisation has no end-to-end run**, for the reason § A17 makes M6 possible
   at all: it needs an Apple account, and ad-hoc signing does not.
   `--notarize <keychain-profile>` builds
   `xcrun notarytool submit --keychain-profile <p> --wait <artifact>`, the guard
   tests exactly the value that line reads (§ A15's rule, as a unit test), and
   the two refusals are e2e-covered. What has never happened is the submission.
   The App Store Connect API-key form is NOT implemented: measured on `refs/node`
   at the pinned `0618e9f0`, `--key-id`, `--issuer` and `store-credentials` return
   0 files each against a control of 16 files for `codesign`, so there is nothing
   to copy and § A15 says not to invent a spelling.

3. **Stapling is not implemented, and NOT because it is unevidenced.** The same
   measurement finds `stapler` in 4 files, one of them real code —
   `refs/node/tools/osx-notarize.sh:58`, `xcrun stapler staple "node-$pkgid.pkg"`,
   three lines past where § A15 stopped quoting. What is unmeasured is whether it
   accepts OUR container: the reference staples a `.pkg`, and the only
   file-shaped darwin artifact `gjsify ship` produces is a `.zip`. Whoever has a
   notarised artifact in hand should measure that and then either add the call or
   write down why a zip cannot carry a ticket.

Two more things deliberately left where § A16 left them, and neither is a defect:
the `.app` BUNDLE is not sealed (the payload round trip carries bytes and mode and
no extended attributes, so a bundle seal over a script main-executable would not
survive into the zip), and no entitlements or `--options runtime` are passed
(§ A16 has not measured library validation either way). Both are stated on
`utils/ship/signing.ts` with their reasons.

### ADR 0024 §8, second half: `gjsify flatpak <sub>` + `generate-installer` move under `ship`

The FORMAT half is DONE (stage 6): `gjsify ship --target flatpak` builds a bundle
out of the staged payload, its module is `buildsystem: simple` + `cp -a stage/.`,
meson is gone from the sandbox, and the six `gjsify.flatpak` BUILD keys have their
deprecation window into `gjsify.ship.flatpak`. **Do not redo any of that** — the
window, what is deliberately NOT in it, and the measured flatpak-builder facts are
`docs/ship-formats.md`.

What is left is the COMMAND rename, which turned out to be independent of the
format: `flatpak ci`, `deps`, `sources`, `diff`, `release` and `sync-flathub` are
Flathub-submission tooling with nothing to do with a staged payload, so moving
them buys consistency with the website's channel table and costs an alias.

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

One cost §8 names and this must still pay:

- `gjsify flatpak …` is in published releases and in the Flathub sync automation,
  so the old command path needs a warning ALIAS, not a removal.

Already done, so do not redo it: the AppStream and desktop-entry renderers moved
out of `commands/flatpak/scaffold.ts` into `utils/app-metadata.ts`, and
`ConfigDataFlatpak` extends a shared base (§8's "the metadata half is the app's,
not Flatpak's"); the runtime/SDK/finish-args resolution moved to
`utils/flatpak-runtime.ts` when `ship` became its second caller; and the
`gjsify.flatpak` config-key window exists. What that window does NOT cover, on
purpose, is the toolchain keys these very subcommands read — `lockfile`,
`ciContainer`, `ciBranches`, `flathubRepo`, `modules`, `extraModules`, `command`.
Deprecating them before their commands moved would warn on every invocation of a
command with nowhere else to read from, so they are this item's job, not the
format's.

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

### 83 scalar GIR properties no `adw-*` element observes yet

`<adw-alert-dialog>` shipped observing FOUR attributes while `Adw.AlertDialog` carries
eight own properties, and the website's widget table — which reads `observedAttributes` —
truthfully rendered "takes 4 attributes". The DOC was right and the ELEMENT was short.
Nothing compared the two, which is why the gap survived: `check-vocabulary-alignment.mjs`
settles which element NAMES which widget and stops there.

`scripts/check-adwaita-element-properties.mjs` closes the mechanism half. A synthetic twin
of the shipped 4-of-8 element is a self-test VECTOR, so the pin survives the real element
being fixed — a regression test that reads the fixed source proves nothing once it is
fixed.

Two classes are excluded, measured rather than assumed, because a rule with a high
false-positive rate gets disabled and then protects nothing: **271 signal props**
(`on-clicked`, `on-notify-*`; a custom element dispatches events, and an `on-*` attribute
is the inline-handler shape nobody wants) and **47 widget-valued props** (`child`,
`content`, `extra-child`, `title-widget` — slots, since an attribute cannot carry a
widget).

**ENUMS ARE IN SCOPE, and getting that wrong was the first version's own bug.** The
generator spells an enum property `AdwToolbarStyleNick | Adw.ToolbarStyle`, so a namespace
test reads it as object-typed and drops it. A nick is a STRING. 24 enum properties are in
scope; 17 are already observed as attributes today, which is the proof they belong. The
first draft excluded them and hid 14 real gaps behind a justification that did not apply.

The same draft carried a second silent hole worth recording, because it is the
unrepresentative-fixture class: its interface-head reader required a literal space after
`extends`, and the generator wraps long heritage lists onto the next line. **65 of 190
interfaces had no body**, and an element whose body is missing was skipped as unmapped —
so eight elements (`adw-action-row`, `adw-spin-row`, `adw-entry-row`, `adw-expander-row`,
`adw-carousel`, `adw-button-row`, `adw-password-entry-row`, `adw-window`) passed by being
INVISIBLE, and the summary line read "35 elements hold their properties" while the honest
number was 35 of 43. Both shapes are fixture vectors now.

**What remains: 83 scalar properties across 28 elements**, listed in the check's
`KNOWN_GAPS`. They are listed rather than individually justified, deliberately — inventing
83 rationales would be worse than naming none, because a rule without its real reason gets
"simplified" back into the bug. What the list buys today is the RATCHET: a new gap fails,
and closing one fails too until it leaves the list, so the number can only go down.

The worst three are `adw-wrap-box` (13 — its whole layout surface; it observes NO
attributes at all), `adw-about-dialog` (11 — the credit-list and release-notes surface)
and `adw-header-bar` (6 — `show-title`, `show-back-button`, `centering-policy` and the two
title-button toggles). Those three are 30 of the 83 and are the obvious first pass. Each
needs its own decision: some are genuinely missing attributes, and some are properties a
web element is right to expose another way (`artists`/`developers` are string LISTS, which
an attribute carries badly). The check does not pretend to know which; it makes the
question visible.

### `systemGiLibraryDirs()` lives in three places, pinned by a test rather than shared

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

### `showcases` is 193 comment lines over its ceiling, and always was

`check-comment-budget.mjs` globbed `'*.ts' '*.mts' '*.mjs' '*.js' '*.cjs'` — a list
written before this tree had a `.tsx` file in it — so it never opened the 19 tracked
ones. Reading them changes two rows, and both numbers are what those trees have had all
along:

- **`showcases` 0.153 → 0.170** against a ceiling of **0.158**, which had been printing
  78 lines of SPARE. Seven files: the four host-counter / gallery apps and the three
  `rn-design-system` modules, 2434 code lines carrying 657 comment lines.
- **`packages/framework` 0.344 → 0.352** against 0.244. Already over before; the 12
  `gtk-host/type-tests/**` files add 114 code lines and 402 comment lines, a ratio of
  3.5 — a type-test is mostly prose about what `tsc` has to reject, which is the material
  a whole-tree ratio suits least.

**The ceiling was not raised, and `--update` cannot raise it** (it writes
`min(stored, measured)`). The gate REPORTS rather than gates: `--warn`, which is what CI
runs, exits 0 over an above-ceiling tree, so the honest number is what landed and
`showcases` now raises an Actions warning it did not raise before. Closing it means
cutting genuine restatement in those seven showcase files, or deciding a showcase's job
IS to be commented and saying so in a reviewed ceiling change. Not by moving full-line
comments onto code lines — the script's own header records that ~1670 trailing comments
are already invisible to it, so that direction buys a number and no clarity.

### 18 specs in five packages are registered by nothing, because their entry is one directory down

`readSuiteRegistration` looks for `src/test*.{ts,mts,cts,tsx}` at the TOP of `src/` only
and returns an empty result when it finds none; `check-node-test-registration.mjs` and
`check-browser-test-registration.mjs` then skip the package outright. Five keep their
entry a level down — `packages/framework/webgl/src/test/`, and `src/ts/` in
`lightningcss-native`, `http2-native`, `sab-native`, `tls-native` — so their 18
`*.spec.ts` files are held to nothing at all. A spec no entry imports would still report
as reachable there, because the reader never looked.

Found by `scripts/check-source-visibility.mjs`: its first registration of that walker
declared the scope as "every spec under a package `src`" and reported these 18 as blind,
and the scope had to be narrowed to the walker's own subject to go green. It is NOT the
extension class it was found beside — nothing here turns on a suffix — and closing it
changes what those two gates ASSERT (18 newly graded specs, plausibly with findings), so
it wants its own commit.

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

- **musl.** Every CI image is Fedora/glibc, and the one leg that executes anything on musl does not reach this bridge. `prebuilds.yml`'s `build-prebuilds-musl` (which runs `.github/prebuild-toolchain/musl-build.sh`, including its `dlopen(RTLD_NOW)` assertion, in `alpine:3.24`) is no longer dispatch-only — it runs on every PR and push the workflow's paths reach and can go red — but it builds `@gjsify/sab-native` and `@gjsify/lightningcss-native`, not node-gi, whose addon is published from `napi.yml`/`release.yml` and whose `paths:` are deliberately a different trigger. The COMMITTED bridge prebuilds have left the other half of the hole: `musl-committed-check.sh` was split out of the build leg and now runs on PRs and pushes as `check-committed-musl` (one native runner per arch) and again inside `commit-prebuilds`, over the staged tree. It cannot reach node-gi — this entry's subject commits no binary at all, its addon being published from `napi.yml`/`release.yml` — so for THE BRIDGE nothing still asserts musl loadability on a PR or a merge. That the assertion is `RTLD_NOW` is not incidental and must not be "simplified": measured with `@gjsify/sab-native`'s pre-#955 prebuild on aarch64 musl and in `alpine:3.24` x86-64, a plain/lazy load LOADS the broken library and the two unresolvable symbols (`fcntl64`, `__cmsg_nxthdr`) only surface at the first call — which is why its suite lost exactly two fd-passing tests and `@gjsify/worker_threads` four cross-process tests instead of everything, and GI's own `G_MODULE_BIND_LAZY` is that lazy path. A load-only gate using default flags would have passed that library; `RTLD_NOW` fails it at load. Both arches behave identically here. Wiring options, cheapest first: give `node-gi.yml` an Alpine leg shaped like `build-prebuilds-musl` (one `docker run alpine:3.24` from a glibc runner, so no JavaScript action has to run on musl — the arm64 constraint that shape exists for); add an Alpine leg driving the existing `test:bun` for real execution coverage; and keep the glibc-floor `SHT_GNU_verneed` audit (#963) as the check that needs no musl machine at all — it is what caught this one. Deno cannot participate in a musl leg: it publishes no musl build.
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

`gtk-menu-button.ts:85`, `adw-combo-row.ts:132` and `gtk-drop-down.ts:116` each
call `labels.indexOf(chosen)` over the raw labels with a bare
`cancelButtonText: 'Cancel'` instead — the addressing core documents as wrong in
`SplitButtonState.activateMenuEntry` ("silently dispatches the first of two
identically named entries and cannot tell an entry called `Cancel` from a
dismissed sheet"). `adw-menu-button` also carries its own `entry.id ?? entry.label`
fallback, which the browser twin repeats at `gtk-menu-button.ts:229`.

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

### Can `@gjsify/napi` retire the hand-written `-native` bridges?

Asked because every `@gjsify/*-native` bridge (`rolldown-native`, `oxfmt-native`,
`lightningcss-native`, …) reimplements a Rust tool that already ships an npm napi
build. Recorded now because the reason this tree gave for "no" is **wrong**, and the
wrong reason makes the question look closed.

**Measured (2026-08-22, static, re-runnable):** npm `rolldown` does not fail under GJS
because of the N-API ABI. It fails one layer higher, in JavaScript.
`rolldown/dist/shared/binding-BmkJW3Wy.mjs:24` evaluates
`createRequire(import.meta.url)` at module scope, and the platform-detection preamble
then calls `__require("node:fs")` / `__require("node:child_process")` (lines 28, 29,
51, 86) to sniff musl vs glibc before choosing a binding. GJS refuses a synchronous
require of a builtin — that is the `createRequire: Cannot require builtin module "fs"
synchronously in GJS` seen when the oxc parser was linked in. **No `.node` is ever
opened.** The same generated-loader shape is in `oxlint/dist/bindings.js`
(`require("fs")` → `/usr/bin/ldd`), so this is napi-rs's loader, not a rolldown quirk.

**So the blocker is a module-loading strategy, not an ABI** — and this tree already
owns the bypass: `napiNodeAddonPlugin` + `detectNapiRsEntry`
(`packages/infra/rolldown-plugin-gjsify/src/plugins/napi-node-addon.ts`) intercept a
napi-rs package at bundle time and route its `.node` straight to `@gjsify/napi`'s
`loadAddon`, wrapper never evaluated.

**The open question is therefore NOT "can we?" but "why did it not fire here?"** — and
that must be measured, not reasoned about. Two candidates, both cheap to discriminate:
`rolldown`'s own `package.json` carries `@rolldown/binding-*` in `optionalDependencies`,
so `isNapiRsPackageJson` should already be true for it; but the import that broke was
the `rolldown/parseAst` SUBPATH, and the file that actually loads the binding is a
content-hashed internal chunk (`dist/shared/binding-*.mjs`) which is not one of the
package's declared `nativeEntrySpecs`. Discriminator: bundle a one-line
`import { parseAst } from 'rolldown/parseAst'` under `--app gjs` and log whether
`detectNapiRsEntry` returns non-null for the resolved file.

**Verdict: demotion, not deletion.** The bridges stay — `@gjsify/napi` is Tier 3, and a
default bundler engine cannot sit on an experimental host. But the entry above may be
recording a wall that is a detour, and the cost of the bridges is paid every release.
Graduation gates for reopening this: the Tier 2 items in the section above, plus
linux-arm64 / darwin-x64 napi prebuilds and a reproducible toolchain story.

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

Stages 2, 3 and 6 have landed: one staged payload, `.deb` and `.rpm` packed by hand-written writers (no `dpkg-deb`, no `rpmbuild`, no vendored `nfpm`), proven end to end by `tests/e2e/ship` against `rpm`, GNU `ar` and GNU `tar`; and `--target flatpak` packing a single-file bundle out of the same stage, proven by `tests/e2e/ship-flatpak` reading it back with `flatpak build-import-bundle` + `ostree ls -R`. Host-boundness is now a declared `HostRequirement` on the format descriptor — the field ADR 0024 § A3 asked for, written because Flatpak needed it first.

**The framing changed.** A format this Linux workstation cannot produce is not a format to defer — it is produced on the host that owns it, in CI, the way this repo already builds per-platform prebuilds (ADR 0024 § A1-A7). Host-boundness becomes a declared `HostRequirement` on the format descriptor, with the independent oracle as a REQUIRED field: `selfReading: true` is legal to declare and illegal to release.

**Four claims this section carried that are measured FALSE** — corrected here rather than deleted, because three separate design passes reasoned from them:

- ~~"Assembly is cross-platform … so a Linux host can build both."~~ True of the `.app` tree, false of the `.dmg`: no HFS+/APFS writer exists anywhere in this tree and `hdiutil` is macOS-only. The line falls between assembly and CONTAINER.
- ~~"No in-tree app declares `gjsify.ship` yet, so the rule is vacuous."~~ `packages/infra/cli/package.json` declares it (`{binaryName: "gjsify", bundle: "dist/cli.gjs.mjs", targets: ["deb","rpm"]}`) and `release-cut.yml:349` runs `ship --skip-build` against it on every cut. The same sentence is in `tests/e2e/ship-declaration/run.mjs`'s header and is wrong there too.
- ~~"an unsigned file that Gatekeeper or SmartScreen will refuse."~~ Gatekeeper blocks; SmartScreen only WARNS until per-file-hash download reputation accrues, signed or not.
- The two certificates are not one open question. **Apple is the binding constraint**: Developer ID has no OIDC route, so stage 4 introduces this repo's first long-lived signing secret. (And the "no long-lived credential today" baseline is itself false — `PREBUILDS_DEPLOY_KEY` is a repo-write SSH key on the ruleset bypass list.)

**Measured, so nobody re-runs it** (2026-08-21, from Linux, `manifest-conformance/lib/binary.mjs`'s `readLibrary()` over the published `@gjsify/gtk-runtime-darwin-arm64@0.41.0` + `@gjsify/node-gi@0.41.0` tarballs): **106 of 106** Mach-O images already carry `LC_CODE_SIGNATURE`; **0** non-system dependencies unresolved inside the closure; **2** images carry an absolute rpath (`/opt/homebrew/lib`), which `checkPrebuildDir` already rules a working fallback. Consequence: a stage digest set cannot survive a Developer-ID re-sign, so arrival must be checked with a Mach-O-aware comparator (identical outside `LC_CODE_SIGNATURE`/`LC_UUID`), not with `sha256`.

Open, in order — each independently mergeable, each with its proof:

1. ~~**`fail_on_unmatched_files` on the release upload.**~~ **DONE (#1252).** `release-cut.yml` globbed the `.deb`/`.rpm` onto the release with the flag absent, so a glob matching nothing uploaded nothing and left the cut green — while the gate that follows checked only `install.mjs` and `cli.gjs.mjs`, and `gjsify self-update` sends system-prefix installs to exactly those assets. Landed: the flag, an install-URL gate that COUNTS what `ship` wrote (the names carry the version and the arch label, so they are read off disk), and `scripts/check-workflow-release-globs.mjs`, wired into both `audit-runtimes` jobs because `release-cut.yml` never runs on a pull request. Correcting a number this list carried: `if-no-files-found: error` appears **33** times, not 37 — the 37 was inherited from a draft and never remeasured.
2. ~~**`kind: 'app'` was dead under the shipped GJS bin, and the cause was TWO gates deep.**~~ **DONE (#1257).** one of its six sites was already fixed at the call site by #1251, which moved that template into source. What the first reading of this entry got right: `rewrite-node-modules-paths.ts`'s `shouldRewrite()` returns false unless the path contains `node_modules`, and it guards the only production call site of `inlineStaticReads`, so the CLI never offered its own reads to the inliner. What it MISSED, and what makes opening that gate insufficient on its own: the inliner parsed with acorn, **which cannot read TypeScript**, and its `catch` returns `inlined: 0` — a value indistinguishable from "this file has no static reads". An installed package ships JS, so the scope kept the parser limitation invisible; measured, the same expression returned 1 as `.js` and 0 as `.ts`. Also worth keeping: the obvious repair is a trap. Rolldown's own oxc parser links npm `rolldown` into a module that must load under GJS, and the CLI bundle then died at startup with `createRequire: Cannot require builtin module "fs" synchronously in GJS`. Fixed with `acorn-typescript`, which is pure JS. **Correcting the reason this list gave for that trap, because the wrong reason makes it look unfixable:** npm `rolldown` does not fail under GJS because it is "a napi crate that cannot run under GJS". It fails one layer higher, in JS: `rolldown/dist/shared/binding-*.mjs` evaluates `createRequire(import.meta.url)` at module scope and its platform-detection preamble calls `__require('node:fs')` / `__require('node:child_process')` — the error quoted above is that require, and no `.node` is ever opened. So the blocker is a module-loading strategy, not an ABI. The published 0.41.0 still ENOENTs on `generate-installer`, `flatpak scaffold` and the two oxc config templates until 0.42.0 ships.
3. ~~**Pack from a stage alone** (`--from-stage` + `.gjsify-ship-stage.json`).~~ **DONE (#1268).** The sidecar is a closure — `{settings (arch resolved at stage time), staged, overlay, namespaces, mtime}` — not a settings dump: measured, dropping `staged` packs the launcher 0644, dropping the overlay omits the Debian-Policy copyright file, dropping `namespaces` loses `gir1.2-gtk-4.0` and `gir1.2-adw-1` from `Depends`, all silently at exit 0. `readStage` must fail on a staged path the plan does not name AND on a planned path the stage lacks (its `?? 0o644` fallback inherits the open `download-artifact` MERGE hazard). Never `writeStage` onto an arriving stage — it opens with `rmSync(root, {recursive: true})`. *The proof, and the deletion IS the discriminator:* `tests/e2e/ship-from-stage` stages into a tmpdir, **deletes the project tree**, packs from the stage and asserts byte-equality with the single-host artifact.
4. ~~**`ship-pack-linux` on a bare `ubuntu-latest`** (no container), downloading a stage and packing deb+rpm.~~ **DONE (#1268)** — `main.yml:1914`, with the `FORMAT_IDS` binding included — it was folded in rather than opened as a third PR once the CI queue, not review capacity, turned out to be the scarce resource. It is the first real `dpkg --install` this project has ever run — `--force-depends` and deliberately NOT `--dry-run`, per `.github/ship-oracle/verify-deb.sh:239`: *"the run worth having is the one that lays bytes down"* — followed by `dpkg --verify` against the package's own md5sums and `dpkg --purge`. Plus `lintian` as a third reader and `rpm` via `docker run --rm fedora:44`, on a free runner. It closed the `dpkg` gap below and exercises the whole cross-host handoff with formats that already exist, before any darwin runner is involved. The vocabulary turned out to have SIX copies, not two: `FormatId`, `FORMATS`, `FORMAT_IDS`, two `extraDepends` reads, the packer dispatch, two ternaries in `depends.ts`, `manifest-conformance`'s `TARGETS`, and a `--target deb,rpm` in `main.yml`. Seven are now compiler-bound or derived, `TARGETS` is bound by `scripts/check-ship-format-vocabulary.mjs` (an import would break the rule's `portable` scope), and the workflow flag is gone. The two `depends.ts` ternaries were the ones that mattered: a third format silently took rpm's package name into a Debian `Depends:`, at exit 0.
5. **Stages 4/5 proper** — macOS `.app` + zip and the Windows program directory + zip (`finishOn: 'any'`), then `.dmg` on `macos-latest`/`macos-15-intel` and `.msi`. **Both `finishOn: 'any'` halves are DONE: macOS (#1354 M2a + M2b) and Windows (#1354 M3)** — see the paragraphs below this list. **The `.dmg` (M4) is DONE too** — see its paragraph below — and so is the `.msi` (**#1354 M5**, its own paragraph below), so NOTHING is left of stages 4/5: every layout now has every container it was promised. **Signing (M6) is DONE** — see the paragraph below this list. UNBLOCKED — items 1-4 have landed, and `HostRequirement` is in the descriptor. **The LAYOUT half is DONE (#1354 M1):** `gjsify ship <linux|darwin|windows>` is § A2's positional, `utils/ship/layout.ts` holds the three rows plus the map from the (still single) prefix-relative plan, the launcher has three forms, `STAGE_LAYOUT_OS` is gone and the manifest's `target.os` is the layout's. Proven by `tests/e2e/ship-layout`, which stages one project three ways and asserts set + bytes modulo a map written out in the suite, and reads every staged Mach-O back from Linux with `manifest-conformance`'s `readLibrary()`. **Do not redo any of that.** What is left is the CONTAINER per layout — `Info.plist`, the zip, the `.dmg`, the `.msi` — and each is a `FORMATS` row with `layoutOs` set, not a second staging path. Three decisions the container forces and M1 deliberately did NOT make, each already named in code so it cannot be missed: (a) **what the Linux-install-dependent files become.** Both new trees carry `share/glib-2.0/schemas/*.gschema.xml`, `share/mime/packages/*.xml` and `share/icons/hicolor/**`, correct on Linux only because a `.deb`/`.rpm` scriptlet compiles or reindexes them at install (`utils/ship/scripts.ts`), plus a `.desktop` entry and an AppStream component neither OS reads. An uncompiled schema makes GSettings abort at runtime. `linuxInstallDependent()` in `utils/ship/payload.ts` is the list — EXHAUSTIVE over `share/` rather than an allow-list, keyed on the shared `SHARE` constant in `utils/ship/share-dirs.ts` that `plan.ts`, `readPayloadFacts` and `cacheRefreshCommands` also import, and split by `ShareVerdict` so the schema entry (which makes `g_settings_new()` ABORT, because every launcher points XDG_DATA_DIRS at the staged `share/`) is printed first and marked rather than ranked with four that merely do nothing. The e2e calls the function instead of re-deriving a regex. All three of those replace a comment that CLAIMED the rules could not drift and was measured false: five independent string literals, and pointing one rule at nothing dropped a file from the warning at exit 0, suite green. The file-set equality is structurally blind to the whole class, because sameness IS the defect. ~~Candidate answers: a compiled `gschemas.compiled` inside the bundle, `Info.plist` `CFBundleDocumentTypes`, a Windows registry association, or simply dropped.~~ **ANSWERED for the schema half (#1354 M2a):** `utils/ship/schemas.ts` compiles the cache into every non-Linux stage at ASSEMBLY time, with `--strict` (measured: without it a malformed schema is skipped at exit 0 and a cache is written without it, so the stage looks compiled and the app still aborts on the schema that was dropped). Linux still gets none, because there the postinst compiles the SYSTEM directory where our schemas merge with every other package's. `SHARE_VERDICTS`'s schema row became a FUNCTION of the payload so the warning stops saying ABORTS without the rule becoming unreachable — take the cache back out and it says ABORTS again, which `tests/e2e/ship-layout` asserts in both directions. The mime, icon and desktop-entry halves are still open and still `inert`. (b) **a loose `.typelib` in `Contents/Frameworks`** is the classic codesign/notarization complaint — that directory is expected to hold code — so stage 4 may have to move it or wrap it; flagged, not measured. (c) **the interpreter.** ~~Every staged launcher execs `gjs -m` today~~ — the launcher execs whatever `gjsify.app` names, which for the audience this command has today is `gjs`; that is truthful about the payload and is not what § 4 derives; `Layout.shippedRuntime` + `Layout.runtimeGap` carry the derived answer and the reason it is unmet, and item 6 below is what closes it. Open question 3 (`DEFAULT_FORMAT_IDS` versus the positional) is answered with BOTH: the positional picks the layout, `defaultFormatIds(os)` filters on `layoutOs` AND `finishOn`, so a bare `gjsify ship` on Linux still emits exactly `deb` + `rpm`. ~~(d) **the arch label is unchecked for a PE payload.**~~ **CLOSED (#1354 M3):** `readBinaryArch` reads the COFF machine now — `e_lfanew` at 0x3C, then `Machine` four bytes past the `PE\0\0` signature — so `assertPayloadMatchesArch` fires on the one layout whose native format IS PE, and `tests/e2e/ship-windows` drives it red (an arm64 closure reached through `GJSIFY_GTK_RUNTIME` under an x64 label) and green. The windows e2e leg no longer reuses a Mach-O: `tests/e2e/pe.mjs` is the synthetic PE writer, sibling to `macho.mjs`. **The console-window gap is NOT closed and cannot be closed by CI** — see the paragraph below the M3 entry.
6. ~~**Bundled Node for `--app node`** — still undecided between a ship-time fetch and a platform package (ADR 0017's shape). Stages 4/5 need it: an unsigned artifact is a legitimate output, an artifact with no interpreter is not.~~ **DONE for macOS (#1354 M2b) and Windows (#1354 M3)** — `@gjsify/node-runtime-<target>` is the platform package, `utils/ship/app-runtime.ts` stages it into `Contents/MacOS/node` or beside the program directory's `.cmd` as `node.exe` (the leaf comes from `nodeRuntimeBinaryName(target)`, the same function that named the SOURCE, so the two cannot drift), with Node's LICENSE, and the launcher execs `"$here/node"` / `"%HERE%node.exe"`. ⚠️ **None of the three `@gjsify/node-runtime-*` packages is published yet** — all 404 on npm at 0.44.0 — so both assemble legs populate one with `packages/node-runtime/scripts/fetch-node-runtime.mjs`, which verifies the release's own SHA-256. `@gjsify/gtk-runtime-win32-x64` IS published (0.44.0). The original entry, kept because its diagnosis is what the staging was built against: **it was the live blocker rather than a later one (#1354 M2b):** the `.app` exists and is a real bundle, and the only thing between it and "a stranger double-clicks it" is that nothing stages an interpreter or a GTK closure into it. `resolveNodeRuntime` still has no caller outside its own spec, and `plan.ts` flattens `bundledTypelibs` with `basename()` — pointed at a `gtk-runtime-darwin-*` tree it would destroy `lib/gdk-pixbuf-2.0/2.10.0/loaders/`, `girepository-1.0/`, `etc/fonts/` and every relative relation `build-gtk-runtime-darwin.mjs`'s `@loader_path/../../..` install names depend on. So M2b is a TREE-PRESERVING staging path plus the launcher's runtime locators, and it carries a core fix in `node-gi`: an app with its own typelib+dylib in `Contents/Frameworks` gets `GI_TYPELIB_PATH` from the launcher and has no way to make GI find the backing dylib, because `activateGiLibraryPath` only ever prepends the GTK bundle's `libDir`. On Linux `LD_LIBRARY_PATH` covers it; on macOS nothing does, and a launcher-set `DYLD_FALLBACK_LIBRARY_PATH` stops working the day the bundle is signed.
7. ~~**`dpkg` is on no CI runner this project uses**, so the `.deb` is never verified by a real `dpkg -i`.~~ **DONE (#1268)** — `ship-pack-linux` runs on a bare `ubuntu-latest`, and the tool question is settled in two steps rather than one assumption. `main.yml:1962` PRINTS which of `dpkg dpkg-deb apt-cache apt-get lintian docker gjs` are present and does not fail on an absent one; the step below then installs `lintian` and `gjs` outright, so absence becomes a download rather than a skipped check. What actually GATES is `.github/ship-oracle/verify-deb.sh:58`, whose `require` list fails the run if any of them is missing at use time. The Fedora-side readers are unchanged: GNU `ar` and GNU `tar` as independent readers of the container and of both inner tars, every `md5sums` digest recomputed, and the data member unpacked and compared byte-for-byte against the staged tree. **What is still open is the other half of this entry, and it is undeclared rather than unverified:** `tests/e2e/ship` makes `ar` required on Linux, but `binutils` appears nowhere in `.docker/ci-fedora.Dockerfile` — it is present only transitively via `gcc`. The failure would be LOUD, not silent: `fixture.mjs`'s `probe()` throws a named error for a missing `ar` on Linux rather than skipping, exactly so the suite cannot go green having read nothing. What is missing is the DECLARATION, so a base-image change that drops the compiler reds the deb oracle for a reason nobody wrote down.
8. ~~**Two docs sentences become false** with host-bound formats.~~ **HALF DONE.** The "run anywhere" claim in `website/src/content/docs/ship/index.mdx` was made false by `--target flatpak` in the same PR and is replaced there: the page now states per format where it can be packed and what reads it back, and `docs/ship-formats.md` carries the model. Still open: *"no packaging file to keep in your repo"*, which only `gjsify ship ci` makes false — it scaffolds a workflow the consumer commits.
**What #1354 M2a landed, and what it deliberately left.** `gjsify ship darwin` now emits two artifacts: the `<App>.app` itself (`macos-app`, a DIRECTORY artifact — the first in `FORMATS`, which is why `FormatDescriptor.artifactKind` exists: `statSync` on a directory answers 4096 and a 20 MiB bundle would be reported as "4096 bytes") and a deterministic zip around it (`macos-app-zip`, written in-tree by `utils/ship/zip.ts`, `requiredTools: []`, STORE-only, mtime from the stage manifest and never `Date.now()`). `Contents/Info.plist` carries eleven keys, each cited to a file in `refs/node`; `Contents/PkgInfo` is eight bytes and no terminator. Both readers are independent and both are watched RED: `.github/ship-oracle/verify-app-plist.py` (CPython `plistlib` — NOT `plistutil`, which accepts a `<dict>` whose `<key>` has no value and prints `<dict/>` at exit 0, and NOT `xmllint --valid`, which exits 4 on a correct plist) and `.github/ship-oracle/verify-app-zip.sh` (`zipinfo -l` — NOT `unzip -Z1`, which prints names only and cannot see the one failure this format has). `tests/e2e/ship-macos` drives both, green and red, on every PR; unlike the deb/rpm readers they are not yet wired into a `main.yml` pack leg, because there is no darwin pack job to wire them into and the e2e already runs them on the CI image, which bakes `python3` and `unzip`. Three things NOT done: no `.icns` and no `CFBundleIconFile` (ADR 0024 § A6 — `png2icns`, `icnsutil` and `iconutil` are absent here and in the image, so an icon written here would be `selfReading`), ~~no interpreter or GTK closure in the bundle (item 6, M2b)~~ **done in M2b**, and ~~no macOS CI leg~~ **added in M2b** — M2a was entirely Linux-verifiable by construction, which is what made it separable from M2b at all.


**What #1354 M3 landed.** `gjsify ship windows` emits two artifacts: the program directory (`windows-dir`, a DIRECTORY artifact like `macos-app`) and a deterministic zip around it (`windows-dir-zip`). Both `layoutOs: 'win32'`, `finishOn: 'any'`, assembled on Linux, unsigned — and SmartScreen only WARNS on an unsigned download where Gatekeeper BLOCKS one, so this is a usable artifact in a way an unsigned `.app` is not (ADR 0024 § A5). The `.cmd` runs `"%HERE%node.exe"` and sets `GJSIFY_GTK_RUNTIME` + `NODE_GI_NATIVE`; it does NOT set `PATH` for the closure, because node-gi's `maybePrependGtkRuntimeDllPath()` does that in-process above its own `loadNative()` and a second copy would drift. Runtime staging is M2b's module unchanged — `Layout.dirs` is what makes the same four pieces land in `lib\node-gi\prebuilds\win32-x64\` instead of `Contents/Frameworks/`. Three defects this closed, each measured red first: `readLauncherInterpreters` read a `.cmd` with the POSIX rules and found NOTHING (batch has no `exec`, `%~dp0` carries its own separator, the file is `node.exe`), so `assertLauncherMatchesInterpreter` passed over a launcher running `gjs` under `gjsify.app: "node"`; `readBinaryArch` stopped at `MZ`, so `assertPayloadMatchesArch` was vacuous on the one PE layout; and the zip had no top level, because the windows stage carries none for it to inherit. Oracles: `.github/ship-oracle/verify-program-dir.py` (CPython `struct` over every staged PE, plus the launcher's bytes and the interpreter it names) and the existing `verify-app-zip.sh` with a third argument naming the kind. `tests/e2e/ship-windows` drives both green and red — 22 of its 27 cases fail against the pre-M3 CLI. Two CI jobs in `node-gi.yml`: `windows-dir-assemble` (Linux, real `node.exe` + the FULL-windowing gvsbuild bundle + the MSVC addon) and `windows-dir-selfcontained` (`windows-latest`), which asserts gvsbuild is ABSENT and that `PATH` reduced to `%SystemRoot%\system32;%SystemRoot%` has no `node`, then unzips the artifact and opens a window. `win32-arm64` stays refused and the blocker is upstream — gvsbuild hardcodes `self.platform = "x64"` (#1117).

**What #1354 M5 landed.** `gjsify ship windows --target msi` emits a Windows installer — the third row over the windows layout and the first format in this table whose producer is not this tree. `utils/ship/msi.ts` renders ONE authored `.wxs` in WiX v3's schema and hands it to a host-selected compiler: `wixl` (`msitools`) on Linux, `candle.exe`+`light.exe` (WiX Toolset 3.14.1.8722, preinstalled on `windows-latest`) on Windows. So `finishOn: ['linux', 'win32']` — ADR 0024 § A5 wrote that as an either/or and the third option is what makes an independent reader possible on both legs, because **each backend's output is read by the OTHER family**: `msiexec` installs the wixl-built file on `windows-msi-install`, RUNS the installed launcher and then uninstalls it, asserting no file, no Add/Remove Programs entry and no Start-Menu shortcut survives; `msiinfo` reads back on Linux (`windows-msi-crossread`) the file WiX compiled from the same document. `verify-msi.sh` takes the expected producer as an argument — `msitools` or `!msitools` — and refuses a file whose `msiinfo suminfo` says otherwise, so a job pointed at the wrong artifact fails instead of passing as a self-oracle. `requiredTools` became a union (`readonly string[] | Partial<Record<HostOs, …>>`) for this one row, resolved by `requiredToolsOn(tools, host)`: a flat list demands `wixl` of a Windows host in one direction and says the other OS needs nothing in the other. The artifact is DETERMINISTIC — `ProductCode` is a UUIDv5 over app id + version + release + arch and `UpgradeCode` one over the app id alone, which is exactly the pair `MajorUpgrade` needs, where WiX's documented `Id="*"` would reroll the code every build. A prerelease version is REFUSED rather than truncated, because `1.2.0~rc.1` and `1.2.0` would become one `ProductVersion` and both would end up installed. `msitools` had to go into `.docker/ci-fedora.Dockerfile` in its OWN PR first: `build-ci-image.yml` publishes the image only on a push to `main`, so a PR adding a package AND a test that hard-requires it can never go green. **What M5 does not claim:** `tests/e2e/ship-msi` compiles with `wixl` and reads with `msiinfo`, two programs out of one package — that is a second implementation VALIDATING the authored document plus a byte round trip out of the embedded cabinet, not verification, and the suite header says so. **A hand-written MSI stays rejected** (§ A6: the three constraints that forced the hand-written deb/rpm writers have no subject here, because there is no GJS host on Windows at all), and **MSIX stays rejected** until a certificate exists. The console-window gap below is NOT closed by the shortcut.

**What #1354 M6 landed.** `--sign <identity>` and `--notarize <credential>` on the FINISH phase (ADR 0024 § A12-§ A17, plus this PR's § A18-§ A21). An identity is a NAME `codesign`/`signtool` resolves a key by, never a certificate — there is no `--certificate`, no `--p12`, no `--password`, and `gjsify.ship.sign.<darwin|win32>.identity` is the project default. Absent identity SKIPS loudly at exit 0, from the flag and from the config alike. `SIGNERS` in `utils/ship/signing.ts` is a per-OS table BESIDE `FORMATS`, because § A14 measured that a format declares where it can be packed and never what it can be signed with; linux has no row and `--sign` there is refused with the mechanism (`debsigs`/`rpmsign` sign the artifact as a whole, with the repository's key). Signing is a payload MUTATION and the ORDER is structural: `readStage` refuses a size-changed file — measured, *"is 6 bytes in the stage and 5 in its manifest"* — so `signPayload` takes its OUTPUT and returns the packer's INPUT, mutating `<outRoot>/signed/<format>/` and never the arriving stage, which is what makes a `--from-stage --sign` run repeatable. The oracle is `.github/ship-oracle/verify-signed-arrival.mjs` over `compareMachOAfterResign` in `manifest-conformance/lib/binary.mjs` (extended, not duplicated — that file's header forbids a second parser), with a third exempt region § A17 did not list and this one derives: `__LINKEDIT`'s size fields, because the blob lives inside that segment by construction. Proven ad-hoc on `macos-suites.yml` with NO secret in the repository, guarded by `GJSIFY_SHIP_SIGNING_REQUIRE_CODESIGN=1` so the leg cannot pass on a host with no `codesign`; `tests/e2e/ship-signing` drives everything else green and red from Linux. What it did NOT prove is its own section above (`gjsify ship --sign`: three things M6 did not prove) — Windows, notarisation, stapling — each with what WAS measured.

**What #1354 M4 landed.** `gjsify ship darwin --target macos-app-dmg` emits a UDIF image around the same `<App>.app` the other two macOS rows produce — `hdiutil create -format UDZO -fs HFS+J -srcfolder <volume> -volname "<display name>" -ov`, on darwin, because `hdiutil` is the only UDIF writer there is and it is macOS-only. It is the FIRST row that is host-bound in `HostRequirement`'s sense (`finishOn: ['darwin']`, `requiredTools: ['hdiutil']`); flatpak is Linux-bound because flatpak runs on Linux, this one is bound by its container while the tree it wraps assembles anywhere. A hand-written UDIF writer stays rejected (ADR 0024 § A6). The packer takes the STAGE and never the `.app` artifact beside it: a `--target macos-app-dmg` run alone must produce an image, and § A17 fixes the seam for a later `--sign` between `readStage` and the container. The row declares `hdiutil` and NOT `glib-compile-schemas`, unlike its two siblings — the compiler is an ASSEMBLY tool and `assertToolsInstalled` fires on the pack path, so declaring it would refuse a `--from-stage` pack on a Mac with no GLib, a pack that works because the compiled cache is already in the stage that arrived.

**The `.dmg` oracle is a chain of four on LINUX, and `hdiutil verify` is deliberately not in it** (ADR 0024 § A3 names this format as the case the field exists for). `.github/ship-oracle/verify-dmg.py`: `7z l -slt` over the UDIF container; `7z t`, which DECOMPRESSES what the container stores and is therefore the only link that can see a byte flipped inside a compressed run; `dmg2img`, a second and unrelated UDIF decoder, which writes the raw volume out; `fsck.hfsplus -f -n` over that volume, which walks the catalog, the extents overflow file and the volume bitmap; then 7-Zip's HFS handler for the listing, compared against `.gjsify-ship-stage.json` by name and size. Three CI jobs in `main.yml`: `ship-stage` gained a darwin half (a second FIXTURE, `tests/e2e/ship-macos/fixtures/dmg-app`, because `packages/infra/cli` is `--app gjs` and every macOS row is `interpreters: ['node']`), `ship-pack-dmg` runs on `macos-latest` with NO checkout — the CLI arrives as the `bootstrap-bundles` GJS bundle and runs under a `brew install gjs`, so the Mac leg costs no workspace install — and `ship-read-dmg` runs on a BARE `ubuntu-latest`. Bare, and that is what kept M4 out of the Dockerfile-then-test ordering trap: `build-ci-image.yml` publishes the image only on a push to `main`, so a PR that adds a package to the image AND a test hard-requiring it can never go green. The three readers arrive by `apt-get install -y 7zip dmg2img hfsprogs` instead. Measured on `ubuntu:24.04`: 7zip `23.01+dfsg-11` (`7z i` lists `Dmg`, `HFS`, `APFS`), dmg2img `1.6.7-1build4`, hfsprogs `540.1.linux3-5build3`. Note `scripts/check-ci-image-packages.mjs` could not have caught the alternative — its "does a job use a tool the image lacks" question covers `NODE_TOOLS` only, and it skips a job with no `container:` outright.

**"Flip a byte" is not a negative control, and WHERE it lands decides more than that (#1354 M4).** One byte flipped at each offset of the real 31715-byte artifact (data fork 0-22939, XML plist 22939-31203, koly 31203-31715) — exit codes `7z l` / `7z t` / `dmg2img -p 4`: at 0·256·512·1024·2048·4096 all three answer 0 (the data fork opens with the GPT partitions' `Zero0`/`Zero2` runs, which store and checksum nothing); at 8192·12288·15000 all three refuse; at 16000·20000 `7z l` is BLIND while the other two refuse; at 24000 `dmg2img` is blind while both 7-Zip reads refuse; at 28000·31000 nothing notices. Three consequences: `--mutate payload` derives its offset from the koly trailer's own `dataForkOffset`/`dataForkLength` and flips the fork's MIDDLE, because its first version used the constant 512, landed in padding and reported "the readers are not doing their job" about a working chain; NO SINGLE READER covers everything, which is a better argument for the chain than "`7z t` is the link that sees the payload"; and roughly the leading 4 KB plus the trailing 3.7 KB of the file is covered by none of them, which is a limit rather than a feature and is not papered over. The discriminator is three mutants — the `koly` magic, the data-fork midpoint, the HFS+ signature in the extracted volume — plus a positive control on the untouched volume, so a branch that refused everything could not pass as a discriminator. Two other measurements worth not re-running: `7z l -slt` on an HFS+ volume roots every path at the VOLUME NAME (so the comparison prepends it), and a journaled volume carries `.journal` and `.journal_info_block` at its root — a CLOSED allowance in the oracle rather than a dotfile glob, because a glob would also swallow a real `.DS_Store` in a user's download.

**A measurement taken on a stand-in (#1354 M4).** This entry first said the `.dmg` listing was blind to POSIX modes, because `7z l -slt` reports `Mode = 0---------` on an empty `mkfs.hfsplus` volume. Against a real `hdiutil` image the same reader prints `-rwxr-xr-x` for `Contents/MacOS/<binary>` and `-rw-r--r--` for the other seven (run 33283043393), so the oracle compares modes against `staged[].mode` — the field that matters most here, because the artifact upload flattens every staged file to 0644 and the sidecar is the only surviving record of what each mode should be. The wrong claim was the expensive direction: it would have REMOVED a check. Three more things the real image settled that a `mkfs` volume could not: **`dmg2img in.dmg out.img` writes the whole GPT-partitioned DISK** — `hdiutil` produces a primary GPT header and table, the `Apple_HFS` volume, an `Apple_Free` run and the backup table, and dmg2img decompressed all eight into one file — so the HFS+ volume header is not at offset 1024 of the result and `fsck.hfsplus` exits 8 on a correct artifact. The fix is dmg2img's own vocabulary rather than a GPT parser of ours: `-l` prints `partition <n>: <name>` and `-p <n>` extracts one, so the oracle names the `Apple_HFS` partition and refuses an image with anything but exactly one. And: `7z l -slt` on a `.dmg` AUTO-NESTS (two archive headers, `Type = Dmg` then `Type = HFS` with `Method = HFS+`, and the ten-dash separator appears only after the second — partitioning on the FIRST occurrence made the type check read `HFS` and refuse a correct image), and an `hdiutil` volume carries two HFS+ hard-link stores, `.HFS+ Private Directory Data` and `[HFS+ Private Data]`, which need no allowance because both are directories.

**What M4 does not claim.** Nothing mounts the image or drags the bundle out of it. The image is unsigned and unnotarised; that is M6. And the fixture the `.dmg` legs wrap is the small one (no interpreter, no GTK closure) — what the heavy tree does is `node-gi.yml`'s `macos-app-selfcontained` leg, and what lets the small payload stand for it here is `tests/e2e/ship-macos`'s assertion that the staged tree is byte-identical across all three macOS containers.

**The console-window gap, and why no leg covers it (#1354 M3).** `node.exe` is a CONSOLE-subsystem PE: `Subsystem` = 3, at offset 0xD4, measured on `node-v24.20.0-win-x64.zip`'s `node.exe` (`e_lfanew` 0x78, so 0x78 + 4 + 20 + 68 = 0xD4). The issue records the same for v24.19.0. And there is no `nodew.exe` to swap in: `unzip -Z1` over that release lists exactly ONE `.exe`, `node-v24.20.0-win-x64/node.exe` (the `nodewin` hits in that listing are corepack shim DIRECTORIES, which is the control string proving the grep was live). So a user who double-clicks the `.cmd` — or a shortcut an `.msi` writes — gets a console window behind the GUI. **Every Windows CI leg starts the app from a shell and therefore already has a console**, so none of them can observe it, and a leg that appeared to would be worse than the gap. What CI does instead: `windows-dir-assemble` PRINTS the subsystem `verify-program-dir.py` read off the real binary, and `tests/e2e/ship-windows` proves that reader is not a constant by feeding it a GUI-subsystem copy. The real fix is one of three, none of them M3's: a GUI-subsystem launcher stub of our own, `Subsystem`-patching the staged `node.exe` (which invalidates any signature and is a redistribution question), or an `.msi` shortcut that starts the app detached (#1354 M5). Instrument for observing it at all is `win11-gjsify`.
**What #1354 M2b landed.** `utils/ship/app-runtime.ts` stages four things into the darwin layout, each resolved BY NAME and each `null`-not-throw: the interpreter (`@gjsify/node-runtime-darwin-<arch>` → `Contents/MacOS/node` + its LICENSE), the relocated GTK closure (`@gjsify/gtk-runtime-darwin-<arch>` → `Contents/Frameworks/node-gi/prebuilds/darwin-<arch>/gtk/**`, TREE-PRESERVING), the addon (`@gjsify/node-gi`'s `prebuilds/<target>/node_gi.node`, SIBLING to that closure because its `@rpath` is `@loader_path/gtk/lib`), and — the one nobody predicted — **node-gi's JavaScript**, because `@gjsify/node-gi/*` is external in every `--app node` bundle by design, so a `gi://Gtk` import compiles to `require('@gjsify/node-gi/gi')` and a `.app` has no consumer `node_modules`. Measured on a bundle staged the M2a way, run from an unrelated directory: `Error: Cannot find module '@gjsify/node-gi/gi'`. The launcher execs `"$here/node"` and exports `GJSIFY_GTK_RUNTIME`, `NODE_GI_NATIVE` and (when the app carries GI libraries of its own) `GJSIFY_GI_LIBRARY_PATH` — all read by node-gi in JS, none by dyld, so § A4's signing rule survives. Two CI jobs in `node-gi.yml`: `macos-app-assemble` (Linux) and `macos-app-selfcontained` (`macos-latest` + `macos-15-intel`), which asserts brew gtk4/libadwaita are ABSENT and `PATH` reduced to the system directories has no `node`, then unzips the artifact and opens a window.

9. **A scaffolded workflow is verified by nothing.** The only scaffolder in the tree (`flatpak ci`) is asserted by four `assert.match` regexes on raw text — never parsed as YAML, never actionlint'd (which discovers only this repo's `.github/workflows/**`), never run. ADR 0024 names this exact class for `ship`; it already exists one command over. Minimum bar for `ship ci`: emit into gjsify's own workflows directory too, and `bash -n` every extracted `run:` block.

10. **Every `.deb` this writer produces ships no `changelog.Debian.gz`.** `E: gjsify: no-changelog usr/share/doc/gjsify/changelog.Debian.gz (non-native package)` — Debian Policy § 4.4, and the only error-severity tag left once the copyright landed. Ledgered rather than fixed in #1268 because it is a FEATURE, not a repair: a second overlay beside the copyright, assembled on the build host and carried in the sidecar the same way, whose open question is what the entry SAYS. A Debian changelog is a release history with a distribution and an urgency per entry, so the honest minimum needs a source for each version's prose (the GitHub release body? a `CHANGELOG.md`?) and an RFC822 date this writer does not produce anywhere yet. Measured by the first real lintian this project has ever run (2.117 on ubuntu-24.04); reproduce the whole leg locally with `podman run --rm -v <workdir>:/w:z -w /w ubuntu:24.04` plus `apt-get install -y sudo gjs lintian`, which is how this entry and #1268's two `verify-deb.sh` corrections were found without a CI round trip each.

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

### The musl leg BUILDS and load-tests a `-musl` prebuild; nothing commits one

`prebuilds.yml`'s `build-prebuilds-musl` is a gate now — it lost `continue-on-error` and its
`workflow_dispatch` gate, runs on every PR and push the workflow's paths reach, and compiles
`@gjsify/sab-native` + `@gjsify/lightningcss-native` inside `alpine:3.24` on native x64 and arm64
runners, load-tests each under Alpine's `gjs` and `dlopen(RTLD_NOW)`s them with `LD_LIBRARY_PATH`
unset. What it does NOT do is ship anything: the artifacts are uploaded and never committed, so a
musl host still installs the glibc binary and lives with the `gnu_get_libc_version` gap above.

Why the artifact is a separate change rather than one line more here, and what it needs:
- **`libc: ["glibc"]` on `@gjsify/lightningcss-native-linux-x64` is an install FILTER** that npm,
  yarn and pnpm all honour, so that package is not installed on a musl host at all. A `-musl`
  artifact reaches a user only via a package a musl host installs — either by dropping that
  filter from the existing platform package (the CLI already prefers `prebuilds/<os>-<arch>-musl/`
  over `<os>-<arch>/`, see `prebuildDirCandidates`), or by a new `…-linux-x64-musl` sibling. The
  second needs a manual npm first-publish + Trusted Publisher bootstrap BEFORE the release that
  ships it (`docs/publishing.md`); skipping that stalls the release train for every
  alphabetically later package, which is why it is not smuggled into a CI fix.
- **`PLATFORM_RE`/`canonicalPlatform` in `packages/infra/manifest-conformance/lib/platforms.mjs`
  are still libc-blind** — `PLATFORM_RE` rejects `linux-x64-musl` and `canonicalPlatform` folds it
  down to `linux-x64`. That fold is not hypothetical: it silently swallowed the whole libc axis on
  the first attempt at the CI parser, which credited the Alpine leg with the glibc target and
  passed. `platforms-ci` now composes with `canonicalPrebuildTarget` instead, so the gap is
  unreachable from there; a COMMITTED `-musl` directory would reach it, and both functions must
  learn the optional suffix in that change.
- **`commit-prebuilds` needs the matching download + `git add`**, and this job is deliberately
  absent from its `needs` so a musl regression cannot take the commit path down with it.

Until then the leg's value is exactly what its script says: the npm `libc` policy — a
`libc`-less `@gjsify/<x>-linux-<arch>` is installed on musl hosts BY DESIGN — rests on the claim
that these sources work when built against musl, and nothing else in CI compiles or runs anything
on musl. That claim is now measured on BOTH arches: the leg's first real run built both bridges on
`ubuntu-latest` and `ubuntu-24.04-arm`, loaded both under Alpine's gjs, dlopened both with no
library-path variable and uploaded all four artifacts, in about five minutes per arch — which also
retires the "the aarch64 builds are INFERRED" caveat the workflow header used to carry.

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

### `<adw-toggle>` has no `enabled`, so a toggle group cannot disable one segment

Upstream's `AdwToggle` carries `enabled`, and `add_toggle` spends it immediately:
`gtk_widget_set_sensitive (toggle->button, toggle->enabled)`
(`adw-toggle-group.c:871`). The web `<adw-toggle>` observes `label` and `icon-name`
and nothing else, so every rendered button is sensitive and there is no way to
express "this view mode is unavailable right now" short of removing the toggle.

This surfaced while making the group keyboard-navigable. `elements/roving-focus.ts`
documents that its caller must filter `hidden`/`disabled` items — leaving one in
strands the user on a `focus()` the browser refuses, which is why
`<adw-sidebar>` filters and has a spec for it. `<adw-toggle-group>` passes its
buttons through UNFILTERED, deliberately: no `<adw-toggle>` attribute can produce
a disabled or hidden button, so a filter would be a branch no test could reach.
Adding `enabled` therefore means adding the filter and its spec in the same
change, or the first disabled toggle is a focus trap — and that obligation is not
left to this paragraph. `keyboard-operable.spec.ts` pins
`AdwToggle.observedAttributes` to exactly `['label', 'icon-name']`, so the commit
that adds `enabled` fails until someone reads this entry.

**Four siblings surfaced with it (2026-08-28), and the reason they were invisible is the
point.** `check-adwaita-element-properties.mjs` holds an `adw-*` element against its
WIDGET's GIR properties — and `AdwToggle` had no entry in the widget table to be held
against, because that table meant "concrete `GtkWidget` descendant" and `AdwToggle` is
not one. The moment the placement-carrier rule gave it a tag (ADR 0028 § Amendment), the
check started comparing and named five gaps at once: `enabled`, plus `description`,
`name`, `tooltip` and `use-underline`. None is new; the ability to see them is. All five
are in that script's `KNOWN_GAPS` ratchet, so closing one now fails until it leaves the
list.

That is worth generalising beyond this element: **a gate that compares two surfaces is
blind wherever one of them has no entry**, and widening a table is therefore also a way
of discovering what a check was never asked. The vocabulary-alignment gate found the same
thing in the same PR, from the other side — `<adw-toggle>` had been declared web-only
with the reason "descends from GObject.Object, not GtkWidget", which stopped being true.

`orientation` is the second thing missing, and it is not cosmetic. `AdwToggleGroup`
implements `GtkOrientable` (`adw-toggle-group.c:187`), installs `PROP_ORIENTATION`
(`:202`), reorients its layout manager (`:929`) and every separator (`:873`,
`:935`), and `AdwInlineViewSwitcher` forwards the property (`:107`). Neither web
element has it, so both are hardcoded horizontal — `attachRovingFocus(…,
orientation: 'horizontal')` in each — and the keyboard follows the layout
GEOMETRICALLY upstream (`focus_sort_up_down`, `adw-widget-utils.c:339-342`), not
from a property. A vertical group therefore needs Up/Down to move inside and
Left/Right to propagate: the exact opposite of what both elements do today. The day
`orientation` lands, the axis and the `inert` spec row move with it, and
`keyboard-operable.spec.ts` pins `AdwToggleGroup.observedAttributes` so that commit
cannot land quietly. `<adw-inline-view-switcher>` has no such pin yet.

The same commit closed the roving half of this widget, and the entry it replaces
got the ROLE wrong in a way worth keeping: it recommended "giving the group the
tab-list role", generalised from `AdwInlineViewSwitcher` building this widget with
`GTK_ACCESSIBLE_ROLE_TAB_LIST` (`adw-inline-view-switcher.c:702`). That is the one
place upstream OVERRIDES the default — the C marks it `/* Special case for
AdwInlineViewSwitcher */` (`adw-toggle-group.c:856`) — and `AdwToggleGroup` itself
declares `GTK_ACCESSIBLE_ROLE_RADIO_GROUP` (`:1191`). Reading the widget that
consumes a class instead of the class itself is how a ledger entry ends up
prescribing the exception as the rule.

### Nothing checks a `file.c:NNN` citation, and nothing checks the `refs/` pointer

Three rounds of review on one PR produced FOUR wrong line numbers, each in a comment
whose whole job was to ground a decision in the C: `adw-toggle-group.c:1058` for a
filter that is at `:1059`, `:872` for a call at `:871`, `:1065` for a function whose
name is at `:1066` (corrected in one file and left standing in another in the same
PR), and `adw-widget-utils.c:399` for `focus_sort`, which is at `:388` — that last one
inside the single paragraph carrying the argument that the previous draft had the axis
backwards. A fifth claim named `adw-inline-view-switcher.c:294` as an inner layout
container; the line resolves, and it is a `GtkImage`.

`scripts/check-refs-citations.mjs` checks that a cited FILE exists. It cannot check a
line, which is why every one of these passed. The shape that would catch them is
narrow and mechanical: for each `<file>.c:NNN` in a comment that also names a
backticked C symbol, assert the symbol occurs within a small window of that line. The
window is the whole design question — a function is cited by its `static` line as
often as by its name line, and this repo does both deliberately (`:428` and `:298` in
one sentence) — so the reader has to accept a range rather than a point, and say which
it accepted when it fails.

**A second cause, found by bumping a pin (2026-08-28).** The four above are transcription errors —
someone wrote the wrong number. This one is not, and the pointer history is the finding:

| when | `refs/gtkx` pointer | `PREFIX_FOR` sits at |
|---|---|---|
| #1180, ADR 0024 written | `83ab4cee` (v1.1.0) | 35 |
| **#1304, 2026-08-25** | `2ce19757a` (upstream `main`, between v1.3.0 and v1.4.0) | **39** |
| #1396, 2026-08-28 | `9c8293db` (v1.5.0) | 41 |

So `ADR 0024`'s `stage.ts:35` was **correct when written and made wrong by #1304**, three days and
two merged PRs before anyone looked. The 2026-08-28 bump moved it 39 → 41; it did not break it, it
found it. #1304 also relabelled the pin in prose in two ADRs at once — 0024 kept saying v1.1.0 and
0032 started saying v1.4.0, while the actual pointer predated v1.4.0 by a day. Nobody wrote a wrong
number; a pointer moved under three correct sentences.

The cheap discriminator needs no window heuristic and no symbol parsing: **a commit that changes a
`refs/<pool>` pointer must re-check every line citation into THAT pool**, and a bump touches one
pool at a time. What stops it is not the script — `check-refs-citations.mjs` exists — but its
reach. It resolves a coordinate with `statSync` (`:259`), i.e. **it asks whether the FILE exists**,
so it was green on 35, green on 39 and green on 41. And it can only ask about pools that are on
disk: it reports its own coverage honestly — `773 coordinates across 53 submodules`, and on a tree
with no pools realized it prints `0 resolved in the 0 of 95 declared submodules checked out here,
762 skipped` and exits 0.

**Adding `refs/gtkx` to that gate's checkout step was written, measured (`2 resolved in the 1 of 95`,
up from 0) and REVERTED, and the reason it was reverted is the one worth keeping.** It was not the
network: `audit-runtimes.yml:435` and `:951` already check out `refs/libadwaita` in both jobs, so
github.com is inside those required checks either way — that was a wrong reason and is corrected
here rather than deleted, because it is the second time in this entry that a true conclusion rested
on a false premise. The sound reason stands alone: the defect is a LINE moving and the gate checks
a FILE, so widening the pool set buys coordinates the gate still cannot fail on. Line-level first;
pools after.

One thing the line-level check will hit immediately, said now so it is a requirement rather than a
surprise: **this entry cites `stage.ts` at line 35 on purpose, and that citation is deliberately
wrong.** `check-refs-citations.mjs` already knows the shape of this problem — `SELF` (`:89`) exists
because "a ledger entry that spells the coordinate it excuses becomes that coordinate's last
citer" — but `SELF` covers only the gate's own file. Today the harvest is harmless: `CITATION`
(`:108`) stops at the path and never takes the `:NNN`. The first version of a line-level check has
to either widen that exclusion or read this paragraph as its own first failing case.

The second half is smaller and equally invisible: the worktree's `refs/libadwaita`
sat FIVE commits ahead of the pointer recorded in `HEAD` during that review. Citations
are only meaningful against the pin, and checking it took a hand-run `md5sum` over
three files to establish that the drift happened to be harmless. `check-refs-pin.mjs`
does NOT cover it, checked: it dispatches to the `refs-pin` rule, which reads
`gjsify.refsLockstep` — declared by exactly two packages, `rolldown-native` and
`oxfmt-native`, both pinning Rust sources they compile. No package declares a
lockstep for `refs/libadwaita`, so the tree every Adwaita citation is measured
against is the one thing about them nothing holds.

Both halves are worth one script, because the cost is already paid: four of these
survived adversarial review by finding them one at a time, and the one that mattered
most was the last one found.

### The NativeScript theme ships almost none of libadwaita's label utilities

`scripts/check-nativescript-theme-classes.mjs` now reads the storybook showcase's views
and templates as well as the bridge's widgets, and it closed three `adw-`-prefixed gaps
(`.adw-card`, `.adw-action-buttons`) plus one unprefixed one it could already see
(`.dimmed`, which had only an ancestor-scoped rule). What it still cannot see is the rest
of the unprefixed half, and the same showcase is full of it: `carousel.ns.ts` builds each
page with `className = 'adw-card accent|success|warning'` and labels it `title-1`,
`bottom-sheet.ns.ts` uses `title-2` — and **not one of those five has a rule** in any of
the three stylesheets `app.css` imports, nor in the `@nativescript/theme` core sheet it
imports first. The pages render at body size in the default colour where the browser twin
sets `font-size:24pt;font-weight:800` and a 14% accent tint
(`carousel.web.ts:12-14,36`), inline, because the web storybook does not use the classes
either.

`bottom-sheet.ns.ts:43` is the one to read first, because it says the quiet part: "Match
the GTK `.title-2` typography (bold heading) — NS has no typography utility class, so a
plain bold Label stands in." There is no stand-in. The next three lines set `text` and
`className = 'title-2'` and nothing else, so the label is neither bold nor larger — a
comment describing a fallback that was never written.

Setting the two properties on the Label is NOT the fix, and this is the trap worth
writing down: NativeScript drops a CSS value for any property a widget set as a LOCAL one
(`properties/index.js:585-598`, the reason `status/nativescript-theme-classes.json`
exempts `adw-icon`), so a local `fontWeight` would permanently shadow the `.title-2` rule
this entry is asking for. The theme rule has to come first.

WHY THE GATE DOES NOT HOLD IT YET, measured rather than assumed. Its tracked set is
`adw-*` plus a named handful of unprefixed classes, deliberately: a bare-word heuristic
would sweep up every lowercase string in the tree. The obvious principled widening — take
the names from `refs/libadwaita/doc/style-classes.md`, which
`check-adwaita-style-classes.mjs` already reads — was tried and measured against the tree
as it stands: **53** documented classes, 15 emitted by the bridge or the showcase, **8
with no unconditional rule**. Four of the eight are noise: `.content`, `.inline` and
`.sidebar` are slot names and property values in `split-view-base.ts`,
`view-switcher-model.ts` and `adw-sidebar.ts` that happen to match a documented class
name, and `.circular` is the equality test `if (style === 'circular')` in
`button-styles.ns.ts:74`. A gate that accuses in four cases out of eight gets routed
around, so the widening waits for a reader that can tell a `className` assignment from
any other string.

That count is 53 and not 52 for a reason worth keeping: `style-classes.md` writes most
classes in backticks and exactly one — `.accent`, the colour-utility table at `:368` — in
`<tt>` tags. `check-adwaita-style-classes.mjs` read only backticks, so a DOCUMENTED
libadwaita style class was outside the gate whose whole job is that document, and its
ledger had no entry for it either. `.accent` has always been implemented on the web
(`scss/_labels.scss:53`); what was missing was anything that would notice if it stopped
being. Both are fixed. The lesson is the shape: a reader keyed on ONE spelling of an
upstream document is a reader with a hole the size of whatever that document spells
differently, and nothing points at the hole.

### The swipe settle drops its velocity, so a flick and a slow drag ease alike

Upstream a released swipe does not scroll — it SPRINGS. `end_swipe_cb` calls
`scroll_to (self, child, velocity)`, which sets the target on an
`AdwSpringAnimation` and then
`adw_spring_animation_set_initial_velocity (…, velocity)`
(`adw-carousel.c:379-397`). So the finger's speed carries THROUGH the settle: a
flick keeps its momentum into the next page, a slow drag eases in, and both use
the same spring rather than the same duration.

The web settle is `scrollTo({ behavior: 'smooth' })`, whose curve and duration are
the user agent's and take no initial velocity. `elements/swipe-drag.ts` hands
`onEnd` the velocity already and `<adw-carousel>`'s handler documents that it
ignores it, so the seam is in place and the number is not lost — what is missing
is something to spend it on.

This is a consequence of a decision the core already records rather than a new
gap: `CAROUSEL_SETTLE_EPSILON`'s comment says the renderers let the PLATFORM
scroll (CSS scroll-snap, a NativeScript `ScrollView`) because C knows a scroll
finished from its own spring and a platform scroller has only an offset. Closing
it means porting `AdwSpringAnimation` — damping ratio, mass, stiffness, epsilon,
and its `estimate_duration` — and driving `scrollLeft` from a rAF loop instead of
handing the browser a target. That buys velocity continuity and costs the
platform's own scroll animation, including whatever it does about reduced motion.
Worth a measurement of the two side by side before it is worth the port.

### `<adw-carousel>` does not work in RTL at all, and the reason is its offset model

Measured in Firefox with `document.documentElement.dir = 'rtl'`, three 440 px pages:

    initial              position 0   scrollLeft 0
    scrollToPage(1)      position 0   scrollLeft 0     <- the PROGRAMMATIC path
    drag right 300 px    position 0   scrollLeft 0
    drag left 300 px     position 0   scrollLeft 0

Nothing moves, including the API call, so this is not about gestures. The element's
whole model is `scrollLeft = position * distance` — `_performScroll`,
`_updatePositionFromScroll`, `_applyScrollFromModel` and `_restorePosition` all
assume it, and the SCSS comment that centre-snapping "leaves `scrollLeft =
position * distance` exactly true" is where the assumption is written down. In an
RTL scroll container the origin is at the RIGHT edge and `scrollLeft` runs from 0
DOWN to `-(scrollWidth - clientWidth)`, so `scrollTo({ left: 440 })` clamps to 0
and `scrollLeft / distance` is 0 forever.

Upstream handles it in one place: `update_orientation` computes
`reversed = horizontal && direction == RTL` and hands it to
`adw_swipe_tracker_set_reversed` (`adw-carousel.c:455-465`), which flips the sign
of every delta the tracker sees. The tracker is only half of it here, though —
`elements/swipe-drag.ts` could take a `reversed` flag in an afternoon, and it
would then compute a correct progress and write it to a `scrollLeft` the container
ignores. So the FIX is direction-awareness in the element's offset model first
(one signed helper, four call sites, plus whatever the two indicators assume), and
the gesture's `reversed` flag after it, in the same change that can test it.

Until then the adapter's axis sign is LTR-only ON PURPOSE rather than by
oversight, and its header says so: a `reversed` branch with no reachable
behaviour behind it is the kind of dead arm this repository keeps deleting.

### `allow-long-swipes: false` does not bound a TOUCHPAD flick on the web

`<adw-carousel>` is a real scroll container with `scroll-snap-type: x mandatory`,
so touch and touchpad swiping are the BROWSER's gestures — momentum, rubber-band
and snapping included — and that is the right answer for those two: GTK is
likewise the platform there, and re-implementing them on top of native scrolling
would replace a real gesture with an imitation. The mouse drag is different, has
no native equivalent, and now runs through `AdwSwipeTracker`'s own decision
(`elements/swipe-drag.ts`).

What the split costs is measurable. `AdwCarousel:allow-long-swipes` defaults FALSE
and means "one flick, one page": upstream enforces it by running the touchpad
scroll through the SAME tracker (`handle_scroll_event`, adw-swipe-tracker.c), whose
`get_bounds` limits the reach to one snap point either side of where the gesture
began. The browser consults nothing of the sort. Measured in Firefox on a
three-page carousel: twenty horizontal wheel notches took `position` from 0 to
**2**, two pages, with the attribute at its default.

Closing it means intercepting native scrolling — `preventDefault` on every wheel
event that is not already handled, then driving `scrollLeft` from the tracker, i.e.
owning the momentum the touchpad driver already provides. That trade needs a
measurement of how the imitation FEELS against the native one before it is worth
making, on a touchpad and on a touchscreen, which is why this is an entry rather
than a fix. The mouse-drag path is the proof the arithmetic is right and shared;
what is missing is a reason to take the platform's gesture away from it.

### adwaita-core modules with no conformance vector table

`breakpoint.ts`, `color-scheme.ts`, `scrolling.ts`, `swipe.ts` and `toast.ts`
export shared behaviour and are covered by nothing in
`@gjsify/adwaita-core/conformance` — no vector table names them, and no
conformance file imports them. Three of them are what `packages/web/AGENTS.md`
advertises as the core's flagship shared behaviour ("Breakpoints
(grammar/parser/evaluator + transition-only `AdwBreakpoint`), color-scheme
observable, toast queue").

`swipe.ts` is the newest and the one with the clearest trigger: it is
`AdwSwipeTracker`'s velocity, projection and snap-point choice, and exactly ONE
renderer drives it today (`adwaita-web`, through `elements/swipe-drag.ts`). A
table now would be the derivation asserted against itself, which is the state
this gate exists to stop counting as coverage. It earns one the moment a second
renderer grows a swipe — and three widgets upstream already want the same
tracker (`adw-bottom-sheet.c`, `adw-navigation-view.c`,
`adw-overlay-split-view.c`), whose web ports currently take `to` as an INPUT
(`resolveSwipeRelease` in `split-view.ts`) with nothing in the tree computing it.

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
`glibClamp` is the sharpest case — `gtk-progress-bar.ts` calls it directly in
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

- **`<gtk-check-button>` and `<adw-radio>` on NativeScript.** The headless half already
  exists: `@gjsify/adwaita-core` carries `RadioGroupState` and `RADIO_GROUP_VECTORS`,
  driven today by core's own spec (`checks.spec.ts`) and the browser suite, by no
  NativeScript spec. What does not exist is the decision. `@nativescript/core` ships no
  checkbox view (nothing under its `ui/`), and libadwaita's own phone idiom for a
  boolean is `AdwSwitchRow`, which this port already has — so the question is whether
  a checkbox belongs on a touch target at all, not how to build one.
- **`<gtk-progress-bar>` on NativeScript.** libadwaita styles the GtkProgressBar node in
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

### The dialect type surfaces sit outside the adapter import-direction check

`scripts/check-adapter-import-direction.mjs` walks `src/adapters/` and holds every
file there to ADR 0027 § 7: no widget-name literal, no placement method, the
vocabulary comes from the table. `src/jsx-runtime.ts`, `src/vue-components.ts` and
`src/react-jsx-runtime.ts` are dialect surfaces of the same kind and are NOT in
that tree, so the rule does not reach them.

Today nothing is wrong: all three files are mapped types over the generated interfaces
and carry zero widget literals, and the generator is what makes a hand-maintained
tag list unnecessary. The gap is the future one — a surface that starts listing
tags by hand would pass every check in the repo. Extending the walk means teaching
it a second root and adding `generated` to `HOST_INTERNALS`, which is more than a
one-line change because that script cross-checks the published `./<framework>`
subpaths against the adapters tree.

### An unknown hyphenated JSX prop cannot be refused, and only a lint rule can

Measured on TypeScript 5.9.3 and 7.0.2, on intrinsics and on components alike:
every attribute whose name contains a hyphen is exempt from excess-property
checking, so `<gtk-box no-such={1}/>` type-checks clean. Three index-signature
shapes were tried and all three either changed nothing or collided with the
declared kebab keys (TS2411).

Both spellings are generated, so a DECLARED `can-focus={'yes'}` still fails on its
value — the hole is only unknown hyphenated names. Closing it needs something
outside the type system: an oxlint rule over `.tsx` attribute names checked against
`WidgetPropsByTag`, or a dev-mode warning in `setProp` when a kebab name resolves
to no ParamSpec. The second is cheaper and catches Vue templates too, which have
the same hole with `strictTemplates` off.

### The React JSX surface has no half in the negative-first type gate

`scripts/check-type-surfaces.mjs` holds the generated type surface with two named
halves — `jsx` (Solid, `jsx: "preserve"`) and `vue` (SFC templates through
`vue-tsc`) — each with its own fixtures, its own annotation grammar and its own
load-bearing-setting probes. `src/react-jsx-runtime.ts` (`jsx: "react-jsx"`,
`jsxImportSource: "@gjsify/gtk-host/react"`) is a third dialect and has no half.

What IS covered: the element list itself. `GtkReactIntrinsicElements` is a mapped
type over the same `WidgetPropsByTag`/`WidgetClassByTag` the `jsx` half already
checks negative-first, so the tags, the properties, the handler signatures and the
enum nicks are the same members under the same gate. What is NOT covered is the
React-specific plumbing: `JSX.Element`, `JSX.ElementType`,
`JSX.IntrinsicAttributes`, and React's `Ref<T>`/`ReactNode` spellings of `ref` and
`children`. Those are the ones the ADR-0028 § 8 measurements were taken on for
Solid, and they were re-derived by reading rather than re-measured here.

The RUNTIME half is covered: `src/adapters/react.spec.ts` renders a tree built by
this runtime's `jsx()` through the adapter, and asserts that `./jsx-runtime`'s
deliberate refusal still throws.

Adding the half is not a one-liner: `checkJsxHalf()` hardcodes `JSX_DIR`,
`JSX_CONFIG`, `JSX_PROBES` and the sentinel config, and a React half needs its own
probes — at minimum "drop `jsxImportSource` and every negative evaporates" and
"point it at `react` and the 208 HTML/SVG/MathML tags come back". A half without
its probes is the checked-nothing shape that whole script exists to refuse, which
is why it is tracked here instead of half-added.

### 138 of 164 generated widgets have no measured placement rule

The generated table names every concrete GtkWidget descendant; the curated table
measures placement for 26. The rest are `children: { kind: 'uncurated' }` — they
can be created, given properties and given handlers, and inserting a child raises
an error naming the tag that needs a policy.

This is the honest state rather than a defect: guessing an adder is what the
`uncurated` kind exists to refuse, because `add`, `append` and `set_child` all
exist somewhere in GTK and calling the wrong one is a warning at exit 0. Curating
more should be driven by a real window that needs one, with its vector, not by
walking the list alphabetically.

### Nothing checks that a published `lib/` holds no test output

`verify-package-outputs.mjs` asserts that every DECLARED output EXISTS, and
`verify-tarball-outputs.mjs` asserts that every declared output is in the TARBALL.
Neither asks the opposite question — whether the tarball also carries files nothing
declared — so a build tsconfig whose `exclude` misses a spec extension ships the
specs and every check stays green.

`@gjsify/rolldown-plugin-vue` had exactly that: `exclude: ["src/test.mts",
"src/**/*.spec.ts"]`, where the other six packages with a `tsconfig.build.json`
also list `src/**/*.spec.mts`. Measured — with only the `.spec.ts` entry, an added
`src/probe.spec.mts` emitted `lib/probe.spec.mjs` + `lib/probe.spec.d.mts`, and
`files: ["lib"]` publishes them. It is now excluded as `src/**/*.spec.*`, one
pattern that cannot miss an extension, which removes the drift for that package
rather than watching for it.

The repo-wide state was measured before reaching for a gate, and it is why there is
no gate: over the non-private workspaces, **84 packages already pack test-shaped
files** — mostly `lib/types/*.spec.d.ts`, and 8 pack executable spec code
(`@gjsify/webgl`'s `lib/esm/conformance/*.spec.js`, `@gjsify/fetch`'s
`lib/*.spec.js`, `@gjsify/adwaita-web`'s `src/*.spec.ts`, `@gjsify/tsc`'s
`src/index.gjs.spec.ts` + `src/test.mts`). Some of those are deliberate — webgl's
conformance suite is something a consumer runs — so the check would need a curated
allowlist on day one, which is the shape this repo keeps deleting. The cheap version
of the mechanism (assert every `src/**/*.spec.*` is excluded from the build
tsconfig) only reaches the 7 packages that HAVE a build tsconfig, i.e. it would
guard the one case already fixed and none of the 84.

So the decision to make first is a policy one: do published packages ship their
specs at all? Once that has an answer, the check belongs in
`verify-tarball-outputs.mjs`, which already computes the packed set per package
from `gjsify pack`'s own oracle and needs no new CI step.

### `gjsify flatpak check` has never run the real appstreamcli

`flatpak check` shells out to `appstreamcli validate --strict`, and no test has ever
fed it a component this repo actually GENERATED. `tests/e2e/flatpak/run.mjs` drives the
command through `writeShim(stubBinDir, 'appstreamcli', 'APPSTREAMCLI_CALLS')` and hands
it the string `<component/>` as the metainfo file, so the suite asserts the CALL SHAPE
(`validate --strict …metainfo.xml.in`) and nothing about the XML. Both linters are
stubbed the same way, and `appstreamcli` was absent from `.docker/ci-fedora.Dockerfile`
until the commit that added this entry, so no CI job could have run the real one either.
And no gate could have said so: `scripts/check-ci-image-packages.mjs` asks "does a job USE
a tool the image never carries" only for `NODE_TOOLS = ['node', 'npx', 'npm', 'corepack']`,
so a suite reaching for `appstreamcli` is outside what it looks at. Widening that question
past the node tools is the mechanism this class wants; it needs a way to derive tool use
from the SUITES rather than from the workflow `run:` lines, which is why it is a ledger
entry and not a one-line change.

What the gap is NOT, so the next reader does not over-buy the fix: an image missing one of
these tools is a RED e2e run, never a green vacuous one. `tests/e2e/ship/fixture.mjs`'s
`probe()` throws for every name in `REQUIRED_ON_LINUX`, and the two `cli-only` cases assert
`hasCommand(...)` instead of branching on it, so no assertion behind them can quietly stop
running. What is missing is only the EARLIER answer — at image-build time rather than at
e2e time. That also names the shape of the fix: `REQUIRED_ON_LINUX` already IS the
declaration, so a check reads it (the way `fixture.mjs` imports `STAGE_MANIFEST_FILE` out
of the CLI rather than restating it) instead of growing a second list beside it. What it
still needs is a binary→package answer that is not a hand-kept table — most plausibly a
smoke step in `build-ci-image.yml` running `command -v` over that same imported set, which
asks the built IMAGE and therefore cannot drift from what the image contains.

The gap is not theoretical. Measured against a component `renderMetainfoApp` produced
for the `ship` e2e fixture, using the flag the command actually passes:

    appstreamcli validate --strict --no-net <stage>/share/metainfo/org.example.ShipDemo.metainfo.xml
    I: org.example.ShipDemo:10: description-first-para-too-short
    ✘ Validation failed: infos: 1, pedantic: 2      # exit 3

`--strict` fails on anything above pedantic severity, so an INFO-level hint is enough.
The same file passes plain `appstreamcli validate --no-net` at exit 0. Two things are
therefore unknown: whether `gjsify flatpak check` passes on any real project, and
whether `--strict` is the severity this command wants — a first description paragraph
under a certain length is a house-style hint, not a defect that should block a build.

Also worth folding in: the command validates the `.in` TEMPLATE rather than the merged
output. Since `gjsify gettext --format=xml` now produces a real translated component
(`msgfmt --xml`, per-catalogue `--locale=` chaining), the file worth validating is the
merged one — the template is missing every `xml:lang` attribute the merge adds.

Fix: drop the appstreamcli shim from that suite, scaffold a project through the real
`flatpak init` renderer, and run the real binary with `--no-net` (its absence otherwise
makes the assertion depend on resolving every `<url>`). Then decide `--strict` on the
evidence that produces.

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

### `gjsify ship` does not localise the MIME package it generates

The freedesktop-metadata localisation added in `packages/infra/cli/src/utils/ship/localize-metadata.ts`
covers the two files `commands/ship.ts` renders into `StageInputs` — the `.desktop` entry
and the AppStream component. It does NOT cover the third generated file a user sees a
string from: `renderMimePackage()` writes a shared-mime-info document whose `<comment>` is
what a file manager shows in place of the raw type string (`mime.ts` refuses an empty one
for exactly that reason), and it stays English for every language.

It is not blocked on anything gettext cannot do. Measured with the same tools:

    msgfmt --xml --template=mime.xml --locale=de --output-file=mime-de.xml po/de.po   # exit 0
    →  <comment>A test application</comment>
       <comment xml:lang="de">Eine Testanwendung</comment>

Note the plain `.xml` name: `shared-mime-info.loc` pairs `pattern="*.xml"` with
`localName="mime-info"`, so this file needs none of the `*.metainfo.xml` suffix care the
AppStream template does. The `.its`/`.loc` pair belongs to the `shared-mime-info` package
(`rpm -qf /usr/share/gettext/its/shared-mime-info.its`), which `.docker/ci-fedora.Dockerfile`
does NOT install — so this cannot be tested in CI until that package is added, and adding a
package for a capability nothing yet uses would be a dependency with no assertion behind it.

Left out of the localisation change on scope: the MIME document is produced inside
`utils/ship/plan.ts` (`source: { kind: 'text', text: renderMimePackage(...) }`) rather than
passed through `StageInputs`, so folding it in means moving where that text is rendered —
in the file that neighbours the layout/stage-writer work. Doing it later costs one call
site; doing it in the same change would have crossed into a tree being rewritten.

### `verify-msi.sh`'s three component assertions pass on an empty Component table

An empty herestring is still one line. `COMPONENT_ROWS=$(awk … <<<"$COMPONENTS" | sort)`
is the empty string when the `Component` parse matches nothing, and `wc -l <<<""` is
**1** — so all three component arms of `.github/ship-oracle/verify-msi.sh` are satisfied
by a table that yielded no rows, provided `ROWS` is 1. Measured, with the exact
expressions from lines 173-186 under `set -euo pipefail`:

    wc -l <<<"$COMPONENT_ROWS" = 1   (an empty herestring is still ONE line)
      line 175 one-component-per-file  : PASSES on zero components
      line 177 component-in-feature   : PASSES on two empty sets
      sort -u <<<"" | wc -l = 1
      line 185 distinct-GUIDs         : PASSES on zero GUIDs

The seam is bounded and is NOT open today: it needs a single-file installer, and with a
realistic `ROWS=14` line 175 reds on `1 != 14`, which is why the shipped fixture closes
it by accident rather than by design. What makes it worth an entry is that the closing
condition is a property of the FIXTURE, not of the oracle — a future one-file artifact,
or a `msiinfo` output change that stops the `NF >= 6` shape matching, reopens all three
arms at once and reports "one component per file" about nothing.

The repair is the one this repo already applies elsewhere: count the rows explicitly and
refuse zero, rather than comparing two line counts that both degrade to 1. `File` already
has that floor one block up (`[ "$ROWS" -gt 0 ] || fail …`); `Component` has none.
Deliberately not fixed in the audit that found it — the release was being cut, and a
shell edit to a gating oracle is exactly the change whose cost cannot be priced in time.

### The registry gate's vacuity control fires on the transition it exists for

`scripts/check-shipped-runtime-packages.mjs` ends with a control asserting that the
disclosure rule has a subject: if `PENDING_BOOTSTRAP` is non-empty and
`dependencySitesSeen === 0`, it reports that "the dependency-line pattern no longer
matches". `dependencySitesSeen` is only incremented on the `live === false && declared`
branch — the `live === true && declared` branch fails and `continue`s above it. So when a
pending name is PUBLISHED, which is the one transition the bidirectional ledger exists to
catch, the control fires as well and blames the regex.

It is a false positive, measured against the tree it accused at the time:

    dependency-line regex matches index.mdx: true
    DISCLOSURE present in index.mdx: true

Observed live: with all three `@gjsify/node-runtime-*` names published and still listed,
the gate reported four problems, of which three were real and the fourth was this. The
cost is not a wrong verdict — the check is correctly red either way — it is a maintainer
sent to debug a working regex while the actual instruction ("delete the entry") sits three
lines above.

The repair is one line: count sites on the published-and-declared branch too, before the
`continue`. Left open rather than applied for the same reason as the entry above, and
because #1427 emptied the ledger, so the control is dormant until the next bootstrap —
which is precisely when someone will meet it cold.

### An in-repo `path:line` citation is checked by nothing

`scripts/check-refs-citations.mjs` holds every `refs/<submodule>/<path>` cited as provenance
against the filesystem. A citation of a path **inside this repository** is covered by no gate at
all, and #1433 proved it costs something: moving `website/src/content/docs/adwaita/controls.mdx`
to `gtk/` left ADR 0034 § Context pointing at a file that no longer exists, plus two reproduction
commands whose glob had silently narrowed. Nothing failed; the ADR simply stopped being
re-runnable, which is the failure this repository cares about most.

Both were repaired by hand (the glob now names both directories and reproduces the same `36 Adw`
/ `4 Gtk`). The gate was NOT written, deliberately: it was found during a release window, and a
new check landing hours before a cut is the change nobody can price. The shape is already
available — `check-refs-citations` resolves with `statSync` and would extend to repo-relative
paths cheaply — and the harder half is the same one it already declines: it asks whether the FILE
exists, never whether the LINE says what the citation claims. A moved file is caught by the cheap
half; a moved line is not, and that is the case that bit `stage.ts:35` three times.
