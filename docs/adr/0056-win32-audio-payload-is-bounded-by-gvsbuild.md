# 56. What the Windows runtime bundle decodes is bounded by gvsbuild's project list

- Status: **Proposed**
- Date: 2026-09-10
- Deciders: Pascal Garber
- Related: [ADR 0037 (the bundles carry the URI source)](0037-gtk-runtime-bundles-carry-the-uri-source.md), [ADR 0055 (a declared media contract)](0055-declared-media-capabilities.md), [ADR 0023 (which GTK a node-gi process uses)](0023-gtk-source-precedence.md)

## Context

[ADR 0055](0055-declared-media-capabilities.md) made every bundle state what it decodes and
left the payload itself open: `@gjsify/gtk-runtime-win32-x64` declared MP3, Ogg/Vorbis and
FLAC as gaps, and #1626 carried the question of whether they had to stay that way. Its
Consequences named three answers — build the libraries into the gvsbuild set, take them from
elsewhere, or keep the narrowed contract — and said the declaration makes the answer visible
to whoever is choosing. It did. This is that answer.

**Where the payload is actually decided.** Not in the bundle builder, which copies what the
prefix holds, and not in `GST_AUDIO_PLUGINS`, which is a request. It is decided by ONE
argument list, duplicated in `node-gi.yml` and `release.yml`:

```
gvsbuild build … --build-dir C:\gtk-build glib-networking libsoup3
gvsbuild build … --skip libvpx --build-dir C:\gtk-build gstreamer gst-plugins-base gst-plugins-good
```

The published `GTK4_Gvsbuild_<version>_x64.zip` carries no GStreamer at all — measured on the
win32 tarball, where all 40 typelibs were present and not one of them GStreamer's — so the
Windows GStreamer is built from source into that same prefix, by us, from gvsbuild's own
project definitions. **The project list is ours; the projects are not.**

**What gvsbuild has.** Read from the pinned tag (`wingtk/gvsbuild@2026.6.0`,
`gvsbuild/projects/`): `ogg.py` and `libvorbis.py` are among the files there. There is no
`flac.py`, no `mpg123.py`, no `mad`, `lame` or `twolame`, and gvsbuild offers no mechanism for
loading a project definition from outside its own package — the directory IS the catalogue. Homebrew has all three libraries,
which is the entire origin of the asymmetry: the darwin builder copies from a prefix that
happens to hold them.

So the three gaps were never one fact. One was an OMISSION — nothing had ever named a project
that existed. Two are ABSENCES — the library is not obtainable from the build system this
prefix is made of.

## Decision

### 1. A win32 format may be claimed when gvsbuild has a project for the library behind it

The constraint on the Windows audio payload is gvsbuild's project list, and the question to
ask of any future codec request is that one, in that order:

1. does gvsbuild define a project for the library the element links?
2. does our invocation name it, before the plugin set that consumes it?
3. does the named assertion at the prefix see the plugin file?

Only then does the format move into `gjsify.mediaCapabilities.audioDecode`. A `no` at step 1
is a declared gap whose `why` says *that*, not "the archive did not have it" — the two read
the same and are repaired in completely different places.

### 2. Ogg/Vorbis falls, because it was an omission

`libvorbis` joins the first invocation, beside `libsoup3`, and for the identical reason
written there: gst-plugins-base's `vorbis` feature is meson `auto` and -base does not DECLARE
libvorbis as a gvsbuild dependency, so nothing orders the two for us. `@gjsify/gtk-runtime-win32-x64`
therefore claims Ogg/Vorbis instead of excusing it, and the `ogg` demuxer it already shipped
stops leading to nothing.

### 3. MP3 and FLAC stay declared gaps, and the reason is availability, not licence

Worth stating because the neighbouring AAC gap IS a licensing decision and the two get
conflated. libmpg123 is LGPL-2.1, libFLAC is BSD-3-Clause, libvorbis and libogg are
BSD-3-Clause: nothing here is a redistribution question. What is missing is a build. Closing
either gap means a project definition in gvsbuild itself — a single file of the shape
`libvorbis.py` already has — after which step 2 above is a one-word change here.

### 4. An `auto` feature is silent, so a claim needs a NAMED assertion

The whole class this area exists for. A meson `auto` feature whose dependency is absent
switches off and the build stays green; `gstsoup.dll` was already measured going missing that
way, and `gstvorbis.dll` can go the same way tomorrow. The prefix assertion therefore names
both files rather than counting the plugin directory, and the bundle builder's own
`missingBundledGstPlugins` reports an absent `vorbis` as UNDECLARED — because the manifest now
claims it — so the payload and the declaration cannot disagree without a red build.

