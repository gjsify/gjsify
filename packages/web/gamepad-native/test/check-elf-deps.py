#!/usr/bin/env python3
"""The Linux half of ADR 0075 Amendment 1's dependency promise, read back from
the built library rather than from meson.build.

  1. DT_NEEDED names only libc, libm, libdl, libpthread, the dynamic loader and
     GLib/GObject (the GObject shim's own). libudev and libdbus are dlopen()ed
     by SDL at run time and must NOT appear: a NEEDED entry would make a host
     without them unable to load the library at all.
  2. The dynamic symbol table exports only `gjsify_gamepad_*`. An exported SDL
     symbol would interpose on (or be interposed by) any other SDL in the
     process — ELF has one flat namespace.

Prints both lists, so the CI log carries the measurement, and exits 1 on any
entry outside them. Uses `readelf` (binutils) — the file format is the
contract, not whatever meson was asked to do.
"""
import re
import subprocess
import sys

ALLOWED_NEEDED = re.compile(
    r"^(libc\.so\.6|libm\.so\.6|libdl\.so\.2|libpthread\.so\.0|ld-linux[-\w.]*\.so\.\d+"
    r"|libglib-2\.0\.so\.0|libgobject-2\.0\.so\.0)$"
)


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

    print(f"{path}")
    print(f"  NEEDED   ({len(needed)}): {', '.join(needed)}")
    print(f"  exported ({len(exported)}): all gjsify_gamepad_*" if all(
        s.startswith("gjsify_gamepad_") for s in exported) else f"  exported ({len(exported)}): {exported}")

    problems = [f"NEEDED {n} is not an OS/GLib library" for n in needed if not ALLOWED_NEEDED.match(n)]
    problems += [f"exports {s}, which is not gjsify_gamepad_*" for s in exported if not s.startswith("gjsify_gamepad_")]
    # An empty parse would pass everything above; the library links libc and
    # exports the whole API, so zero of either means the parse stopped reading.
    if not needed or len(exported) < 20:
        problems.append(f"parsed {len(needed)} NEEDED / {len(exported)} exports — readelf's format moved")
    for p in problems:
        print(f"  FAIL: {p}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
