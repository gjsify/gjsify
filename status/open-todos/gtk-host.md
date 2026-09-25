<!-- Authored Open-TODO sections — area: @gjsify/gtk-host.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

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
   retirement condition, now spelled as `retire-when:` clauses over
   `src/generated/widgets.ts` and #1446 rather than as a sentence. The day both rows
   leave the table and the issue closes, `scripts/check-probe-retirement.mjs` fails and
   names the step; nobody has to re-read this paragraph for that to happen.
2. **The diagnosis.** Five of the six assertions die as a bare `TypeError: Cannot read
   properties of undefined (reading '$gtype')`, which does not say WHICH row. A
   conformance test whose subject is "the table vs the installed typelib" should report
   an absent class by name rather than dereference it — otherwise the next OS finding
   arrives as six anonymous type errors, which is how this one nearly did.


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
edge exists) and asserts identical arrays over a table of injected host shapes.
That is the repo's own sanctioned shape for a deliberate duplicate, the same one
`impliedExampleNodeEntry()` uses against the CLI's `resolveNodeEntry()`. It now
compares all THREE copies rather than two — see below for what that cost.

**The stated blocker is stale, and it was hiding a live drift.** This entry says
the lift needs a NEW npm name (`@gjsify/system-gi`), deferred because a first
publish plus Trusted Publisher bootstrap is expensive and the `@gjsify/tls-native`
incident showed a half-bootstrapped name stalling 60+ packages. That is no longer
the choice on the table: `@gjsify/utils` is Tier 1, its `/core` subpath is PURE by
ADR 0014, it has held `system-gi-dirs.ts` — a third copy of this exact rule — since
#1160, and `@gjsify/cli` already declares `@gjsify/utils` in `dependencies`. So the
shared home EXISTS and is already paid for; what is owed is a delegation, not a
package.

Until that delegation lands, the third copy is the dangerous one, because for its
whole life nothing compared it to anything: the agreement suite reached node-gi and
the CLI only. Measured by mutating each copy in turn — reversing the ORDER
`giLibraryDirsForTypelibDir` offers its two candidate libdirs (the order decides
which directory a bare leaf resolves from) left every suite in this repo green when
done in `@gjsify/utils`, and caught it in the other two. Its hand-rolled `dirname`
had also been disagreeing with both `posix.dirname` mirrors on any typelib dir
written with a trailing slash. Both are fixed and the suite now covers three;
whoever does the delegation deletes the CLI copy and shrinks that suite to two.


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


### The list widgets GTK builds with a METHOD have no portable collection, and a model type is the wrong fix

