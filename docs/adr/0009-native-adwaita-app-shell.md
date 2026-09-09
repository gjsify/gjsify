# ADR 0009 — Native Adwaita app shell: extract the GTK application shell

- **Status:** Accepted (2026-07-08)
- **Scope:** new `@gjsify/adwaita-app`; consumers `@gjsify/storybook` (opportunistic
  re-base), plus the two studio apps that motivated it (buchhaltung, eco-retrofit)

## Context

Every native GJS/Adwaita application built on gjsify re-implements the same
application-shell plumbing by hand. Two independent studio apps prove the
duplication concretely:

- **buchhaltung** (`app/src/frontends/desktop/`) — `Adw.Application` subclass with
  `runAsync()` bootstrap, `installDevtools` on `startup`, standard `app.quit`
  (`<primary>q`) + `app.about` → `Adw.AboutDialog`, an `Adw.NavigationSplitView`
  nav shell (sidebar `Gtk.ListBox.navigation-sidebar` + content `Gtk.Stack` +
  `Adw.Breakpoint(max-width: 720px)` collapse, driven by a data `NAV_ITEMS` array),
  an async-view mounter (`loadIntoStack` + a monotonic `LoadToken` stale-guard),
  promise dialogs, a singleton toast helper, and `BH_APP_*` dev-hook env vars.
- **eco-retrofit** (`cli/src/app/`) — the *same* `Adw.Application` subclass, the
  *same* devtools-on-startup wiring, the *same* NavigationSplitView + sidebar +
  ViewStack + 720px breakpoint nav shell, a `Gtk.FileDialog` open helper, an
  observable store, and `ER_APP_*` dev-hook env vars.

The pattern is not hypothetical: gjsify already implements it once, correctly, in
**`@gjsify/storybook`** (`StorybookApplication` — CSS via
`Gtk.CssProvider.load_from_string`, `installDevtools(this, { enabled, extend })`,
`DEFAULT_FLAGS`, `runAsync([...ARGV])`, get-or-create window on `activate`). But
that shell is storybook-specific; a general app cannot reuse it.

Two costs follow from leaving it un-extracted:

1. **Divergence + drift.** eco-retrofit boots with `Adw.Application.run(null)`, not
   `runAsync()`. That is a latent hang: the moment it adds an asynchronous view load,
   the GJS promise-job queue is not flushed and the view hangs on its spinner — the
   exact bug buchhaltung already hit and fixed by switching to `runAsync()`. The two
   apps also differ on toast, dialogs, and file-open — each solved once, in the wrong
   place.
2. **A shared gap neither app fills.** Neither sets up a `Gtk.CssProvider` or
   `Adw.StyleManager` color-scheme bootstrap; both rely on ad-hoc `get_color()`
   theme-tracking. The one place this *is* done well is storybook's `_initStyles()`.

This is precisely the bar the framework pillar sets for a helper (per AGENTS.md,
"Framework — `packages/framework/*`"): *a helper lands only when it delivers what
inline bootstrap cannot — multi-subsystem wiring, convention-over-config, composable
lifecycle.* The app shell is multi-subsystem wiring (Application + devtools + CSS +
navigation + async mounting + dialogs), and it is duplicated across two real
consumers plus storybook.

## Decision

1. Create **`@gjsify/adwaita-app`** in `packages/framework/` — a composition-first,
   GJS-only (`runtimes {gjs: polyfill, node/browser/nativescript: none}`), **tier 2**
   framework package holding the reusable native Adwaita application shell. It is the
   `storybook-core` / ADR 0004 (`adwaita-core`) seam pattern applied to the
   *application* layer: the generic wiring lives here; apps compose it.

2. **It composes standard Adw/GTK, it does not hide it.** Consistent with the
   framework rule that showcases use raw `Adw.Application`/`ApplicationWindow` to
   *demonstrate* the API, `adwaita-app` is opt-in wiring for the parts that are pure
   boilerplate (lifecycle, devtools gate, CSS bootstrap, about/quit actions,
   nav-split-view scaffolding), never a wrapper that conceals the toolkit. A consumer
   still writes its own views as plain `Gtk.Widget`s.

3. **Scope of the first version** (resist over-abstracting, per ADR 0004 §Consequences):
   - `runAdwaitaApp(options)` + an `AdwaitaApp` base: `runAsync` bootstrap (the
     correct default — kills the `.run()` latent-hang class), `DEFAULT_FLAGS`,
     get-or-create window on `activate`, optional CSS-string load on `startup`,
     `installDevtools` gate, and standard `app.quit` (`<primary>q`) + optional
     `app.about` → `Adw.AboutDialog` from an `AboutInfo`.
   - `createNavShell({ navItems, onSelect, … })`: `Adw.NavigationSplitView` + sidebar
     `Gtk.ListBox` + content `Gtk.Stack`/`Adw.ViewStack` + `Adw.Breakpoint(720px)`
     collapse, driven by a data `NavItem[]`.
   - Async-view mounter: `LoadToken` (monotonic stale-guard) + `loadIntoStack`.
   - Interaction primitives: `confirmDialog`/`errorDialog` (`Adw.AlertDialog`,
     promise-based), `registerToastOverlay`/`showToast`, `pickFile`/`saveFile`
     (`Gtk.FileDialog`, promise-based).
   - `readAppDevHooks({ prefix })` → `{ view?, file?, debug? }` — the `BH_APP_*` /
     `ER_APP_*` env reader, parameterized by prefix.

4. **Adoption is opportunistic, not a rewrite.** New native apps start on
   `adwaita-app`; buchhaltung and eco-retrofit adopt on their next shell touch (both
   currently consume *published* `@gjsify/*`, so adoption follows the next release
   train, not this PR); `@gjsify/storybook` may re-base `StorybookApplication` onto
   the base class when next touched. No "while-I'm-here" sweep.

