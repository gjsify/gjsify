#!/usr/bin/env python3
"""What `libspiel-1.0.so` links and exports, read back from the built file.

Two claims meson.build makes, neither of which the build log can prove:

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

Prints both lists so the CI log carries the measurement, and exits 1 on any
entry outside them. Uses `readelf` (binutils): the file format is the contract,
not whatever meson was asked to do.
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


def readelf(*args):
    return subprocess.run(["readelf", "--wide", *args], check=True, capture_output=True, text=True).stdout


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
    print(f"{path}")
    print(f"  NEEDED   ({len(needed)}): {', '.join(needed)}")
    print(f"  exported ({len(exported)}): {len(spiel)} spiel_*" + (f", plus {other}" if other else ""))

    problems = [f"NEEDED {n} is not an OS/GNOME library" for n in needed if not ALLOWED_NEEDED.match(n)]
    problems += [f"exports {s}, which is not spiel_*" for s in other]
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
