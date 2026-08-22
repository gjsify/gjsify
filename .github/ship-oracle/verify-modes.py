#!/usr/bin/env python3
"""Assert a .deb reproduces EVERY mode the stage sidecar planned.

WHY THIS EXISTS, and why it is not "the launcher is 0755".

`actions/upload-artifact` stores no POSIX mode, so every file in the stage
arrives on the packing host at 0644 and `.gjsify-ship-stage.json`'s `staged[]`
is the only surviving record of what each mode should be. A check that reads
the launcher and stops covers one path out of the payload; the failure it
misses is a plan entry and a tree entry whose paths are spelled differently,
which the CLI used to resolve to `?? 0o644` — a package that installs and
cannot start, at exit 0, with every structural reader happy.

Reproduce by hand:

    dpkg-deb --contents x.deb > contents.txt
    python3 verify-modes.py stage/.gjsify-ship-stage.json contents.txt

DISCRIMINATOR (run it, do not trust it): flip the launcher's `x` bits in
contents.txt and this must exit 1 naming `bin/<name>: planned 0755, packed
0644`. Both branches were run against dpkg-deb-shaped fixtures before this
file shipped.

A separate file rather than an inline heredoc for the reason
`scripts/check-workflow-inline-scripts.mjs` states in its own header: a body
that lives in a workflow is a body nobody can run by hand when it fails.
"""

import json
import stat
import sys

# `.deb` payload paths are `./usr/<prefix-relative>` — `FORMATS.deb.prefix`.
DEB_PREFIX = "./usr/"


def packed_modes(listing_path):
    """Path → mode, for the REGULAR FILES in a `dpkg-deb --contents` listing."""
    out = {}
    with open(listing_path, encoding="utf-8") as handle:
        for line in handle:
            parts = line.split()
            # Directories (`d`) and symlinks (`l`) are not payload; a stage that
            # contained either would have been refused two jobs earlier.
            if len(parts) < 6 or not parts[0].startswith("-"):
                continue
            name = parts[-1]
            if not name.startswith(DEB_PREFIX):
                continue
            bits = "".join("1" if char != "-" else "0" for char in parts[0][1:])
            out[name[len(DEB_PREFIX):]] = stat.S_IMODE(int(bits, 2))
    return out


def main(argv):
    if len(argv) != 3:
        print(f"usage: {argv[0]} <stage-manifest.json> <dpkg-deb-contents.txt>", file=sys.stderr)
        return 2
    with open(argv[1], encoding="utf-8") as handle:
        planned = {entry["path"]: entry["mode"] for entry in json.load(handle)["staged"]}
    if not planned:
        print("::error title=Ship handoff::the sidecar plans no files, so this check has no subject")
        return 1
    seen = packed_modes(argv[2])

    bad = []
    for path, mode in sorted(planned.items()):
        got = seen.get(path)
        if got is None:
            bad.append(f"{path}: planned {mode:04o}, ABSENT from the .deb")
        elif got != mode:
            bad.append(f"{path}: planned {mode:04o}, packed {got:04o}")
    if bad:
        print("::error title=Ship handoff::the .deb does not reproduce the staged mode plan")
        for row in bad:
            print(f"  {row}")
        return 1
    print(f"{len(planned)} path(s) packed at exactly the mode the sidecar planned")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