### 5. The terms travel with the library, by the mechanism already in place

gvsbuild installs each project's `COPYING` into `share/doc/<project>`, and the win32 licence
step ships that prefix-wide corpus, so `libvorbis`'s BSD text arrives with the library and no
list has to be extended by hand. One entry IS added to `WIN32_LICENSE_FAMILIES` ahead of
anything matching it: gvsbuild builds ogg and libvorbis with CMake, CMake defaults to a static
library, and the measured `bin/` accordingly carries `opus-0.dll` (opus is a meson project) and
no ogg DLL at all. If a bump flips libvorbis to shared, the coverage gate would fail the
release on a binary belonging to no declared family — a red build over a licence question the
corpus has already answered.

## Consequences

- **The three targets stop differing by three decoders and start differing by two.** Ogg,
  Opus, WAV/PCM, A-law and µ-law now play on every bundle; MP3 and FLAC are darwin-only and
  say so in the metadata of the package a consumer installs.
- **`npm view` answers the payload question, and now answers it with a repair.** A gap's `why`
  names the upstream file that would close it instead of describing a prefix nobody outside
  this repository can see.
- **The argument list is duplicated and stays duplicated, with no new check over it.**
  `node-gi.yml` builds it on a PR and `release.yml` builds it for the tag, and the temptation
  is a guard holding the two texts equal. There already is one, and it is the declaration: a
  prefix missing a plugin the manifest CLAIMS makes `missingBundledGstPlugins` report an
  UNDECLARED absence and the builder exit 1, naming it. A second check would watch a mechanism
  that works. What the duplication does cost is WHEN — the leg that proves the payload is not
  the leg that ships it, so a change to one that misses the other is a red release rather than
  a red pull request. Change both in the same commit.
- **A cache key is part of the decision, and is covered by the same mechanism.** Both workflows
  key the gvsbuild prefix cache on the project set they build. Adding a project without moving
  the key is a cache hit that skips the build and produces the bundle from before the change —
  which then fails as an undeclared absence rather than shipping.
- **This ADR is `Proposed` until a Windows leg has run it.** What is measured today is a file
  list and a project list, both read from Linux. What is not: that `gstvorbis.dll` builds, that
  it loads, and that `vorbisdec` registers. The first is the prefix assertion, the second and
  third are `gst-elements.test.mjs` on the target — which asks for exactly the elements this
  bundle's manifest claims, so the claim added here is what puts `vorbisdec` in its question.
  Promote on the first green win32 windowing-bundle run carrying both.

## What this does NOT decide

- **Whether to build libmpg123 or libFLAC beside gvsbuild in our own workflow.** It is
  technically open — both have MSVC-capable CMake builds — and it is rejected below rather than
  ruled out forever; a gvsbuild project is the same work in the place that maintains it.
- **AAC**, which stays a gap on all three targets for the reason ADR 0055 gives: `faad` is GPL
  and `avdec_aac` brings the libav closure ADR 0037 refuses, so it is the product author's
  redistribution decision and not this bundle's.
- **Video, capture or encoding.** The vocabulary is still `audioDecode` because that is what
  the bundles carry.
- **Anything about darwin.** Homebrew's prefix is not bounded this way, and the two builders
  are deliberately separate.

## Alternatives rejected

**Side-load prebuilt MinGW binaries (MSYS2) into the MSVC prefix.** Two costs, either of which
is enough. The ABI: gvsbuild exists precisely because the MSVC and MinGW toolchains produce
different CRT closures, and a plugin that allocates in one and frees in the other fails in a way
no file list can see. The licence: a side-loaded DLL lands in `bin/` with no `share/doc/<project>`
entry, so its terms would have to be hand-vendored under `licenses-not-in-prefix/` — the escape
hatch that exists for projects the prefix builds and does not document, not for projects the
prefix never built.

**Build libmpg123 and libFLAC from source in the workflow, beside gvsbuild.** This would close
both gaps and it makes this repository the maintainer of two more Windows builds inside a prefix
that is otherwise one build system's output. The same work as a gvsbuild project file, in the
place where nobody else benefits from it and where the next GStreamer bump is ours to chase.

**Keep the narrowed contract and change nothing.** That was the state ADR 0055 declared, and
declaring it is what made the omission findable — but a gap that could be closed by naming a
project the build system already has is not a contract, it is an oversight with a reason
attached.
