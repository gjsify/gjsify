# 98. A minimal `Gtk.Application` / `Adw.Application` runs on the browser and NativeScript

- Status: **Accepted** (2026-10-08)
- Date: 2026-10-08
- Deciders: Pascal Garber
- Related: [ADR 0042 (portable menu model)](0042-portable-menu-model.md),
  [ADR 0071 (a slot is a placement)](0071-a-slot-is-a-placement-a-renderer-answers-to.md),
  [ADR 0093 (template constructs per renderer)](0093-template-constructs-are-carried-and-each-renderer-declares-what-it-builds.md),
  [ADR 0096 (a GObject subset)](0096-a-gobject-subset-runs-on-the-browser-and-nativescript.md)
- Amends: [ADR 0096](0096-a-gobject-subset-runs-on-the-browser-and-nativescript.md) § 2 and § 3 (`vfunc_*`).
- Completes: the "`Adw.Application` and `vfunc_activate`" item of ADR 0096 § What this does not decide.

## Context

ADR 0096 left the application object as "the per-target entry point". Learn6502
(`gjsify/easy6502`, `packages/app-gnome`) shows what that costs: its GNOME `Application` is the one
class that cannot move, and the Android app has an unrelated `Application.run({ moduleName })`.
Measured, by reading the source:

- **Class.** `class Application extends Adw.Application`, `GObject.registerClass({ GTypeName }, this)`
  in a static block, `super({ applicationId, flags: Gio.ApplicationFlags.DEFAULT_FLAGS })`.
- **Signals and vfuncs.** `connect("startup", …)` for theme and font setup, `vfunc_activate()` that
  builds `new MainWindow(this)` when `active_window` is unset and calls `present()`. No `open`,
  `command-line`, `shutdown`, `hold`, `release`, `register` or D-Bus call.
- **Actions.** Three `app.` actions (`quit`, `about`, `preferences`) made with `new Gio.SimpleAction`,
  `connect("activate", …)` and `this.add_action(…)`; the window adds eleven `win.` actions the same way.
- **Window link.** `active_window` and `get_active_window()` as the parent for dialogs; `quit()` from an
  action; `MainWindow extends Adw.ApplicationWindow` takes the application in its constructor.
- **Accelerators.** `set_accels_for_action` four times (`app.quit` and three `win.` file actions).
- **Entry.** `await application.runAsync([programInvocationName].concat(ARGV))`, then `exit(code)`.
- **GIO.** `Gio.Application` runs `register`, then `startup`, then `activate`; `activate` is
  `RUN_LAST` (so `connect` handlers run before `vfunc_activate`) and `startup` is `RUN_FIRST`
  (`gio/gapplication.c`). `GtkApplication` holds the application while it has a window and adds
  `add_window`/`remove_window`/`active_window`. `GApplication` and `GtkWindow` implement
  `GActionMap`; an action name resolves from the widget up to the window, then to the application.

ADR 0096 refuses every `vfunc_*`, so an unmodified `Application` fails today at the first line of
`vfunc_activate`. The refusal lives in `packages/web/adwaita-core/src/gobject.ts` (the `vfunc_` scan in
`registerClass`, `refusal(className, key, ' (a virtual function override)')`) and is pinned by the `vfunc`
row of `src/conformance/gobject.ts` (holds on the subset only). Neither `adwaita-web` nor
`nativescript-bridge/adwaita` repeats it.

## Decision

**Each port exports `Gtk.Application` and `Adw.Application` (the second extends the first), built on
one renderer-free class in `@gjsify/adwaita-core`. Stage 1 is a strict subset of GIO/GTK: the same
names with GJS's semantics, and what is not implemented throws, naming it. Every later stage only
adds, so an application written against stage 1 is never rewritten.**

### 1. Stage 1: the subset

| GJS spelling | on the browser and NativeScript |
|---|---|
| `GObject.registerClass({ GTypeName }, class extends Adw.Application)`, `super({ applicationId, flags })` | implemented through ADR 0096. `flags` accepts only `Gio.ApplicationFlags.DEFAULT_FLAGS` (`NONE`); any other value is refused |
| `application_id` / `applicationId`, `get_application_id()` | implemented. An id that `Gio.Application.id_is_valid` rejects throws; `null` is allowed, as on GJS |
| `Gio.ActionMap`: `add_action`, `lookup_action`, `remove_action`, and `Gio.SimpleAction` (`name`, `enabled`, `connect('activate')`, `activate()`) | implemented. `add_action` of an existing name replaces it, as on GIO. `add_action_entries`, `Gio.PropertyAction`, state and `parameter_type` beyond null-or-not are refused (ADR 0097 stage 3 adds state) |
| `Gio.ActionGroup`: `has_action`, `list_actions`, `activate_action(name, param)`, `get_action_enabled` | implemented, as the same registry |
| `connect('startup')`, `connect('activate')`, `vfunc_startup`, `vfunc_activate` | implemented; the first two entries of the vfunc allow-list below |
| `runAsync(argv)`, `quit()` | implemented (§ 3). `run(argv)` is refused by name: it blocks, and a page cannot |
| `add_window`, `remove_window`, `get_windows()`, `active_window`, `get_active_window()` | implemented. The first window added becomes active; `present()` on a window makes it active |
| `Adw.ApplicationWindow` / `Gtk.ApplicationWindow` constructed with `application`, `window.application`, `win.` actions | implemented as `add_window` plus a `win` group on the window. UNVERIFIED: whether each port's existing window class has the construct property; the implementing PR measures it |

