# 89. Platform design languages sit on top of Adwaita, in three layers: tokens, platform integration, and widgets with no Adwaita equivalent

- Status: **Proposed**
- Date: 2026-10-02
- Deciders: Pascal Garber
- Related: [ADR 0003](0003-package-tiering.md) (new packages start at tier 3),
  [ADR 0018](0018-os-axis-declaration.md) (`gjsify.os` for OS-branching code),
  [ADR 0034](0034-widget-vocabulary-convergence.md) (the owning-library rule this extends),
  [ADR 0078](0078-the-desktop-appearance-reaches-a-web-page-through-a-handoff.md) (the
  desktop appearance reader the accent decision builds on),
  `website/astro.config.mjs` (the `Adwaita` sidebar group)

## Context

GTK 4 and libadwaita now run on Linux, Windows and macOS. Adwaita is GNOME's design
language, so a gjsify app looks like a GNOME app on all three. The other platforms have
their own:

- **Fluent 2** — Windows 11, WinUI 3, with the Mica and Acrylic materials.
- **Apple HIG with Liquid Glass** — macOS, iOS and iPadOS 26 (2025).
- **Material You** (Material 3, currently M3 Expressive) — Android.

The goal is a native look and feel per platform, so that a portable app does not look
foreign on two of its three desktops — and, long term, on phones and tablets too: Apple's
HIG covers macOS, iPhone and iPad alike, and Material You is Android's.

Mobile already gets real native widgets through the NativeScript bridge (the
`nativescript` axis) and React Native. The first layers decided here land on the GTK
desktops and `@gjsify/adwaita-web`; the token model is deliberately not GTK-specific, so
that the NativeScript and React Native surfaces can consume the same design languages
later (see § Every language on every system).

Precedent exists: Qt Quick Controls ships styles (Material, Universal, iOS, macOS),
Avalonia ships a Fluent theme, Flutter ships Material and Cupertino.

ADR 0034 decides which website section and which namespace a widget lands in by the
library that owns its GType: libadwaita owns it → `Adw`, GTK owns it → `Gtk`. The sidebar
already anticipates more: "Adwaita" is named after the design system, so a second one can
sit beside it.

## Decision

A design language is a layer over Adwaita, never a replacement for it. It has three
layers, ordered by cost. A language ships only when all three it needs are complete.

### Every language on every system

A design language is selected by the app (or the user), not by the OS: Fluent runs on
Linux and macOS, HIG on Windows and Linux, Material You on every desktop. Nothing in a
language may REQUIRE its home platform. Hence a fixed fallback order for every value:

1. **The system's own value**, where the running OS offers it (the accent, the colour
   scheme, high contrast, a window material).
2. **The nearest equivalent the running OS offers** — above all the accent: every desktop
   and mobile OS we target has a user accent (portal on Linux, WinRT/registry on
   Windows, `controlAccentColor` on macOS/iOS, the dynamic-colour seed on Android 12+),
   and a language takes it whatever OS it was designed for.
3. **The language's documented default**, shipped in its token set (e.g. Fluent's
   default accent, Apple's `systemBlue`, Material's baseline seed), used only where 1 and
   2 give nothing.

Layer-2 integration is an enhancement under the same rule: Mica on Linux, or Liquid
Glass on Windows, falls back to the language's own documented solid fallback surface —
the one the vendor itself uses where the material is unavailable — never to a broken or
half-applied look.

Tokens are therefore **platform-neutral data**, one source per language, with one emitter
per surface: Adwaita CSS for GTK (layer 1), CSS for `@gjsify/adwaita-web`, and later the
styling inputs of the NativeScript and React Native widgets.

**One style per language, taken from the original.** A design language ships exactly one
style: the platform's own, light and dark, coloured by the system accent. No colour
variants, no "rounded/square" or "compact" tweaks, no alternative accents of our own.

### The user chooses, at run time

The app decides its DEFAULT language and whether to offer a choice; the user's choice
wins. An app may stay on Adwaita by default on Linux and still offer Fluent or the Apple
look in its preferences. The framework provides the setting and its persistence, so an
app only opts in.

Switching applies **at run time, without a restart**: layer 1 swaps one `CssProvider` for
another and re-emits the accent tokens, layer 2 removes one window material and requests
the other. A restart is the documented fallback only for a part that provably cannot
switch live, and each such part names its reason; it is never the default path.

### Accent equivalence

Languages fall into two kinds. Fluent and Material You take ANY colour as accent, so they
consume the exact `accentRgb` and need no mapping. Adwaita (nine named accents) and macOS
(eight named accents plus multicolour) have a NAMED set, so a colour coming from another
system has to land on one of the names. Two mechanisms, in this order:

