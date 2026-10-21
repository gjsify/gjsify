<!-- Authored Open-TODO sections — area: NativeScript bridge.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### The NativeScript `xmlns` barrels cannot spell every tag a project's templates use

Which tags, and in which templates, is printed by
`node scripts/report-target-gap.mjs <project-dir>`; this entry carries no list because a hand
measurement is stale as soon as a widget lands. `elementFor` refuses a tag with no member in
`packages/nativescript-bridge/adwaita/src/namespace/{adw,gtk}.ts` by design, so each is a clean
refusal and not a wrong widget. Each tag the report lists becomes a widget with a test, ranked by
the report's summary. `GtkSource.View` goes through ADR 0094, not a one-off widget.


### `withSignals` shadows nothing in `@nativescript/core` today, and nothing holds "today"

`widgets/signals.ts` adds `connect` and `disconnect` to every `@gjsify/adwaita-nativescript`
widget (ADR 0034 § Amendment 14) on the measurement that no view base of
`@nativescript/core@9.1.0-alpha.11` declares either — `Observable`, `ViewBase`, `View`,
`LayoutBase` and their platform variants have none, the one `disconnect(` in the package
is `GesturesObserver`'s, and no runtime `.js` assigns the name. That is the same class of
hazard the `cssClasses` incident came from: `ViewBase`'s constructor assigns a member, a
widget shadows it, and the widget dies inside its own constructor.

The ambient slice `src/ns-core.d.ts` holds the hazard in ONE direction only. A member it
declares makes a shadowing widget fail `gjsify tsc`; a member the real package ADDS later
is a name it cannot declare, so a future core that grows `Observable.connect` would be
shadowed by the mixin with no type error anywhere in this repository, and the first place
it would show is a consumer's build against the real package. What would hold it: a step in
`tests/integration/nativescript` — the one venue with the real `@nativescript/core`
installed — that asserts the two names are absent from every base the widgets extend, and
fails the day one appears. Not built here, because that suite is a device-adjacent leg
nobody runs in the required job, and a guard that runs nowhere is prose.


### Four widgets are real GObject subclasses — 157 are not

ADR 0105 § 2's twin route was reversed on 2026-10-19: on NativeScript Android `registerClass`
now takes a `@nativescript/core` parent, so a widget can BE its own GObject instead of carrying
a twin beside it (the gated divergence, [report](../../docs/reports/2026-10-19-adr-0105-route-d.md)).
`widgets/adw-window-title.ts` is the FIRST port widget that uses it, and the seam it went
through is built: on the real engine `AdwWindowTitle` is a GType over `StackLayout`, with
`bind_property` and `Gio.ListStore` identity; on the pure-JS leg it is byte-identical to what it
was. 133 real-gio and 55 pure-JS device cases on an emulator and a Galaxy S9.

THE SEAM IS `widgets/signals.ts`, and the per-widget cost is now a `Properties` block:
`withSignals(Base, { GTypeName, Properties, Signals })` in the port's own vocabulary
(`kind: 'string' | 'boolean' | 'int' | 'uint' | 'double'`). `meta === undefined` is the old
hand-rolled mixin unchanged, which is why 160 untouched widgets did not move. The engine check
was the hard part the previous note predicted, and it is settled by LAZY REALIZATION: the mixin
cannot ask at class-evaluation time, so it asks at the first CONSTRUCTION of the class. The
consequence is deliberate and documented in the seam header — on Android a migrated widget's
first construction throws unless the app opted in or out explicitly, because real GObject is the
Android default (ADR 0110 § 1) and a silent fallback would report the subset from a payload that
carries the whole engine.