Order, on GJS and here: `runAsync` → `startup` (once) → `activate` (once, no files, no arguments
parsed) → the application lives while it has a window or until `quit()` → resolves with the exit code
(`0`). The `connect` and `vfunc` order of each signal follows the class structure above, and a vector
pins it.

Refused by name, with a vector that holds on the subset only (ADR 0096 § 3): `run`, `register`,
`hold`, `release`, `mark_busy`, `open` and the `open`/`command-line`/`handle-local-options`/`shutdown`
signals and their `vfunc_*` (not on the list of § 1a), `set_inactivity_timeout`, `send_notification`, `register_session`,
`set_option_context_*`, `add_main_option*`, `Gio.ApplicationFlags` other than the default,
`resource_base_path`, `Gio.Application.get_default()` beyond the instance just made, any D-Bus
property (`is_remote`, `get_dbus_*`), `set_accels_for_action` (stage 2 below, but it throws until then,
because a shortcut that silently dies is the drop ADR 0071 § 3 forbids), `set_menubar`, `get_menu_by_id`,
`app_menu`.

### 1a. `vfunc_*` is unlocked one by one

`vfunc_*` is allowed in principle, never as a block. A virtual function is unlocked only when its port
counterpart is built and a conformance vector proves it against GJS (the oracle). Every other `vfunc_*`
stays refused at `registerClass` time, naming the vfunc and this ADR, so nothing silently does nothing.

- **One list.** `UNLOCKED_VFUNCS` in `packages/web/adwaita-core/src/gobject.ts`, keyed by the class that
  declares the vfunc (`'Gio.Application'`) and read by the scan that refuses today. The `vfunc` row of the
  conformance gains one vector per entry; the gate is that an entry without a vector fails.
- **Stage 1 unlocks** `Gio.Application.vfunc_startup` and `vfunc_activate`. `super.vfunc_*()` chains up.
- **Next candidates**, from Learn6502, each a pure addition (one list entry plus its vector):
  `Gtk.Widget.vfunc_map` and `vfunc_unmap` (both overridden by `HelpWindow extends Adw.Window`, to
  register and unregister a themed widget; web: connected and disconnected, NativeScript: attach and
  detach); `GtkSource.GutterRenderer.vfunc_query_data` (`GutterRendererLineNumbers extends
  GtkSource.GutterRendererText`; waits for ADR 0094).

### 2. How `app.` resolves

The application is the root action group under the prefix `app`; a window is the group `win`. This is
the lookup ADR 0097 § 3 needs, and it is GTK's: resolution starts at the widget, takes the nearest group
with that prefix up the parent chain, and from the window root continues to `window.application`. The
ports only supply `parent(widget)` and `root(widget)`, so the walk lives once in the core.

- **Web.** A window is an element in the document; the walk follows the DOM, and a widget inside a
  popover layer starts from its owning button (ADR 0097 § 3). That the popover case resolves is
  accepted, but **stage 1 must prove it with a vector against GJS** before ADR 0097 stage 2 builds on it.
- **NativeScript.** The walk follows `View.parent`; the root view is the window's, whose `application`
  is the single `Application` instance.

A widget with no window above it finds no `app` group, which is not an empty group (ADR 0042 § 2).

### 3. Lifecycle per port

- **Web.** `runAsync` waits for `DOMContentLoaded` (at once if the document is ready), emits `startup`,
  then `activate`. A web page has no process: `quit()` resolves the promise and removes the windows it
  added, and the tab stays. `remove_window` of the last window resolves it too, as on GTK.
- **NativeScript.** `runAsync` calls `Application.run({ create })`; `create` emits `startup` and
  `activate` and returns the active window's root view. So `activate` must `add_window` a window
  synchronously, else `runAsync` rejects naming this. `quit()` finishes the Activity. Android's own
  activity lifecycle is not mapped (`resume`, `suspend` stay `@nativescript/core` events).
- **Both.** An exception in a handler or vfunc rejects `runAsync` with it (GJS only logs it); this is
  a deliberate divergence, as ADR 0096 § 3 item 5 made, and a subset-only vector records it.

### 4. Later stages, each a pure addition

1. **Accelerators.** `set_accels_for_action`, `get_accels_for_action`, `list_action_descriptions`.
   Browser: a document `keydown` listener resolves the string to the action; NativeScript keeps the
   refusal (ADR 0097 § 4). Accelerators in `.blp` items follow.
