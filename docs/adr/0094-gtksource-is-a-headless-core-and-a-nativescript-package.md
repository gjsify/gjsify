# 94. GtkSourceView is a headless core plus a NativeScript package, with named gaps

- Status: **Accepted** (2026-10-08)
- Date: 2026-10-05
- Deciders: Pascal Garber
- Related: [ADR 0034 (widget vocabulary convergence)](0034-widget-vocabulary-convergence.md),
  [ADR 0015 (headless package contract)](0015-headless-package-contract.md),
  [ADR 0093 (template constructs)](0093-template-constructs-are-carried-and-each-renderer-declares-what-it-builds.md)

## Context

Learn6502 edits assembly in a `GtkSource.View`. Its GNOME app has the real widget; its web app has
`adw-source-view`, a CodeMirror twin; its Android app had nothing. A `.blp` with
`using GtkSource 5;` and `GtkSource.View` should render on all three.

GtkSourceView has no JavaScript port. What can be reused is its DATA: `.lang` and style-scheme XML,
which the GNOME editors and the web twin already agree on.

## Decision

1. **Two packages, cut at the toolkit.** `@gjsify/gtksource-core` (`packages/web/`) is headless
   (`gjsify.headless: true`, all four slots `polyfill`): an XML reader, `.lang` and scheme parsing,
   GRegex to RegExp translation and a line tokenizer that carries state across lines. It reaches no
   typelib, no DOM and no `@nativescript/core`, so Node, GJS and NativeScript run the same specs.
   `@gjsify/gtksource-nativescript` (`packages/nativescript-bridge/`) holds everything that touches
   a platform: the `EditText` driver, the `View` shell, and the `Buffer` / `LanguageManager` /
   `StyleSchemeManager` objects, whose logic is plain TypeScript. The platform half is one file,
   `native-editor.android.ts`, behind a driver seam.
2. **The vocabulary is a namespace.** The package root exports `GtkSource` (`export * as`), and the
   `./gtksource` subpath is the module an app's `xmlns:gtksource="~/gtksource"` barrel re-exports.
   One barrel per library, for the reason ADR 0034 § Amendment 9 gives: the prefix is the only
   thing saying which library a widget belongs to.
3. **The gates stay as they are, on purpose.** `check-core-namespace-claims` already reads
   `GtkSource` as an oracle namespace. `check-vocabulary-alignment` holds the Adw and Gtk tables,
   so `adw-source-view` stays web-only against them; only its stated reason changes.
   `check-construct-capabilities` and `check-adwaita-conformance-drivers` hold renderers of the
   template constructs, and `GtkSource.View` is a leaf view, not a renderer. A gate widened to
   cover it would model a claim nobody makes.

4. **A `.blp` reaches it through a registered barrel, and the adwaita package is a peer.**
   The shared-tree builder of `@gjsify/adwaita-nativescript` knows the `adw` and `gtk` barrels it
   owns; `registerBarrel(prefix, library, namespace)` lets a package that depends on it add one
   more without the dependency running the other way. `@gjsify/gtksource-nativescript/builder`
   makes that call for `GtkSource`, and an app imports it once beside the adwaita builder, so
   `using GtkSource 5; GtkSource.View { … }` builds unchanged, including a `buffer: GtkSource.Buffer
   { text: "…"; };` object child. A real `.blp` compiled with `?shared-tree` takes this path in the
   specs; a device has not run it. The class is named `GtkSourceView`,
   because the builder holds a member to the GIR name the `.blp` wrote. `@gjsify/adwaita-nativescript`
   is a `dependency`, declared with the same `workspace:^` range the app uses, so one installed
   copy serves both: the view shares the adwaita package's colour-scheme state, and a second copy
   would own a state the app's own copy never writes, leaving the editor in the wrong scheme. It was
   first a `peerDependency`, but `gjsify foreach --topological` orders production dependencies
   only, so CI built this package before the adwaita one it imports and failed on a missing
   `registerBarrel`.

## Deliberate gaps

Each is declared in `status/status.json` rather than left to be found.

- **Engine, from the core:** `extend-parent` and `once-only` are not modelled, back-references in
  `end` are not supported, and case-insensitive contexts are not supported. They are reported as
  `unsupported`, or throw under `strict`. A regex feature the translator cannot render faithfully is
  refused, never mistranslated.
- **No word wrap.** Every logical line is one layout line and the view scrolls horizontally. The
  gutter is drawn from the text `Layout`, which stays exact only under that rule.
