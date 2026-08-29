#!/usr/bin/env python3
r"""Read a staged Windows program directory back, with a reader that is not ours.

WHY THIS FILE EXISTS, and what it can honestly claim. A `<App>.app` has one file
that makes it a bundle, so its oracle is a plist parser. A Windows program
directory has NO metadata file at all — what a Windows installer says about an
application lives in the `.msi`'s own tables (#1354 M5) — so there is nothing here
to parse and the two halves that CAN be read back are different questions:

  1. **the launcher**, which `gjsify ship` writes by hand
     (`packages/infra/cli/src/utils/ship/launcher.ts`). Its authoritative reader is
     `cmd.exe`, and nothing on Linux is one. What this script asserts instead is
     everything about the file that is decidable without running it: that it is
     CRLF and ASCII (`cmd.exe` re-seeks a batch file by byte OFFSET while it runs,
     and reads it in the console's active code page), and that the interpreter its
     last command names is a file the directory actually CARRIES. That last one is
     the launcher's whole promise, and nothing else in the pipeline compares the
     two: `assertLauncherMatchesInterpreter` compares the launcher with the
     DECLARATION, not with the tree.
  2. **the images the directory carries**, which are `node.exe` from nodejs.org
     and a gvsbuild DLL closure — files this project does not write and therefore
     files whose headers are worth reading back to prove the STAGING put the right
     ones there. `struct` is CPython's; the two PE readers in this repository
     (`utils/ship/payload.ts`'s `readBinaryArch` and
     `manifest-conformance/lib/binary.mjs`'s `readPe`) are ours, and this is a
     third opinion in another language.

WHAT IT DOES NOT CLAIM, stated here so a green run is not read as more than it is.
A PE records its imports in a data directory reached through the section table and
the RVA map, and nothing in this repository parses one — `binary.mjs` returns
`inspectable: false` on purpose. So "every DLL this directory needs is inside it"
has exactly one reader, `LoadLibrary`, on Windows, and it is
`.github/workflows/node-gi.yml`'s `windows-dir-selfcontained` leg. The macOS
sibling of this suite CAN make that claim from Linux because Mach-O records its
dependencies as strings; this one cannot, and pretending otherwise would be the
more expensive mistake.

THE ONE MEASUREMENT NOBODY ELSE CAN MAKE is printed rather than judged: the
interpreter's PE `Subsystem`. `node.exe` is a CONSOLE-subsystem image and
`nodew.exe` does not exist in the Node release, so a GUI launch of this artifact
pops a console window — and no CI leg can observe that, because every Windows leg
starts the app from a shell and therefore inherits one. Printing the field turns
an assumption into a number the suite reads back (#1354 M3).

THE EXPECTATIONS ARE DERIVED, never written down here — same rule as
`verify-app-plist.py`. Every value comes out of the stage's own
`.gjsify-ship-stage.json`, produced by a different code path
(`utils/ship/stage-manifest.ts`) from the launcher and the staging, so this is two
independently written descriptions of one artifact being made to agree.

Reproduce by hand:

    python3 .github/ship-oracle/verify-program-dir.py \
        "ship/out/Ship Demo" ship/stage/.gjsify-ship-stage.json

DISCRIMINATOR (run it, do not trust it): delete the `node.exe` the launcher names
and this must exit 1 saying the launcher execs a file the directory does not
carry; rewrite the `.cmd` with LF endings and it must exit 1; swap one staged DLL
for an arm64 one and the machine check must exit 1 naming the file. All three are
driven from `tests/e2e/ship-windows/run.mjs` against copies of the artifact, so
the failure path of this file runs on every PR.
"""

import json
import re
import struct
import sys
from pathlib import Path

# `IMAGE_FILE_HEADER.Machine` → the `process.arch` spelling the stage manifest
# uses. The same three rows the CLI and `binary.mjs` carry; the constants are
# Microsoft's, so agreeing with them is not a copy of our own answer.
PE_MACHINE = {0x014C: "ia32", 0x8664: "x64", 0xAA64: "arm64"}

# `IMAGE_SUBSYSTEM_*`. 2 is the one a GUI application wants; 3 is what `node.exe`
# is, and there is no `nodew.exe` in the Node release to be the other.
SUBSYSTEM = {2: "GUI", 3: "CONSOLE"}

# Suffixes that are loadable code on Windows. `.node` is an N-API addon, which is
# a DLL with another name — node-gi's `node_gi.node` is exactly that.
IMAGE_SUFFIXES = (".exe", ".dll", ".node")


def fail(message):
    print(f"::error title=Ship program directory::{message}")
    return 1