2. **`Gio.Menu` as application menu** and `set_menubar`/`get_menu_by_id` over ADR 0097's value.
3. **`hold`/`release`/`mark_busy`**, defined on the lifecycle of § 3.
4. **`open` with files** (`Gio.ApplicationFlags.HANDLES_OPEN`, `Gio.File` from a URL or an Android intent)
   and `command-line` as the query string; needs `Gio.File`, so it waits for that decision.
5. **`shutdown`** (web: `pagehide`; NativeScript: activity destroy) and `register`.
6. **Notifications** (`send_notification`) over the Notification API / Android channels, by capability.
7. **D-Bus** stays refused for good on both ports; `is_remote` and `get_dbus_*` throw by design.

## Proof

- `APPLICATION_VECTORS` in `@gjsify/adwaita-core/conformance`, run on the web, NativeScript and GJS
  (GJS the oracle; a vector that fails there is wrong). Vectors: `startup` once before `activate`
  once; signal-handler versus vfunc order for both; `add_action` then `lookup_action`, replace on a
  duplicate name, `remove_action`; `activate_action('x')` runs the handler; a disabled action does
  nothing; first window is `active_window`, `present()` switches it; last `remove_window` resolves
  `runAsync` with `0`; `quit()` resolves with `0`; an `app.` action resolves from a button in a window,
  from a button in a popover owned by a menu button, and not from a widget with no window.
- Refusal vectors (the list in § 1) are subset-only, and a gate as in ADR 0093 § 4 requires each
  refusal to throw.
- `tests/e2e/gi-renderer-arms` gains the arm: Learn6502's `Application` skeleton built with both
  `--app browser` and `--app nativescript`.

## Consequences

- The Learn6502 `Application` class compiles unchanged for both ports, except `set_accels_for_action`,
  which throws until stage 1 of § 4; that is one line to guard, and then it is a pure addition.
- **For ADR 0097.** `app.` resolves through this Application, so ADR 0097 § 3's "explicitly inserted
  `app` group until then" and its "What this does not decide" line on the application object are
  superseded. On NativeScript, menus render as a native Android `PopupMenu` anchored at the menu
  button (maintainer decision), which replaces the `Dialogs.action()` sheet ADR 0042 and ADR 0097 § 2
  describe: sections become dividers, submenus nested `PopupMenu`s, and insensitive rows are shown
  disabled instead of omitted. That also lifts the "no anchor" reason ADR 0097 gave for refusing
  `Gtk.PopoverMenu`; the follow-up amendment to ADR 0097 decides it. The web popover resolution from
  the owning menu button is accepted, but not before the vector above exists.
- The single app package question of ADR 0096 is not answered, but its blocker is: the entry point
  of the GNOME app is a class both ports can run.

## Alternatives rejected

- **A `run(argv)` that returns a number.** A page cannot block; a fake would spin or lie.
  `runAsync` is real GJS API.
- **An application of our own shape (`start(window)`).** Every GNOME app's `Application` would be a
  second source, the thing ADR 0051 exists to remove.
- **Implementing `hold`/`open`/D-Bus now "for later".** Unused members enter by the gap report, as in
  ADR 0096 § 2.

## What this does not decide

- `Gio.File`, `Gio.Settings`, `GLib.Variant`, and state on actions beyond null-or-not.
- iOS, and the Android activity lifecycle beyond create and finish.
- The single app package.

## Implementation

Tracked in `status/open-todos/adwaita-core.md`. One PR, a commit per step: the core with its GJS
vectors (the oracle first, including the popover case); the web door; the NativeScript door; the
`GI_RENDERERS` arm. First consumer: Learn6502's `Application`, converted in its own repository.

## Amendment 1: the helpers a source view reads

Four members entered by the gap report (Learn6502's `SourceView`), each a subset held by vectors that
run on real GJS first:

- `GLib.MAXUINT32`, `GLib.build_filenamev` (a line-for-line port of `g_build_path_va`, not `path.join`),
  `GLib.get_current_dir` and `GLib.get_system_data_dirs`. A host without a filesystem answers
  `get_current_dir()` as `"/"` and `get_system_data_dirs()` as `[]`; a caller walking the list falls
  through to its default. These are defaults, not hooks: a port with a real answer replaces the member in
  its own file. The shared vectors hold only the shape of those two, each port's spec holds the value.
- `Adw.StyleManager`: `get_default()`, the read-only `dark` / `get_dark()` and `notify::dark`, which
  fires only on a change. The web reads the root's `.theme-dark` / `.theme-light` and
  `prefers-color-scheme`; NativeScript reads `adwaitaColorScheme()`. `color_scheme`, `set_color_scheme`,
  `get_for_display` and `Adw.ColorScheme` stay out and are reported as missing.
- `Gio.SimpleActionGroup` on the web (NativeScript had it); its class now lives in the core. Not carried:
  `change_action_state`, `query_action`, `add_action_entries`, `action-added` / `action-removed`.

`Gio.File.query_exists` is NOT added: `Gio.File` is ADR 0100's, which refuses it by name until a path
can be named.