1. **An equivalence table** where both sides are named — e.g. macOS `purple` ↔ Adwaita
   `purple`, Windows' default `#0078D4` ↔ Adwaita `blue`. Committed data, one row per
   pair, each row citing where the source value was read.
2. **A colour-space partition** for every colour no row covers: hue ranges in OkLCh plus a
   chroma floor for greys. Adwaita's partition already exists — libadwaita's own hue ladder
   (`adw_accent_color_nearest_from_rgba`), ported and held against vectors read out of
   libadwaita in `@gjsify/adwaita-core`'s `nearestAccent`. Each named-set language
   declares its partition the same way.

### 1. Design tokens → Adwaita CSS

Each design language gets a token set — colour, radius, spacing, typography, motion —
generated into CSS over libadwaita's CSS variables. The CSS is an app-level
`CssProvider` added at a priority above libadwaita's own.

Adwaita CSS nodes and classes are NOT stable API; a libadwaita release can rename one.
Visual regression tests (the storybook) are therefore required for every style, and a
libadwaita bump re-runs them.

Token values come from the vendor's sources, never from a third-party theme:

- Fluent: WinUI 3's theme resources (`refs/microsoft-ui-xaml`,
  `controls/dev/*/*_themeresources.xaml`, MIT) and the Fluent 2 design guidance.
- HIG: Apple's Human Interface Guidelines and Apple Design Resources (the system colours,
  materials and type ramp per platform). Apple publishes no code to vendor, so values are
  transcribed and cited per token.
- Third-party GTK ports such as `refs/fluent-gtk-theme` (vinceliuice, GPL-3.0) and
  `refs/whitesur-gtk-theme` (vinceliuice, MIT, macOS-style) are a map of
  WHICH Adwaita/GTK selectors a restyle has to touch, and a visual comparison. Their values
  and variants are not adopted, whatever the licence: they approximate the original and
  ship style options we do not. A CSS theme also ends at layer 1 — window materials,
  vibrancy, Liquid Glass and platform behaviour (layers 2 and 3) are where this ADR goes
  further than any of them.

**Accent and colour scheme follow the system, on every system.** Part of this exists
already:

- libadwaita ≥ 1.6 reads the accent itself on Linux (portal), Windows (WinRT
  `UIColorType_Accent`) and macOS (`NSColor.controlAccentColor`) — but SNAPS it to the
  nearest of its nine named accents (`adw_accent_color_nearest_from_rgba`). Fine for
  Adwaita, wrong for Fluent and HIG, whose accent is the exact user colour.
- ADR 0078's reader (`@gjsify/adwaita-app/appearance`: portal, GNOME settings, Windows
  registry, macOS defaults) keeps the exact value as `accentRgb` beside the snapped
  `accent`, and watches for changes.

A design language therefore consumes `accentRgb`, never the snapped accent, and writes it
into the accent tokens (`--accent-bg-color` and friends) of its layer-1 CSS, re-applied on
every change the reader reports. Fluent's accent ramp (light 1–3, dark 1–3) comes from
Windows' `AccentPalette` where it exists and is derived from the base colour on Linux and
macOS. Material You derives its whole tonal palette from the accent as seed, wherever
it runs. The Windows palette layout is not yet measured on Windows (see `mapping.ts`); the
first Fluent change measures it.

### 2. Platform integration, native per OS

What CSS cannot reach is done through the OS, in code declared per OS (ADR 0018):

- **Window backdrop materials.** Windows: `DwmSetWindowAttribute` with
  `DWMWA_SYSTEMBACKDROP_TYPE` for Mica and Acrylic. macOS: `NSVisualEffectView`, or
  `NSGlassEffectView` on 26, behind the GDK surface.
- **Behaviour conventions.** Dialog button order, window controls on the left on macOS,
  the global menu bar, Cmd versus Ctrl, scroll physics.
- **In-window glass and blur.** GTK CSS supports `backdrop-filter` since 4.22 (GTK NEWS,
  4.21.2), so a toolbar or sidebar blurs the window content beneath it in plain layer-1
  CSS.
- **Behind-window blur on Linux.** GTK 4.24 speaks the `ext-background-effect-v1` Wayland
  protocol (gtk!10145, which derives the blur region from the render node), and Mutter 51
  (mutter!5071) and KWin 6.7 implement it. A translucent window surface can thus ask the
  compositor to blur the desktop behind it — Linux's counterpart of Mica/Acrylic and
  macOS vibrancy, and the first place layer 2 can be developed and tested. Where the
  compositor lacks the protocol, the window falls back to the solid surface (§ Every
  language on every system).
