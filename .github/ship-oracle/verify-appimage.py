#!/usr/bin/env python3
"""Read an AppImage this project did NOT write, without asking the file about itself.

WHY THIS FILE EXISTS.  `.deb` and `.rpm` are written by this tree, and ADR 0024 § A3
records what that bought: writing the RPM header ourselves made `rpm` an *independent*
oracle, and it caught a real defect in the first artifact.  An AppImage forfeits that —
its container is written by `appimagetool` and its filesystem by the `mksquashfs` that
tool bundles.  So the oracle has to be something that is neither, and the obvious
readers are exactly the ones that must NOT be used: `--appimage-offset` and
`--appimage-extract` are the artifact's own embedded runtime reading what that runtime
was concatenated onto.

THE CHAIN, and what each link is for — none of them is redundant:

  1. ELF HEADER, PARSED HERE.  A type-2 AppImage is an ELF executable with a squashfs
     image appended, and the filesystem begins at `e_shoff + e_shnum * e_shentsize` —
     i.e. immediately after the section-header table, which is the last thing in the
     ELF.  That is the ELF specification and nothing else, twelve bytes read out of the
     64-byte header.  Deriving the offset rather than asking the file for it is the
     WHOLE independence argument: `--appimage-offset` would be the runtime answering a
     question about itself.

  2. SQUASHFS SUPERBLOCK AT THAT OFFSET.  `hsqs` (0x73717368 little-endian) has to be
     the first four bytes there.  This is the link that catches the failure this file
     exists for — the artifact that is a valid, executable, correctly named ELF with
     NOTHING behind it.  `ls -l` shows a plausible size, `file` says ELF, the image
     "builds", and it mounts an empty directory.  Measured on a real artifact: the
     derived offset and `--appimage-offset` agree exactly (944632 on the first one
     built here), which is also what makes link 1 checkable rather than asserted.

  3. `unsquashfs -s` AND `-ll` AT THAT OFFSET.  squashfs-tools, which is a different
     PROGRAM from the mksquashfs appimagetool carries, over a filesystem this tree
     never wrote.  `-s` prints the superblock (compression, inode count); `-ll` prints
     a listing with MODES, which is what turns "a name appears" into "the launcher will
     run".  A distributed application whose `bin/<name>` arrives 0644 mounts fine and
     refuses to start, and no listing without modes can see it.

  4. THE STAGE SIDECAR.  Every path in `.gjsify-ship-stage.json`'s `staged[]` has to be
     inside the image under `usr/`, at the mode the plan gave it — the same sidecar
     `verify-modes.py` holds the `.deb` against, so the two formats are checked against
     ONE record of what the payload is rather than against each other.

  5. THE THREE APPDIR ROOT FILES.  `AppRun` (executable), `<appId>.desktop` and the
     icon its `Icon=` names.  appimagetool refuses an AppDir without the first two, so
     their absence cannot be what fails here — what CAN is `AppRun` arriving
     non-executable, or the icon being the `-symbolic` glyph instead of the app's face.

USAGE
    python3 verify-appimage.py <image.AppImage> <stage/.gjsify-ship-stage.json> <appId>
"""

from __future__ import annotations

import json
import re
import struct
import subprocess
import sys

#: `hsqs`, the squashfs 4.0 magic, little-endian.
SQUASHFS_MAGIC = b"hsqs"

#: Where the prefix lives inside an AppDir — `APPDIR_PREFIX_DIR` in `utils/ship/appimage.ts`.
PREFIX_DIR = "usr"


def fail(message: str) -> None:
    print(f"::error title=AppImage oracle::{message}")
    sys.exit(1)


def run(argv: list[str], *, what: str) -> str:
    print(f"== {' '.join(argv)}")
    proc = subprocess.run(argv, capture_output=True, text=True)
    if proc.returncode != 0:
        fail(f"{what} failed ({proc.returncode}): {proc.stderr.strip() or proc.stdout.strip()}")
    return proc.stdout


def payload_offset(image: str) -> int:
    """Where the squashfs starts, from the ELF header and nothing else.

    64-bit ELF only, which is not a limitation worth removing: every architecture
    `APPIMAGE_ARCH` names except `i686`/`armhf` is 64-bit, and those two have no
    runner here to be read on.  A 32-bit file is REFUSED rather than mis-parsed —
    the 32-bit header puts `e_shoff` at 0x20 as a 4-byte value, so reading it as
    an 8-byte value at 0x28 would produce a plausible number pointing nowhere.
    """
    with open(image, "rb") as handle:
        header = handle.read(64)
    if header[:4] != b"\x7fELF":
        fail(f"{image} does not start with the ELF magic — an AppImage is an ELF with a filesystem appended")
    if header[4] != 2:
        fail(f"{image} is a 32-bit ELF; this reader parses the 64-bit header only")
    e_shoff = struct.unpack_from("<Q", header, 0x28)[0]
    e_shentsize = struct.unpack_from("<H", header, 0x3A)[0]
    e_shnum = struct.unpack_from("<H", header, 0x3C)[0]
    return e_shoff + e_shentsize * e_shnum


