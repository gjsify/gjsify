#!/usr/bin/env python3
"""What `libspiel-1.0.so` links and exports, read back from the built file.

Three claims meson.build makes, none of which the build log can prove:

  1. DT_NEEDED names only libc and the GNOME libraries the host provides
     (GLib/GObject/GIO and GStreamer). libspeechprovider must NOT appear: it is
     linked statically (meson.build § ONE library), and a NEEDED entry would mean
     the prebuild is half a set and cannot load without a libspeechprovider
     package — the one thing this build exists to avoid.
  2. The dynamic symbol table exports only `spiel_*`. ELF has ONE flat symbol
     namespace, and the statically linked libspeechprovider's seven
     `speech_provider_*` functions would otherwise interpose on (or be
     interposed by) the real `libspeechprovider.so` that a speech PROVIDER in the
     same process links. Measured: 89/0 with src/c/spiel.map, 89/7 without.
  3. No undefined symbol asks for a glibc version >= 2.28. npm installs these
     prebuilds on musl hosts too (no `libc` filter), and musl has neither symbol
     versions nor glibc's large-file redirect layer: `fcntl()` compiled with
     `-D_FILE_OFFSET_BITS=64` became `fcntl64@GLIBC_2.28`, which musl does not
     export — and GI binds lazily, so it failed at first call, not at load
     (`sab-native` lost two fd-passing tests to exactly this). meson.build § 4
     undefines `_FILE_OFFSET_BITS` globally to get plain `fcntl@GLIBC_2.2.5`.

Prints all three measurements so the CI log carries them, and exits 1 on any
symbol or entry outside the claims. Uses `readelf` (binutils) and its sibling
`nm` for the per-symbol glibc version: the file format is the contract, not
whatever meson was asked to do.
"""
import re
import subprocess
import sys

# GStreamer is a load-time dependency here, unlike in the sibling bridges: Spiel
# plays a provider's audio stream through a GStreamer pipeline, so libgstreamer,
# libgstaudio and libgstbase are part of what `gi://Spiel` needs present.
ALLOWED_NEEDED = re.compile(
    r"^(libc\.so\.6|libm\.so\.6|libdl\.so\.2|libpthread\.so\.0|ld-linux[-\w.]*\.so\.\d+"
    r"|libglib-2\.0\.so\.0|libgobject-2\.0\.so\.0|libgio-2\.0\.so\.0"
    r"|libgstreamer-1\.0\.so\.0|libgstaudio-1\.0\.so\.0|libgstbase-1\.0\.so\.0)$"
)

# The Spiel API as of the pinned revision. A floor rather than an equality: a
# libspiel bump that ADDS API must not fail this, while a version script that
# stopped being applied (or a build that exported nothing) must.
MIN_SPIEL_EXPORTS = 80

# glibc's large-file/redirect layer starts here: `fcntl()` became `fcntl64`,
# `stat()` -> `__xstat`, … even though the API name is unchanged. musl has no
# versions and no such redirect, so a symbol above this floor is one musl cannot
# bind. `readelf --dyn-syms` prints the name WITHOUT its `@GLIBC_x.y` suffix
# (the version lives in `.gnu.version`), so the per-symbol version comes from
# `nm -D` — same binutils, no new dependency.
GLIBC_REDIRECT_FLOOR = (2, 28)


def readelf(*args):
    return subprocess.run(["readelf", "--wide", *args], check=True, capture_output=True, text=True).stdout


def undefined_versions(path):
    """(symbol, glibc version string) for every versioned undefined symbol."""
    out = subprocess.run(
        ["nm", "-D", "--undefined-only", path], check=True, capture_output=True, text=True
    ).stdout
    found = []
    for line in out.splitlines():
        cols = line.split()
        # `                 U fcntl64@GLIBC_2.28` -> ["U", "fcntl64@GLIBC_2.28"]
        if len(cols) == 2 and "@GLIBC_" in cols[1]:
            symbol, _, version = cols[1].partition("@")
            found.append((symbol, version))
    return found


def glibc_version(text):
    """'GLIBC_2.2.5' -> (2, 2, 5), so a numeric compare is not a string compare."""
    return tuple(int(p) for p in text.removeprefix("GLIBC_").split("."))


def main(path):
    needed = re.findall(r"\(NEEDED\)\s+Shared library: \[([^\]]+)\]", readelf("-d", path))
    exported = []
    for line in readelf("--dyn-syms", path).splitlines():
        cols = line.split()
        # Num: Value Size Type Bind Vis Ndx Name — defined (Ndx != UND), GLOBAL/WEAK.
        if len(cols) >= 8 and cols[4] in ("GLOBAL", "WEAK") and cols[6] != "UND":
            exported.append(cols[7].split("@")[0])

    spiel = [s for s in exported if s.startswith("spiel_")]
    other = [s for s in exported if not s.startswith("spiel_")]
    versions = undefined_versions(path)
    newest = max(versions, key=lambda v: glibc_version(v[1]), default=None)
    print(f"{path}")
    print(f"  NEEDED   ({len(needed)}): {', '.join(needed)}")
    print(f"  exported ({len(exported)}): {len(spiel)} spiel_*" + (f", plus {other}" if other else ""))
    print(f"  glibc max: {newest[0]}@{newest[1]}" if newest else "  glibc max: no versioned undefined symbol")

    problems = [f"NEEDED {n} is not an OS/GNOME library" for n in needed if not ALLOWED_NEEDED.match(n)]
    problems += [f"exports {s}, which is not spiel_*" for s in other]
    problems += [
        f"references {s}@{v}, a glibc>={GLIBC_REDIRECT_FLOOR[0]}.{GLIBC_REDIRECT_FLOOR[1]} symbol "
        "musl does not export (meson.build § 4)"
        for s, v in versions
        if glibc_version(v)[:2] >= GLIBC_REDIRECT_FLOOR
    ]
    # An empty parse would pass everything above: the library links libc and
    # exports the whole Spiel API, so neither list can be short.
    if not needed or len(spiel) < MIN_SPIEL_EXPORTS:
        problems.append(
            f"parsed {len(needed)} NEEDED / {len(spiel)} spiel_* exports — "
            "either the version script hid the API or readelf's format moved"
        )
    for p in problems:
        print(f"  FAIL: {p}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
