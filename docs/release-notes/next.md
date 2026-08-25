<!--
THE PROSE PREAMBLE FOR THE NEXT RELEASE.

`scripts/check-changelog-references.mjs --release-notes <version>` publishes this
file ABOVE the generated changelog section in the GitHub release body. Write here
in the PR that lands the change, while you still remember why it mattered — the
generated section already says what changed.

  · Prose is OPTIONAL. No prose costs a warning in the cut's job summary and
    nothing else; the body is then the changelog section alone.
  · It counts only if git says this file changed since the last tag, so the
    previous release's text can never reappear under a new version. There is no
    version to write down and nothing to reset by hand: after a release this file
    is stale by definition, and the next prose is simply the next edit.
    So REPLACE what you find here, do not append to it — right after a release
    this file still holds the text that shipped with it, and the tag is where
    that copy lives (`git show v0.28.0:docs/release-notes/next.md`).
  · It goes through the same broken-reference detector as CHANGELOG.md, so a
    fabricated issue or repository link fails the cut. Write `#123` for a real
    issue in this repo; put anything `#`-shaped that is NOT a reference in
    backticks (`PKCS#7`), and the same for npm scopes and at-rules (`@girs`,
    `@font-face`) so they are not read as GitHub accounts.
  · No `## [x.y.z]` heading — the preamble sits above the section, not beside it.

Everything below the last comment is published verbatim. Delete this comment or
leave it; comments are stripped either way, and a file holding only comments
counts as no prose.

A worked example is the v0.28.0 release body:
https://github.com/gjsify/gjsify/releases/tag/v0.28.0
-->

## What this release is about

**Four things an app could not do, every one of which fails silently when you get it wrong.**

---

### A UI framework can drive GTK

GTK could already describe a window instead of assembling it — that is what Blueprint is for, and it
does property bindings too. What a template cannot do is change its own shape. A `.blp` is
instantiated once; a list that grows, a page that swaps, a widget that appears when a checkbox is
ticked all fall back to imperative code holding a reference to every widget it might later mutate.
That is the code a UI framework exists to delete, and no UI framework could reach GTK from GJS.

`@gjsify/gtk-host` is the layer that lets one: fourteen operations over GTK4/Adwaita widgets —
create, insert, remove, set a property, read a parent — with no framework in them at all. Three
adapters sit on top and share it, so a fix to how a child is parented reaches all three at once
rather than being fixed once per renderer:

```tsx
import { render } from '@gjsify/gtk-host/solid';

render(() => (
    <gtk-box orientation="vertical">
        <gtk-button label={label()} onClicked={() => setCount(count() + 1)} />
    </gtk-box>
), window);
```

Solid (`/solid`), Vue (`/vue`) and React (`/react`) are all real entry points, and two new packages
compile what they are written in — `@gjsify/rolldown-plugin-solid` for Solid's JSX and
`@gjsify/rolldown-plugin-vue` for single-file components.

**Why the compile step is a package and not four lines of config.** Point rolldown's own transformer
at a `.tsx` with no JSX configuration and it emits `import { jsx } from "react/jsx-runtime"`, reports
the unresolved import as a WARNING, and exits 0. The build succeeds. The artifact throws at import,
in a bundle nobody has reason to suspect, and the message names React — a dependency the project does
not have and never asked for.

The plugins are gated on their EMITTED CODE for the same reason, and one of those gates already
caught something a running showcase could not. The Solid plugin cached its assembled Babel preset
chain rather than the compiler modules, which made every option inert after the first plugin
instance. A single build with a single instance never sees it; a process that builds two packages
emits the first one's renderer imports into the second one's bundle, and that artifact fails at
import with a module that is not there. A showcase asserts the real widget tree and is blind to it,
because a showcase is one build.

Two properties of the host are load-bearing enough to be pinned rather than described. The compiler
emits `insertNode` BEFORE `setProp`, which is why the host defers materialising a widget — a
construct-only property has to survive as a JSX attribute, and it can only do that if nothing has
been constructed yet (ADR 0027 § Decision 5). And the renderer must never emit DOM: Solid's `dom`
output cannot run under GJS at all, and it fails on an unresolved `document` at runtime, wherever the
first render happens to be.

The widget vocabulary is not hand-written. It is generated from the GIR, so a property that GTK has
is a property the types have (ADR 0028) — and ADR 0029, landed in this release, proposes moving that
vocabulary to `@girs/*`, where every GJS UI framework can share it instead of each generating its
own.

### An app can find its own translations

`gjsify ship` learned to package compiled catalogues in 0.42.0, and its launcher exports
`GJSIFY_LOCALE_DIR` because only the launcher knows whether the payload became `/usr` in a `.deb`, a
`--prefix` tree, or `/app` in a Flatpak. Nothing read that variable. Every app was expected to write
the same four calls, and the two that tried had no translation at all.

`initLocale(domain)` in `@gjsify/adwaita-app` is the reading half:

```ts
import { initLocale } from '@gjsify/adwaita-app';

const _ = initLocale('bauplaner');
label.set_label(_('Assembly'));
status.set_label(_.plural('%d layer', '%d layers', n));
```

Two details are the reason this is shared code and not a snippet:

- **`textdomain()` is set, not only `dgettext()` used.** GtkBuilder resolves every
  `translatable="yes"` string — so everything from a `.blp` file — in the DEFAULT domain, inside GTK,
  where the app never gets to pass one. Binding only through `dgettext` translates the TypeScript
  strings and leaves the Blueprint ones in the source language, which reads as a half-finished
  translation rather than as a missing call.
- **An empty `GJSIFY_LOCALE_DIR` counts as unset.** The launcher exports it only when it staged
  catalogues, but a wrapper that sets it unconditionally hands over `''` — and
  `bindtextdomain(domain, '')` binds to the *current directory*, where the lookup finds nothing and
  reports it exactly as "this app has no German".

Measured against a real compiled catalogue, because "the calls did not throw" is not evidence that a
lookup resolves: `de_DE.utf8` returns the translation and picks the right plural form, `en_US.utf8`
returns the msgids (English needs no catalogue of its own), and an unset variable falls back to
`/usr/share/locale`.

### A package can define a file type, not just claim to open one

`MimeType=` in a desktop entry says "I open this type". It does not say the type EXISTS. For
`text/plain` that never matters — the distribution defines it. For a type of your own it decides
whether the feature works, and nothing tells you when it does not: no component knows what a
`.bauplan` file is, so the file manager never assigns the type, `MimeType=` matches nothing, and a
double-click does nothing at all. No error, no log line. It is indistinguishable from the app not
being installed.

`gjsify.ship.mimeTypes` defines types as a shared-mime-info document staged into
`share/mime/packages/<app-id>.xml`, and the package refreshes the MIME cache on install — detection
reads the compiled cache under `share/mime`, not the packages directory, so without that refresh the
document installs and the type still does not exist.

```json
"gjsify": {
  "ship": {
    "mimeTypes": [
      { "type": "application/x-bauplan", "comment": "Bauplaner project", "globs": ["*.bauplan"] }
    ]
  }
}
```

Declared types are folded into `provides.mimetypes` automatically, so the desktop entry and the
metainfo need no knowledge of the new field — they already render `MimeType=` (with the `%f` field
code) and `<mediatype>` from that one list. Keeping the two independent would make "defined but not
handled" reachable by omission, and that state installs cleanly and does nothing.

Four declarations are refused outright, each of which would otherwise install and never resolve: a
malformed type name (`update-mime-database` ignores it), a glob with no wildcard (`bauplan` matches
only a file called exactly that), a type with neither a glob nor a parent type (nothing can ever
match it), and a duplicate definition (which comment wins would depend on document order). See
ADR 0024 § A11.

### A shared widget can have a Blueprint template

Blueprint was quietly an application-only feature. The `.blp` transform was installed by the
`--app gjs|node|browser` build factories and by nothing else, so a `.blp` imported from a package
built with `--library` reached rolldown's JavaScript parser — and a Blueprint file's first line,
`using Gtk 4.0;`, is *valid JavaScript*: a `using` resource declaration with no initializer. The
build died on `Using declarations must have an initializer.` with nothing anywhere naming Blueprint.

The consequence was not the error message, which at least stops you. It was what the error pushed
people to do instead: a widget shared between applications had to assemble itself in TypeScript, and
a caption assigned from TypeScript carries no `translatable` attribute, so `xgettext` never sees it.
`LoadingStack`'s error page says "Something went wrong" in every consumer, in English, permanently —
and that is invisible, because an untranslatABLE string looks exactly like one nobody has translated
yet.

`--library` builds now run the same transform the app factories do.

`LoadingStack` itself stays as it was, and the reason is worth writing down because it applies to
every package in THIS repo. Converting it was tried and reverted: `blueprint-compiler` is not
installed on the macOS or Windows runners, and this package builds on all three — so a `.blp` here
makes the compiler a hard build requirement for every host rather than only for hosts that ship an
app. Worse, the repo bootstraps from the PUBLISHED CLI (ADR 0002), which is the release BEFORE this
one and therefore has no library-mode transform; during a cold bootstrap the `.blp` reaches the
JavaScript parser and the consumer-gate jobs fail exactly there. A capability cannot be used by the
tree that introduces it until it has shipped once. The first real consumers are applications, which
build with their own installed CLI: an app's shared widgets can carry templates today.

`tests/e2e/library-blueprint/` holds the capability instead. It builds a library fixture and asserts
the emitted module carries the compiled Builder XML with `translatable="yes"` — and, as the
discriminator, that a MALFORMED `.blp` fails through blueprint-compiler rather than through the
JavaScript parser, since a JS-parser message would mean the transform never ran and the first
assertion passed for some other reason.

Two new lint rules keep the door shut, both measured against this workspace before being switched
on. `gjsify/prefer-blueprint-template` reports a `Gtk`/`Adw` subclass that constructs widgets *and*
parents them while declaring no `Template` — both signals are required, because constructing without
parenting is a model and parenting without constructing is a reparent. `gjsify/no-literal-widget-label`
reports a bare string literal in a prose property (`title`, `label`, `subtitle`, `tooltip-text`, …),
which is the half that survives even after a class has a template. Learn6502, which carries a whole
application in 24 Blueprint files, reports zero under both.