`widgets/adw-spinner.ts` is the SECOND, and the first whose properties are not strings
(`spinning` boolean, `size` double). The coercion trap is solved AT THE SEAM, not per widget:
`signals.ts` `coerceDeclared()` turns an XML string into the declared type on BOTH legs (pure
side: in the declared setter; route D: `wrapRouteDAccessors()` over the accessors node-gi
installed). Only strings are touched; `'true'`/`'false'` for booleans, a finite `Number()` for
number kinds, anything else throws. A property whose reading is more lenient than that (`size`
accepts `"24px"` and floors at 16) declares `normalize`, which replaces the seam's coercion on
both legs. No existing widget's observable types changed (window-title is string-kind). The one
consumer-visible change: `spinning="maybe"` used to become false silently and now throws.
The xml-doors gate accepts a declared number/boolean property and checks the seam still calls
`coerceDeclared` on both legs. 702 trees tests, 1714 pure tests; device: emulator API 36 and a
Galaxy S9, 143 real-gio and 61 pure-JS cases each, `specs/spinner.ts`.

`widgets/adw-action-row.ts` and `widgets/adw-switch-row.ts` are the THIRD and FOURTH, and the
first PAIR: `AdwSwitchRow` is a GType registered over `AdwActionRow`'s GType. Measured on the
device, the chain is `AdwSwitchRow -> AdwActionRow -> GObject` — `GridLayout` is a NativeScript
class with no GType, so the base registration roots at GObject rather than at its host parent.

GObject inheritance needed a CORE fix, in node-gi rather than at the seam. `findParentGType`
walked the class-side prototype chain and read `$gtypeName` through it, so an ordinary class
between two registrations — which is what a widget extending a registered mixin IS — handed it
the mixin's dotless name with no registry entry, and it threw. It now skips a class whose
`$gtypeName` is INHERITED (`hasOwnProperty`) and takes the registered ancestor above it, which is
the answer GJS gives. An OWN dotless name with no registry entry still throws. Host-independent,
tested off-device in `test/multilevel-subclass.test.mjs` and `test/foreign-parent.test.mjs`.

The seam's own change is that declaration state is CHAIN-AWARE: a `DECLARATIONS` WeakMap keyed on
the mixin class, and `realizeChain(new.target)` registering the whole declared chain base-first at
the first construction. A derived class reuses the PARENT's captured gi thunks rather than
capturing its own — `$foreignSkipped` on `AdwSwitchRow` lists all 37 GObject verbs it inherits,
`connect`/`disconnect`/`emit` among them, and that is correct rather than a conflict. There is a
second door now: `withProperties(Base, meta)` for a widget that declares properties and no
routers, which is what the derived row uses.

