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

## Upgrading

One breaking change, in `@gjsify/adwaita-nativescript`. On `GtkImage` and `AdwImageButton`,
`iconSize` used to take a number of pixels. It now takes the icon-size enum, and the pixel
number moves to a new `pixelSize` property.

```
image.iconSize = 24            ->  image.pixelSize = 24
<gtk:Image iconSize="24"/>     ->  <gtk:Image pixelSize="24"/>
image.iconSize = "large"       ->  unchanged, and now actually 32 pixels
```

Old numeric code throws, and the error text contains the migration. Worth knowing why we
broke it rather than adding the new property beside the old one: `iconSize="large"` was
accepted before and quietly drew 16 pixels, because the string fell through to a default.
A name that means one thing in GTK and another here is the kind of bug you only find by
measuring pixels. See #1647.

## @girs 5.0.0: a signal name is now checked

The type packages went to 5.0.0, and they dropped the permissive overloads that let
`connect`, `connect_after` and `emit` take any string. A signal name the object's type does
not declare is a compile error now.

That found a bug we had shipped for years. `@gjsify/http2` connected `accept-certificate`
on the `Soup.Session`, and libsoup 3 installs no signal of that name there, so the call
threw. `rejectUnauthorized: false` never worked on that path, and the string overload is
the reason it kept compiling.

Twenty-two call sites in nine packages needed changing here. If you hit the same error
after upgrading, the shape is almost always one of two. A name known only at runtime
belongs in `GObject.signal_connect` / `signal_emit_by_name`, the low-level API that exists
for exactly that. A name the type should know means the receiver is typed too widely, or
the signal is one an element installs at runtime, which you can read back with
`GObject.signal_query` and declare once (#1659).

## Blueprint reads enum values instead of passing names through

A `.blp` file says `orientation: vertical`. GtkBuilder wants `1`. The in-repo parser passed
the name through, which is why eleven corpus files still differed from what the reference
compiler produces.

The numbers were already in reach. The `@girs` type packages carry each enum member's value
since 4.8.0, and since 4.9.0 they also say which enum a property belongs to. The parser reads
both from the pinned dependency, so it needs no GTK installed and works on any runner.

Two constructs are typed by something other than the widget around them. `layout { }` belongs
to the layout child, and `accessibility { }` is answered by the ARIA table. Both happened to
look right inside a `Gtk.Box` and were wrong inside a `Gtk.Label`. See #1644.

## gjsify test now measures the code you changed

This one is worth reading even if you never touch Blueprint, because it changes what a local
test run means.

`gjsify test` rebuilds its bundle only when something changed. To decide that, it walked the
folder holding the test entry. The variable was called `srcRoot` and the comment beside it
said "the src tree", and for any project with tests in `tests/` it was neither. Edit a source
file, rerun the tests, and the run measured the previous build and reported on that.

It lies in both directions. We hit a green run over code that was no longer installed, then a
red run over a fix that was already correct. CI never sees it, because a fresh container has
no previous build to reuse. The only person it misleads is the one checking locally before
pushing, which is the worst possible audience for a wrong answer.

The command and the build cache now share one definition of a package's inputs. It is a
deny-list: everything in the package except its dependencies, its tool state, and what it
generates. What a package generates is read from its own clean-up script, so nothing is
declared twice. Every allow-list we ever wrote for that question is wrong for some package in
this repository today. See #1651 and #1654.

## Windows says what it cannot play, and the reason is checked

`@gjsify/gtk-runtime-win32-x64` ships no MP3 decoder, and no version bump will change that.
The upstream Windows build recipe configures ffmpeg with `--disable-everything` and re-enables
three audio decoders, none of them MP3. FLAC is obtainable, we costed it, and we are not
paying that price while MP3 is missing anyway.

The useful part is not the answer but who holds it. A gap's justification is a claim about
someone else's project at a pinned version, and every check we had compared our declaration
against our own bundle. All of them would have stayed green on the day the gap became
closable. The declaration now carries the upstream reference and is checked against a
committed catalogue snapshot on every pull request, in both directions. Formats we claim must
be present, formats we declare missing must still be missing. See #1626 and #1642.

## Fixes

- A devtools selector compared the exact type name, so no subclass matched. The same
  comparison stood three times in one file, and one of them routes key presses, where the
  symptom read as a broken keyboard (#1639).
- `explainPropValue` answered "accepted" for `pointerEvents="box-none"`, which the renderer
  refuses. Three route shapes list what is allowed, the oracle read only what is forbidden.
  A classifier without a default branch now stops a new route shape from compiling until
  someone says what its values mean (#1648, #1650).
- React Native refusals name the element now, by class and test id. Twenty-five identical
  `<View className="flex-1">` sites used to produce the same message. The same change fixes
  a refusal that was never the caller's fault: one empty, invisible text child stripped the
  layout context from every element sibling beside it (#1640, #1641, #1649).
- `gjsify workspace --with-dependencies` sees local packages declared with an ordinary
  version range, not only with the `workspace:` protocol (#1646).
- Under GJS a command that set an exit code instead of throwing ended the process at 0, with
  its error already printed. It exits non-zero now (#1653).
- `gjsify ship` refused to package a GNOME app whose symbolic icon shares a name with the
  regular one, and wrote two zip files a release page could not tell apart (#1655).
- Translation catalogs named in BCP-47, `zh_Hans` and friends, landed in a directory gettext
  never reads (#1652).
- Every `.deb` we produce compressed its changelog at the default level instead of the maximum
  Debian policy asks for. The cause sat in `@gjsify/zlib`, whose options parameter was named
  `_options` and ignored, so every caller down the chain got the default (#1643).

## Two guards that were not guarding

A scaffolded workflow was asserted by four regular expressions over raw text. We broke the
file seven different ways and counted: a real workflow linter rejects six of them, those four
regexes reject none.

Then the new test for it turned out to check nothing on any CI host, because the linter it
needs is installed on none of our images. It passed anyway. It skips visibly now, and a job
that claims to have the tool fails by name if it does not. See #1645.
