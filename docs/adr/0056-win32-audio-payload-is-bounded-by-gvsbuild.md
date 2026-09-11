# 56. What the Windows runtime bundle decodes is bounded by gvsbuild's project list

- Status: **Accepted**
- Date: 2026-09-10, amended 2026-09-11 (§ 6, and the two routes out of the catalogue the first
  draft never named)
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

**Naming the project was not enough, and the first Windows run is what said so.** gvsbuild
fetches CMake 4.3.3; libvorbis 1.3.7 opens with `cmake_minimum_required(VERSION 2.8.12)`;
CMake 4 removed compatibility below 3.5. So the project gvsbuild defines cannot configure with
the CMake gvsbuild ships, and the invocation answered `Error: libvorbis build failed`. libogg
is untouched because its own CMakeLists asks for 3.6 — which is exactly why the `ogg` demuxer
was in the payload and the Vorbis decoder was not, a difference that had nothing to do with
either library's availability and would never have been visible from a project listing. The
repair is `--extra-opts 'libvorbis:-DCMAKE_POLICY_VERSION_MINIMUM=3.5'`: CMake's own documented
escape hatch, carried by gvsbuild's own per-project option, retiring the day either side moves.

So step 1 of § 1 is necessary and not sufficient, and the ADR would have been wrong to stop
there. A project in the catalogue can still be unbuildable with the toolchain the catalogue
ships, and only a build says which.

### 3. MP3 and FLAC stay declared gaps, and the reason is availability, not licence

Worth stating because the neighbouring AAC gap IS a licensing decision and the two get
conflated. libmpg123 is LGPL-2.1, libFLAC is BSD-3-Clause, libvorbis and libogg are
BSD-3-Clause: nothing here is a redistribution question. What is missing is a build. Closing
either gap means a project definition in gvsbuild itself — a single file of the shape
`libvorbis.py` already has — after which step 2 above is a one-word change here.

**Re-measured 2026-09-11 at the same pin, and the two formats are no longer one answer.** The
project list settles MP3 on its own: the catalogue has no libmpg123, gvsbuild's own ffmpeg
patch turns MP3 off (§ Alternatives rejected), gst-plugins-rs has no MP3 decoder at all, and
gst-plugins-ugly 1.28.4 ships `ext/` = a52dec, cdio, dvdread, mpeg2dec, sidplay, x264 — `mad`
was removed upstream. Every route out of this build system is shut, and #1626 closes on that.
The NEXT gvsbuild release does not reopen it either: `2026.8.0`, published while `2026.6.0`
was still the pin, carries the same 94 project modules with nothing added or removed — read
with § 6's own `--update` against the newer tag, which is the first thing that tooling was
asked and the answer a pin bump would otherwise have taken a Windows leg to discover.
FLAC is not in the same position: `claxon` in gst-plugins-rs is a pure-Rust FLAC decoder and
gvsbuild already defines that tree as a project. It stays a gap, but as a COSTED decision
rather than an absence, and the cost is written down below rather than left to the next reader
to rediscover.

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

### 6. The claim that bounds the payload is machine-held, and retires itself

Every sentence above is about an artifact this repository does not own, at a version it pins.
That pin is spelled in eight workflow `env:` blocks, gvsbuild 2026.8.0 was published while
2026.6.0 was still the pin, and NOTHING in this area could have noticed the difference: the
three mechanisms around the declaration all compare it to OUR artifact — `media-capabilities`
to the shipped plugin files, `missingBundledGstPlugins` to what the builder copied,
`gst-elements.test.mjs` to the registry on the target — and all three stay green on the day a
gap's reason expires. That is #1544's class with the sign flipped: there a decoder was absent
and nothing said so; here a gap outlives its cause and nothing says so.

So the reason leaves prose and becomes data. A claim or a gap may carry
`upstream: { catalogue, library }`, and the two halves are checked by who can read them — the
same split ADR 0055 § 2 draws through `plugin` and `element`, one level up:

| held by | what it holds | where |
|---|---|---|
| `media-capabilities` (portable) | the SHAPE — `catalogue` and `library` are both filled | any consumer's tree |
| `gvsbuild-catalogue` (repo) | what the value SAYS — against a committed snapshot of gvsbuild's project modules, pinned to `GVSBUILD_VERSION` | every PR, no network |

**Both directions, on every run, which is the only reason the matcher can be believed.** A
GAP's library must match nothing in the snapshot; a CLAIM's must match something. The win32
bundle carries both kinds — Ogg/Vorbis and Opus exist because `libvorbis.py` and `opus.py` do,
MP3 and FLAC do not because nothing answers to them — so a matcher that had silently stopped
matching would fail on the claims in the same run it passed the gaps. A bundle declaring only
one direction is itself a finding, and so is a snapshot too short to be a catalogue: a
truncated one answers "absent" to everything, which passes every gap and points the blame at
the declarations.

