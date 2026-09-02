# @gjsify/adwaita-react-native

Adwaita widgets with **one API surface and two implementations**: the real `Adw.*`
widget on GTK4, React Native primitives on a phone.

```tsx
import { AdwClamp } from '@gjsify/adwaita-react-native';

<AdwClamp maximumSize={400}>{content}</AdwClamp>;
```

On GTK that is `Adw.Clamp` through [`@gjsify/gtk-host`](../gtk-host). On Android and
iOS it is a `View` whose width and offset come from
[`@gjsify/adwaita-core`](../../web/adwaita-core)'s port of
`adw_clamp_layout_allocate` — libadwaita's own easing curve, not a `maxWidth`
approximation.

## What this is, honestly

**Not a widget set yet.** The table below is the whole of it, and every row carries the
whole vertical — both platform halves, the resolution mechanism, the `exports` entry, a
gate, and a suite on each side that reads the REAL tree. `AdwBin` and `AdwClamp` came
first and proved that shape; the groups since are where it starts earning its keep, and
the content-and-feedback widgets are the clearest case — each has a DERIVATION as its
shared half (an initials hash, a palette index, a queue policy, a ring geometry), so the
two implementations are held to the same number rather than to the same shape. The
boxed-list rows carry that argument across a whole preferences page. What is not here is
everything else libadwaita has: navigation, dialogs, the view switchers, the lists.

**Nothing here re-implements a rule that already has an owner.** Every derivation the
rows share — `string_is_not_empty` on both labels, `Adw.EntryRow`'s `update_empty` truth
table and its apply latch, character-counted truncation, the switch row's two routes into
one transition, the expander's disclosure — comes from
[`@gjsify/adwaita-core`](../../web/adwaita-core), which is the same call
`@gjsify/adwaita-web` and `@gjsify/adwaita-nativescript` make. The GTK half calls none of
it: the C original is right there, and the core's value on that path is as the oracle the
React Native half is measured against.

**The promise is the Adwaita design language on React Native, not "your app runs".**
Unlike [`@gjsify/react-native`](../react-native) — the opposite direction, which was
measured against a real production Expo application — this package has no third-party
codebase behind it. What it has is a shared arithmetic core and two renderers held to
the same numbers.

## Install

Not on npm yet: this is a new name, and the first publish plus its Trusted Publisher
bootstrap is a maintainer action deliberately not attempted from CI or a feature branch
([the procedure](../../../docs/publishing.md)). Until then it is consumable from a
workspace checkout.

```sh
npm install @gjsify/adwaita-react-native
```

`react` (>= 19.2) is a peer dependency. `react-native` (>= 0.87) is an **optional** peer:
a GTK-only consumer does not need it installed.

## Widgets