- **Liquid Glass refraction** needs more than blur. `GskGLShaderNode` is deprecated since
  GTK 4.16 with no replacement; whether `backdrop-filter` with SVG filters can approximate
  it is unmeasured, so refraction stays **open and deferred**.

Anything that has to change inside GTK itself is not filed upstream by us. Per the
workspace rule, we open an issue in our own repo titled
`Upstream (GTK, file by hand): …` with the facts.

### 3. New widgets only where Adwaita has no semantic equivalent

A widget exists per design language when Adwaita has nothing that means the same thing:
Fluent `InfoBar` and `TeachingTip`, Material FAB, `NavigationRail` and `BottomAppBar`.
A difference that is only how an existing widget looks stays in layer 1. These widgets
compose or subclass Adw widgets; they do not reimplement them.

### Docs and website

Each design language gets its own sidebar section beside Adwaita and Gtk. ADR 0034's
rule extends by one case: **a widget goes in the section of the design-language package
that owns its GType**, so `Fluent.InfoBar` is documented under Fluent, not under
Adwaita.

**Prerequisite.** Design-language widgets build on Adw and Gtk widgets, so those two
sections must document every non-deprecated concrete widget first. Measured against the
installed GIRs today: Adwaita 39 of 55, Gtk 6 of 74. "Documented" means the full gallery
block, including its `@gjsify/adwaita-web` replica, since a block without one previews
nothing. No design-language section opens before that gap closes.

### Order

Fluent first, on all three desktops, with Windows as the place its layer 2 is measured:
Mica is a documented API, and Fluent is visually close to Adwaita, so layer 1 does most
of the work. The glass and blur work starts on Linux, the one platform where both halves
are testable today: in-window `backdrop-filter` with GTK ≥ 4.22, behind-window blur with
GTK ≥ 4.24 on Mutter ≥ 51 or KWin ≥ 6.7. Material You follows; its tonal palette needs
only the accent seed. Liquid Glass comes later, after the shader question above has an
answer.

## Consequences

- **Uncanny valley.** A half-native look is worse than consistent Adwaita. A style ships
  only when complete; "mostly Fluent" stays unreleased.
- **Licensing.** SF Pro and SF Symbols are licensed for Apple platforms only, and Segoe UI
  for Windows only: use the system font and never bundle either. Fluent System Icons (MIT)
  and Material Symbols (Apache-2.0) may be bundled.
- **libadwaita upgrades can break layer 1**, since its CSS nodes are not API. The visual
  regression suite is the guard, and it is a standing cost.
- **Package names follow the `adwaita-*` family, without a prefix.** Uniformity beats a
  prettier name: a `design-` prefix would mean renaming every published `@gjsify/adwaita-*`
  package too. So each language mirrors that family's split — `@gjsify/fluent-core`
  (headless tokens), `-web`, `-app` (GTK), later `-nativescript`, `-react-native` — and
  `@gjsify/material-*` likewise.
- **Packaging.** New packages start at tier 3, experimental (ADR 0003), and may not be
  depended on by tier 2. OS-branching integration code carries `gjsify.os` declarations
  (ADR 0018).
- Layer 2 needs native code per OS, which neither CSS nor the shared GTK core provides.

## Open questions

- **The Apple family's package name** (`apple-*`, `hig-*`, …) — a name that is neither a
  trademark problem nor unrecognisable.
- **Layer-3 widgets under a foreign language**: what `Fluent.InfoBar` looks like when the
  user switches the app to Adwaita at run time — an Adwaita rendering of its own, or the
  nearest Adw widget.
- **Mobile emitters**: how a token set reaches NativeScript and React Native widgets on
  Android and iOS (native theme resources, style props, or both).
- **Accent outside Windows**: how to derive a Fluent or HIG accent ramp from one base
  colour so that it matches what the vendor's own algorithm would produce.
- **Liquid Glass refraction**, pending a shader path in GTK.

## Alternatives considered

- **Adwaita everywhere.** One look, no uncanny valley, no extra work. Rejected as the only
  option: it is the problem statement, but it stays the default when no design language
  is selected.
- **Replace Adwaita with per-platform widget sets** (as Flutter does). Rejected: it forks
  every widget, and ADR 0034's one vocabulary across surfaces goes with it.
- **Restyle by CSS only.** Cheapest, and enough for part of Fluent, but it cannot give
  window materials, platform conventions or widgets Adwaita lacks.

## Implementation

Not in this PR — this ADR is `Proposed`. A first implementing change owes the Adw and Gtk
documentation gap closing, then a Fluent token set with its storybook regression rows,
then the Windows backdrop call behind a `gjsify.os` declaration.
