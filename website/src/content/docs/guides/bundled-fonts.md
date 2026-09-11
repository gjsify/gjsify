---
title: Ship your own fonts
description: Put a brand typeface inside your app. gjsify.ship.fonts stages the faces, the launcher hands over GJSIFY_FONT_DIR, and one initFonts() call at startup makes the family real on every operating system.
---

Your app wants to render in a face nobody's machine has. Put the `.ttf` in the payload with
`gjsify.ship.fonts`, then call `initFonts()` once before you build any UI.

Two steps, because staging a file and having the toolkit *know about* it are different
things. The gap between them is the quietest failure in GTK: Pango does not report a missing
family. `set_family('Brand')` against a font map that has never heard of `Brand` resolves to
the default sans, the window draws and the process exits 0. Your app is just wearing the
wrong typeface.

Measured, and the detail matters because it is the only thing that ever tells you: the
**win32** backend does print `couldn't load font "Brand …", falling back to "Sans …"` at
layout time, while the fontconfig host printed nothing at all for the same invented family.
A line on stderr on one platform, silence on the other, and neither is a value your code can
branch on — which is why `initFonts()` returns the answer instead (§ [Check that it
worked](#check-that-it-worked)).

## 1. Stage the faces

```jsonc
{
  "gjsify": {
    "ship": {
      "fonts": "data/fonts"   // a directory, or a single face
    }
  }
}
```

`data/fonts` is also the default: leave the key out and a directory by that name is picked
up if it exists. Every face lands at `share/fonts/<appId>/<basename>` in the payload, on all
three layouts. The app id is in the path because `/usr/share/fonts` is shared with every
other package on the machine, and a `Regular.ttf` at the top of it belongs to whoever
installed last.

Ship the desktop formats: `.ttf`, `.otf`, `.ttc`, `.otc`. A `.woff`, `.woff2` or `.eot` is
**refused by name**, not quietly skipped. Whether FreeType can open one is a build option of
the FreeType inside the *shipped* runtime, not the one on your packaging machine, so a web
wrapper that works here is exactly the kind of thing that substitutes silently there.

Two other refusals, same reasoning: a configured path that holds no face at all, and two
faces whose basenames collide. One of the two would not ship, and a face that did not ship
is a substituted typeface rather than an error.

## 2. Register them at startup

`gjsify ship`'s launcher exports **`GJSIFY_FONT_DIR`** at the staged directory, on every
layout. Only the launcher knows whether your payload became `/usr`, a `--prefix` tree,
`/app`, a bundle's `Contents/Resources` or `C:\Program Files\My App`. Reading it is your
app's side of the handover, and `@gjsify/gtk-host` does it for you:

```bash
gjsify install @gjsify/gtk-host
```

```ts
import { initFonts } from '@gjsify/gtk-host/fonts';

const fonts = initFonts();
```

That is the whole API. It reads `GJSIFY_FONT_DIR` itself, walks the directory, hands every
face to `PangoCairo.FontMap.get_default().add_font_file()`, and returns what happened:

```ts
interface InitFontsResult {
    /** The APPLICATION's font directory that was read, or `undefined` when nothing named one. */
    dir: string | undefined;
    /** Every directory registered, runtime first — see below. */
    sources: readonly { dir: string; origin: 'runtime' | 'app' }[];
    /** What the UI-font policy did, or `undefined` when none was asked for. See below. */
    uiFont: { next: string | undefined; kind: 'raised' | 'family' | 'restored' | 'kept' | 'unparsed' } | undefined;
    /** Faces now on the default font map. */
    registered: readonly string[];
    /** Faces a font map that does no runtime registration refused. See below. */
    declined: readonly string[];
    /** Faces that failed for any other reason. Each one was also warned about on stderr. */
    failed: readonly { path: string; message: string }[];
    /** The family NAMES the map gained across this call, sorted. See below. */
    families: readonly string[];
    /** What each `expectedFamilies` name resolves to on the map. Empty when you declared none. */
    matches: readonly FontFamilyMatch[];
}
```

`registered` is a list of FILES, and no `font-family` declaration takes one. The last two
fields are the ones you act on: `families` is a diff of `list_families()` across the call —
which only the registering call is in a position to take — and `matches` answers your own
names against the map. Pass them in:

```ts
const fonts = initFonts({ expectedFamilies: ['Merriweather', 'Source Sans 3'] });
```

Every name that does not resolve exactly is warned about on stderr on the spot, which is the
one place a missing family is ever loud.

It never throws. A face that will not open costs you one stderr line and one entry in
`failed`; taking the app down over a decorative typeface would be worse than drawing it in
a fallback. What it will not do is fail *silently*, which is the entire point:

```text
initFonts: /tmp/gjsify-badface-MHB3U3/NotAFont.ttf could not be read as an application font
(Adding font /tmp/gjsify-badface-MHB3U3/NotAFont.ttf to fontconfig configuration failed).
Text asking for a family this application ships will render in a substituted one.
```

It is also safe in an app that ships no fonts. The launcher exports `GJSIFY_FONT_DIR` only
when it actually staged a face, so an unset variable gives you `dir: undefined` and empty
arrays — and with no `expectedFamilies` either, the call returns without reading the font map
at all, so nothing about it is a cost you pay for shipping no faces.

### Running from your source tree

Before there is a payload there is no `GJSIFY_FONT_DIR`. Pass the directory instead. The
option wins over the environment, so one line covers both:

```ts
import GLib from 'gi://GLib?version=2.0';
import { initFonts } from '@gjsify/gtk-host/fonts';

const fonts = initFonts({ fontDir: GLib.getenv('GJSIFY_FONT_DIR') ?? 'data/fonts' });
print(`dir=${fonts.dir} registered=${fonts.registered.length} failed=${fonts.failed.length}`);
```

Run from a project whose `data/fonts` holds one face:

```text
dir=data/fonts registered=1 failed=0
```

A relative path resolves against the working directory. That is what you want in a source
tree and never what you want in a shipped app, where `GJSIFY_FONT_DIR` is absolute and takes
over.

## 3. Call it before you build any UI

This is a contract, not a style preference.

**Registration is not retroactive.** The fontconfig-backed font map caches the *fontset* it
resolved for a font description, and `add_font_file` does not invalidate that cache. So a
`Pango.Layout` that measured your family before the call keeps measuring the fallback for
the life of the process, even though `list_families()` now lists the family, and even though
a context created afterwards loads the real face.

Measured, on Linux, with one layout before the call and one after:

```text
before initFonts: listed=false measured=87x63
initFonts: registered=1 declined=0 failed=0
after  initFonts: listed=true measured=87x63
control (invented family): 87x63
```

Read the last three lines together. `registered=1` succeeded. `listed=true` says the family
is on the font map. And the text still measures `87x63`, byte for byte what a family that
does not exist measures. The symptom is not "no font"; it is a **stale measurement**, which
from inside your app reads like "the font is installed and Pango is ignoring me".

On Windows a late call recovers, because that backend clears the map's cache when you add a
file. So registering early is free on the backend that recovers and unrecoverable on the one
that does not, which is why the rule is stated flatly for both.

In an `Adw.Application`, the place that satisfies the rule is `startup`, before the first
window exists:

```ts
import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import { initFonts } from '@gjsify/gtk-host/fonts';

class MyApplication extends Adw.Application {
    static { GObject.registerClass(MyApplication); }

    vfunc_startup(): void {
        initFonts();          // before anything measures text
        super.vfunc_startup();
        // …now build your windows, load your CSS, create your widgets
    }
}
```

If you use [`runAdwaitaApp`](/gjsify/guides/native-adwaita-app/), the line above it is early
enough: `createWindow` does not run until the first `activate`.

## What each operating system does

One payload directory, three different readers. You write the same call everywhere; each
operating system answers it differently, and all three answers are correct:

| Where it runs | What reaches the font map | What `initFonts()` reports |
|---|---|---|
| **Linux** (`.deb`, `.rpm`, Flatpak, a `--prefix` tree) | fontconfig finds the staged directory on its own, through the stock `fonts.conf` | the faces in `registered` |
| **macOS** (`.app`) | `ATSApplicationFontsPath` in `Info.plist`: macOS activates the directory for your app before your code runs | the faces in `declined`. **Expected, not a failure** |
| **Windows** (program directory, `.msi`) | **nothing.** This call is the mechanism | the faces in `registered` |

Windows is the row that matters. GTK4 there is pangowin32, and that font map is populated
from DirectWrite and from nothing else: no filesystem search path, no fontconfig. A
fontconfig directory beside your app is inert. Measured on Windows 11, a config naming your
staged directory moves the default font map by zero families *even when it is the only
configuration loaded*. What puts the family there is `add_font_file` on that same map, the
one a `Gtk.Label` renders through.

macOS goes the other way. Pango's CoreText font map implements no runtime registration at
all, so the call answers `G_IO_ERROR_NOT_SUPPORTED` and `initFonts()` files the face under
`declined` rather than `failed`. **Nothing is lost**: the bundle's `Info.plist` already had
the OS activate the same directory at launch, earlier than any code of yours could have
run. So `declined` on macOS is the correct outcome and needs no branch in your app, which
is why there is no `process.platform` check anywhere in this API. The decision is made from
the error the font map returns, so it stays right whichever backend a host actually
compiled in.

### The family NAME can differ per platform too

Not just whether the face arrives — what it is then **called**. The family name comes out of
the font's naming table, and the two font stacks do not read it the same way. The same
byte-identical `Merriweather_400Regular.ttf` from Google Fonts, SHA-256-verified on both
machines and handed to `add_font_file` by one script:

| host | font stack | the map gained |
|---|---|---|
| Fedora 44, GJS | fontconfig | `Merriweather` |
| Windows 11, `@gjsify/gtk-runtime-win32-x64` | gvsbuild | **`Merriweather 18pt`** |

Google Fonts ships Merriweather as an optical-size family, and the readers disagree about
whether the size axis belongs in the name. `Source Sans 3`, from the same staging run, has
no size axis and reads identically on both.

So `font-family: Merriweather` renders in Merriweather on Linux and in Tahoma on Windows,
from one payload and one call that reported success on both. `matches` is the answer:
`exact` is the name you wrote, `optical` hands you the name to ask for instead,
`ambiguous` means the map has several optical sizes and which one to set at which point
size is your design decision, and `absent` is the family nothing has.

## Check that it worked

Do not take `registered.length` as proof. It says the call did not fail; it does not say
the family is renderable, and a substituted family looks identical to a resolved one from
the outside. Measure instead, with an invented family as your control:

```ts
import Pango from 'gi://Pango?version=1.0';
import PangoCairo from 'gi://PangoCairo?version=1.0';
import { initFonts } from '@gjsify/gtk-host/fonts';

const FAMILY = 'Round9x13';            // the family name your face carries
const CONTROL = 'ZzzNoSuchFamily';     // a family that cannot exist

const fonts = initFonts({ expectedFamilies: [FAMILY, CONTROL] });
print(`dir=${fonts.dir}`);
print(`registered=${fonts.registered.length} declined=${fonts.declined.length} failed=${fonts.failed.length}`);

// `matches` in place of a hand-rolled `list_families()` scan, and it is not the same check:
// it accepts the optical-size alias the Windows stack makes of the name (`match.family` is
// then what you put in `font-family`) and refuses to guess between several of them.
const listed = (family: string) =>
    fonts.matches.find((match) => match.declared === family)?.kind !== 'absent';

const map = PangoCairo.FontMap.get_default();

const measure = (family: string) => {
    const description = new Pango.FontDescription();
    description.set_family(family);
    description.set_size(40 * Pango.SCALE);
    const layout = Pango.Layout.new(map.create_context());
    layout.set_font_description(description);
    layout.set_text('Wg', -1);
    return layout.get_pixel_size().join('x');
};

print(`listed=${listed(FAMILY)}`);
print(`${FAMILY}=${measure(FAMILY)} vs ${CONTROL}=${measure(CONTROL)}`);
```

Two things have to be true, and the second is the one that discriminates:

- the declared name resolves — `matches` says anything but `absent`, **and**
- it measures *differently* from the control.

The first is now the call's own answer rather than yours to compute, and `fonts.families`
tells you which names this call put there. The second still has to be measured, because a
resolved name and a rendered face are not the same claim: registration is not retroactive
(§ [Call it before you build any UI](#3-call-it-before-you-build-any-ui)), so a family can be
on the map and still measure as the fallback.

With the face staged and `GJSIFY_FONT_DIR` pointing at it:

```text
dir=/tmp/fontcheck
registered=1 declined=0 failed=0
listed=true
Round9x13=66x50 vs ZzzNoSuchFamily=87x63
```

The same program with nothing staged, which is what a broken payload looks like from the
inside:

```text
dir=undefined
registered=0 declined=0 failed=0
listed=false
Round9x13=87x63 vs ZzzNoSuchFamily=87x63
```

`87x63` twice. Your family and a family that cannot exist are rendering as the same face,
and nothing about the run says so. That is why the control is in the check.

On macOS the honest expectation is different again: `declined=1`, and the family absent
from `list_families()` *at this point in the process*, with the text still correct on screen
because the OS activated the directory before your code ran. The check to run in a shipped
`.app` is `PangoCairo.FontMap.get_default().list_families()` inside the running bundle, and
`PANGOCAIRO_BACKEND=bogus ./YourApp` makes Pango print which backends it was actually built
with.

## The platform's own typeface comes from the runtime

Everything above is about **your** face. There is a second one, and off Linux nobody installs
it: the GNOME UI typeface itself.

Measured on Windows 11 / GTK 4.22.4 against the published 0.50.0 runtime bundle — 82 font
families on the map, and `Cantarell`, `Adwaita Sans` and `Adwaita Mono` among none of them.
Every request for one came back as Tahoma, with the same `couldn't load font …, falling back`
line and the same exit 0. An Adwaita stylesheet naming the GNOME font got a foreign face, in
every gjsify GTK app on that platform.

`@gjsify/gtk-runtime-<target>` now carries **Adwaita Sans + Adwaita Mono** under
`gtk/share/fonts` (OFL-1.1, named in the bundle's `THIRD-PARTY-NOTICES.md`), and
`@gjsify/node-gi`'s loader publishes that directory as `GJSIFY_GTK_RUNTIME_FONT_DIR`.

**You do not have to do anything about it** on Linux and Windows. The same `initFonts()` call
registers both — the runtime's faces first, then yours:

```ts
const fonts = initFonts({ expectedFamilies: ['Brand'] });

fonts.sources;
// [{ dir: 'C:\…\gtk\share\fonts', origin: 'runtime' },
//  { dir: 'C:\…\share\fonts\org.example.App', origin: 'app' }]
```

Two variables and not one, deliberately: an app that ships a brand face must never have to
choose between its face and the platform's. On Linux neither is usually set and the call stays
the no-op it always was.

:::caution[macOS cannot register them yet]
The darwin bundles ship the faces, and nothing can put them on the font map. `add_font_file` is
a vfunc the CoreText map does not implement, so every face comes back in `declined` with
`G_IO_ERROR_NOT_SUPPORTED` — measured on a darwin-arm64 runner. `adwaitaUiFontAvailability()`
therefore answers `absent` there, so don't offer the `adwaita` policy on macOS; `system` and
`size` are unaffected, and macOS needs no size correction anyway (18.8 px against GNOME's 19.0).
The two routes out — `ATSApplicationFontsPath` at ship time, or `PANGOCAIRO_BACKEND=fc` — are in
`status/open-todos.md`.
:::

### …and the size, which the faces do not fix

GTK takes the system UI font from the shell. Windows' is **9 pt**; GNOME designs for **11**.
Measured as `ascent + descent` — points are not comparable across platforms — that is **16.0 px
against GNOME's 19.0**, about 16 % small, which is the whole of "the font looks a bit small" and
is not something the typeface can answer. macOS measures 18.8 px and needs no correction, so the
gap is Windows-alone.

Which of those you want is a **policy**, and your app picks one of three:

| policy | on Windows | what it means |
|---|---|---|
| `system` | `Segoe UI 9` — untouched | the host's font, size included. Someone who chose 9 pt keeps 9 pt |
| `size` | `Segoe UI 11` | the host's face, drawn at the size Adwaita was designed for. Raise-only |
| `adwaita` | `Adwaita Sans 11` | the GNOME font, identical on every platform |

```ts
import { applyUiFontPolicy, UI_FONT_POLICIES } from '@gjsify/gtk-host/fonts';

applyUiFontPolicy('size');      // recommended for an app shipping a bundled GTK
applyUiFontPolicy('adwaita');   // or let the user choose — UI_FONT_POLICIES enumerates them
applyUiFontPolicy('system');    // and back again, at any time
```

You can also ask for it once, while registering the faces:

```ts
initFonts({ uiFont: 'size' });
```

**Nothing happens unless you ask.** Registering a typeface and rewriting the user's font
setting are two different acts, and a runtime that does the second uninvited is a surprise.
There is a second reason: if anything applied a policy by default, `system` would already be
unreachable — the host's own value would have been overwritten before you could choose to
keep it.

Which is the other half of how this works. `initFonts()` records `gtk-font-name` **as the
process first found it**, and `system` restores exactly that:

```ts
uiFontBaseline();   // "Segoe UI 9" — the host's own, before anything wrote
```

That capture is why switching `adwaita` → `system` in a preferences dialog lands on the
user's real setting rather than an approximation. Once a value has been overwritten it is not
recoverable: GTK keeps no previous value, Windows has no GSettings to re-read, and on Linux
the value a session applied may itself be an override of the schema default.

### Before you offer the `adwaita` option

Forcing `Adwaita Sans 11` on a host where that family never arrived — an older bundle, a
system GTK without adwaita-fonts — does not fail. Pango substitutes, and the user who picked
"use the Adwaita font" gets Tahoma: one substitution traded for another, by a setting that now
lies about what it did. So ask first:

```ts
const adwaita = adwaitaUiFontAvailability();
if (!adwaita.available) {
    // don't offer it, or offer it disabled — `adwaita.match` says why
}
```

It answers a `FontFamilyMatch`, not a boolean, because `optical` is a real third state — and on
Windows it is the NORMAL one for this very font. `Adwaita Sans` is a variable font with an `opsz`
axis whose value at 14 is named `Text`, so fontconfig puts **`Adwaita Sans`** on the map and
gvsbuild's DirectWrite reader puts **`Adwaita Sans Text`**. Byte-identical file, two family names.

`applyUiFontPolicy('adwaita')` handles that for you: it asks the map which name it holds and
writes that one. If you set `gtk-font-name` yourself, do the same — writing the declared name on
Windows asks for a family that host does not have, and Pango substitutes Tahoma without a word.

Call it after `initFonts()`, which is what puts the bundled faces there.

## Who does what

| Piece | Job |
|---|---|
| `gjsify.ship.fonts` | names the faces; `gjsify ship` copies them to `share/fonts/<appId>/` |
| the generated launcher | exports `GJSIFY_FONT_DIR` at that directory, on every layout |
| `initFonts()` from `@gjsify/gtk-host/fonts` | reads the variable and registers what it finds |
| `applyUiFontPolicy()` from the same module | applies one of the three UI-font states, and undoes it |
| `@gjsify/gtk-runtime-<target>` | carries the GNOME UI typeface in `gtk/share/fonts` |
| `@gjsify/node-gi`'s loader | exports `GJSIFY_GTK_RUNTIME_FONT_DIR` at that directory |

`gjsify ship` deliberately does not make the call for you. A packaging command that injected
a startup step would be deciding your app's initialisation order, invisibly, and the
ordering above is exactly the thing that has to stay yours.

## When it does not work

| What you see | What it means |
|---|---|
| `dir` is `undefined` in a shipped app | the payload staged no face. Check `gjsify.ship.fonts` and re-run `gjsify ship` |
| `declined` holds your faces, on macOS | correct. `ATSApplicationFontsPath` already did the work |
| `declined` holds your faces, anywhere else | this process resolved a font map that does no runtime registration; check `PANGOCAIRO_BACKEND` |
| `initFonts: … could not be read as an application font` | FreeType would not open that file: truncated, corrupt, or something wearing a face extension |
| the family is listed but text is unchanged | something laid out text before `initFonts()`. Move the call earlier |
| `initFonts: X: on the font map as "X 18pt"` | this font stack keeps the optical-size axis in the family name. Ask for the name on the right — `match.family` |
| `initFonts: X: NOT on the font map` | the face never arrived under that name. Check `families` for what did |
| `gjsify ship: … is a web-font wrapper` | replace the `.woff2` with the desktop face it was made from |
| `gjsify ship: … holds no font face` | the configured directory has no `.ttf`/`.otf`/`.ttc`/`.otc` in it |

## Where to next

- [Windows artifacts](/gjsify/ship/windows/): the layout where this call is the only
  mechanism there is.
- [macOS app bundles](/gjsify/ship/macos/): where the `Info.plist` key does the work
  instead.
- [Linux packages](/gjsify/ship/linux-packages/): where fontconfig gets there on its own.
- [CLI Reference → `gjsify ship`](/gjsify/cli-reference/#gjsify-ship) lists every
  configuration key.
