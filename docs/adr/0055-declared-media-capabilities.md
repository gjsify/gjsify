# 55. A runtime bundle declares the media formats it decodes, and the declaration names its own evidence

- Status: **Proposed**
- Date: 2026-09-10
- Deciders: Pascal Garber
- Related: [ADR 0017 (per-target platform packages)](0017-platform-specific-prebuild-packages.md), [ADR 0018 (the OS axis)](0018-os-axis.md), [ADR 0024 (ship installable artifacts)](0024-ship-installable-artifacts.md) § A3, [ADR 0037 (the bundles carry the URI source)](0037-gtk-runtime-bundles-carry-the-uri-source.md)

## Context

`@gjsify/gtk-runtime-<os>-<arch>` exists so an application can ship its own GTK. Since
#1094 that payload includes GStreamer, so the same package also decides what the
application can PLAY — and that half is per-platform in a way nothing said out loud.

Measured on the published `0.48.0` tarballs, read from a Linux workstation with `tar -tz`
over the registry tarball (no macOS and no Windows host is needed to read a file list):

| bundle | plugins in `gtk/lib/gstreamer-1.0/` | present nowhere else |
|---|---|---|
| `darwin-x64` | 24 | `flac`, `mpg123`, `osxaudio`, `vorbis` |
| `darwin-arm64` | 24 | identical set to `darwin-x64` |
| `win32-x64` | 21 | `directsound` |

`osxaudio` against `directsound` is a platform's own sink and not a gap. The other three
are decoders: MP3, Ogg/Vorbis and FLAC play on darwin and not on win32, out of one npm
scope, at one version, with one documented audio path.

Nothing between the builder and the consumer was wrong when that shipped, and that is the
part worth keeping. gvsbuild carries the gst-plugins-good/base elements only if
libmpg123, libvorbis and libFLAC were built, and they were not; Homebrew has all three.
The builder copied what the archive held. The bundle's own `gtk/manifest.json` recorded
`windowingData.gstPlugins: 21` — and **a count cannot be wrong about WHICH**. Every gate
was satisfied by a number that was true.

#1544 found it the expensive way: a person ran an application on Windows, its bundled mp3
failed as *"missing a plug-in"* and its mp3 stream as *"Internal data stream error"* —
the string `gst-plugins.mjs` documents for a missing TLS backend, which it was not, so the
second symptom sent the reader to the network layer. #1562 then closed the BUILDER's blind
spot: `GST_PLUGIN_GAPS` in `packages/node-gi/scripts/gst-plugins.mjs` declares each
absence with what it costs, and `missingBundledGstPlugins` fails the build on an
undeclared one. That is a real fix and it is the wrong shape for the audience:

- **A build script is not published.** The declaration lives in a repository a consumer
  has no reason to read, while the thing they hold is a tarball whose `package.json` says
  nothing about what it can play.
- **The tables were one list for three artifacts.** `GST_AUDIO_DECODERS` read as *"the
  audio path takes these seven formats"* — true of darwin, false of win32 by three of the
  seven, and the difference only visible by consulting a SECOND list keyed by target.
- **Nothing obliged one bundle to answer for another's claim.** The asymmetry was not a
  contradiction anywhere; it was a silence, and a silence has no owner.

## Decision

### 1. The claim is a manifest declaration, per bundle

Every package shipping a `gtk/` runtime payload declares:

```jsonc
"gjsify": {
  "mediaCapabilities": {
    "gstPluginDir": "gtk/lib/gstreamer-1.0",
    "audioDecode": [{ "format": "MP3", "plugin": "mpg123", "element": "mpg123audiodec" }],
    "gaps": [{ "format": "FLAC", "plugin": "flac", "element": "flacdec", "why": "…" }]
  }
}
```

`gjsify.*` because it joins the four declaration axes the root AGENTS.md defines, and
under the rule that governs all of them: **no declaration without a check**.
`field-coverage` fails on any `gjsify.*` key no rule claims, so the key could not have
been added quietly.

### 2. A claim names its own evidence, split by who can read it

This is the shape borrowed from ADR 0024 § A3, where host-boundness stopped being prose
and became a `HostRequirement` field with a REQUIRED oracle. The same question is asked
here — *who can check this, and where* — and the answer is two fields rather than one:

| field | what it is | who can read it |
|---|---|---|
| `plugin` | a FILE in the bundle | **any host.** A Linux workstation reads the win32 payload's directory listing; that is how the table above was measured |
| `element` | a GStreamer element-factory name | **only the target OS**, by asking the running registry |

A file being present is a NECESSARY condition for a decoder and not a sufficient one, and
the check says so on every run rather than in a comment. `selfReading` has no analogue
here and does not need one: the two oracles are a file listing and a running GStreamer,
neither of which is the manifest that made the claim.