THREE consumer-visible changes, all narrow: `activatable="maybe"` and `active="maybe"` now throw
(the seam's coercion, same as `spinning` one widget back); the `NotifyActiveEventData` type is
gone, because a real `notify::` carries a `GParamSpec` and not the value — read the state off the
emitter, `(self) => self.active`; and `iconName` no longer throws when something else fills the
prefix slot — it REPLACES it, symmetric with `add_prefix`. That last one is forced, see below.
`SwitchRowState` is gone from the widget and stays in `@gjsify/adwaita-core` for adwaita-web, the
RN pillar and the conformance vectors. 810 pure tests / 1983 assertions; device: emulator API 36
and a Galaxy S9, 172 real-gio and 84 pure-JS cases each, `specs/rows.ts`.

NO BACKWARD COMPATIBILITY (owner, 2026-10-20): no gjsify app exists outside this repo, so a
migration has no third party to spare. The clean GJS-like API is designed and this repo's own
callers — examples, specs, storybook, docs — are updated in the SAME PR. No compat shim, no
deprecated alias, no per-leg migration layer; `NotifyActiveEventData` was deleted under this rule
rather than kept as an alias of `EventData`. A shim would otherwise outlive the reason for it and
become the API.

ONE DOOR PER DECLARED MEMBER, both legs. A declared property's `notify::<prop>` and a declared
signal belong to GObject, and `connect` is the only verb that subscribes to them:
`addEventListener`, `removeEventListener`, `on`, `once` and `off` throw a `TypeError` that names
`connect`, and so does `notify({ eventName: 'notify::<declared>' })`. Five verbs through two
overrides — `on`/`once` call `this.addEventListener` and `off` calls `this.removeEventListener`
in `@nativescript/core` (measured in 9.0.20 and 9.1.3; `View` overrides only the latter two). The
string form `notify('active')` is still `g_object_notify`, and an undeclared NativeScript event
is untouched on all five.

This replaced a REAL per-leg difference, which is what route D may not ship: an
`addEventListener('notify::active')` listener fired off-device and nothing on it, because the
emission belongs to the GObject there. A silence a widget's own specs pass over is worse than a
refusal. To make the refusal reachable on the pure leg at all, that leg's declared emissions moved
off the NativeScript observable into the seam's own `DECLARED_HANDLERS` table — the pure leg now
has exactly the doors route D has. Handler exceptions match too: LOGGED, and the next handler
runs. Measured with the installed `gjs` (a throwing `notify::` handler logs `JS ERROR`, the second
handler still runs, the assignment returns and the property keeps its value) and already node-gi's
behaviour via `SurfacePendingException`. 16 both-legs vectors in `signals-gobject.spec.ts`, 5 on
the device in `specs/rows.ts`.

`widgets/adw-entry-row.ts` is the FIFTH, the second derived registration, and the first whose
properties are not independent of one another: six declared (`text`, `text-length`, `max-length`,
`editable`, `show-apply-button`, `activates-default`) and two declared signals (`apply`,
`entry-activated`, both parameterless as upstream declares them).

THE DELEGATE CHILD, answered: the owned `TextField` is a VIEW, never a store. One funnel each way
— the renderer writes the field from the property, and the field's `textChange` writes back
through `this.text` rather than past it, so typing and a programmatic write take the same
normalizer and the equal-write rule ends the loop. `EntryRowState` is gone from the widget (it
stays in `@gjsify/adwaita-core` for adwaita-web and the conformance vectors); what the widget kept
of it is a handful of additive pure functions there — `clampEntryText`, `entryTextLength`,
`clampEntryMaxLength`, `deriveEntryRowState`, `resolveEntryRowActivation`.

A PROPERTY DERIVED FROM A PROPERTY is the new seam shape. `text-length` is read-only upstream and
read-only here BY DERIVATION: its `normalize` ignores what was written and recomputes from its
SIBLING `text`, which needed `normalize(value, self)` — the seam now hands the instance to the
normalizer on both legs, and `wrapRouteDAccessors` passes it through node-gi's `set_property` too.
A normalizer that must parse an XML string BEFORE its own rule calls the exported
`readDeclaredValue(name, kind, value)` first; `max-length` does, so `maxLength="five"` throws
where `maxLength="5"` clamps. The cost, written down rather than hidden: `notify::text-length`
is emitted from INSIDE the `notify::text` emission.

`setShowIndicator` stayed a METHOD and did not become a property — C:1281-1296 re-derives with no
equality guard, and a declared property would add exactly the guard it must not have.

CONSUMER-VISIBLE: `apply` and `entry-activated` are GSignals reached through `connect`, not
NativeScript events; `NotifyTextEventData`, `NotifyTextLengthEventData` and
`EntryActivatedEventData` are deleted (read the value off the emitter);
`maxLength="five"` throws. `storybook/src/controls.ts` is moved over in the same PR.

An UPSTREAM WRINKLE to keep in view: declaring `max-length` makes it notify on change on both
legs, while `ENTRY_MAX_LENGTH_VECTORS` pins `notifications: 0` because C:1329-1343 has no
`g_object_notify_by_pspec` for `PROP_MAX_LENGTH`. Both are right — `g_object_set_property`
notifies regardless, so upstream's omission only affects its direct C setter, and the vectors
still describe that setter. The pin was left alone.

1746 tests / 4764 assertions (node and gjs), 859 / 2368 trees; device: emulator API 36 and a
Galaxy S9, 194 real-gio and 100 pure-JS cases each, `specs/rows.ts`.

MIGRATE NEXT: `widgets/adw-expander-row.ts`, which `extends AdwActionRow` plainly today with an
`expanded` get/set and an `add_row(child)` list. The QUESTION it raises is the first one about a
property that owns a SUBTREE rather than a view's attribute: `expanded` reveals and collapses
child rows, and upstream pairs it with `enable-expansion` and `show-enable-switch`, where one
property gates another's effect. Not `adw-button-content.ts` or `adw-combo-row.ts` yet: both want
an OBJECT-typed property (`hostButton` is a `View`, `model`/`selected-item` are objects) and the
seam has no ParamSpec kind for one.

ALSO OPEN, from the device run: `emit('<undeclared>')` does NOT throw. The seam's `emit` is also
this port's NativeScript dispatch door, so a name no class declared goes to the observable
instead, where GJS would throw. The refusal `addEventListener` gained in #2325 has no counterpart
on `emit`, and giving it one would make a consumer's own invented event name throw — a decision
with a trade-off, left for the owner.

CARRY THESE: `vfunc_*` does not work on a foreign-parent class, so a widget that needs one stays
on the twin. A REFUSAL MAY NOT LIVE IN A `notify::` HANDLER: an exception thrown there is logged
and the next handler runs — GJS's rule, node-gi's, and now the seam's on both legs — while the
write that caused it keeps its value, so there is nothing for a throw there to reject. That is
what dropped `AdwActionRow.iconName`'s "needs the prefix slot" TypeError; a declared property that
wants to refuse has to do it in a `normalize`, where the seam calls it on both legs before the
value lands. And a name the host
chain owns is skipped, not shadowed: read `$foreignSkipped` in
the device spec when a property silently does not take. For `AdwWindowTitle` it measures
`get_property, set_property, setProperty` — the first two are the PORT's own one-argument
property door answering before node-gi could install the introspected pair, the third is
NativeScript's `Observable.setProperty`. So the list mixes both kinds of owner, and a name in it
is not by itself evidence of a conflict. (The third item is GONE: a handler that
captures an enclosing `this` used to be immortal — node-gi's C↔JS closure cycle — so every
migrated widget had to use the emitter argument. Signal closures hold their callback weakly now,
as in GJS; `finalized=true` on both devices, asserted by `foreign-parent.ts` and `inversion.ts`.
The emitter argument the mixin passes first stays the idiomatic spelling, not a requirement.)

KEEP iOS GREEN: every migrated widget gets a test that builds it under the pure-JS engine
(`engine-target.ios.ts`'s default) and asserts the same properties, notifies and signals as the
Android leg. iOS has no node-gi, so a widget that only works through `registerClass` breaks there
silently — the owner's condition for route D (2026-10-19) is that iOS stays on the twin unharmed.


### The theme-class gate counts a name only if it starts with `adw-`

`check-nativescript-theme-classes.mjs` holds every style class a NativeScript widget emits
against the stylesheet that must carry it, and its filter is one line:

    const isTracked = (name) => name.startsWith('adw-') || UNPREFIXED.has(name);

**Right today, and only because of a distinction ADR 0034 § Amendment 10 had to state
explicitly**: a widget is named after the library owning its GType, a style class after the
design system whose stylesheet carries it. Every class this port emits is Adwaita's — the five
widgets that took GIR names (`GtkButton`, `GtkDropDown`, `GtkEntry`, `GtkMenuButton`,
`GtkImage`) all still set `adw-*` classes, deliberately.

**What it cannot see** is the day that stops being true. A widget emitting a `gtk-`-prefixed
class would leave the gate's sight silently: not reported as unstyled, not reported at all —
the same shape as a seed that matches nothing (#1544), one file over. Measured while renaming
`AdwIcon`: moving its class to `gtk-image` produced *"listed, but no widget emits it any
more"* for the ledger entry and NOTHING for the new class, which is the asymmetry.

**Why it is not widened now.** A rule widened before it has a case to serve is a rule nobody
can check: with no `gtk-`-prefixed class in the tree, the widened filter and the current one
are indistinguishable on every input, and the vector that would separate them has to invent
the thing it tests. The trigger to act is the first widget that genuinely wants a GTK-named
class — at which point the filter becomes `startsWith('adw-') || startsWith('gtk-')` and the
ledger keys move with it.


### `Adw.Avatar:custom-image` has no NativeScript counterpart, and the blocker is the CLIP

`AdwAvatar` on `@gjsify/adwaita-nativescript` now carries four of its GType's five
writable properties — `text`, `size`, `showInitials` and `iconName`. The fifth,
`custom-image`, is not there, and the reason it is an entry rather than a fix is worth
stating precisely, because the property's own header comment used to give the wrong one
("the CSS-subset widget has no icon-theme lookup") for the two that WERE implementable.

The VALUE is not the obstacle. `Adw.Avatar:custom-image` is a `GdkPaintable`, and
NativeScript's honest counterpart is `ImageSource` (a decoded `android.graphics.Bitmap`
/ `UIImage`) or the `src` string an `Image` already accepts — the browser element next
door settled the same question by taking an image URL. The obstacle is that
`update_visibility` puts the image INSIDE a circle, and this port cannot show that a
NativeScript view clips a bitmap to one:

  · `packages/nativescript-bridge/AGENTS.md` records the measured fact that NS does not
    clip children to a parent's border-radius — which is why every row here is
    transparent and the `.boxed-list` card paints the rounded fill. So the avatar's own
    `GridLayout` radius will not clip a child `Image`.
  · An `Image` carrying its OWN `borderRadius` is a different question and the answer is
    per-platform. iOS sets `clipsToBounds = true` on every image
    (refs/nativescript/packages/core/ui/image/index.ios.ts:88#clipsToBounds), so a layer
    corner radius clips there. Android routes background *and* the four corner radii
    into one `org.nativescript.widgets.BorderDrawable.refresh(…)` call
    (refs/nativescript/packages/core/ui/styling/background.android.ts:79#borderDrawable.refresh),
    which is the BACKGROUND drawable — an `ImageView`'s own drawable is painted above it,
    and whether that one is clipped is Java this repo does not vendor.
  · A `background-image` on the avatar's GridLayout would go through that same
    `BorderDrawable` and might therefore be clipped for free. That is an inference from
    one call signature, not a measurement, and `background-size: cover` is a second
    unmeasured assumption on top of it.

So the honest state is: one of two plausible implementations, neither verified, on a
port whose iOS half is unverified on device at all (#1051). What closes this is a run,
not a design decision — set a square photo on an avatar under both spellings on an
Android emulator and an iOS device, and see which (if either) comes out round. Until
then a `customImage` setter would be a property that silently draws a square where GTK
draws a circle, which is the shape this repo treats as the defect rather than the
fallback.

Note for whoever picks it up: `avatarMode` in `@gjsify/adwaita-core` already returns
`'image'`, `avatarVisibilities` in `widgets/avatar-view.ts` already answers for it, and
`AdwAvatar._applyMode` passes a hardcoded `hasCustomImage: false` with a comment saying
so. The wiring is one property and one child view; only the clip is open. The vocabulary
ledger cannot hold this: `NS_PROPERTY_ALIGNMENT` measures properties the PORT has that
the GIR counterpart does not, so a GIR property the port LACKS is invisible to it and to
every other gate in the tree.


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


### The NativeScript list-model setter is held by core's vectors, not by a widget test

`AdwComboRow.model` and `GtkDropDown.model` on `@gjsify/adwaita-nativescript` run
`normalizeComboOptions`, so one authored model — bare strings included — moves
between the surfaces unchanged (ADR 0046 § 5). It fixed a real defect: the setter
took descriptors only, so `model = ['a', 'b']` stored strings and every label read
back `undefined`.

Nothing in that package asserts it. `drop-down.spec.ts` and `index.spec.ts` drive
`ComboState` directly, for the reason `drop-down.spec.ts`' own header gives: the
widget module cannot be imported there, because `GtkDropDown extends StackLayout`
evaluates the bare `@nativescript/core` specifier at module-eval, which is
unresolvable on GJS and on Node. `LIST_NORMALIZE_VECTORS` is driven through the
browser elements' real `model` property and through core, so the RULE is measured
twice — but the NativeScript widget's own door is measured by nothing, and this is
what a reader should know before treating that surface's normalisation as covered.

The same gap covers every other pure-delegation line in those two widget classes.
What closes it is whatever eventually lets a NativeScript widget module be
evaluated in the suite — the `ns-core.d.ts` ambient slice is the type-level half of
that problem and does not run anything.