def read_pe(path):
    """`(machine, subsystem)` for one PE image, or a string saying why not.

    Two seeks and four `struct.unpack`s: `e_lfanew` at 0x3C, the `PE\\0\\0`
    signature it points at, `Machine` four bytes past that, and `Subsystem` 68
    bytes into the optional header (which starts 20 bytes past the COFF header, at
    the same place for PE32 and PE32+). Measured against
    `node-v24.20.0-win-x64.zip`'s `node.exe`: `e_lfanew` 0x78, so `Subsystem` at
    0xD4.
    """
    data = path.read_bytes()
    if len(data) < 0x40 or data[:2] != b"MZ":
        return f"{path.name} does not start with `MZ` — it is not a PE image"
    (pe_off,) = struct.unpack_from("<I", data, 0x3C)
    if pe_off + 24 > len(data):
        return f"{path.name} has an e_lfanew ({pe_off}) past the end of the file"
    if data[pe_off : pe_off + 4] != b"PE\0\0":
        return f"{path.name} has no `PE\\0\\0` signature at e_lfanew"
    (machine,) = struct.unpack_from("<H", data, pe_off + 4)
    (opt_size,) = struct.unpack_from("<H", data, pe_off + 4 + 16)
    if opt_size < 70:
        return f"{path.name} has a {opt_size}-byte optional header, too short to carry a Subsystem"
    (subsystem,) = struct.unpack_from("<H", data, pe_off + 24 + 68)
    return (machine, subsystem)


def main(argv):
    if len(argv) != 3:
        print(f"usage: {argv[0]} <program directory> <stage-manifest.json>", file=sys.stderr)
        return 2
    root = Path(argv[1])
    manifest = json.loads(Path(argv[2]).read_text(encoding="utf-8"))
    settings = manifest["settings"]
    target = manifest["target"]

    if not root.is_dir():
        return fail(f"{root} is not a directory — this script reads the program directory `windows-dir` writes")
    if target["os"] != "win32":
        return fail(f"the stage manifest says os={target['os']!r}; this reader is for the windows layout")

    # ── 1. the launcher, as bytes ────────────────────────────────────────────
    launcher = root / f"{settings['binaryName']}.cmd"
    if not launcher.is_file():
        return fail(
            f"{launcher} does not exist. A program directory with no `.cmd` at its root is a directory of "
            "files — nothing in it tells Windows what to start."
        )
    raw = launcher.read_bytes()
    try:
        text = raw.decode("ascii")
    except UnicodeDecodeError as error:
        return fail(
            f"{launcher.name} is not ASCII ({error}). `cmd.exe` reads a batch file in the console's active "
            "code page, not as UTF-8, so a non-ASCII byte is whatever that page says it is."
        )
    if re.search(rb"(?<!\r)\n", raw):
        return fail(
            f"{launcher.name} carries a bare LF. `cmd.exe` reads a batch file in chunks and re-seeks by byte "
            "OFFSET while it runs, which is where the documented `goto` and block-parsing failures on LF-only "
            "files come from."
        )

    # ── 2. the interpreter the launcher NAMES has to be in the directory ─────
    # The last non-empty line is the command `cmd.exe` runs, and its exit status
    # is the script's — batch has no `exec` to anchor on. `%HERE%` is `%~dp0`,
    # which always ends in a separator, so the token is the program's path
    # relative to this directory.
    commands = [line.strip() for line in text.splitlines() if line.strip()]
    run = commands[-1] if commands else ""
    quoted = re.match(r'^"([^"]*)"', run)
    token = quoted.group(1) if quoted else run.split()[0] if run.split() else ""
    if not token.startswith("%HERE%"):
        return fail(
            f"the last command of {launcher.name} runs {token!r}, which is not a path inside the program "
            "directory. A launcher naming a bare interpreter finds it on PATH or not at all, and Windows "
            "ships neither node nor gjs — see `Layout.runtimeGap`."
        )
    interpreter = root / token[len("%HERE%") :].replace("\\", "/")
    if not interpreter.is_file():
        return fail(
            f"{launcher.name} runs {token}, and {interpreter} is not in the artifact. The launcher promises "
            "an interpreter the directory carries; this one carries nothing."
        )

    # ── 3. every image the directory carries ─────────────────────────────────
    images = sorted(p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES)
    if not images:
        return fail(
            "the program directory carries no PE image at all. A directory of JavaScript is not a "
            "self-contained application — it would need a Node and a GTK on the machine, which Windows has "
            "neither of."
        )
    bad = []
    for image in images:
        read = read_pe(image)
        if isinstance(read, str):
            bad.append(read)
            continue
        machine, _subsystem = read
        arch = PE_MACHINE.get(machine)
        if arch != target["arch"]:
            named = arch or f"machine 0x{machine:04x}"
            bad.append(f"{image.relative_to(root)} is {named}, and the stage is labelled {target['arch']}")
    if bad:
        print("::error title=Ship program directory::the staged images disagree with the stage manifest")
        for row in bad:
            print(f"  {row}")
        return 1

    # ── 4. the console-window measurement, PRINTED and not judged ────────────
    # No CI leg can observe the defect this names: every Windows leg starts the
    # app from a shell and inherits a console, so a GUI launch popping one is
    # invisible there. Reporting the field is what makes it a number instead of an
    # assumption — see this file's header and status/open-todos.md.
    read = read_pe(interpreter)
    _machine, subsystem = read
    kind = SUBSYSTEM.get(subsystem, f"subsystem {subsystem}")

    print(
        f"verify-program-dir.py: {launcher.name} runs {token} (CRLF, ASCII), "
        f"{len(images)} PE image(s) all {target['arch']}, interpreter subsystem {subsystem} ({kind})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
