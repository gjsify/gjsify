---
title: Ship your own fonts
description: Put a brand typeface inside your app. gjsify.ship.fonts stages the faces, the launcher hands over GJSIFY_FONT_DIR, and one initFonts() call at startup makes the family real on every operating system.
---

Your app wants to render in a face nobody's machine has. Put the `.ttf` in the payload with
`gjsify.ship.fonts`, then call `initFonts()` once before you build any UI.

Two steps, because staging a file and having the toolkit *know about* it are different
things — and the gap between them is the quietest failure in GTK. Pango does not report a
missing family. `set_family('Brand')` against a font map that has never heard of `Brand`
resolves to the default sans, the window draws, the process exits 0 and nothing anywhere
says a word. Your app is just wearing the wrong typeface.

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
three layouts — the app id is in the path because `/usr/share/fonts` is shared with every
other package on the machine, and a `Regular.ttf` at the top of it belongs to whoever
installed last.

Ship the desktop formats: `.ttf`, `.otf`, `.ttc`, `.otc`. A `.woff`, `.woff2` or `.eot` is
**refused by name**, not quietly skipped — whether FreeType can open one is a build option
of the FreeType inside the *shipped* runtime, not the one on your packaging machine, so a
web wrapper that works here is exactly the kind of thing that substitutes silently there.

Two other refusals, same reasoning: a configured path that holds no face at all, and two
faces whose basenames collide (one of them would not ship, and a face that did not ship is
a substituted typeface rather than an error).

## 2. Register them at startup

`gjsify ship`'s launcher exports **`GJSIFY_FONT_DIR`** at the staged directory — on every
layout, because only the launcher knows whether your payload became `/usr`, a `--prefix`
tree, `/app`, a bundle's `Contents/Resources` or `C:\Program Files\My App`. Reading it is
your app's side of the handover, and `@gjsify/gtk-host` does it for you:

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
    /** The directory that was read, or `undefined` when nothing named one. */
    dir: string | undefined;
    /** Faces now on the default font map. */
    registered: readonly string[];
    /** Faces a font map that does no runtime registration refused — see below. */
    declined: readonly string[];
    /** Faces that failed for any other reason. Each one was also warned about on stderr. */
    failed: readonly { path: string; message: string }[];
}
```

It never throws. A face that will not open costs you one stderr line and one entry in
`failed`; taking the app down over a decorative typeface would be worse than drawing it in
a fallback. What it will not do is fail *silently*, which is the entire point:

```text
initFonts: /tmp/gjsify-badface-MHB3U3/NotAFont.ttf could not be read as an application font
(Adding font /tmp/gjsify-badface-MHB3U3/NotAFont.ttf to fontconfig configuration failed).
Text asking for a family this application ships will render in a substituted one.
```

It is also safe in an app that ships no fonts. The launcher exports `GJSIFY_FONT_DIR` only
when it actually staged a face, so an unset variable gives you `dir: undefined` and three
empty arrays.

### Running from your source tree

Before there is a payload there is no `GJSIFY_FONT_DIR`. Pass the directory instead — the
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

A relative path resolves against the working directory, which is what you want in a source
tree and never what you want in a shipped app — where `GJSIFY_FONT_DIR` is absolute and
takes over.

## 3. Call it before you build any UI

This is a contract, not a style preference.

**Registration is not retroactive.** The fontconfig-backed font map caches the *fontset* it
resolved for a font description, and `add_font_file` does not invalidate that cache. So a
`Pango.Layout` that measured your family before the call keeps measuring the fallback for
the life of the process — even though `list_families()` now lists the family, and even
though a context created afterwards loads the real face.

Measured, on Linux, with one layout before the call and one after:

```text
before initFonts: listed=false measured=87x63
initFonts: registered=1 declined=0 failed=0
after  initFonts: listed=true measured=87x63
control (invented family): 87x63
```

Read the last three lines together. `registered=1` succeeded. `listed=true` says the family
is on the font map. And the text still measures `87x63` — byte for byte what a family that
does not exist measures. The symptom is not "no font"; it is a **stale measurement**, which
from inside your app reads like "the font is installed and Pango is ignoring me".

On Windows a late call recovers, because that backend clears the map's cache when you add a
file. So registering early is free on the backend that recovers and unrecoverable on the
one that does not — which is why the rule is stated flatly for both.

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

## What each operating system actually does

One payload directory, three different readers. You write the same call everywhere; each
operating system answers it differently, and all three answers are correct:

| Where it runs | What reaches the font map | What `initFonts()` reports |
|---|---|---|
| **Linux** (`.deb`, `.rpm`, Flatpak, a `--prefix` tree) | fontconfig finds the staged directory on its own, through the stock `fonts.conf` | the faces in `registered` |
| **macOS** (`.app`) | `ATSApplicationFontsPath` in `Info.plist`: macOS activates the directory for your app before your code runs | the faces in `declined` — **expected, not a failure** |
| **Windows** (program directory, `.msi`) | **nothing.** This call is the mechanism | the faces in `registered` |

Windows is the row that matters. GTK4 there is pangowin32, and that font map is populated
from DirectWrite and from nothing else — no filesystem search path, no fontconfig. A
fontconfig directory beside your app is inert: measured on Windows 11, a config naming your
staged directory moves the default font map by zero families *even when it is the only
configuration loaded*. `add_font_file` on that same map — the one a `Gtk.Label` renders
through — is what puts the family there.

macOS goes the other way. Pango's CoreText font map implements no runtime registration at
all, so the call answers `G_IO_ERROR_NOT_SUPPORTED` and `initFonts()` files the face under
`declined` rather than `failed`. **Nothing is lost**: the bundle's `Info.plist` already had
the OS activate the same directory at launch, earlier than any code of yours could have
run. So `declined` on macOS is the correct outcome and needs no branch in your app — which
is why there is no `process.platform` check anywhere in this API. The decision is made from
the error the font map returns, so it stays right whichever backend a host actually
compiled in.

## Check that it worked

Do not take `registered.length` as proof. It says the call did not fail; it does not say
the family is renderable, and a substituted family looks identical to a resolved one from
the outside. Measure instead — an invented family is your control:

```ts
import Pango from 'gi://Pango?version=1.0';
import PangoCairo from 'gi://PangoCairo?version=1.0';
import { initFonts } from '@gjsify/gtk-host/fonts';

