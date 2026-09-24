# Licence texts the gvsbuild prefix does not document

These are **not** this package's own terms (it is MIT) and **not** a licence claim written
here. Each file is a verbatim copy of an upstream project's own licence text, used by
`scripts/build-gtk-runtime.mjs` only for a project the build prefix ships a **binary** for
and **no text** for. A project the prefix documents is always taken from the prefix; this
directory never overrides it, and nothing here is shipped for a library the bundle does
not carry.

## Why it exists

Measured on the `win32-x64` CI artifact of PR #1476: the bundle carries 65 DLLs in `bin/`
plus 25 binaries in their own directories, and the prefix documents 45 projects — and nine
of the projects behind fourteen of those binaries are in neither set. `libgio`,
`libgobject` and `libglib` (LGPL-2.1-or-later) and `libcrypto`/`libssl` (Apache-2.0, whose
§ 4 requires the licence to travel with the binary) shipped with no terms at all. gvsbuild
simply has no install step for some of these, and for others installs under a name the
licence scan does not accept (`openssl` installs `LICENSE` while OpenSSL 3 ships
`LICENSE.txt`; `glib` installs `LICENSES/LGPL-2.1-or-later.txt`).

The gate that now refuses such a bundle is `assertLicenseCoverage` +
`WIN32_LICENSE_FAMILIES` in `packages/node-gi/scripts/bundle-licenses.mjs`. **Deleting a
directory here fails the win32 build by name** rather than silently shipping the binary
without its terms — which is the point, and why the repair for a new one is to add its
text here, never to drop the family.

## Provenance

Each text is a byte-verbatim copy of the upstream release the gvsbuild pin builds the DLLs
from. The pin and the per-project version live in `provenance.json` beside this file rather
than in the table below, so they are one fact a test can hold instead of two copies of a
number: `gtk-runtime-bundle-gates.test.mjs` requires an entry for every directory here, a
directory for every entry, and the recorded `gvsbuild` to equal the `GVSBUILD_VERSION` the
workflows actually build with. A pin bump therefore cannot leave these texts silently
describing a different release.

Only the freetype file NAMES carry a `LICENSE-` prefix, because the scan matches licence
files by name and `FTL.TXT` / `GPLv2.TXT` do not look like one.

| Component | File here | Taken from |
|---|---|---|
| `glib` | `COPYING` | `LICENSES/LGPL-2.1-or-later.txt` (what glib's own `COPYING` symlinks to) |
| `gobject-introspection` | `COPYING` | `COPYING` — which half of the project a file belongs to |
| `gobject-introspection` | `COPYING.LGPL` | `COPYING.LGPL` — the terms of `girepository/`, the only half the bundle carries |
| `freetype` | `LICENSE.TXT` | `LICENSE.TXT` — the dual-licence chooser |
| `freetype` | `LICENSE-FTL.TXT` | `docs/FTL.TXT` — the FreeType Licence |
| `freetype` | `LICENSE-GPLv2.TXT` | `docs/GPLv2.TXT` — the other half of the choice |
| `graphene` | `LICENSE.txt` | `LICENSE.txt` |
| `libtiff` | `LICENSE.md` | `LICENSE.md` |
| `libxml2` | `COPYING` | `Copyright` |
| `zlib` | `LICENSE` | `LICENSE` (unchanged since 1.3.1; zlib carries the same notice in `zlib.h`) |
| `sqlite` | `LICENSE.md` | `LICENSE.md` — the public-domain dedication |
| `openssl` | `LICENSE.txt` | `LICENSE.txt` — Apache-2.0 |

A gvsbuild bump that changes one of these projects' TERMS is still not detected — only that
the pin moved, which is what puts a human back in front of this table. What IS detected on
its own is a bump that adds a library: it belongs to no declared family, and the build stops
with its name.

The failure this directory is easiest to reintroduce is naming the wrong project, not
missing one: two leaves that look like one library can be two. `girepository-2.0-0.dll` is
glib's since 2.80, `girepository-1.0-1.dll` is still gobject-introspection's own, and the
bundle ships both — matched as one family, the notice named glib as the project behind a
gobject-introspection binary. A wrong name ships the wrong project's terms, which is worse
than shipping none.
