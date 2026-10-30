# 125. GLib gettext is the translation API on every target

- Status: **Accepted** (2026-10-30)
- Date: 2026-10-30
- Deciders: Pascal Garber
- Related: [ADR 0024](0024-ship-installable-artifacts.md) (desktop `.mo` staging),
  [ADR 0038](0038-shipped-application-fonts.md),
  [ADR 0059](0059-foreign-platforms-carry-their-own-configuration.md); gjsify
  [#2438](https://github.com/gjsify/gjsify/pull/2438) (libintl that reads `.mo`),
  [#2447](https://github.com/gjsify/gjsify/pull/2447) (`.mo` staging, bare `gettext`,
  `@gjsify/adwaita-app/locale`, `_()` in `.blp`),
  [#2449](https://github.com/gjsify/gjsify/issues/2449) (live locale switch); first consumer:
  [Learn6502 ADR 0002](https://github.com/JumpLink/Learn6502/blob/ci/android-apk/docs/adr/0002-gettext-on-every-platform.md)

## Context

An app that targets GNOME, the web and Android shares its UI code and marks strings with `_("…")`
and `_()` in `.blp`. The three targets read a catalogue differently:

| Target | Catalogue source |
|---|---|
| GNOME (GJS) | GLib gettext over the `.mo` the build installs |
| Android (NativeScript) | none that GLib could read; apps fell back to Android string resources |
| Web | none; the msgid is shown |

A spike on Android showed that real GLib gettext works there once two gaps close. The `libintl.so`
in the sysroot was proxy-libintl, which never reads a `.mo`. And the process had no `LANGUAGE`, so
no locale selected a catalogue. #2438 fixed the first (libintl reading `.mo`); #2447 fixed the
second and the plumbing around it: `.mo` staging through `gjsifyNativescript({ locale })`, bare
`gettext`, `@gjsify/adwaita-app/locale` with `initLocale()`, and `_()` in `.blp` through
`dgettext` / `dpgettext2`.

Without a platform decision, each app would pick its own scheme per target and need a per-platform
adapter behind `_()` for good.

## Decision

**GLib gettext is the one translation API on every target.** Shared code calls `_()`; the target
decides only where the catalogue comes from.

1. **GNOME:** GJS gettext over the installed `.mo` (ADR 0024).
2. **Android: real GLib** through GI and the libintl `.mo` reader (#2438).
   `initLocale(appId)` from `@gjsify/adwaita-app/locale` sets `LANGUAGE` from the app's locale
   list, cut after the first English tag, since English is the msgid language and has no
   catalogue. `_()` in `.blp` goes through `dgettext` / `dpgettext2`, the calls GtkBuilder makes.
3. **Web: a re-creation of the same GLib API** (`bindtextdomain` / `textdomain` / `dgettext` /
   `dpgettext2`) over the same `.mo` files. Not built yet; it gets its own follow-up. If GLib
   itself runs in the browser (the WebAssembly spike), it replaces the re-creation and no app
   changes.
4. **The Android launcher label is a string resource generated from `po/`**, by an option of
   `gjsifyNativescript({ locale })`. Android reads `@string/app_name` before any JS runs, so
   gettext cannot supply it. Not built yet.

## Consequences

- One msgid scheme on every target; `_()` behaves the same, including `%d` placeholders.
- **A language switch applies on the next start.** Android's per-app language relaunches the
  activity but keeps the process and its built window, so nothing re-translates until a restart.
  Live switching is #2449.
- The APK carries `.mo` files instead of string resources. The size difference is unmeasured.
- An app needs a gjsify release with #2438 and #2447.

## Rejected alternatives

- **NativeScript localize on Android.** A second lookup scheme (an encoded resource key instead of
  the msgid), generated churn in tracked files, and an adapter behind `_()` on every app.
- **A JS gettext on Android too.** The real GLib is already in the APK for GI; a re-creation would
  be a second implementation to keep in step where the real one is available.
- **A runtime launcher label.** Android shows it from the manifest before the app starts; there
  is no runtime hook.

## Open

- The web re-creation.
- The launcher-label generator.
- APK size with `.mo` versus string resources.

## Implementation

- Done: #2438, #2447.
- First consumer: Learn6502, which removed `@nativescript/localize` and verified a cold start
  under de-DE, en-US, de-DE on a Galaxy S9.