The other half of #1524, and it is deliberately NOT what ADR 0046 built — nor what its
§ Amendment built. The seam half, the `coerce` branch that turns the portable list model
into a `Gtk.StringList` for the widgets that HAVE a `model` property, landed with that
amendment (`Adw.ComboRow` and `Gtk.DropDown` carry their framework snippets now, and
`Adw.SpinRow` with the adjustment's), and the entry that tracked it is gone. This entry is
the other half and stays open on purpose: a curated descriptor per widget, driven by a real
window, which no value seam can substitute for.

A list `model` property exists on five GTK widget interfaces
(`AdwComboRow`, `GtkDropDown`, `GtkColumnView`, `GtkGridView`, `GtkListView` —
read from `packages/framework/gtk-host/src/generated/props.ts`). For the widgets
that carry most of the divergence the property does not exist at all:
`AdwSidebarProps` has `dropPreload`/`filter`/`menuModel`/`mode`/`placeholder`/
`prefix`/`selected`/`suffix` and no item list; `AdwTabViewProps` has
`defaultIcon`/`menuModel`/`selectedPage`/`shortcuts` and no page list;
`AdwToggleGroupProps` has `active`/`activeName`/`canShrink`/`homogeneous` and no
toggle list. Items are ADDED — `adw_sidebar_append()`, `adw_tab_view_append()`,
`adw_toggle_group_add()` — which is why every one of those ports invented its own
container and why `scripts/check-vocabulary-alignment.mjs` records each as `own`
rather than as a name to converge.

So a portable model type for them would be a GTK word on a value GTK does not
have, and it would not unblock the thing that looks like it should: those widgets'
gallery blocks are refused for `uncurated-placement`, which is gtk-host's
descriptor refusal — `scripts/adwaita-gallery-trees.mjs` says so in place, "a
property of the descriptor table on `main`, not of the widget".

The fix is therefore a curated descriptor in
`packages/framework/gtk-host/src/descriptors/` using the `ChildPolicy` kinds that
already exist (`single`/`ordered`/`indexed`/`keyed`/`slotted`), one widget at a
time, each with the vector that proves the adder is the right one. That is the
same work as the entry below, which holds the count and the reason guessing an
adder is refused — this entry exists so the LIST half of #1524 is not read as
undone by oversight.


### No window in this repository needs a curated placement rule

The generated table names every concrete GtkWidget descendant; the curated table
measures a CHILD policy for a fraction of them. The rest are
`children: { kind: 'uncurated' }` — they can be created, given properties and given
handlers, and inserting a child raises an error naming the tag that needs a policy.

This is the honest state rather than a defect: guessing an adder is what the
`uncurated` kind exists to refuse, because `add`, `append` and `set_child` all
exist somewhere in GTK and calling the wrong one is a warning at exit 0. Curating
more should be driven by a real window that needs one, with its vector, not by
walking the list alphabetically.

**So the drive was measured, and it came back EMPTY.** Every tree in this repository
that renders through `@gjsify/gtk-host` was swept for both tag spellings — the four
`showcases/gtk/*-host-counter` apps, the three `adwaita-gallery-*` showcases,
`examples/`, `packages/framework/react-native` (incl. `src/primitives/table.ts` and
`src/lists`), `packages/framework/adwaita-react-native/src/widgets`,
`packages/nativescript-bridge`, `scripts/adwaita-gallery-*.mjs` and `website/`:

- **0** uncurated widgets are given a materialised child anywhere.
- **19** are used, and every one of them as a LEAF: `AdwAvatar`, `AdwBanner`,
  `AdwButtonContent`, `AdwButtonRow`, `AdwComboRow`, `AdwEntryRow`,
  `AdwPasswordEntryRow`, `AdwShortcutLabel`, `AdwSpinner`, `AdwSpinRow`,
  `AdwSplitButton`, `AdwSwitchRow`, `AdwViewSwitcher`, `AdwViewSwitcherBar`,
  `AdwWindowTitle`, `GtkDropDown`, `GtkListView`, `GtkMenuButton`, `GtkPicture`,
  `GtkTextView`. A leaf needs no policy at all.
- **6** are ATTEMPTED as a parent and refused on purpose, all in one place:
  `showcases/gtk/adwaita-gallery-solid/src/refusals.ts`, which probes
  `AdwBottomSheet`, `AdwCarousel`, `AdwSidebar`, `AdwTabView`, `AdwToggleGroup` and
  `AdwViewSwitcher` and asserts the refusal is still true.
- Everything else in the trees that wraps children routes the wrap through an
  already-curated container (`GtkBox`, `AdwToolbarView`'s slots, `AdwHeaderBar`'s).

Two sweep trees turned out not to be consumers at all, which is worth writing down
because both LOOK like ones: `packages/nativescript-bridge` writes its own
NativeScript `View` subclasses resolved through XML namespaces, and the `html`
preview fences under `website/src/content/docs/adwaita/` are `@gjsify/adwaita-web`
custom elements — a neighbouring vocabulary, several of whose tags
(`adw-sidebar-item`, `adw-tab-page`, `adw-carousel-indicator-dots`) have no gtk-host
row at all.

**What that leaves as the next step, and it is not "curate the list".** The six
probed refusals are the only measured demand, and the GIR says what each would need:
`AdwBottomSheet` is `slotted` over `set_content`/`set_sheet`/`set_bottom_bar`;
`AdwCarousel` is `indexed` over `insert(child, position)`/`remove`; `AdwToggleGroup`
is `ordered` over `add`/`remove` and takes only `AdwToggle`; `AdwSidebar` the same
over `insert`/`remove` and takes only `AdwSidebarSection`; `AdwViewSwitcher` has NO
child-taking method at all and is honestly `children: { kind: 'none' }`, not
`uncurated`; `AdwTabView` is the one with no clean pair, because `insert` hands back
an `AdwTabPage` and removal is `close_page(page)`.

Curating any of them is a GALLERY change, not a table change: `ADWAITA_GALLERY_REFUSALS`
in `scripts/adwaita-gallery-trees.mjs` and arm 5b of `check-generated-website-data.mjs`
hold the refusal list against the descriptor directory in both directions, so a
descriptor landing without its authored gallery tree fails the check — by design. The
vector each one needs is that tree.


### A host-routed `notify::` handler is deaf to the layer's own write, and nothing says which ones may be

`@gjsify/gtk-host`'s echo guard drops any `notify` / `notify::<prop>` handler it installed while
a host property write is open — module-wide, not just on the object being written
(`inHostWrite() && isNotify` in `signals.ts`). That leg is deliberate and it has four measured
cases behind it: it is what stops a controlled `<TextInput>` re-entering `onChangeText`, a
`Adw.SwitchRow` re-entering `onNotifyActive`, an `Adw.EntryRow` its `onNotifyText`, and it is
what `policies.ts`' `writeVisible` deliberately buys when it brackets `hideBeforeRemove`.

The consequence is a CLASS: any prop that routes a `notify::` through the host fires on every
change EXCEPT the one the framework itself made. Three sites, all measured, and the guard is
right on some of them and wrong on others with nothing to tell them apart:

- **`accessibilityLiveRegion` on `<Text>` (ADR 0039).** The one prop whose whole purpose is to
  fire on that write — a `<Text>`'s content IS a host write into `Gtk.Label:label`. Bound as an
  `on:notify::label` prop it announced a change made from outside React and never the one the
  application made. Fixed in the PR that found it: `announce.ts` connects with
  `widget.connect()` directly, and the obvious test (`label.label = …` from a spec) was green
  the whole time it was broken.
- **`AdwComboRowProps.onNotifySelected` and `AdwSpinRowProps.onNotifyValue`.** Measured on
  libadwaita 1.9.3: a re-render from `selected={0}` to `selected={2}` moves the widget and calls
  nothing, while `row.selected = 1` from outside React calls it; the spin row the same, reached
  through the memoised `Gtk.Adjustment` it re-sets rather than a `value` property. The props file
  claimed the opposite in capitals ("FIRES ON EVERY CHANGE, INCLUDING A PROGRAMMATIC ONE") for
  the life of the surface. Now named as a divergence in `@gjsify/adwaita-react-native`'s README
  and pinned by two vectors in `preferences.gtk.spec.tsx`, in BOTH directions — only the pair
  distinguishes "suppressed" from "never connected".
- **`onNotifyActive` / `onNotifyText` / `onNotifyExpanded` / `onNotifyVisibleChild`,
  `onChangeText`, `onValueChange`.** Suppression is the intended behaviour and each one says so.

What is missing is the DISCRIMINATOR. Which side of the guard a `notify::` binding belongs on is
a fact about the prop, and today it lives only in prose: nothing in `PRIMITIVES`, in
`adwaita-react-native`'s props file or in the host declares "this handler must hear the layer's
own write", so the next such prop is written as an `on:notify::` route, tests green against an
external write, and ships announcing nothing. A route kind (`announce` is the precedent — it is
a table field, and it is the reason both L3s subscribe directly) or a per-binding declaration
checked by the surface gates would make the class visible; naming it here is not that check.


### The window-chrome check fires at startup only; a composition that breaks LATER is unwatched

ADR 0043's amendment takes option A of #1546: `AppRegistry` runs
`@gjsify/gtk-host/conformance`'s `windowChromeProblems()` over its own window, once, on the
idle after `map`, ungated, and publishes the answer as `lastWindowChromeProblems()`. That
catches the shape the instrument was built for — #1460 was an application that OPENED with two
close buttons — and it is the only option that fires for a consumer who never writes a vector.

It does NOT catch a composition that goes wrong after startup, and the reason it cannot is the
instrument's own: the invariant is about the RESTING composition, `Adw.NavigationView` keeps a
departing page mapped while the arriving one slides in, and a per-commit check would therefore
report a defect for every push. Measured in `gtk-host/conformance/window-chrome.ts`' own header:
four mapped header bars and four sets of controls at the moment a nested tab group is entered.

So option B is still open and is what answers the rest: a `WindowChromeProblems` method on
`@gjsify/devtools`, beside `DumpTree`/`Screenshot`. Zero cost when nobody asks, no layering
question, and it composes with the headless driving a driver already does — walk an
application's routes and ask after each, at a moment the driver knows is resting. The case
#1546 was written from is exactly that: a `headerShown: false` screen pushed on top of a
bar-ful root stack, which is a NAVIGATION and not a launch.

Blocked on nothing but the decision to spend a devtools method on it.


### A `ViewStack` page removed mid-transition can crash, and gtk-host is where it would be avoided

The crash itself is upstream libadwaita's, and it is ledgered where this repository puts an
upstream gap: `status/upstream-patch-candidates.md` carries the source reading, #1453's
reporter's backtrace, why `AdwViewStack:enable-transitions = false` is not an escape, what a
consumer can do meanwhile, and the upstream ask. This entry is only the half that is ours, so
there is one copy of the mechanism rather than two.

`@gjsify/gtk-host`'s reconciler is what removes an `AdwViewStack` page one at a time, so it is
the layer that could keep the dangling pointer from being created at all. The lead is in
libadwaita's own source: `update_child_visible` clears `last_visible_child` whenever the page it
names stops being visible (`adw-view-stack.c:1073`), so hiding the child and letting that notify
land before the remove would take the freed page out of play through public API.

NOT done in #1567, and the reason is that it would be a guard nothing measures. These vectors
never remove a `ViewStack` page one at a time — React unmounts a deleted subtree from its top and
the pages go with the stack — so reaching the crash needs a route set that SHRINKS while the
window is mapped, and nothing in the tree builds one.

BLOCKED ON THE VECTOR, not on the decision: build the shrinking-route-set case first. If it
reproduces the assertion, the hide-then-remove belongs in gtk-host's `ViewStack` descriptor with
that case holding it, and both retire the day the upstream fix ships.


### `registerBuiltinWidgets()` and the shell lifecycle past `toShellOptions` have no vector

Carried out of `### \`react-native-devtools\` needs a display, and one already exists in CI`,
which this round deletes: that entry existed because the suite had no host and listing it would
have bought a silent suite. It has a host now (#1550), so the entry's premise is gone — but the
residue #1549 recorded is not, and it would have gone with it.

What is still guarded by nothing that CI runs: `registerBuiltinWidgets()`, and everything past
`toShellOptions` — the shell's own lifecycle wiring (`installDevtools` at `startup`, `activate`
building the window, `runAsync`). ADR 0043's amendment split `runApplication` at
`mountApplicationRoot` and `ownTheApplication` precisely because the entry point cannot be
reached from a spec: a nested `g_application_run` inside the runner's own main loop never
returns (measured: `g_application_run: assertion '!application->priv->must_quit_now' failed`,
the case timed out at 5 s). So these need the LOOP, which is what the e2e host now provides —
the work is writing the vectors, not finding somewhere to run them.


### `AdwTabView`'s id-taking methods, where libadwaita takes the page

[ADR 0048](../docs/adr/0048-page-selection-by-identity.md) made `selectedPage` the door on
both renderers and widened `TabViewState.setSelectedPage` to take the PAGE as well as an id
— that one had to move, because `page_belongs_to_this_view` cannot be answered from an id:
ids are unique within ONE view (`_nextId` counts per view), so `a.setSelectedPage(b.pages[1])`
read as an id selected `a`'s own page of that id. The core refuses it now, with the
diagnostic C raises.

What was left was the rest of the family: `isClosing(id)`, `closePage(id)`,
`closePageFinish(id, …)` and `setPagePinned(id, …)` all took an ID where libadwaita takes an
`AdwTabPage *` (`refs/libadwaita/src/adw-tab-view.h:150#adw_tab_view_set_selected_page` is
the shape for all of them). Each carried the same latent confusion the selection one did,
and none produced a measured defect — which is why they were here rather than in that ADR.
The entry said to settle them together or not at all, because an id-taking `closePage`
beside a page-taking `setSelectedPage` is itself the asymmetry.

**Settled on `@gjsify/adwaita-nativescript`**, together, in the pass that emptied the
vocabulary gate's method column: the eighteen page verbs took their GIR names and the
widening with them, so `close_page`, `close_page_finish` and `set_page_pinned` take an
`AdwTabPage` or the id, narrowing through one `pageHandle` helper exactly as the core's
`setSelectedPage` narrows. `isClosing` stayed under its own ledger entry: the state between
`close_page` and `close_page_finish` is internal to `Adw.TabView` and observable only
through the `close-page` signal, so there is no counterpart method to converge to. What remains is the same family on `<adw-tab-view>`, where the element's own
methods still take the id alone.



### A tab page with no `page-id` cannot be named from markup, and the reflection then leaks a generated id

`<adw-tab-view selected-page="…">` (ADR 0048 § 3) names the page by the id
`<adw-tab-page page-id>` declares. A page that declares none gets `_nextId()`'s value, which
an author cannot predict — so for those pages the markup door is write-never, and the
reflection writes that generated id back into the DOM where it reads like an API.

`<adw-view-stack visible-child-name>` has the same shape for a page with no name and it has
never been a problem in practice, which is the only reason this is an entry rather than a
blocker. The candidate fixes both have costs worth measuring before picking: making
`page-id` required is a breaking change to every declared page, and deriving the id from the
title makes it move when the title does.



### `headerbar.flat` is deprecated upstream, and the port just made it a first-class value

[ADR 0049](../docs/adr/0049-style-classes-are-a-list.md) turned `AdwHeaderBar.flat` into
`styleClasses='flat'` — a real convergence in shape, and a class libadwaita is retiring. The
citation trail is the finding: `refs/libadwaita/src/stylesheet/widgets/_header-bar.scss` has
no `.flat` DEFINITION at all, only `.titlebar headerbar:not(.flat)` in a window-shadow
block; the class lives in `_deprecated.scss:456#headerbar.flat` and `adw-header-bar.c`
mentions `flat` nowhere. Upstream's replacement is `AdwToolbarView`, whose
`top-bar-style`/`bottom-bar-style` carry the same look as an ENUM on the container rather
than a class on the bar.

Nothing is wrong today: the class still exists, still styles, and the port's own stylesheet
is what renders it. What is open is which side of the deprecation this port follows, and it
is not a rename — `AdwToolbarView` is a widget this port does not have, and
`@gjsify/adwaita-react-native` already carries `topBarStyle`/`bottomBarStyle` on its own
toolbar props (`props.ts:145-147`), so the two surfaces would answer differently until one
of them moves.

Worth settling with the same measurement the rest of ADR 0049 used: what does
`refs/libadwaita`'s own demo do, and what does `adwaita-web` render for a flat header today.