- **`indent-width` is held and read back, not applied.** An `EditText` has no indent step; its only
  Tab is a hardware key that inserts `\t`, and `tab-width` would need a `TabStopSpan` per line that
  GtkSourceView does not tie to `indent-width`. `auto-indent` copies the previous line's blanks.
- **LGPL data is not bundled.** `def.lang` and the `Adwaita` scheme are GtkSourceView's and LGPL.
  The package ships a small stand-in under `Adwaita` / `Adwaita-dark` and takes the real files
  through `addSchemeFromXml()`.
- **Fallback schemes are our own.** `fallback-schemes.ts` holds colours this package chose; they
  exist because schemes name `Adwaita` as `parent-scheme`, not because they match it.
- **Device-verified in part on Android, not at all on iOS (see the amendments).**
  `native-editor.android.ts` is held by type-checking plus the two device-verified signals;
  `native-editor.ios.ts` by type-checking and the UIKit-free arithmetic alone. The specs drive
  `EditorSession` through a fake driver, which is not a device.

## Shared widget classes: actions, tooltips, icons

A GtkSource-based widget class shared with a GNOME app writes `action-name: "source-view.copy"`
in its `.blp` and registers `Gio.SimpleAction({ name: "copy" })` in a group under that prefix.
`@gjsify/adwaita-nativescript` carries the minimum of that: `Gio.SimpleAction`,
`Gio.SimpleActionGroup`, `insertActionGroup` and a tap that resolves `prefix.name` up the
parent chain (`widgets/actions.ts`). Not modelled: parameter types, state, `app.`/`win.`
resolution through an application, accelerators. `tooltip-text` also reaches Android's
`View.setTooltipText` (API 26, long press; duck-typed, so no `TooltipCompat` and a no-op on older
devices) beside the accessibility hint, and a glyph in the app's GResource
resolves by GNOME name (ADR 0116 § 4; `registerIcons(map)` is removed, ADR 0116 § 8). An icon-only `Gtk.Button` wears
`image-button` and `.osd` has a theme rule, so the shared `.blp` renders flat and unlabelled. An app's `native-api-usage.json` must list
`android.view.View` for `setTooltipText`, besides the `EditText` classes of the editor itself.

## Consequences

- A consumer gets `GtkSource.View` from one `.blp` on GTK, and on NativeScript Android once it has
  a device-verified driver. Until then the package is `partial`.
- The core can back a web or GJS renderer later without a rewrite; this ADR does not promise one.
- Closing a gap above means editing the core, not working around it per consumer.

## Amendment (2026-10-09): `gi://GtkSource` is routed on NativeScript

`GI_RENDERERS` (ADR 0034 stage 9) answers `gi://GtkSource?version=5` on `--app nativescript` out of
`@gjsify/gtksource-nativescript/gtksource`, through the table's `specifiers` field, since the
package depends on the renderer and cannot be a member of its root barrel. `tests/e2e/gi-renderer-arms`
builds and evaluates a `GtkSource.View` subclass through it. `GtkSource.init()` is a no-op on
this port, as on GJS where it returns `undefined` and may be called twice; a conformance vector table
runs against real `gi://GtkSource` and the namespace door. The browser row had no `GtkSource` at that point. Status unchanged.

## Amendment (2026-10-09): a web `GtkSource` over the core

`@gjsify/adwaita-web` exports a `GtkSource` namespace (`View`, `Buffer`, `LanguageManager`,
`StyleSchemeManager`, `init`), and the browser row of `GI_RENDERERS` answers `gi://GtkSource?version=5`
from it, so `using GtkSource 5; GtkSource.View` no longer reports a missing member on the browser. It is
built on `@gjsify/gtksource-core`, not on the CodeMirror `<adw-source-view>`: both ports read the same
`.lang` and style-scheme files. The platform-free model (`Buffer`, the managers, `EditorSession`, the
highlight controller, gutter arithmetic, `init`) moved from the NativeScript package into the core, so
Android and the web share one copy. `<gtk-source-view>` is a `<textarea>` that keeps caret, selection,
input, IME and undo, with the highlight on a backdrop and the line numbers in a gutter; its structure
mirrors the Android driver. Like Android it has no word wrap and holds `indent-width` without applying
it. The GJS snake_case manager verbs (`get_default`, `get_language`, `get_scheme`) exist, with vectors run
against real `gi://GtkSource`. Everything else (`TextIter`, `TextMark`, gutters, the `buffer:` object
child of a `.blp`) is absent and refused by name. Status unchanged.

