# Licence texts the gvsbuild prefix does not document

These are **not** this package's own terms (it is MIT) and **not** a licence claim written
here. Each file is a verbatim copy of an upstream project's own licence text, used by
`scripts/build-gtk-runtime.mjs` only for a project the build prefix ships a **binary** for
and **no text** for. A project the prefix documents is always taken from the prefix; this
directory never overrides it, and nothing here is shipped for a library the bundle does
not carry.

## Why it exists

Measured on the `win32-x64` CI artifact of PR #1476: the bundle carries 65 DLLs in `bin/`
and the prefix documents 45 projects — and eight of the projects behind fourteen of those
DLLs are in neither set. `libgio`, `libgobject` and `libglib` (LGPL-2.1-or-later) and
`libcrypto`/`libssl` (Apache-2.0, whose § 4 requires the licence to travel with the
binary) shipped with no terms at all. gvsbuild simply has no install step for some of
these, and for others installs under a name the licence scan does not accept
(`openssl` installs `LICENSE` while OpenSSL 3 ships `LICENSE.txt`; `glib` installs
`LICENSES/LGPL-2.1-or-later.txt`).

The gate that now refuses such a bundle is `assertLicenseCoverage` +
`WIN32_LICENSE_FAMILIES` in `packages/node-gi/scripts/bundle-licenses.mjs`. **Deleting a
directory here fails the win32 build by name** rather than silently shipping the binary
without its terms — which is the point, and why the repair for a new one is to add its
text here, never to drop the family.

## Provenance

Version = the gvsbuild `2026.6.0` project pin, i.e. the source the DLLs in the bundle are
built from. Contents are byte-verbatim; only the freetype file NAMES carry a `LICENSE-`
prefix, because the scan matches licence files by name and `FTL.TXT` / `GPLv2.TXT` do not
look like one.

| Component | Version | File here | Taken from |
|---|---|---|---|
| `glib` | 2.88.1 | `COPYING` | `LICENSES/LGPL-2.1-or-later.txt` (what glib's own `COPYING` symlinks to) |
| `freetype` | 2.14.3 | `LICENSE.TXT` | `LICENSE.TXT` — the dual-licence chooser |
| `freetype` | 2.14.3 | `LICENSE-FTL.TXT` | `docs/FTL.TXT` — the FreeType Licence |
| `freetype` | 2.14.3 | `LICENSE-GPLv2.TXT` | `docs/GPLv2.TXT` — the other half of the choice |
| `graphene` | 1.10.8 | `LICENSE.txt` | `LICENSE.txt` |
| `libtiff` | 4.7.1 | `LICENSE.md` | `LICENSE.md` |
| `libxml2` | 2.15.3 | `COPYING` | `Copyright` |
| `zlib` | 1.3.2 | `LICENSE` | `LICENSE` (unchanged since 1.3.1; zlib carries the same notice in `zlib.h`) |
| `sqlite` | 3.53.2 | `LICENSE.md` | `LICENSE.md` — the public-domain dedication |
| `openssl` | 3.6.1 | `LICENSE.txt` | `LICENSE.txt` — Apache-2.0 |

A gvsbuild bump that changes one of these projects' terms is not detected here. What IS
detected is a bump that adds a library: it belongs to no declared family, and the build
stops with its name.