The snapshot is `packages/node-gi/scripts/gvsbuild-catalogue.json`, re-read by that file's
sibling `--update`, and it is MODULE BASENAMES rather than project names on purpose. Project
names need a Python parser — a first attempt at that regex silently missed `opus`, `cairo` and
`dav1d`, and a parser that under-reports turns every absence assertion into a pass. A directory
listing cannot be wrong in that direction, and a library gvsbuild learns to build arrives as
its own module, the way `libvorbis.py`, `ogg.py`, `opus.py`, `dav1d.py` and `x264.py` each did.

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
- **A widening cannot be split across two commits, so the win32 leg becomes a probe for one
  release cycle.**
  `gtk-os-suites.yml` stages the PUBLISHED tarball and audits this tree's declaration against
  it — the artifact a stranger downloads, per ADR 0024 § 4. A widening therefore disagrees with
  the last release until the next one carries the plugin, and its own comment already called
  that the honest direction. What it called the repair — "land the payload first" — is not
  available: the builder refuses to let declaration and payload travel separately in EITHER
  direction (a format out of `gaps` and unclaimed fails the coverage pass; a gap whose plugin
  arrived fails as RETIRED). They move in one commit by construction. Both doors were run, not
  argued: the unclaimed format reports *"says nothing about Ogg / Vorbis, which
  @gjsify/gtk-runtime-darwin-arm64, @gjsify/gtk-runtime-darwin-x64 declare an answer for"*, and
  the kept gap reports `retired: ["vorbis"]` into a `process.exit(1)`.
- **Gating that window was rejected, because it is not path-filtered.** An earlier draft of this
  decision kept the leg red and defended it as "advisory (path-filtered, never a required
  check)". Only the second half is true: `gtk-os-suites.yml` carries no `paths:` at all — every
  pull request, every push to `main`, nightly at 06:30 — so a red widening reds that job on
  `main` and on every unrelated contributor's PR until the release ships, for something they did
  not cause. That is this repository's own lesson in the other direction: a guard that cannot
  fail is worthless, and a guard that is knowingly failing spends the same coin, because the
  next real finding on it lands on a job people have learned to skip.
- **So the win32 step is a PROBE, which reports rather than silences.** `continue-on-error` + an
  `id` + `report-probe-outcome.mjs` — the shape `rn-probe-win32` in the same job already uses,
  for the same cause (a leg that cannot see a fix until a release ships). The audit still runs
  and still prints the finding; the reporter emits a `::warning::` on the PR and a job-summary
  line stating the job is green ONLY because of the flag; `check-probe-outcomes-read.mjs`
  refuses a probe whose outcome nothing reads. Almost nothing stops gating: `audit-runtimes.yml`
  runs `--check --strict` on every pull request with no paths filter of its own, so only the
  `--media-payload` comparison — the half that legitimately disagrees during a widening — is
  advisory. The darwin leg keeps gating. **Retirement is a RELEASE, not an issue:** delete
  `continue-on-error`, both step ids and the note on the first run after a published
  `@gjsify/gtk-runtime-win32-x64` carries `gstvorbis.dll`.
- **A Windows leg has now run it once, and refuted the easy half.** Run 34502880383 built the
  prefix from scratch (the cache key moved, so nothing reproduced the old bundle) and the named
  assertion fired: `MISSING …\gstvorbis.dll`. Naming the gvsbuild project was not sufficient —
  § 2 carries the cause. That run is also what makes the difference between the two halves of
  this ADR concrete: the project LIST is readable from Linux and settled MP3 and FLAC, while
  whether a listed project BUILDS is a Windows fact and nothing here could have predicted it.
- **Accepted on run 34530994036, which carried both halves it asked for.** The bundle build
  is green with the policy flag and the named assertion satisfied; the artifact was then read
  off the wire rather than off the log — `lib/gstreamer-1.0/gstvorbis.dll` present,
  `windowingData.gstPlugins` 22, `licenses/libvorbis/COPYING` in the tarball, and no vorbis or
  ogg DLL in `bin/`, which is the static-CMake reading § 5 added its licence-family entry
  against. On the target, `gst-elements.test.mjs` passed 8 of 8 on `windows-latest` with no
  gvsbuild on the host: it asks the running registry for exactly the elements this manifest
  claims, so `vorbisdec` resolving is what its green means, and `a declared decoder gap is
  still a gap` says `mpg123audiodec` and `flacdec` are still null there. The file and the
  element are different questions and both are now answered.
