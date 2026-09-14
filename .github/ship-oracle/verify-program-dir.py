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

THE MEASUREMENT NO CI LEG CAN MAKE is now two fields, one judged and one printed.

  * JUDGED: the GUI launcher's `Subsystem` must be 2. `node.exe` is a
    CONSOLE-subsystem image and the Node release ships no `nodew.exe`, and the
    `.cmd` is run by `cmd.exe`, which is a console image too — so the program
    directory carries a third launcher whose only job is to have the other value
    in that field (`packages/infra/cli/src/utils/ship/pe-launcher.ts`, ADR 0040).
    That is a claim about a file this repository WRITES, so it is asserted rather
    than printed, and it is asserted here because the two PE readers that would
    otherwise see the file only read `Machine`.
  * PRINTED: the interpreter's own `Subsystem`, still 3, still not a defect —
    `node.exe` never becomes the thing a user double-clicks.

Neither can be observed by running the app in CI: every Windows leg starts it from
a shell and therefore already has a console. The window measurement that closed
this was made by hand on `win11-gjsify`, in session 1, by diffing the visible
top-level window list around each launch — the `.cmd` adds two console-host
windows and the `.exe` adds none.

THE EXPECTATIONS ARE DERIVED, never written down here — same rule as
`verify-app-plist.py`. Every value comes out of the stage's own
`.gjsify-ship-stage.json`, produced by a different code path
(`utils/ship/stage-manifest.ts`) from the launcher and the staging, so this is two
independently written descriptions of one artifact being made to agree.

Reproduce by hand:

    python3 .github/ship-oracle/verify-program-dir.py \
        "ship/out/Ship Demo" ship/stage/.gjsify-ship-stage.json

DISCRIMINATOR (run it, do not trust it): delete the `node.exe` the launcher names
and this must exit 1 saying the launcher runs a file the directory does not carry;
rewrite the `.cmd` with LF endings and it must exit 1; replace one staged image
with an arm64 one and the machine check must exit 1 naming the file; make the
launcher run a bare name off `PATH` — which is what M1 wrote — and it must exit 1;
rewrite the GUI launcher's `Subsystem` back to 3 and it must exit 1; empty the
launcher's resource data directory and it must exit 1 saying the launcher carries
no icon; corrupt one embedded PNG and it must exit 1 naming the RT_ICON. All are
driven from `tests/e2e/ship-windows/run.mjs` against copies of the artifact, so the
failure path of this file runs on every PR.