const FAMILY = 'Round9x13';            // the family name your face carries
const CONTROL = 'ZzzNoSuchFamily';     // a family that cannot exist

const fonts = initFonts();
print(`dir=${fonts.dir}`);
print(`registered=${fonts.registered.length} declined=${fonts.declined.length} failed=${fonts.failed.length}`);

const map = PangoCairo.FontMap.get_default();
const listed = (family: string) => map.list_families().some((f) => f.get_name() === family);

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

- the family appears in `list_families()`, **and**
- it measures *differently* from the control.

With the face staged and `GJSIFY_FONT_DIR` pointing at it:

```text
dir=/tmp/fontcheck
registered=1 declined=0 failed=0
listed=true
Round9x13=66x50 vs ZzzNoSuchFamily=87x63
```

The same program with nothing staged — which is what a broken payload looks like from the
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
from `list_families()` *at this point in the process* — with the text still correct on
screen, because the OS activated the directory before your code ran. The check to run in a
shipped `.app` is `PangoCairo.FontMap.get_default().list_families()` inside the running
bundle, and `PANGOCAIRO_BACKEND=bogus ./YourApp` makes Pango print which backends it was
actually built with.

## Who does what

| Piece | Job |
|---|---|
| `gjsify.ship.fonts` | names the faces; `gjsify ship` copies them to `share/fonts/<appId>/` |
| the generated launcher | exports `GJSIFY_FONT_DIR` at that directory, on every layout |
| `initFonts()` from `@gjsify/gtk-host/fonts` | reads the variable and registers what it finds |

`gjsify ship` deliberately does not make the call for you. A packaging command that injected
a startup step would be deciding your app's initialisation order, invisibly — and the
ordering above is exactly the thing that has to stay yours.

## When it does not work

| What you see | What it means |
|---|---|
| `dir` is `undefined` in a shipped app | the payload staged no face — check `gjsify.ship.fonts` and re-run `gjsify ship` |
| `declined` holds your faces, on macOS | correct. `ATSApplicationFontsPath` already did the work |
| `declined` holds your faces, anywhere else | this process resolved a font map that does no runtime registration; check `PANGOCAIRO_BACKEND` |
| `initFonts: … could not be read as an application font` | FreeType would not open that file — truncated, corrupt, or something wearing a face extension |
| the family is listed but text is unchanged | something laid out text before `initFonts()`. Move the call earlier |
| `gjsify ship: … is a web-font wrapper` | replace the `.woff2` with the desktop face it was made from |
| `gjsify ship: … holds no font face` | the configured directory has no `.ttf`/`.otf`/`.ttc`/`.otc` in it |

## Where to next

- [Windows artifacts](/gjsify/ship/windows/) — the layout where this call is the only
  mechanism there is.
- [macOS app bundles](/gjsify/ship/macos/) — where the `Info.plist` key does the work
  instead.
- [Linux packages](/gjsify/ship/linux-packages/) — where fontconfig gets there on its own.
- [CLI Reference → `gjsify ship`](/gjsify/cli-reference/#gjsify-ship) lists every
  configuration key.