| widget | props | notes |
|---|---|---|
| `AdwActionRow` | `title`, `subtitle`, `activatable` (false), `onActivated`, `children` | The fundamental boxed-list row. `children` are the SUFFIX |
| `AdwAvatar` | `size` (**required**), `text`, `showInitials`, `iconName` | Initials and palette entry from one port of `extract_initials_from_text` + `set_class_color`. `size` is required because libadwaita's default is the `-1` "ask the stylesheet" sentinel and neither renderer here has one |
| `AdwBanner` | `title`, `buttonLabel`, `revealed`, `useMarkup`, `buttonStyle`, `onButtonClicked` | An omitted `useMarkup` is FALSE on both halves — the value the widget reads back, not the TRUE its `GParamSpec` declares |
| `AdwBin` | `children` | One child, no layout of its own |
| `AdwButtonContent` | `iconName`, `label`, `useUnderline`, `canShrink` | Four derivations from the core, including the 6px gap that is `border-spacing` and not `GtkBox:spacing` |
| `AdwButtonRow` | `title`, `onActivated` | A row that behaves like a button — always activatable, and holds no children at all |
| `AdwClamp` | `children`, `maximumSize` (600), `tighteningThreshold` (400) | Constrain a child's width and centre it, on libadwaita's easing curve |
| `AdwComboRow` | `title`, `subtitle`, `model`, `selected`, `useSubtitle`, `onNotifySelected` | Pick one item of a list. `model` keeps libadwaita's NAME and takes `@gjsify/adwaita-core`'s option vocabulary instead of a `Gio.ListModel` — the GTK half builds the real `Gtk.StringList`. One item or none is not a choice: no chevron, and the row is not activatable. `useSubtitle` MOVES the value into the subtitle rather than adding a second copy of it |
| `AdwEntryRow` | `title`, `text`, `maxLength` (0), `editable` (true), `showApplyButton` (false), `onNotifyText`, `onApply`, `onEntryActivated` | The row IS the entry. `max-length` counts CHARACTERS |
| `AdwExpanderRow` | `title`, `subtitle`, `expanded` (false), `onNotifyExpanded`, `children` | `children` are the DISCLOSED rows. The header toggles, the disclosure does not |
| `AdwHeaderBar` | `start`, `titleWidget`, `title`, `subtitle`, `end` | The three slots as PROPS, in draw order. No window controls: a phone has none |
| `AdwNavigationPage` | `children`, `title`, `tag`, `canPop` (true) | One page of a navigation view, or one pane of a navigation split view. A widget on GTK because `adw_navigation_view_add` takes one; three properties and no drawing of its own |
| `AdwNavigationSplitView` | `children` (the content), `sidebar`, `sidebarTag`, `contentTag`, `sidebarTitle`, `contentTitle`, `collapsed`, `showContent`, `sidebarPosition`, plus the four sizing props | Sidebar beside content; a navigation stack when collapsed. Both panes are wrapped in an `Adw.NavigationPage` on GTK, because the two slots take nothing else |
| `AdwNavigationView` | `children` (the pages, first is the root), `animateTransitions` (true), `popOnEscape` (true), `ref` (`push`, `pop`, `popToTag`, `replaceWithTags`, `visiblePageTag`, `canGoBack`, `backButtonTooltip`) | A page stack. Pushed BY TAG through the ref, never by prop — `Adw.NavigationView:visible-page` is read-only |
| `AdwOverlaySplitView` | `children` (the content), `sidebar`, `collapsed`, `showSidebar` (true), `pinSidebar`, `sidebarPosition`, `enableShowGesture` (true), `enableHideGesture` (true), `onNotifyShowSidebar`, plus the four sizing props | Sidebar that slides OVER the content when collapsed. Collapsing hides an unpinned sidebar itself, which is what `onNotifyShowSidebar` reports |
| `AdwPasswordEntryRow` | `title`, `text`, `maxLength`, `editable`, `showApplyButton`, `onNotifyText`, `onApply`, `onEntryActivated` | `Adw.EntryRow`'s surface exactly — the subclass declares no property of its own. `maxLength` counts CHARACTERS through the core, never `TextInput.maxLength`'s UTF-16 units |
| `AdwPreferencesGroup` | `children` (the rows), `title`, `description` | A titled card. Five visibility answers from one `derivePreferencesGroupHeader` call; the card hides itself at zero rows while its header stays |
| `AdwPreferencesPage` | `children` (the groups), `title`, `iconName`, `name`, `description`, `descriptionCentered`, `useUnderline` | Four of the five properties are identity a view switcher reads, drawn by neither half — as in libadwaita. Only `description` is painted |
| `AdwSpinRow` | `title`, `subtitle`, `value`, `lower`, `upper`, `stepIncrement`, `digits`, `onNotifyValue` | The range is `Gtk.Adjustment`'s three own property names rather than a fourth private spelling. Every mutation clamps, including a bound that moves under the value |
| `AdwSpinner` | `widthRequest`, `heightRequest` | The BOX and the RING are two numbers: an unbounded box around a ring capped at 64 |
| `AdwStatusPage` | `children`, `iconName`, `title`, `description` | A centred empty state. The icon draws on GTK only |
| `AdwSwitchRow` | `title`, `subtitle`, `active` (false), `onNotifyActive` | Controlled. The whole row toggles, not only the handle |
| `AdwToastOverlay` | `children`, `ref` (`addToast`, `dismissAll`) | One toast at a time. A toast is PUSHED through the ref, never declared as a prop — `add_toast` is a call |
| `AdwToolbarView` | `children` (the content), `topBar`, `bottomBar`, `topBarStyle` (`flat`), `bottomBarStyle` (`flat`), `extendContentToTopEdge` (false), `extendContentToBottomEdge` (false) | Content framed by bars. The two styles reach the real widget on GTK and draw nothing on a phone |
| `AdwViewStack` | `pages` (`name`, `title`, `iconName`, `visible`, `badgeNumber`, `needsAttention`, `useUnderline`, `child`), `visibleChildName`, `onNotifyVisibleChild` | Named pages, one visible. A page is a PROP OBJECT because `Adw.ViewStackPage` is a GObject and not a widget |
| `AdwViewSwitcher` | `AdwViewStack`'s props plus `policy` (`narrow`) | A button row over the stack. It BUNDLES the stack libadwaita keeps separate, as both other renderers do — on GTK it still builds a real `Adw.ViewStack` and binds it to `Adw.ViewSwitcher:stack` |
| `AdwWindowTitle` | `title`, `subtitle` | Two labels; an EMPTY one takes no space, a blank one does |
| `AdwWrapBox` | `children` plus libadwaita's fourteen: `childSpacing`/`childSpacingUnit`, `lineSpacing`/`lineSpacingUnit`, `align`, `justify`, `justifyLastLine`, `lineHomogeneous`, `naturalLineLength`/`naturalLineLengthUnit`, `packDirection`, `wrapReverse`, `wrapPolicy`, `orientation` | Children flow onto new lines. The line DECISION is `@gjsify/adwaita-core`'s, the line BREAKING is Yoga's |

Props are libadwaita's own names, camelCased — `maximumSize` is `AdwClamp:maximum-size`,
not a React Native `maxWidth` — so the property you look up in libadwaita's documentation
is the property you write. Defaults are libadwaita's.

A signal is named the way [`@gjsify/gtk-host`](../gtk-host)'s generated surface names it
(`onActivated` for `::activated`, `onNotifyActive` for `notify::active`), because the GTK
half hands the prop straight to the host and a second spelling here would be a translation
table nothing checks.

**A slot is a prop, never a `slot`-carrying child.** `AdwHeaderBar`'s three ends and
`AdwToolbarView`'s two bars are props because gtk-host routes a child by a `slot` prop on
the CHILD, and a prop of a React component is an arbitrary `ReactNode` with nothing to
write it on — `cloneElement` sets a prop on a COMPOSITE component, which forwards
nothing, so the slot would be silently dropped for exactly the children this package
ships. Each slot therefore gets one container widget on GTK, which is also what
libadwaita puts there itself.