- **#1626 closes on MP3, and it closes as a DECLARATION rather than a payload.** Every route
  out of this build system was read rather than remembered: no `mpg123` module in the
  catalogue (cross-read at 2026.6.0 from the GitHub contents API and from the PyPI wheel
  `pipx install` unpacks — 95 entries, identical), no mp3 decoder in gvsbuild's ffmpeg
  configure line, none in gst-plugins-rs 0.15.2, none left in gst-plugins-ugly 1.28.4. The
  application that found this (a desktop reader whose bundled episode and live radio both
  fail on Windows) gets no payload out of this decision and one thing it did not have: the
  gap now says, in the metadata of the package it installs, that a product author willing to
  make the redistribution call can add an MSVC-ABI `gstmpg123.dll` through `GST_PLUGIN_PATH`,
  which `gtk-runtime.js` deliberately never sets. Measured that the additive path merges with
  the bundle's `GST_PLUGIN_SYSTEM_PATH` and the bundle's own elements survive it.
- **The gap can now expire loudly, which is the part that was missing.** § 6's rule is what
  turns "gvsbuild has no project for this" from a sentence written once into a claim re-asked
  on every pull request. The negative controls were run rather than argued: a gap library
  spelled as one the catalogue HAS, a claim library it does not, a single workflow bumped to
  2026.8.0, a snapshot truncated to two modules, the `upstream` fields deleted, and only one
  direction left — six edits, six red runs, each naming the edit.

## What this does NOT decide

- **Whether to build libmpg123 or libFLAC beside gvsbuild in our own workflow.** It is
  technically open — both have MSVC-capable CMake builds — and it is rejected below rather than
  ruled out forever; a gvsbuild project is the same work in the place that maintains it.
- **Whether FLAC stays a gap once something needs it.** Unlike MP3 it has a route out of this
  catalogue (`claxon`, below), so the entry is a price and not a wall. Its `why` says so, which
  is the difference between the two gaps a consumer can now read off `npm view`.
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

**Take `gst-libav`, which IS in the catalogue.** The first draft of this ADR never named this
route, and that was its worst omission: a reader checking the catalogue finds `gst-libav` in
`gstreamer.py` and `ffmpeg` in `ffmpeg.py` and concludes § 3 is simply wrong. It is not, and
the reason is a fact rather than a principle — **gvsbuild's own ffmpeg is not a full ffmpeg.**
Its `gvsbuild/patches/ffmpeg/build/build.sh` configures `--disable-everything` and then names
what comes back: `h264`, `hevc`, `libdav1d` and `mpeg1video` on the video side, and on the
audio side exactly three decoders, under the comment *"audio decoder which aren't available in
native gst plugins"* — `mp2float`, `wmav2`, `wmapro`. No mp3, no flac, and no aac either, so
this route closes neither gap and would not have closed the AAC one. Widening it means patching
a build script inside a project we do not own, which is the same objection as the entry above
with an extra maintenance surface. (ADR 0037 refuses the libav closure on size grounds anyway;
worth separating, because "we will not ship it" and "it would not work" are different sentences
and only one of them survives a bump.)

**Take `claxon` out of gst-plugins-rs, which is also in the catalogue — the FLAC-only route.**
gvsbuild defines gst-plugins-rs under the project name `gst-plugin-gtk4` (0.15.2, built
`--auto-features=disabled -Dgtk4=enabled`), and that tree's `meson_options.txt` carries
`claxon`: a pure-Rust FLAC decoder, `claxondec`, MPL-2.0. So FLAC is REACHABLE and this is the
one place in this decision where "upstream-bounded" would be the wrong word. It is not taken,
and the price is why: the project's gvsbuild dependencies are `meson, cargo, gst-plugins-base,
gst-plugins-bad, gtk4` plus a `cargo install cargo-c --locked`, and the extracted GTK4 zip
carries no gvsbuild build markers — so gvsbuild rebuilds gtk4 from source too, on the leg whose
GStreamer build already runs under a 150-minute timeout and has been measured dying 25 minutes
in on a toolchain mismatch. That is a large, unverifiable-from-Linux addition to close the one
of the two gaps no consumer has been measured needing, while MP3 — the one a real application
was measured failing on — stays absent either way. A `libFLAC` gvsbuild project closes it for
one word and no new toolchain; `lewton`, the same tree's Vorbis decoder, is the control that
says this is a real capability and not a misreading. Revisit if a consumer measures FLAC, or if
the Rust toolchain arrives in that prefix for another reason.

**Keep the narrowed contract and change nothing.** That was the state ADR 0055 declared, and
declaring it is what made the omission findable — but a gap that could be closed by naming a
project the build system already has is not a contract, it is an oversight with a reason
attached.

**Leave § 6's claim as prose, on the grounds that a pin bump is rare.** Rare is what makes it
worse, not better: the reader who bumps `GVSBUILD_VERSION` is bumping it for GLib or GTK and
has no reason to be thinking about libmpg123, and the eight `env:` blocks make a partial bump
the likelier accident of the two. Rejecting a guard here would also have been inconsistent with
the rest of this area — ADR 0055 § 1 is "no declaration without a check", and the `why` is
where the declaration actually says something falsifiable.