## Amendment (2026-10-09): the Buffer surface

`GtkSource.Buffer` on the web and NativeScript doors now answers the GJS verbs Learn6502 calls:
`get_insert`, `get_selection_bound`, `get_start_iter`, `get_end_iter`, `get_selection_bounds`,
`get_text(start, end, include_hidden)`, `move_mark`, `insert_at_cursor(text, -1)`, `delete(start, end)`,
`set_language`, `set_style_scheme`, `cursor_position`, `begin_user_action`, `end_user_action`,
`undo`, `redo`, `can_undo`, `can_redo`, and `connect_after`. `TextIter` offers `get_offset` and
`set_offset` (counted in characters, as GTK does; the buffer's own offsets stay UTF-16), and `TextMark`
offers `name`, for the two marks `insert` and `selection_bound`. The signals `mark-set` (iterator, mark),
`cursor-moved`, `begin-user-action`, `end-user-action`, `undo` and `redo` are emitted in GTK's order;
`connect` of any other signal name throws by name. `text =` is not undoable and clears the history; a
native edit counts as a user action. Undo coalescing across separate edits is not implemented: each
edit outside a user action is its own step. Vectors (`GTKSOURCE_BUFFER_VECTORS`) run against real
`gi://GtkSource`, the core, and both doors. Not here: arbitrary marks, tags, and the view-side verbs.
(`signal_stop_emission_by_name` followed in Slice 8b, below.) Status unchanged.

## Amendment (2026-10-09): the View surface

`GtkSource.View` on the web and NativeScript doors now answers the verbs Learn6502 calls on the view:
`cursor_visible` (default TRUE), `get_/set_editable`, `highlight_current_line`, `show_line_numbers`,
`vadjustment` and `hadjustment` (one stable `Gtk.Adjustment` each; on the web it follows the textarea's
scroll), `set_direction`/`get_direction`, `get_first_child`, `get_next_sibling` and `get_parent`. A view
has no widget children of its own on these doors, so `get_first_child` answers null where real GTK
answers an internal child. `Gtk.ScrolledWindow` gains `get_policy`, `set_policy` and
`set_/get_vadjustment`/`hadjustment`, and `Gtk` gains the enums `PolicyType`, `TextDirection` and
`TextWindowType`, with GTK's numeric values. Vectors (`GTKSOURCE_VIEW_SURFACE_VECTORS`) run against real
`gi://GtkSource` and `gi://Gtk` (instance vectors only where a display exists), the web door and the
NativeScript door. Not here: `get_gutter` (slice 6) and the later-slice members, which throw by name.
Status unchanged.

## Amendment (2026-10-09): stopping an emission (Slice 8b)

`GObject.signal_stop_emission_by_name` works on the GtkSource objects Learn6502 stops: `extend-selection`
on the view and `mark-set` on the buffer (ADR 0096 Amendment 1 carries the `STOP_EMISSION` protocol).
Learn6502 also connects `copy-clipboard` with `connect_after` on the view, and `end-user-action`, `undo`,
`redo` and `connect_after("cursor-moved")` on the buffer. Both objects now have `connect_after`.

An emission runs plain handlers, then the class handler, then `connect_after` ones; a stop skips what is
left, and a handler disconnected meanwhile does not run. Flags as in GTK 4: `mark-set` is RUN_LAST, and its
class handler emits `cursor-moved` and the `notify::cursor-position` family, so a stopped `mark-set` emits
neither. `extend-selection` is RUN_LAST with a `true_handled` accumulator: a handler that answers TRUE ends
the emission and leaves the range it set; a stop or no TRUE collapses the range to the click. `copy-clipboard`
is RUN_LAST; a stop skips the copy. The platform default is mapped to the class handler: on the web, a
`mousedown` with `detail` 2 or 3 asks `extend-selection` first (WORD, LINE) and the textarea's own selection
runs only if nothing stopped it, and a `copy` event is cancelled when a handler stopped `copy-clipboard`.
After a `mark-set` handler moved the marks away from the platform's selection, the widget follows the
buffer. `Gtk.TextExtendSelection` (`WORD` 0, `LINE` 1) is added to both doors.

Gap (closed by the 2026-10-10 amendment): the Android driver did not emit `extend-selection`; stopping `mark-set` works there, being buffer-level. Vectors (`GTKSOURCE_STOP_VECTORS`)
run against real `gi://GtkSource` (view rows where a display exists), the core and the web door; the
NativeScript door runs the buffer rows. Status unchanged.

## Amendment (2026-10-10): the Android driver asks `extend-selection`

The Android driver now emits `extend-selection` and `copy-clipboard`, both run on a device (Learn6502 as
harness; a handler stopped the emission on the first line only, the second line passed through).
`EditText` has no selection-gesture hook, so the driver overrides `onTouchEvent` (before `super`, so no
native selection flickers) and `performLongClick`. A `MultiTap` counter (timeout and slop from
`ViewConfiguration`) asks WORD on the second tap and LINE on the third, and a long press asks WORD. The
location is `getOffsetForPosition`. A non-null range from the session becomes the selection and the rest
of the gesture is swallowed; a null answer (no handler stopped) hands the event to the platform.
`copy-clipboard` comes from `onTextContextMenuItem(copy)`, keyed on the constant `0x01020021`: the
NativeScript runtime exposes no readable `android.R.id`. Android collapses the selection on Copy and GTK
does not, so the driver restores it after the platform copy, which lets a `connect_after` handler read it.

Verified on `Medium_Phone` (API 24) and `Tablet_API_36`: (a) `extend-selection` fires for double tap
(WORD), triple tap (LINE) and long press (WORD), and a stopping handler prevents the native word
selection while an unstopped one leaves it; (b) `copy-clipboard` fires from the context-menu Copy;
(c) text a `connect_after` handler writes reaches the `ClipboardManager`.

Named gaps: a triple tap has no platform selection below API 28, so on API 24 it is asked and, if
unstopped, not applied natively. Drag-extend of a selection handle is not a `Gtk.TextExtendSelection`
gesture on Android and is not emitted. The package stays `partial`; the specs for the tap counter run
on the NativeScript door without a device (`multi-tap.spec.ts`).

## Amendment (2026-10-15, accepted with ADR 0116): search paths replace the XML doors

`LanguageManager.addLanguageFromXml` and `StyleSchemeManager.addSchemeFromXml` have no GtkSourceView
counterpart. They exist because the web and NativeScript ports had no file system and no GResource
for `set_search_path` to walk (the Context of `style-scheme.ts`). ADR 0116 embeds the app's GResource
at build time and answers it synchronously, so that reason goes away.

ADR 0116 is accepted, so:

- `get_search_path`, `set_search_path`, `append_search_path` and `prepend_search_path` work on both
  managers for `resource://` entries, and the managers scan them as `gtksourcelanguagemanager.c` and
  `gtksourcestyleschememanager.c` do (`*.lang`, `*.xml`). A plain file-system entry stays a record
  on the web, as `Gtk.IconTheme.add_search_path` does (ADR 0116 § 4).
- `addLanguageFromXml` and `addSchemeFromXml` are removed in the same release. gjsify is 0.x, where
  a minor release may break. Learn6502's shared UI moves to the `set_search_path` calls its GNOME
  app already makes (`packages/app-gnome/src/resources.ts`).
- The deliberate gap "LGPL data is not bundled" stays. An app that wants the real `Adwaita` scheme
  puts it in its own GResource and lists the path, as on GNOME. The fallback schemes stay the
  answer when no path supplies `Adwaita`.

Accepted with ADR 0116 on 2026-10-15.

## Amendment (2026-10-31): an iOS driver, unverified on device

`native-editor.ios.ts` is the second platform half: a `UITextView` whose `NSTextStorage` carries
the highlight as attributes, with the gutter and the current-line band drawn in `drawRect:` from
the `NSLayoutManager`'s line fragments. `gjsify.nativescriptPlatforms` is `['android', 'ios']`
accordingly, so the `nativescript-platforms` rule now holds BOTH halves of every platform-resolved
module in this package.

Why it exists before anyone can run it: the base `native-editor.ts` refuses with
`'Platform not supported'`, which on iOS is indistinguishable from a silently missing variant —
the shape that shipped `icons.android.ts` without an iOS twin and rendered no icon at all for the
life of the declaration (the incident the conformance rule carries).

**What differs from Android, and is the reason for the two new modules.** `NSTextStorage` holds
attributes on ranges, not span OBJECTS the platform moves through edits and a repaint removes by
identity. So a repaint must NAME the range it overwrites: it resets the line's extent to the base
attributes and adds the runs over it, and the extent is read off the LIVE text every pass
(`lineExtent`), never remembered. `text-ranges.ts` holds that arithmetic UIKit-free — offsets,
line starts, the ARGB split, the edit queue — so `text-ranges.spec.ts` measures it on Node and
GJS; `ios-types.ts` names the UIKit/Foundation members called, as `android-types.ts` does.
Two further asymmetries are paid for in the driver rather than hidden: setting `font` or
`textColor` rewrites the whole storage's attributes, so a palette or layout change repaints every
line that carries runs (a span survives the same call); and TextKit 1 is pinned by reading
`layoutManager`, because TextKit 2 answers fragment geometry only through viewport layout, which
a gutter drawn in `drawRect:` cannot ask.

**Named gaps, not approximations.** `extend-selection` is not emitted on iOS: the text view's
double/triple-tap selection comes from its internal gesture recognisers, which offer no documented
veto before they select. `copy-clipboard` is not emitted either: UIKit's copy arrives as the
`-copy:` editing action, whose override name collides with `NSObject`'s own `-copy`. Both keep
UIKit's own behaviour. `selectionBackground` has no counterpart — UIKit derives the selection fill
from the `tintColor` that also paints the caret, where GTK gives two colours.

**NOT VERIFIED ON A DEVICE OR A SIMULATOR.** The arithmetic half is green on Node and GJS; the
UIKit call sequence is written from the documented API and has been run by nothing. There is no
iOS leg in `tests/integration/nativescript/` — it drives Android over `adb logcat` — and no NS CLI
on this machine, so no simulator run was possible (#1051). The package stays `partial`.

## Amendment (2026-11-03): verified on the iPhone 17 simulator, the current-line fill fixed, the gutter still open

Build, type and syntax highlighting checked out on an iPhone 17 simulator (iOS, `D3BF03B2-…`,
Learn6502's `app-android` target): typing in the Code tab reaches the buffer, `GtkSource`
syntax highlight attributes land correctly, and the view scrolls. Two things did not:

**The current-line band rendered solid black instead of a translucent tint — root-caused and
fixed.** Measured directly: a `0x18000000` fill colour (≈9% black, `#00000018` in the style
scheme) reads correctly as `argb=0x18000000, alpha≈0.094` on the JS side (`argbComponents` is
correct), and the SAME colour through `UIColor.backgroundColor` (ordinary `CALayer` compositing,
no `CGContext` draw call) renders as the expected light tint. But `UIRectFill` inside `drawRect:`
does not alpha-blend it against the existing context content — it behaves as `kCGBlendModeCopy`,
and the near-transparent result composites as solid black once the layer renders. Fixed in
`native-editor.ios.ts`'s `fill()`: `UIRectFillUsingBlendMode(rect, kCGBlendModeNormal)` instead of
plain `UIRectFill`, plus `view.opaque = false` so the `drawRect:` context is pre-cleared
transparent each pass, per UIKit's own documented contract for opaque views ("may have
non-zeroed pixels", `clearsContextBeforeDrawing` ignored).

**The line-number gutter does not appear — the app-side cause is fixed, a core rendering gap
remains open.** `editor.blp` now authors `line-numbers: true` on its `$SourceView` (matching
`hexdump.blp`, `disassembled.blp`, `hex-monitor.blp`, `example-list-item.blp`, which always did).
Confirmed by log instrumentation (since reverted) that this closes the first gap: the `lineNumbers`
setter now fires, `SourceView.setupLineNumbers()` runs, `GutterRendererLineNumbers` is constructed
with a non-zero `width_request` and `leftGutter.insert(renderer, 0)` succeeds. The GSettings key
`show-line-numbers` is still dead — unused by any `*.ts` in `packages/ui/src`.

Despite that, the gutter STILL does not render on the iPhone 17 simulator. Traced one level
further than the previous pass reached: `@girs/gtksource-5`'s `GutterRendererText` is correctly
build-time-aliased to `@gjsify/gtksource-nativescript`'s own class on `--app nativescript` (one
class in the bundle, `instanceof` holds), so that is not it. `native-editor.ios.ts`'s
`drawGutter`/`gutterColumns`/`queryGutter`/`applyLayout` chain reads structurally correct on paper
— `gutterPoints()` should total 36pt (24 width + 6+6 margin) the first time `drawRect:` runs and
schedule `applyLayout()` on the next tick — but a scroll/back-navigation gesture that forces
several more `drawRect:` passes still shows no gutter column or widened text inset. Not
instrumented further this pass (the `drawRect:`/`applyLayout()`/`textContainerInset` interaction
itself, and whether `visibleLines()` ever returns non-null on the first passes, are the next
things to log). Whether GNOME/Android render this correctly is still unconfirmed.

## Amendment (2026-11-03, same day): the keyboard now dismisses; the gutter paint itself is the gap

**The iOS code editor's keyboard could not be dismissed — fixed.** Nothing on iOS closed the
software keyboard: a `UITextView` has no back button, and the editor had no tap-outside target, so
the keyboard stayed open over the hammer button and the tab bar for the rest of the session. Fixed
in `native-editor.ios.ts`: `keyboardDismissMode = onDrag` plus an `inputAccessoryView` carrying a
"Done" button, verified end to end on the iPhone 17 simulator (type → Done → hammer and tab bar
reachable → Assemble → Play → the game console draws → a D-pad tap changes the snake's direction).
Two sub-findings worth keeping: a `UIBarButtonItem` built from `UIBarButtonSystemItemDone` renders
nothing at all here — present, zero-size, no exception — so the visible button is a plain
`UIButton` wrapped as the item's `customView`; and a target-action selector string a `.extend()`
class does not LITERALLY implement (`'dismissKeyboard:'` when the class only has `dismissKeyboard`,
or vice versa) does not fail quietly — `-sendAction:to:from:forEvent:` calls
`doesNotRecognizeSelector:` and the app aborts (`SIGABRT`, visible on the simulator as an instant
drop to the home screen) — so the tap handler goes through `UIAction`'s closure instead, which
needs no selector at all.

**The line-number gutter: traced to the actual paint call, not yet past it.** Continuing the
previous amendment's trace with full instrumentation (since reverted): `gutterPoints()` genuinely
computes 36pt on the very first `drawRect:` (confirmed non-zero `GutterRendererLineNumbers` column,
width 24 + 6 + 6 margin) and `applyLayout()` has already run by then —
`view.textContainerInset.left` reads **48** (12 own margin + 36 gutter) on that same first call, so
the TEXT CONTAINER INSET genuinely reserves the gutter's space; this is not a width-computation
bug. The gutter's columns carry real, non-empty cell text (`vfunc_query_data` runs; a separate,
now-fixed easy6502 bug made it read `"0","1","2",…` instead of `"1","2","3",…`, see below). The
palette colours are correct, opaque, non-degenerate (`lineNumberForeground` a legible grey
`#8a8f92`, `lineNumberBackground` a near-white `#f6f5f4`, both measured, not assumed). And yet nothing
paints: a forced, unconditional `UIRectFillUsingBlendMode` fill at `(0, 0, 40, 200)` in bright red,
placed in the EXACT same `drawGutter()` call that has all the numbers above — reaches zero pixels
on screen (checked by scanning the screenshot for the fill colour, not by eye). Ruled out this
pass: draw order relative to `this.super.drawRect(rect)` (tried gutter-before-text and
gutter-after-text — identical, still invisible); a clipped/partial dirty rect (`drawRect:`'s own
`rect` argument is logged as the FULL view bounds, `(0, 0, 402, 13975)` — the view's `bounds` is
the whole ~860-line document, not a viewport, because an ancestor scroll view scrolls it rather
than the `UITextView` itself); and `visible` being `null` (it reads a real `{first, last}` range on
every capture). The one thing this pass did NOT get to: whether a SECOND `UIRectFillUsingBlendMode`
call within the same `drawRect:` invocation behaves differently from the first (the current-line
band, `drawBehind()`'s identical call, DOES render — it is the only reason this is narrowed to
"something about the gutter's specific call" rather than "CGContext fills never work here" at all).
Next step: log immediately before/after each `UIRectFillUsingBlendMode` call whether
`UIGraphicsGetCurrentContext()`-equivalent state looks sane, and try replacing it with a
`UIBezierPath`/`CGContextFillRect` call to see whether the blend-mode function specifically is at
fault for a second call in one pass.

Also fixed, in easy6502 not gjsify (`packages/ui/src/source-view.ts`): `setupLineNumbers()` built
`GutterRendererLineNumbers` with no `mode` in its constructor params, then set `.mode` right after
construction — but the renderer's OWN constructor computes its default `startValue` from `mode`
BEFORE that external assignment lands, so it always picked HEX's `startValue = 0`, off by one from
NORMAL's `1`. Passing `mode` at construction fixes it; unrelated to the rendering gap above, and
would have been invisible either way until the gap closes.