**A property this package does not carry is ABSENT, never present and ignored** — the
omissions are listed under [Named divergences](#named-divergences). Two rules decide who
owns a value: `AdwSwitchRow:active` is strictly CONTROLLED (React Native's own contract for
`Switch`, and what a GTK consumer gets from the host's echo guard), while
`AdwEntryRow:text` and `AdwExpanderRow:expanded` are owned by the ROW — the prop seeds
them and overwrites them when it CHANGES, and a keystroke or a tap the consumer does not
echo back still stands. That is GObject's contract rather than React's, and both halves
follow it for the same mechanical reason: `@gjsify/gtk-host` patches a property only when
the prop changes, and `@gjsify/adwaita-core`'s state machines are the buffer on the other
side.

**Neither half styles text.** Bold-and-dim is `@gjsify/adwaita-web`'s stylesheet and
`@gjsify/adwaita-nativescript`'s theme CSS; this package has no theme layer to read
`@gjsify/adwaita-core`'s tokens through, so what the React Native half carries is layout
and visibility. Inventing a styling seam is a decision this slice does not make.

### `AdwExpanderRow` needs a curated placement, and this package added it

`Adw.ExpanderRow` was in `@gjsify/gtk-host`'s GENERATED table, which knows the tag and no
placement rule, so every child of an `<adw-expander-row>` was an `uncurated-placement`
refusal. The policy is now curated in `gtk-host/src/descriptors/adw.ts` — `add_row` as the
default slot, `add_prefix`/`add_suffix` by name — and it needed one thing the `slotted`
policy did not have: `add_row` hands the child to an inner `Gtk.ListBox`, and
`gtk_list_box_remove` does NOT unwrap the implicit `GtkListBoxRow` that box makes for a
non-row child, so the child leaks on unmount behind one `Gtk-WARNING`. Measured on GTK
4.22.4, and caught by the host's own "every slotted descriptor survives a round trip
through every slot" mechanism before this shipped. So `slotted` now takes the same
per-slot `wrapSlots` that `indexed` already declared for `GtkListBox`, and the host makes
the row itself. Any widget can go in a disclosure.

## How the two halves are selected

Through the package's `exports` map and the `react-native` condition:

| condition | entry |
|---|---|
| `react-native` | `lib/esm/index.native.js` |
| `default` | `lib/esm/index.gtk.js` |
| `exports` ignored, `module` read | `lib/esm/index.js` — refuses, by name |

**A stock React Native 0.87 application needs no configuration.** `metro-config` enables
package exports and `@react-native/metro-config` supplies the `react-native` condition.

Two things follow that are easy to undo by accident, so both are held by
`scripts/check-adwaita-rn-platform-split.mjs` rather than by convention — its header
carries the resolver measurements behind them:

- **The condition ORDER is part of the map.** `exports` answers with the first match and
  `default` matches everything, so moving `default` ahead of `react-native` hands the GTK
  build to every phone.
- **Every barrel names its platform files literally.** Nothing relies on a resolver
  picking a `.native` sibling: that mechanism is real, and right for an *application*,
  but it does not carry a published library whose shipped imports carry a `.js` extension.

### Consuming it on GTK

Nothing to configure on the phone. On GTK, point JSX at the host that has a GTK element
list, so a stray `<div>` is a type error instead of a tag that type-checks and renders
nothing:

```json
{
    "compilerOptions": {
        "jsx": "react-jsx",
        "jsxImportSource": "@gjsify/gtk-host/react"
    }
}
```

## What is proven, and what is not

| claim | held by |
|---|---|
| both halves satisfy one declared surface | `tsc` — a platform module that renames, drops or invents a prop, or changes an arity, is a compile error |
| the `.native` half type-checks against **real** React Native | the `react-native` package's own types, never a subset |
| GTK: the widget is the real `Adw.*`, and it **renders** | the live GTK tree plus a GSK rasterisation, because GTK's failure mode is an empty window at exit 0 |
| React Native: which primitives, which props, which nesting | React's own reconciler over `react-test-renderer` |
| GTK: where the children actually END UP, not that they exist | numbers read off the live tree. Three 100-point children at `childSpacing` 20 in a 1000-point frame sit at x=0, 120 and 240, and `align={1}` moves a two-child line to x=780 and 900; a toolbar view's content starts at `topBarHeight` and is `height − topBarHeight − bottomBarHeight` tall, and extending the top edge moves it to y=0 while the bar KEEPS its height |
| GTK: a slot is the slot it was written into | the style class libadwaita puts on the box it packs into — `start`/`end` on the header bar, `top-bar`/`bottom-bar` on the toolbar view. `pack_start`, `pack_end`, `add_top_bar` and `add_bottom_bar` are all WRITE-ONLY, so an assertion that the child is merely present passes with the child in the wrong slot |
| both halves agree on the number | two frames, one of them ON the easing curve: 1000 points at `maximumSize` 400 gives width 400 at offset 300, and 700 points at the default 600/400 gives **575 at offset 62**, where a `min()` would give 600 |
| both halves answer the same for a property value GObject cannot store | `normalizeClampSize` from `@gjsify/adwaita-core`, run by **both** halves — the same call `@gjsify/adwaita-web` and `@gjsify/adwaita-nativescript` make. `400.7` &rarr; 400, `NaN` &rarr; the default 600, `-5` &rarr; the range floor 0, asserted on both sides |
| both halves pick the same avatar colour, from the same bytes | libadwaita PUBLISHES its answer: `set_class_color` stamps `color{n}` on the avatar's internal gizmo. GTK reads `color11` off the live tree for "Ada Lovelace" and `color6` for "Grace Hopper"; React Native paints `#8c75d9` and `#eba831`, the same two entries flattened. Two names, because one agreeing proves only that both landed in a bucket once — the derivation is `g_str_hash` over UTF-8 BYTES, and a renderer hashing UTF-16 code units agrees for plenty of ASCII names |
| both halves show ONE toast for two adds | measured on libadwaita 1.9.3 as a single `AdwToastWidget` carrying the first title, and asserted of `@gjsify/adwaita-core`'s `AdwToastQueue` on the other side. Neither half runs the other's queue |
| the millisecond&rarr;second conversion cannot turn a brief toast into a permanent one | `Adw.Toast:timeout` counts whole seconds and reads back 5 on a default toast; `DEFAULT_TOAST_TIMEOUT` counts 5000 ms. The conversion is `ceil`, asserted against libadwaita's own default rather than against itself — `Math.round(400 / 1000)` is 0, which is "until dismissed" |
| the spinner's box and its ring are held on the half where each is a node | GTK measures the BOX (`[16, 16]` unrequested, 200 requested, no upper bound); React Native asserts the RING, which on GTK is an `AdwSpinnerPaintable` and not a widget at all — 64 points with an 8-point stroke inside a 200-point box |
| the rows share libadwaita's derivations rather than re-deriving them | the React Native half runs `@gjsify/adwaita-core` and the GTK half reads the answer back off the real widget: `activatable` false on `Adw.ActionRow` and `BUTTON_ROW_ACTIVATABLE` true on `Adw.ButtonRow`, the `notify` gate that stays SILENT for a set to the value already held on both the switch row and the expander, and `max-length` keeping `'🔒é'` — 2 characters, 3 UTF-16 units — where `TextInput.maxLength` would cut the pair in half |
| `AdwExpanderRow`: the disclosure is an ALLOCATION, not a flag | the live GTK tree, with animations off: the disclosed row is unmapped at 0×0 and still PARENTED while collapsed, and 596 wide below the header once revealed, with the expander's height equal to its header list plus its revealer to the point (109 = 55 + 54 on libadwaita 1.9.3) |
| `AdwExpanderRow`: an unechoed toggle survives the next render, on both halves | a second render with the prop unchanged, asserted on each side — the GTK one against the real widget through `@gjsify/gtk-host`'s patch-on-change, the React Native one through `ExpanderState` |

**Not proven: the row THEME.** What the rows lay out is structure — `flexDirection: 'row'`
is what makes a row a row — and what they do not carry is padding, the type scale, the
dim-label colour and the row separator. `@gjsify/adwaita-core`'s `/tokens` subpath states
outright that projecting its CSS custom properties onto a React Native style scale is a
mapping decision of its own, and this slice does not make it. The rows are correct and
unstyled.

**Not proven: Yoga, and the device.** A `width` in a style object is an instruction to a
layout engine that no test here runs. The React Native half is type-checked and
tree-checked and has never been on a phone. That gap closes with an app on a real device,
and until then it is a gap, not a formality.

## Named divergences

These are places where the two halves cannot be made identical, written down rather
than smoothed over.

- **`AdwPreferencesPage` is not a scroller on React Native.** `Adw.PreferencesPage` wraps
  its groups in a `GtkScrolledWindow`; this half emits the column and a consumer wraps it.
  Not a shortcut: `testing/react-native.ts` may only double a React Native component that
  IS a host element with its props forwarded, and `ScrollView` is a COMPOSITE that renders
  `RCTScrollView` around a second content `View` and moves `contentContainerStyle` onto it.
  A double of it would be a nesting real React Native never emits, and every assertion
  written against it would be about the double — the measured reason `spinner.native.tsx`
  refuses `ActivityIndicator`. The same wrapper carries the page's CLAMP:
  `adw-preferences-page.ui` puts an `AdwClamp` inside the scrolled window, so a wide window
  centres the groups at the clamp width while this half stretches them. `AdwClamp` is in
  this package, so a consumer that wants both wraps with both.
- **`AdwPreferencesGroup` has no `header-suffix` and no `separate-rows`.** The first is a
  placement question, not a naming one: `header-suffix` holds a WIDGET, so a React surface
  has to spell it as a slot, and the group's curated descriptor in `@gjsify/gtk-host` is
  `ordered` — `add`/`remove`, `remove-all` to reorder, because `Adw.PreferencesGroup.insert`
  does not exist on libadwaita 1.x — which has no slots at all. Adding one changes a
  placement policy other conformance vectors already assert, with its own measurement. The
  second is pure card styling, and this package's React Native half draws no theme.
- **`AdwPreferencesGroup`'s `single-line` header state is derived and not drawn.** It is a
  stylesheet number — `min-height: 34px` against `margin-bottom: 6px` — and there is no
  theme layer here to spend it in. It is computed because it comes out of the same core call
  as the four states that ARE drawn.
- **A pure-markup group title is hidden on GTK and shown on React Native.**
  `adw-preferences-group.ui` sets `use-markup` on both header labels, and libadwaita's
  visibility test reads the DISPLAYED text — so `<b></b>` is an empty label there. This half
  paints the string verbatim and passes `useMarkup: false`, which is the case
  `derivePreferencesGroupHeader` documents that value for, and which both sibling renderers
  pass as well.
- **`AdwComboRow` has no popover on React Native.** `Adw.ComboRow` opens a `GtkPopover` over
  a `GtkListView`; a row with no overlay layer cannot. The press advances to the next option
  and wraps, which still runs the real `ComboState.select` guard — bounds and
  no-op-on-same — so the arithmetic underneath is the shipped one and only the gesture is
  this half's own.
- **`AdwComboRow`'s `useSubtitle` publishes the value at once on React Native and on the
  next selection change on GTK.** What both halves DO agree on is that the value is drawn in
  one place: `adw-combo-row.ui` binds the inline value view's `visible` to `use-subtitle`
  with `sync-create|invert-boolean`, and this half hides its trailing label the same way.
  What they cannot agree on is WHEN the subtitle picks the value up.
  `adw_combo_row_set_use_subtitle` calls `selection_changed`, while the subtitle is written
  by `selection_item_changed` — a different function, reached only from
  `notify::selected-item` and `set_model` — so an authored subtitle survives switching
  `use-subtitle` on and is replaced by the next selection change. Measured on libadwaita
  1.9.3 and asserted on both halves. Reproducing the lag here would mean carrying a
  libadwaita ordering artefact into a renderer that has no reason for it.
- **`AdwSpinRow`'s range is spelled `lower`/`upper`/`stepIncrement`, where the two sibling
  Adwaita renderers spell it `min`/`max`/`step`.** Those are
  `adw_spin_row_new_with_range`'s PARAMETER names; these are `Gtk.Adjustment`'s own GObject
  property names for the same three values, and this package's rule is that a caller writes
  the property they would look up in libadwaita's documentation. The arithmetic is still
  shared — both halves map onto `@gjsify/adwaita-core`'s `SpinState`, which uses the short
  names internally.
- **`AdwSpinRow`'s decimal separator is the process locale's on GTK and always `.` on React
  Native.** `gtk_spin_button_update` formats the displayed value through the C library's
  locale — measured on gjs 1.88.1 under a de_DE locale, a `digits={2}` row of 3.14159 reads
  `3,14` — while `Number.prototype.toFixed` is specified never to localise and gives `3.14`
  on every machine there is. The two halves therefore agree on the DIGIT COUNT and differ by
  one character. Both suites assert the digits; neither builds its expectation from the
  locale, because a test that did would be measuring the machine it runs on.
- **A range that moves past itself notifies twice more on React Native than on GTK.** The
  GTK half builds one new `Gtk.Adjustment` from `lower`, `upper` and `stepIncrement`
  together, so moving 0…100/50 to 200…300/250 is a single step. The React Native half
  applies each property in its own effect — one per setter, because each has its own guard
  in the C — so it passes through an inverted range: `setMin(200)` runs while the maximum is
  still 100, and `SpinState`'s clamp answers the maximum. `onNotifyValue` therefore reports
  `100, 200, 250` where GTK reports the end state. The settled value is the same on both,
  React batches the renders, and the stream is asserted so that changing it is a decision.
- **`AdwSpinRow` carries no `climb-rate`, `snap-to-ticks`, `numeric`, `update-policy` or
  `wrap`.** Each needs an editable text entry or a key-repeat timer the React Native half
  does not have, so carrying them would mean a property GTK honours and the phone ignores.
  Neither sibling renderer has them either.
- **`AdwPasswordEntryRow`'s caps-lock indicator is present and can never show.**
  `indicatorVisible` is `editing && show_indicator`, and `show_indicator` is pushed from
  `!revealed && capsLockOn` — but React Native exposes no keyboard modifier state, and this
  surface carries no prop libadwaita does not have, so nothing can set it. The node stays in
  the tree, hidden, and a test asserts that: "no caps-lock warning" and "no caps-lock
  support" must not be the same picture. `@gjsify/adwaita-nativescript` hit the same wall
  and answered it with a host seam, which is a surface this package does not have.
- **`AdwPasswordEntryRow` publishes no `revealed`, where both sibling renderers do.**
  `Adw.PasswordEntryRow` declares no property of its own — its generated prop interface is
  empty over `AdwEntryRowProps` — and the peek state is private to the widget. A `revealed`
  prop would be the one place this surface invents a name; the button owns it on both halves.
- **The glyphs on the three rows are this half's own.** The chevron, the two steppers, the
  apply check, the caps-lock arrow and the peek pair all stand in for icon-theme names the
  core carries as data (`pan-down-symbolic`, `value-increase-symbolic`,
  `adw-entry-apply-symbolic`, `caps-lock-symbolic`, `view-reveal-symbolic`). They are NOT
  what `@gjsify/adwaita-web` draws — that renderer masks a generated CSS class from the same
  names and draws no text at all — so they are named here as a divergence rather than as a
  shared fallback. The accessible NAMES beside them do come from the core, so
  "Show Password"/"Hide Password"/"Apply"/"Caps Lock is on" are one string in one place
  across three renderers.
- **`AdwClamp` ignores the child's intrinsic minimum on React Native.** libadwaita's
  clamp is a two-pass measure-then-allocate, and a child minimum wider than the clamp
  RAISES all three thresholds — which is how such a child still gets its minimum
  instead of being cut off. React Native has no such pass: `onLayout` reports a size
  after layout and never the child's intrinsic minimum. So `childMin`/`childNat` are
  passed as 0, and a child wider than the clamp is compressed here and is not on GTK.
- **`AdwClamp`'s `small`/`medium`/`large` size class is not carried.** libadwaita stamps
  it on the child as a style class; React Native has no class system to stamp it into,
  and inventing a styling seam is a decision this slice does not make.
- **One unclamped frame.** Before the first `onLayout` there is no available width, so
  the child renders full-width for one frame.
- **A second child is kept on React Native and dropped on GTK, silently.** `Adw.Bin`,
  `Adw.Clamp`, `Adw.StatusPage:child` and `Adw.ToolbarView:content` are one-child slots,
  and gtk-host's `single` child policy fills them with `set_child`, so a second child
  EVICTS the first — with no throw, no host error and no GLib message. A `View` has no
  such limit and renders both. Both behaviours are pinned by a test on each side, so
  neither can move alone. Refusing more than one child on both halves would close it and
  is a surface decision this slice does not make.
- **`AdwHeaderBar` resolves an unauthored title on GTK and leaves it blank on a phone.**
  Authoring neither `title` nor `subtitle` installs no title widget at all, so
  libadwaita's `update_title` (adw-header-bar.c:475) walks navigation page → dialog →
  window → application name and puts what it finds in the centre; a phone has none of
  those to walk. Both sides are asserted — the GTK suite reads the window's own title
  back out of the bar, the React Native suite reads two collapsed labels.
- **`AdwHeaderBar` has a `title`/`subtitle` that `Adw.HeaderBar` does not.** The real
  widget has no `title` property; its derived centre is a plain `gtk_label_new (NULL)`
  with no subtitle at all, and an app that wants one sets an `AdwWindowTitle` as its
  title widget. A declarative surface wants the attribute, so authoring either installs
  an `AdwWindowTitle` centre. This is the same divergence `@gjsify/adwaita-web` and
  `@gjsify/adwaita-nativescript` carry, recorded as `HeaderBarRenderState.derivedSubtitle`
  in `@gjsify/adwaita-core`.
- **Neither renderer here resolves an icon theme, so `iconName` is accepted and not
  drawn.** `icon-name` names an entry in an ICON THEME and React Native has none — no
  `Image` source a GNOME symbolic name resolves to, and no renderer for the SVG
  `@gjsify/adwaita-nativescript` substituted instead. Drawing the name as text would put
  the literal `folder-symbolic` on screen. So `AdwStatusPage` shows no icon, `AdwAvatar`'s
  icon mode is a coloured circle with the initials hidden where GTK draws
  `adw-avatar-default-symbolic`, and `AdwButtonContent`'s icon slot sits in the row with
  libadwaita's own `hexpand` and holds no glyph. The props are carried so a GTK consumer's
  props stay portable, and the ABSENCE of an icon node is asserted in each case, so the
  day one appears it is a decision and not a drift.
- **`AdwToolbarView` does not run libadwaita's allocation on React Native, and cannot.**
  `adw_toolbar_view_size_allocate` is two chained CLAMPs over the bars' MINIMUM and
  NATURAL heights — ported as `toolbarViewAllocate` and held to vectors — and React
  Native hands a component an already-laid-out size and never a child's intrinsic
  minimum. Feeding the measurement in as both `min` and `nat` would turn each CLAMP into
  the identity and dress a pass-through up as libadwaita's arithmetic. The consequence is
  one-directional: a STRETCHY bar keeps its natural height where libadwaita would shrink
  it toward its minimum to protect the content.
- **`AdwToolbarView`'s four style classes have nowhere to land on a phone.** `raised`,
  `border`, `undershoot-top` and `undershoot-bottom` are what `topBarStyle` and
  `bottomBarStyle` derive; React Native has no class system to stamp them into. Both
  props are carried and reach no style, which is asserted on the React Native side and
  measured against libadwaita's own `update_undershoots` on the GTK side.
- **`AdwWrapBox`'s `naturalLineLength` is a MAX SIZE on React Native.** libadwaita caps
  the box's NATURAL size REQUEST and leaves a larger allocation free to happen; neither
  CSS nor Yoga has a property that caps only the intrinsic contribution, so this half
  writes `maxWidth`/`maxHeight`. `@gjsify/adwaita-web` records the same deliberate
  deviation. Limiting line length inside a popover — the intended use — behaves the same
  either way.
- **`AdwWrapBox` wraps every child in a `View` of its own.** `flex-grow` and `flex-shrink`
  belong to the CHILD, and this component does not own its children's styles:
  NativeScript sets them as attached properties and the browser publishes a custom
  property its stylesheet reads, and neither seam exists here. The wrapper is therefore
  visible in the tree and is asserted rather than left as an implementation detail.
- **`AdwWrapBox`'s `align` is snapped to three positions on both non-GTK renderers.** C
  offsets the whole line block by `roundf (length_delta * align)` — a continuum — and
  flexbox has `flex-start`, `center` and `flex-end`. The snap is the renderers'
  approximation and not libadwaita's rule, which is why it lives in
  `@gjsify/adwaita-core`'s `wrapBoxFlexStyle` rather than in a conformance vector. The
  GTK half runs none of it: `Adw.WrapBox` is `adw-wrap-layout.c` itself, and the suite
  reads the continuum back off the live tree.
- **`AdwAvatar`'s font size is the CAP, not a measurement.** `update_font_size` scales
  the label's measured aspect ratio against `avatarMaxFontSize(size)`; React Native
  reports a text box only through `onLayout`, i.e. after layout — the same missing
  measure pass that makes `AdwClamp` pass `childMin: 0`. Using the cap alone stays inside
  libadwaita's bound. The NativeScript port's `size * 0.4` heuristic is deliberately not
  copied: it is not monotonic in `size` and exceeds the cap above ~54 points.
- **`AdwButtonContent` cannot stamp `image-text-button`.** `adw_button_content_root` puts
  the class on the nearest `GtkButton` ancestor, and this package ships no button for it
  to find. `buttonContentStyleTargetIndex` holds the retarget rule for a renderer that has
  a tree to walk; when a button lands here, that is the call to make.
- **`AdwSpinner` draws the track and not the arc.** `AdwSpinnerPaintable`'s segment
  extends, overlaps, contracts and idles on an ease-in-out-sine while the whole figure
  turns, and drawing it needs a path renderer that is not a dependency of this package.
  What is drawn is the circle underneath — `ADW_SPINNER_TRACK_OPACITY` of the current
  colour, exactly what the browser renderer paints under its arc. The `_spinner.scss`
  substitute (a fixed 90-degree `border-top-color` chase at 0.8s) is a different animation
  with a different period, so copying it would put a wrong number where there is an absent
  one. **The suite asserts the track's opacity and nothing about motion** — there is no
  animation assertion here, because there is no animation to assert.
- **`Adw.Toast:timeout` is lossy in the other direction.** GObject stores whole seconds,
  so 1500 ms is 2 s on GTK and stays 1500 ms on React Native.
- **A toast's action button has no callback.** `Adw.Toast` expresses its action as
  `action-name`, a `GAction` this package has no surface for, so pressing the button does
  what both other renderers do: dismiss the current toast, which advances the queue.
- **`dismissAll`'s REMOVAL is asserted only on React Native.**
  `adw_toast_overlay_dismiss_all` animates the strip out over real time, and pumping the
  main context for ~1.6s leaves the `AdwToastWidget` in place — measured. GTK asserts that
  the call lands and costs no diagnostic; the removal is asserted where the queue is ours.
- **`AdwBanner` reduces markup to its plain text.** React Native has no inline-markup
  layer, and painting `<b>Metered</b>` literally is further from what GTK draws than
  painting `Metered` is. Unparseable markup keeps the raw string, which is Pango's own
  fallback.
- **A press assertion proves the widget ASKS for the press, never that a tap arrives.**
  The `react-native` double forwards `onPress` verbatim; the real runtime wires it through
  the press responder. Same class of gap as Yoga, one layer up.
- **`Adw.ClampScrollable` has no counterpart and will not get one.** It binds its four
  scroll properties onto its child, which is a GTK adoption concern; on React Native
  scrolling belongs to the `ScrollView`, not to the clamp. This is an asymmetry, not a
  missing widget.
- **No icons anywhere on the React Native half.** `AdwActionRow:icon-name`,
  `AdwButtonRow:start-icon-name`/`:end-icon-name` and `Adw.EntryRow`'s edit and indicator
  icons all name an entry in a GTK ICON THEME, and this package ships no icon renderer for
  React Native. The PROPS are therefore absent from the surface rather than accepted on one
  half and dropped on the other. Two affordances that are the widget's own rather than a
  caller's prop do get a stand-in CHARACTER — the entry row's apply button (`✓`) and the
  expander's chevron (`▾`/`▴`) — because without them those two widgets give a user no
  signal that they do anything. Neither is what `@gjsify/adwaita-web` draws: that renderer
  masks a generated `.adw-icon--<name>` CSS class and shows no text at all.
- **`add_prefix` has no counterpart.** `Adw.ActionRow` and `Adw.ExpanderRow` both have a
  prefix slot, reachable on the GTK half by writing `slot="prefix"` on a child. React
  Native has no slot mechanism, and giving the surface a `prefix` PROP taking a node would
  be a second child channel that only one half implements, so the surface offers `children`
  only — the suffix on the action row, the disclosure on the expander.
- **`AdwExpanderRow` carries no `enable-expansion` and no `show-enable-switch`.** The
  enable switch is a SECOND control inside the row with its own veto over the disclosure,
  and the rule tying the two flags together lives in no shared place:
  `@gjsify/adwaita-core`'s `ExpanderState` — what all three renderers compose — models the
  disclosure alone. Adding it here would create a fourth private copy of a rule three
  renderers need; lifting it into the core first is what would close this, and this slice
  does not do it.
- **A disclosed child must be a real row on GTK, and can be anything on React Native.**
  `adw_expander_row_add_row` hands the widget to an inner `Gtk.ListBox`, which wraps a
  non-row child in an implicit `GtkListBoxRow` that `remove` then cannot find — measured on
  libadwaita 1.9.3, a `Gtk.Label` disclosed child leaks on unmount behind a single
  `Gtk-WARNING`, an `Adw.ActionRow` round-trips cleanly. The curated descriptor carries the
  measurement. A React Native `View` has no such rule.
- **`AdwEntryRow`'s empty↔filled cross-fade is a hard swap.** libadwaita animates between
  the placeholder and the floating title over its own duration; the React Native half
  switches at the two endpoints, the same compromise `@gjsify/adwaita-nativescript` makes,
  because a cross-fade needs an animation seam this slice does not add.
- **`AdwSwitchRow` is strictly controlled and `Adw.SwitchRow` is not.** React Native's own
  contract for `Switch` is that the component renders the `value` prop whatever the user
  does, so a toggle the consumer declines to echo back is not kept here — where GTK keeps
  it. The other two stateful rows go the GTK way (see [Widgets](#widgets)); this one goes
  React Native's, because a `Switch` that disagrees with its `value` prop is a bug on that
  platform.
- **The navigation view animates on GTK and swaps instantly on React Native, and there
  is no automatic back button.** `animateTransitions` reaches the real
  `Adw.NavigationView` and reaches `NavigationViewState` on the other half, where nothing
  spends it — this package has no animation layer, which is the same position
  `@gjsify/adwaita-nativescript` records ("kept for API parity"). `popOnEscape` is inert
  for the plainer reason that a phone has no Escape key. And where the browser renderer
  finds an `<adw-header-bar>` inside the visible page and injects a back button into it,
  neither NativeScript nor this package can identify a header bar inside an opaque child:
  `canGoBack()` and `backButtonTooltip()` on the handle are libadwaita's own two
  derivations, and the caller wires its own button to them.
- **An untitled `Adw.NavigationPage` is a GTK warning and nothing at all on React
  Native.** Measured on libadwaita 1.9.3: a page with no title prints `AdwNavigationPage
  0x… is missing a title. To hide a header bar title, consider using
  AdwHeaderBar:show-title instead.` The React Native half has no counterpart, so the
  `'Back'` tooltip fallback — which needs an empty title — is asserted on that half only,
  against the constant both halves import from `@gjsify/adwaita-core`.
- **Neither split view has a content minimum to protect on React Native.** libadwaita
  caps the sidebar with the content pane's own minimum width and reports
  `sidebar_min + content_min` as the view's own minimum; React Native hands a component an
  already-laid-out size and never a child's intrinsic minimum, so `contentMin` and
  `sidebarChildMin` go in as 0. The consequences are one-directional and both measured:
  the sidebar can take its full share of a view too narrow for both panes, and the view
  cannot refuse to be narrower than its contents the way GTK does (the GTK suite asserts
  that refusal at 380 against `measureSplitViewHorizontal`; the React Native suite cannot
  ask). Same class as `AdwClamp`'s `childMin`.
- **The two sidebar-width rules can only be told apart one at a time on GTK.**
  `resolveNavigationSidebarWidth` caps the sidebar's MAX BOUND by `width - content_min`
  and `resolveOverlaySidebarWidth` caps the RESULT, which the core's own vectors separate
  at 300 points (180 versus 100). The NAVIGATION half of that pair is unreachable through
  a window: `measure_uncollapsed` makes `sidebar_min + content_min` its minimum, GTK never
  allocates below a minimum, and from there upwards `width - content_min` never falls under
  `sidebar_min`, so the bound cap never inverts. The OVERLAY half is reachable, because its
  minimum is `(int) (sidebar_min * show_progress) + content_min` — a hidden sidebar takes
  that term out — and the GTK suite reads its 100 off the live tree. So the two answers are
  never asserted side by side here; the disagreement itself is held by
  `@gjsify/adwaita-core`'s vectors, and this package asserts the navigation minimum and the
  overlay cap separately.
- **The overlay's reveal is instant on React Native.** libadwaita animates with a spring
  `(1, 0.5, 500)`; `@gjsify/adwaita-web` approximates it from `requestAnimationFrame` and
  `@gjsify/adwaita-nativescript` from `View.animate()`. React Native's own answer is
  `Animated`, a COMPOSITE surface the test double may not stand in for, so the core's
  `INSTANT_SPLIT_VIEW_ANIMATOR` default stands and `enableShowGesture` /
  `enableHideGesture` are carried and inert. `show-progress` still runs through the core,
  so the continuum is expressible the day an animator is plugged in.
- **The React Native split views resolve `start`/`end` against `ltr` only.**
  `isSidebarAtVisualStart` takes a reading direction, GTK resolves it from the widget, and
  React Native's lives on `I18nManager` — not a host component, so not something
  `testing/react-native.ts` may double. The core call still takes the parameter; closing
  this is one argument.
- **`sidebar-position: end` is invisible on a COLLAPSED React Native split view.**
  `resolveNavigationStack` builds the stack the other way round for `end` — the content is
  the root page and the sidebar is pushed on top of it — but the LAST entry, which is the
  pane on screen, is the same for both positions at every value of `show-content`. What
  differs is the push/pop DIRECTION, which a renderer spends on a slide and this one has
  none of. The position IS asserted where it is observable: the docked draw order.
- **`sidebarTitle` and `contentTitle` reach a real page on GTK and nothing on a phone.**
  They are `Adw.NavigationPage:title` of the wrap `AdwNavigationSplitView` puts around each
  pane, which libadwaita uses for the header of a collapsed view. The React Native half has
  no header bar to put a title in, so it carries them and draws neither — the same shape as
  `iconName`.
- **`AdwViewSwitcher` bundles the stack libadwaita keeps separate.** `Adw.ViewSwitcher:stack`
  points at an `Adw.ViewStack` elsewhere in the tree, and a React prop cannot hold a widget
  that does not exist yet on the half where widgets exist at all. Both other renderers made
  the same call. On GTK nothing is simulated: the component builds a real `Adw.ViewStack`
  and writes it into that property, which the GTK suite asserts by identity.
- **The switcher's buttons carry no icon.** Same icon-theme rule as above, with one extra
  consequence worth naming: a page with an icon and NO title still gets a button, because
  `isViewSwitcherButtonVisible` tests both — and on React Native that button's label is
  empty. The button's ORIENTATION is still applied, since it is what arranges the label
  and the badge.