## Consequences

- Shell bugs (the `runAsync` hang, focus/teardown, breakpoint thresholds) are fixed
  once. `runAsync` becomes the default, so the latent-hang class cannot recur.
- The CSS/`StyleManager` bootstrap that neither studio app has becomes a one-line
  option, reusing storybook's proven `_initStyles()` approach.
- Pure-logic pieces (`LoadToken`, `readAppDevHooks`, nav-item filtering) are
  unit-tested on GJS + Node headlessly. The GTK-widget pieces (nav shell, dialogs,
  toast, file dialogs) are **type-checked + built** and mirror code already running in
  two apps + storybook, but cannot be asserted headlessly (no display in CI/sandbox) —
  same limitation every `packages/framework/*` GTK package carries.
- Cost: one more package on the release train (ADR 0008), and a small API-surface
  design to keep composition-first (no god-object `App` that owns everything).

## Implementation

1. Package scaffold (`packages/framework/adwaita-app/`, mirror `@gjsify/devtools`'s
   `package.json`/`tsconfig`/scripts), `gjsify.tier = 2`, GJS-only runtimes triplet,
   deps `@girs/{adw-1,gdk-4.0,gio-2.0,glib-2.0,gobject-2.0,gtk-4.0,gjs}` +
   `@gjsify/devtools` (`workspace:^`).
2. Implement the base + nav shell + mounter + primitives + dev-hooks reader as pure
   named exports (no `/register`, no `globalThis` writes — framework rule).
3. Tests: `*.spec.ts` (Node + GJS) for `LoadToken`, `readAppDevHooks`, nav filtering;
   `*.gjs.spec.ts` for anything needing a GJS-only type.
4. `gjsify tsc --noEmit` + `gjsify build` green; add the package's authored status
   entry to `status/status.json` (tables, tiers and metrics derive themselves) and
   to AGENTS.md's framework table.
5. Follow-up (`status/open-todos.md`): release + first-publish/Trusted-Publisher
   bootstrap (maintainer-gated, needs npm OTP), then wire buchhaltung + eco-retrofit +
   storybook onto it on their next shell touch.

## Amendment 1, 2026-09-09 — the app ships its icons, and GTK defers to the host theme

The shell gained a startup icon bootstrap beside the startup CSS one: a subset of
`@gjsify/adwaita-icons` compiled into the app's own GResource and registered with the icon
theme, so `icon-name` resolves without the host having the Adwaita set installed. Before it,
`add_resource_path` and `add_search_path` had ZERO hits in every `.ts`/`.js`/`.mjs`/`.tmpl`/
`.blp` outside `node_modules`, and a documented icon name drew whatever the host had — or
the broken-image paintable.

### The declared divergence, and why it is a decision

**Under the default `prefer: 'fallback'`, GTK is the only one of the three renderers whose
drawn glyph is not determined by the toolkit.** That is deliberate, and this is where it is
recorded rather than discovered.

The other two have no host theme to defer to. `@gjsify/adwaita-web` resolves a name against
its compiled subset in `packages/web/adwaita-web/src/icon-registry.ts`, and the NativeScript
port against its own in `packages/nativescript-bridge/adwaita/src/widgets/icon-theme.ts`
(ADR 0034 § Amendment 16) — a browser and a phone runtime ship no icon theme, so both always
draw the shipped Adwaita glyph. GTK does have one, and
`Gtk.IconTheme.add_resource_path()` CONTRIBUTES to it rather than overriding it: its own GIR
doc says "make application-specific icons available as part of the icon theme". Measured on
gtk4 by asking `lookup_icon(...).get_file().get_uri()`, which is the file the widget paints:

| host icon theme | `list-add-symbolic` resolves to | |
|---|---|---|
| Adwaita (defines the name) | `file:///usr/share/icons/Adwaita/…` | the HOST's glyph |
| oxygen | `resource:///…` | the app's glyph |
| Bluecurve | `resource:///…` | the app's glyph |
| hicolor | `resource:///…` | the app's glyph |

So on a Papirus or Breeze desktop, the glyph the gallery documents and the glyph the app
draws can differ. **That is the intended behaviour, not a gap:** a user who installed a
different icon theme chose it, and honouring it is what GNOME's own applications do — the
icons an app ships are a floor under the theme, not a replacement for it. The failure this
bootstrap exists to end is the other one, and it is closed on every host: a name never fails
to resolve.

Where the shipped glyph matters more than the host's taste — a screenshot rig, a kiosk, a
documentation gallery whose pictures have to match its prose — `prefer: 'bundled'` makes the
shipped set authoritative. It points the icon theme at a name nothing installs, so the theme
chain contributes nothing and only the app's resource can answer; the cost is that a name
OUTSIDE the bundle then has nothing behind it but GTK's builtins. `prefer: 'host'` (or
`bundledIcons: false`) keeps the pre-amendment behaviour.

Both directions are asserted rather than described, in
`packages/framework/adwaita-app/src/icon-theme.spec.ts`: one arm proves the bundled glyph
wins where the host theme lacks the name, and another proves the host still wins where it
has it. Overstating this guarantee is precisely how a reader would come to trust a glyph
they are not getting, so the limit has a test of its own.

### What else it costs

41 glyphs — the same set `@gjsify/adwaita-web` compiles, held by
`scripts/check-bundled-icon-parity.mjs` so the two cannot drift — at 20 349 B compiled
(19.9 KiB) and 27 132 B as the base64 the bundle travels as (26.5 KiB). The bytes are a
value rather than a sibling file because `gjsify build` emits one bundle with no asset
pipeline; the compiling is still `glib-compile-resources`, through the CLI's own
`gjsify gresource`.