def assert_superblock(image: str, offset: int) -> None:
    """The link that catches an AppImage with nothing in it."""
    with open(image, "rb") as handle:
        handle.seek(offset)
        magic = handle.read(4)
    if magic != SQUASHFS_MAGIC:
        fail(
            f"no squashfs superblock at offset {offset} (read {magic!r}). The ELF runtime is there and the "
            "filesystem behind it is not — which is an executable file of plausible size that mounts an "
            "empty directory."
        )
    print(f"squashfs superblock found at {offset}, derived from the ELF section-header table")


#: One `unsquashfs -ll` row: `-rwxr-xr-x root/root  31 2026-09-11 21:52 squashfs-root/AppRun`.
LISTING_ROW = re.compile(r"^([-dlrwxsSt]{10})\s+\S+\s+\S+\s+\S+\s+\S+\s+squashfs-root/(.+)$")

#: `rwx` triplets → mode bits, so a listing can be compared against a planned `0o755`.
BIT = {"r": 0o4, "w": 0o2, "x": 0o1, "s": 0o1, "-": 0}


def parse_mode(flags: str) -> int:
    mode = 0
    for group in range(3):
        triplet = flags[1 + group * 3 : 4 + group * 3]
        value = sum(BIT[char] for char in triplet)
        mode = mode * 8 + value
    return mode


def listing(image: str, offset: int) -> dict[str, int]:
    """Path inside the AppDir → mode, read by squashfs-tools."""
    out = run(["unsquashfs", "-o", str(offset), "-ll", image], what="unsquashfs -ll")
    found: dict[str, int] = {}
    for line in out.splitlines():
        match = LISTING_ROW.match(line.strip())
        if match is None or match.group(1)[0] != "-":
            continue
        found[match.group(2)] = parse_mode(match.group(1))
    if not found:
        fail("unsquashfs listed no regular files inside the image")
    return found


def main(argv: list[str]) -> None:
    if len(argv) != 4:
        fail("usage: verify-appimage.py <image.AppImage> <stage manifest.json> <appId>")
    image, manifest_path, app_id = argv[1], argv[2], argv[3]

    offset = payload_offset(image)
    assert_superblock(image, offset)
    # The superblock, printed rather than asserted on: the compression is pinned in
    # `appImageToolArgs` and the unit spec holds that. What matters here is that a
    # SECOND implementation could read it at all.
    print(run(["unsquashfs", "-s", "-o", str(offset), image], what="unsquashfs -s").strip())

    inside = listing(image, offset)

    with open(manifest_path, encoding="utf-8") as handle:
        planned = {entry["path"]: entry["mode"] for entry in json.load(handle)["staged"]}

    problems: list[str] = []
    for path, mode in sorted(planned.items()):
        got = inside.get(f"{PREFIX_DIR}/{path}")
        if got is None:
            problems.append(f"{PREFIX_DIR}/{path}: planned {mode:04o}, ABSENT from the image")
        elif got != mode:
            problems.append(f"{PREFIX_DIR}/{path}: planned {mode:04o}, packed {got:04o}")

    # The AppDir root. `AppRun` non-executable is the one failure appimagetool itself
    # cannot catch — it checks that a desktop file and an icon EXIST, never that the
    # entry point can be run.
    apprun = inside.get("AppRun")
    if apprun is None:
        problems.append("AppRun: ABSENT — the AppImage runtime has nothing to exec")
    elif apprun & 0o111 == 0:
        problems.append(f"AppRun: packed {apprun:04o}, which the runtime cannot exec")
    if f"{app_id}.desktop" not in inside:
        problems.append(f"{app_id}.desktop: ABSENT from the AppDir root")
    icons = [name for name in inside if name.startswith(f"{app_id}.") and name.endswith((".png", ".svg"))]
    if not icons:
        problems.append(f"{app_id}.png/.svg: ABSENT from the AppDir root — the desktop entry's Icon= names it")
    if any(name.endswith("-symbolic.png") or name.endswith("-symbolic.svg") for name in icons):
        problems.append("the AppDir root icon is the -symbolic glyph, not the application's face")

    if problems:
        for problem in problems:
            print(f"  ✗ {problem}")
        fail("the AppImage does not reproduce the staged payload")

    print(f"{len(planned)} staged path(s) inside the image at exactly the planned mode, plus AppRun, entry and icon")


if __name__ == "__main__":
    main(sys.argv)