### 3. `media-capabilities` holds it, and three of its four passes need no payload

The rule is `portable` in `@gjsify/manifest-conformance` — it reads the manifest and files
on disk, and the format→plugin→element mapping is in the DECLARATION rather than in a
table inside the rule, so it knows nothing about GStreamer's catalogue or about this
repository.

| pass | needs a payload? |
|---|---|
| a package shipping `gtk/` declares `mediaCapabilities` at all | no |
| shape: three fields per claim, a mandatory `why` per gap, no format both taken and not taken, `gstPluginDir` inside `files` | no |
| **every bundle answers for every format any bundle speaks about** | no |
| every claimed `plugin` is in the payload, and every gap's plugin is NOT | yes |

The third is the one that would have caught this class at declaration time, and it is the
reason the rule is a gate on an ordinary Linux PR rather than only on the two OS legs: the
defect is an ASYMMETRY between targets, and an asymmetry is visible from anywhere.

The fourth runs where a payload exists — the two builders, and
`audit-runtimes --check --media-payload=<pkg>=<dir>` in `gtk-os-suites.yml`, which already
stages the published tarball. Where no payload is reachable the rule PRINTS that it opened
no artifact, on passing runs too: a check that reports "clean" over something it never
opened is the shape this whole area exists to remove.

### 4. The builders and the on-target probe read the same declaration

`gst-plugins.mjs` derives `GST_PLUGIN_GAPS`, `gstAudioDecoders(target)` and
`gstFormatGaps(target)` from the bundle packages' manifests, and
`gst-elements.test.mjs` asks the running registry for exactly the elements the host
target's bundle claims. One declaration, three readers, and a gap that retires itself in
all three: the builder fails when a declared gap's plugin arrives, the conformance rule
fails when the shipped payload carries it, and the on-target probe starts demanding the
element the moment the entry is deleted.

`GST_AUDIO_PLUGINS` stays where it is. It is the SEED of the copy — a request, not a
promise — and #1544 is precisely the difference between the two.

## Consequences

- **`npm view @gjsify/gtk-runtime-win32-x64` now answers "no MP3".** The gap that took a
  person on Windows to find is in the metadata of the package they would have installed.
- **Three tables leave a build script.** This is a consolidation rather than a fifth guard:
  the decoder table, the per-target plugin gaps and the format gaps had one home between
  them and now have one home each, in the artifact each describes.
- **The payload half is only as good as the payloads offered to it.** On a Linux PR it
  inspects none, and says so. `gtk-os-suites.yml` closes that for the two published
  targets on its own schedule, against the tarball a stranger downloads.
- **A fourth bundle cannot be added silently.** The trigger is `files` naming a `gtk/`
  payload, not a package list, so a new target's first commit is a red build asking for
  its audio contract.
- **A declared gap is a decision, and declaring it is what got one of them decided.**
  #1626 carried the win32 payload question — build libmpg123/libvorbis/libFLAC into the
  gvsbuild set, take them from elsewhere, or keep the narrowed contract — and asking it of
  three artifacts at once separated an OMISSION from an ABSENCE: gvsbuild has a `libvorbis`
  project nobody had ever named, and no project at all for libmpg123 or libFLAC. Ogg/Vorbis
  is now a claim on all three targets; the other two stay gaps whose `why` names the upstream
  file that would close them. [ADR 0056](0056-win32-audio-payload-is-bounded-by-gvsbuild.md).

## What this does NOT decide

- **Whether a shipped plugin LOADS.** The rule reads file names. A plugin whose own
  dependencies do not resolve, or a bundle GStreamer is never told the directory of,
  presents exactly as a healthy `Gst.init()` — that question belongs to
  `gst-elements.test.mjs` on the target OS, and this declaration is what tells it which
  elements to ask for.
- **Video, capture, encoding, or any format outside the audio path.** The vocabulary is
  `audioDecode` today because that is what the bundles carry; a `videoDecode` array is an
  additive change to the same declaration, and the rule's shape checks do not need to
  learn about it before it exists.
- **`@gjsify/webaudio`'s `canPlayType`,** which answers from a hardcoded MIME list and is
  wrong about `audio/aac` inside a bundle. It is a tier-1 package and cannot import a
  tier-2 script; whether it should ask the registry directly or read a declaration is
  open, in `status/open-todos.md`.
- **Whether the AAC gap ever closes.** `faad` is GPL and `avdec_aac` brings the libav
  closure ADR 0037 refuses, so it is a redistribution decision belonging to whoever ships
  the product. It stays a declared gap on all three targets, with no `plugin` — nothing
  was ever going to be copied, so no file's arrival can retire it.