THE ICON IS THE THIRD JUDGED FIELD (section 4b). Two readers of a different
family than the writer: this file's own `struct` walk of the resource tree, which
reassembles the `.ico` and inflates every PNG (`png_check.py`), and binutils'
`objdump -p`, whose tree print must agree on the types and the leaf count. Both
are in the CI image. Pillow, `icotool` and ImageMagick are NOT, and are therefore
not consulted here — the reassembled `.ico` is written beside the directory so a
workstation can hand it to them.
"""

import json
import re
import struct
import subprocess
import sys
from pathlib import Path

# Beside this file; `sys.path[0]` is the script's directory when run as one.
from png_check import check_png

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

# The resource types an application icon is: `RT_ICON` holds one image,
# `RT_GROUP_ICON` the directory that names them by id. Microsoft's numbers.
RT_ICON = 3
RT_GROUP_ICON = 14
DIRECTORY_ENTRY_RESOURCE = 2

# The sizes Windows draws an application icon at and the ones a set must not
# miss: 16 (Explorer list, taskbar at 100 %), 32 (Start menu, Alt-Tab), 48
# (Explorer medium), 256 (Explorer extra large, and what every other size is
# scaled from when its own is absent). Microsoft's "Icons (Design basics)"
# guidance calls these four the full set for a classic desktop application; the
# writer adds 24 and 64 for scaling, and more is welcome, fewer is a blur.
ICON_MINIMUM = (16, 32, 48, 256)


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
    if pe_off + 24 + 70 > len(data):
        return f"{path.name} has an e_lfanew ({pe_off}) past the end of the file"
    if data[pe_off : pe_off + 4] != b"PE\0\0":
        return f"{path.name} has no `PE\\0\\0` signature at e_lfanew"
    (machine,) = struct.unpack_from("<H", data, pe_off + 4)
    (opt_size,) = struct.unpack_from("<H", data, pe_off + 4 + 16)
    if opt_size < 70:
        return f"{path.name} has a {opt_size}-byte optional header, too short to carry a Subsystem"
    (subsystem,) = struct.unpack_from("<H", data, pe_off + 24 + 68)
    return (machine, subsystem)


def rva_to_offset(data, pe_off, rva):
    """Map an RVA to a file offset through the section table, as a loader would."""
    (sections,) = struct.unpack_from("<H", data, pe_off + 6)
    (opt_size,) = struct.unpack_from("<H", data, pe_off + 20)
    table = pe_off + 24 + opt_size
    for index in range(sections):
        at = table + index * 40
        virtual_size, virtual_address, raw_size, raw_offset = struct.unpack_from("<IIII", data, at + 8)
        if virtual_address <= rva < virtual_address + max(virtual_size, raw_size):
            return raw_offset + (rva - virtual_address)
    raise ValueError(f"RVA 0x{rva:x} lies in no section")


def read_icon_resources(path):
    """The `.ico` the launcher's resource directory amounts to, or a string saying why not.

    Walks `IMAGE_DIRECTORY_ENTRY_RESOURCE` the way `FindResource` does — type,
    then id, then language — with `struct` and the RVA map above. Returns
    `(ico_bytes, sizes)` where `ico_bytes` is the ICONDIR file form reassembled
    from the group and the images (which is what an independent reader opens),
    and `sizes` the edge lengths in group order. Every image is put through
    `check_png` on the way: a PNG that does not inflate is a slot Windows shows
    the generic icon for.
    """
    data = path.read_bytes()
    (pe_off,) = struct.unpack_from("<I", data, 0x3C)
    (opt_size,) = struct.unpack_from("<H", data, pe_off + 20)
    (magic,) = struct.unpack_from("<H", data, pe_off + 24)
    directories = pe_off + 24 + (112 if magic == 0x20B else 96)
    if opt_size < (112 if magic == 0x20B else 96) + 8 * (DIRECTORY_ENTRY_RESOURCE + 1):
        return f"{path.name} has no resource data directory slot at all"
    rsrc_rva, rsrc_size = struct.unpack_from("<II", data, directories + 8 * DIRECTORY_ENTRY_RESOURCE)
    if rsrc_rva == 0 or rsrc_size == 0:
        return (
            f"{path.name} names no resource directory (IMAGE_DIRECTORY_ENTRY_RESOURCE is empty), so it carries "
            "no icon. Every shortcut, the Start menu and Explorer show the generic blank-document icon for it."
        )
    try:
        base = rva_to_offset(data, pe_off, rsrc_rva)
    except ValueError as error:
        return f"{path.name}: the resource directory {error}"

    def entries(offset):
        named, ids = struct.unpack_from("<HH", data, base + offset + 12)
        out = []
        for index in range(named + ids):
            name, target = struct.unpack_from("<II", data, base + offset + 16 + index * 8)
            out.append((name, target & 0x7FFFFFFF, bool(target & 0x80000000)))
        return out

    leaves = {}
    for type_id, type_offset, subdir in entries(0):
        if not subdir:
            return f"{path.name}: resource type {type_id} points at data instead of a name table"
        names = entries(type_offset)
        ids = [name for name, _, _ in names]
        if ids != sorted(ids):
            # The loader binary-searches; an unsorted table is one it may not find an entry in.
            return f"{path.name}: resource type {type_id} lists ids {ids}, which are not ascending"
        for name_id, name_offset, subdir in names:
            if not subdir:
                return f"{path.name}: resource {type_id}/{name_id} points at data instead of a language table"
            for _language, leaf_offset, subdir in entries(name_offset):
                if subdir:
                    return f"{path.name}: resource {type_id}/{name_id} has a fourth directory level"
                rva, size = struct.unpack_from("<II", data, base + leaf_offset)
                try:
                    at = rva_to_offset(data, pe_off, rva)
                except ValueError as error:
                    # THE CLASSIC MISTAKE, named: a file offset written where the
                    # format wants an RVA lands here, in no section.
                    return f"{path.name}: resource {type_id}/{name_id}'s data entry {error} — a file offset where an RVA belongs?"
                leaves[(type_id, name_id)] = data[at : at + size]

    groups = [key for key in leaves if key[0] == RT_GROUP_ICON]
    if len(groups) != 1:
        return f"{path.name} carries {len(groups)} RT_GROUP_ICON resource(s); an application icon is exactly one"
    group = leaves[groups[0]]
    reserved, kind, count = struct.unpack_from("<HHH", group, 0)
    if reserved != 0 or kind != 1 or count == 0:
        return f"{path.name}: the RT_GROUP_ICON is not an icon group (reserved={reserved}, type={kind}, count={count})"
    if len(group) != 6 + 14 * count:
        # 16-byte entries here is the `.ico` FILE form written into the resource,
        # which Windows reads as ids that name nothing.
        return f"{path.name}: the RT_GROUP_ICON is {len(group)} bytes for {count} entries; 14-byte entries make {6 + 14 * count}"
    images = []
    sizes = []
    for index in range(count):
        width, height, _colours, _reserved, planes, bits, size, image_id = struct.unpack_from(
            "<BBBBHHIH", group, 6 + index * 14
        )
        image = leaves.get((RT_ICON, image_id))
        if image is None:
            return f"{path.name}: the icon group names RT_ICON {image_id}, which the directory does not carry"
        if len(image) != size:
            return f"{path.name}: the icon group says RT_ICON {image_id} is {size} bytes; it is {len(image)}"
        try:
            png_width, png_height = check_png(image, f"RT_ICON {image_id}")
        except ValueError as error:
            return f"{path.name}: {error}"
        declared = (width or 256, height or 256)
        if (png_width, png_height) != declared:
            return (
                f"{path.name}: the icon group declares RT_ICON {image_id} as {declared[0]}x{declared[1]} and "
                f"the PNG inside is {png_width}x{png_height}"
            )
        if png_width != png_height:
            return f"{path.name}: RT_ICON {image_id} is {png_width}x{png_height}, not square"
        images.append((width, height, planes, bits, image))
        sizes.append(png_width)

    # The `.ico` file form: ICONDIR, 16-byte entries with file offsets, then the images.
    ico = bytearray(struct.pack("<HHH", 0, 1, count))
    offset = 6 + 16 * count
    for width, height, planes, bits, image in images:
        ico += struct.pack("<BBBBHHII", width, height, 0, 0, planes, bits, len(image), offset)
        offset += len(image)
    for _width, _height, _planes, _bits, image in images:
        ico += image
    return bytes(ico), sizes


def objdump_resource_tree(path):
    """binutils' own count of RT_ICON leaves under the launcher, or a string saying why none.

    `objdump -p` (`pei-x86-64`) prints the resource directory as a tree —
    `Type Table`, `Entry: ID: 0x000003`, `Leaf: Addr: …` — from a parser that
    shares nothing with `read_icon_resources` above or with the writer. It is in
    the CI image (`binutils`), so this is the second family on every run.
    """
    try:
        out = subprocess.run(["objdump", "-p", str(path)], capture_output=True, text=True, check=False)
    except FileNotFoundError:
        return "objdump is not on PATH; it is the second reader of the icon resource tree and skipping it would leave one"
    if out.returncode != 0:
        return f"objdump -p {path.name} exited {out.returncode}: {out.stderr.strip()}"
    if "Resource Directory section" not in out.stdout:
        return f"objdump -p {path.name} prints no resource directory section"
    # The TYPE table's entries and nothing below them. objdump indents by
    # level — three spaces after the offset for a type entry, five for a name,
    # seven for a language — and the first attempt at this regex matched all
    # three, reporting types [1, 1, 2, 3, 3, 4, 5, 6, 14] for a correct tree.
    types = re.findall(r"^[0-9a-f]+ {3}Entry: ID: 0x([0-9a-f]+), Value: 0x8", out.stdout, re.M)
    leaves = out.stdout.count(" Leaf: Addr:")
    return sorted(int(value, 16) for value in types), leaves


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

    # ── 4. the GUI launcher, JUDGED ──────────────────────────────────────────
    # The file the console-window fix IS. Its name is the launcher's with `.exe`
    # for `.cmd` — not a convention this script chose, but the one the stub
    # depends on: it finds its `.cmd` by rewriting the last three characters of
    # its own module filename.
    gui = root / f"{settings['binaryName']}.exe"
    if not gui.is_file():
        return fail(
            f"{gui} does not exist. A program directory whose only entry point is a `.cmd` gives every "
            "double-click and every installer shortcut a console window, because `cmd.exe` is a "
            "console-subsystem image (ADR 0024 § M3, ADR 0040)."
        )
    read = read_pe(gui)
    if isinstance(read, str):
        return fail(read)
    gui_machine, gui_subsystem = read
    if gui_subsystem != 2:
        return fail(
            f"{gui.name} has Subsystem {gui_subsystem} ({SUBSYSTEM.get(gui_subsystem, '?')}), and the whole "
            "point of the file is that it is 2 (GUI). At 3 Windows allocates a console for it exactly as it "
            "does for the `.cmd`, and the artifact is back to a black window behind every launch."
        )
    if PE_MACHINE.get(gui_machine) != target["arch"]:
        return fail(f"{gui.name} is machine 0x{gui_machine:04x}, and the stage is labelled {target['arch']}")

    # ── 4b. the icon inside the GUI launcher, JUDGED for an application ──────
    # The file the shortcut, Explorer and the Start menu ask for their icon, and
    # the measured defect of one released app: a launcher with no resource
    # directory at all and a generic blank-document Start-menu entry (Windows 11,
    # Learn6502 0.8.0). A CLI project ships no icon and is owed none; an `app`
    # carries one or the stage is refused (`utils/ship/layout.ts`) — so for an
    # app, its ABSENCE here is a defect of the pipeline and is judged.
    # DERIVED FROM THE ARTIFACT, not read from the manifest: `PackSettings`
    # carries no `kind` by design (`utils/ship/types.ts` lists it among the
    # phase-1-only fields), and the tree already states it — an application
    # stages its desktop entry, a CLI stages none. The entry and the icon are
    # two independently written claims about one payload being made to agree.
    desktop_entry = root / "share" / "applications" / f"{settings['appId']}.desktop"
    is_app = desktop_entry.is_file()
    icon_summary = "no icon (no desktop entry, so a CLI)"
    if is_app:
        icon = read_icon_resources(gui)
        if isinstance(icon, str):
            return fail(icon)
        ico, sizes = icon
        missing = [size for size in ICON_MINIMUM if size not in sizes]
        if missing:
            return fail(
                f"{gui.name} carries an icon at {sorted(sizes)} px and none at {missing}; Windows scales the "
                "nearest size for those slots, which is the blur every half-ported app has. The writer "
                "(`utils/ship/ico.ts`) embeds 16/24/32/48/64/256."
            )
        tree = objdump_resource_tree(gui)
        if isinstance(tree, str):
            return fail(tree)
        objdump_types, objdump_leaves = tree
        if objdump_types != [RT_ICON, RT_GROUP_ICON] or objdump_leaves != len(sizes) + 1:
            return fail(
                f"objdump -p reads {gui.name}'s resource tree as types {objdump_types} with {objdump_leaves} "
                f"leaf/leaves, and the CPython walk found types [{RT_ICON}, {RT_GROUP_ICON}] with {len(sizes) + 1} — "
                "two readers disagreeing about one tree is a tree at least one of them cannot use"
            )
        # The `.ico` file form, beside the directory, for whoever wants to open it
        # in a third reader (Pillow, icotool, ImageMagick — none in the CI image).
        ico_path = root.parent / f"{root.name}.icon-from-exe.ico"
        ico_path.write_bytes(ico)
        icon_summary = f"icon: {len(sizes)} PNG image(s) at {'/'.join(str(size) for size in sizes)} px, objdump agrees, ico at {ico_path.name}"

    # ── 5. the interpreter's own subsystem, PRINTED and not judged ───────────
    # Still 3, still not a defect: `node.exe` is what the `.cmd` execs, never what
    # a user starts. Reporting the field is what keeps that a number rather than
    # an assumption — see this file's header.
    read = read_pe(interpreter)
    if isinstance(read, str):
        # Only reachable when the launcher runs something that is not a PE at all
        # — `%HERE%app\\run.mjs`, or an extensionless `%HERE%node`, neither of which
        # section 3's suffix filter looked at. Without this branch the unpack below
        # raises a ValueError traceback instead of an ::error annotation, which is
        # a failure a reader of the log cannot act on.
        return fail(read)
    _machine, subsystem = read
    kind = SUBSYSTEM.get(subsystem, f"subsystem {subsystem}")

    print(
        f"verify-program-dir.py: {launcher.name} runs {token} (CRLF, ASCII), "
        f"{len(images)} PE image(s) all {target['arch']}, {gui.name} subsystem 2 (GUI), "
        f"interpreter subsystem {subsystem} ({kind}), {icon_summary}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
