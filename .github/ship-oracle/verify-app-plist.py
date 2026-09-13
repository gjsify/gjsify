#!/usr/bin/env python3
"""Read a staged `<App>.app` back as a BUNDLE, with a parser that is not ours.

WHY THIS FILE EXISTS. `gjsify ship darwin` writes `Contents/Info.plist` by hand
(`packages/infra/cli/src/utils/ship/plist.ts`) — XML assembled from string
concatenation, no plist library anywhere in the tree. A `.app` without that file
is a directory whose name ends in `.app`, which is what #1354 M1 staged and what
M2a closes, so the file's mere presence proves nothing: it has to PARSE, and it
has to parse under something that did not write it.

WHY `plistlib` AND NOT THE TOOL A READER REACHES FOR FIRST. Measured on Fedora
44, against a `<dict>` whose `<key>` has no value:

    plutil                                    ABSENT — macOS-only
    plistutil -i bad.plist -f xml -o -        exit 0, prints `<dict/>`
    xmllint --noout bad.plist                 exit 0 (well-formedness only)
    xmllint --noout --valid --nonet ok.plist  exit 4 (the DTD is a remote URL)
    python3 -c 'plistlib.load(...)'           exit 1, "missing value for key 'A'"

`plistutil` SWALLOWS the malformed file and emits an empty dict at exit 0 — the
green-that-checked-nothing shape, in the exact place an oracle was going to go.
`xmllint --valid` exits 4 on a CORRECT plist too, so it is a constant and not a
reader. CPython's `plistlib` is a different implementation family, it refuses the
malformed file naming the line, and `python3` is baked into
`.docker/ci-fedora.Dockerfile` while `plistutil` is not in it at all.

THE EXPECTATIONS ARE DERIVED, never written down here. Every value is read out of
the stage's own `.gjsify-ship-stage.json`, which is produced by a different code
path (`utils/ship/stage-manifest.ts`) from the plist (`utils/ship/plist.ts`). A
constant in this file would only ever agree with itself; this way the check is
two independently written descriptions of one app being made to agree.

Reproduce by hand:

    python3 .github/ship-oracle/verify-app-plist.py \\
        "ship/stage/Ship Demo.app" ship/stage/.gjsify-ship-stage.json

DISCRIMINATOR (run it, do not trust it): truncate `Contents/Info.plist` after its
opening `<dict>` and this must exit 1 with plistlib's own parse error; change one
character of `CFBundleIdentifier` and it must exit 1 naming the key; delete the
`.icns` and it must exit 1 calling the key a dangling reference; strip the key and
it must exit 1 naming the generic icon; corrupt one element's PNG and it must exit
1 naming the element. All are driven from `tests/e2e/ship-macos/run.mjs`, which
mutates a COPY of the bundle, so the failure path of this file runs on every PR
rather than on the day it is needed.

THE ICON IS READ WITH ONE INDEPENDENT FAMILY ON LINUX, and that is said here
rather than implied by a green run: CPython walks the `.icns` element table and
inflates every PNG (`read_icns`, `png_check.py`). `icns2png` (libicns 0.8.1)
refuses seven of the ten element types by name — measured — and Pillow, which
reads all ten, is not in the CI image. The reader with authority is Apple's
`iconutil -c iconset`, which is a run on a Mac and not a CI leg.
"""

import json
import plistlib
import struct
import sys
from pathlib import Path

# Beside this file; `sys.path[0]` is the script's directory when run as one.
from png_check import check_png

# `CFBundlePackageType` and `CFBundleSignature` are constants of the FORMAT, not
# of this app, so they are the two values that cannot come from the sidecar.
# `refs/node/tools/gyp/pylib/gyp/mac_tool.py:232` writes a PkgInfo only when the
# type is `APPL`; line 239 defaults the signature to `????`.
PACKAGE_TYPE = "APPL"
SIGNATURE = "????"
# `refs/node/tools/gyp/pylib/gyp/mac_tool.py:245` — `fp.write(f"{type}{sig}")`,
# eight bytes and no terminator.
PKGINFO_BYTES = 8

# The ten PNG-backed element types of an application `.icns` and the pixel size
# each holds — Apple's `iconutil` vocabulary, cross-checked against Pillow 12.3's
# `IcnsImagePlugin.SIZES`. A modern icon is exactly these; `utils/ship/icns.ts`
# writes them in this order.
ICNS_ELEMENTS = {
    b"icp4": 16,
    b"ic11": 32,
    b"icp5": 32,
    b"ic12": 64,
    b"ic07": 128,
    b"ic13": 256,
    b"ic08": 256,
    b"ic14": 512,
    b"ic09": 512,
    b"ic10": 1024,
}


def fail(message):
    print(f"::error title=Ship .app::{message}")
    return 1


def read_icns(path):
    """`{type: size}` for every PNG-backed element of an `.icns`, or a string saying why not.

    The container is a big-endian tagged list: `icns` + total length, then
    elements of `type` + length (including the 8-byte head) + data. Every element
    whose type is in `ICNS_ELEMENTS` must hold a whole PNG of exactly that size —
    `check_png` inflates it — and the total length must be the file's. This is
    CPython over the format; `icns2png` (libicns 0.8.1) parses three of the ten
    types and Pillow is not in the CI image, so on Linux this walk is the one
    independent reader, and `iconutil` on a Mac is the one with authority.
    """
    data = path.read_bytes()
    if len(data) < 8 or data[:4] != b"icns":
        return f"{path.name} does not start with the `icns` magic"
    (total,) = struct.unpack_from(">I", data, 4)
    if total != len(data):
        return f"{path.name} says it is {total} bytes and is {len(data)}"
    found = {}
    at = 8
    while at < len(data):
        if at + 8 > len(data):
            return f"{path.name} ends inside an element head at offset {at}"
        kind = data[at : at + 4]
        (length,) = struct.unpack_from(">I", data, at + 4)
        if length < 8 or at + length > len(data):
            return f"{path.name}: element {kind!r} at offset {at} claims {length} bytes, past the end"
        body = data[at + 8 : at + length]
        if kind in ICNS_ELEMENTS:
            try:
                width, height = check_png(body, f"element {kind.decode('latin1')}")
            except ValueError as error:
                return f"{path.name}: {error}"
            want = ICNS_ELEMENTS[kind]
            if (width, height) != (want, want):
                return f"{path.name}: element {kind.decode('latin1')} holds a {width}x{height} PNG and the type means {want}x{want}"
            if kind in found:
                return f"{path.name} carries element {kind.decode('latin1')} twice"
            found[kind] = want
        at += length
    return found


def main(argv):
    if len(argv) != 3:
        print(f"usage: {argv[0]} <App.app> <stage-manifest.json>", file=sys.stderr)
        return 2
    bundle = Path(argv[1])
    settings = json.loads(Path(argv[2]).read_text(encoding="utf-8"))["settings"]

    info = bundle / "Contents" / "Info.plist"
    if not info.is_file():
        return fail(
            f"{info} does not exist. A directory named `*.app` with no Info.plist is not a bundle — "
            "LaunchServices has nothing to tell it which file under Contents/MacOS to exec, and the "
            "Finder shows it as a folder."
        )

    # The parse itself is the first assertion. A `ValueError` here is the oracle
    # working: it is raised by a reader in another language, over bytes this
    # repository's own string concatenation produced.
    try:
        plist = plistlib.load(info.open("rb"))
    except Exception as error:  # noqa: BLE001 — the type is plistlib's business, the refusal is ours
        return fail(f"plistlib refused {info}: {error}")

    # Sidecar → plist. `CFBundleVersion` is the only one that is not a field
    # copied across: it is `<version>-<release>`, because Apple's short string is
    # the marketing version and `CFBundleVersion` is the build, and this command
    # already has that exact pair.
    expected = {
        "CFBundleExecutable": settings["binaryName"],
        "CFBundleIdentifier": settings["appId"],
        "CFBundleName": settings["name"],
        "CFBundleDisplayName": settings["name"],
        "CFBundleShortVersionString": settings["version"],
        "CFBundleVersion": f"{settings['version']}-{settings['release']}",
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundlePackageType": PACKAGE_TYPE,
        "CFBundleSignature": SIGNATURE,
        "CFBundleDevelopmentRegion": "en",
        "CFBundleSupportedPlatforms": ["MacOSX"],
    }
    bad = []
    for key, want in sorted(expected.items()):
        if key not in plist:
            bad.append(f"{key}: absent; the stage says it should be {want!r}")
        elif plist[key] != want:
            bad.append(f"{key}: plist says {plist[key]!r}, the stage says {want!r}")
    if bad:
        print(f"::error title=Ship .app::{info} and the stage manifest describe different applications")
        for row in bad:
            print(f"  {row}")
        return 1

    # KEYS THIS MILESTONE DELIBERATELY DOES NOT EMIT, asserted absent rather than
    # left unmentioned. Asserting the absence is what keeps "we decided not to"
    # from decaying into "somebody added it untested". `CFBundleIconFile` left
    # this list when the `.icns` writer landed with the readers below; the
    # asset-catalog key `CFBundleIconName` joins it, because there is no
    # `Assets.car` for such a name to point into.
    for key in ("CFBundleIconName", "LSMinimumSystemVersion", "NSHighResolutionCapable"):
        if key in plist:
            return fail(
                f"{info} carries {key}, which this tree does not emit and no reader here can check. "
                "If it is now justified, cite the file it was read off and give it a test — see "
                "packages/infra/cli/src/utils/ship/plist.ts."
            )

    # ── the icon: BOTH halves, for an application ────────────────────────────
    # The key without the file is a dangling reference the Finder answers with
    # the generic icon; the file without the key is bytes nothing reads. Measured
    # on the released 0.8.0 bundle of one app on macOS 15.7: no key, no `.icns`,
    # generic icon. A CLI bundle is owed neither and must carry neither.
    # DERIVED FROM THE BUNDLE, not read from the manifest: `PackSettings` carries
    # no `kind` by design (`utils/ship/types.ts`), and the tree already states it
    # — an application stages its desktop entry under `Contents/Resources/share`,
    # a CLI stages none. Two independently written claims about one payload.
    desktop_entry = bundle / "Contents" / "Resources" / "share" / "applications" / f"{settings['appId']}.desktop"
    is_app = desktop_entry.is_file()
    icon_summary = "no icon (no desktop entry, so a CLI)"
    if is_app:
        icon_name = plist.get("CFBundleIconFile")
        if not icon_name:
            return fail(
                f"{info} carries no CFBundleIconFile, so the Finder shows the generic application icon for "
                f"{bundle.name} — the released-0.8.0 shape this key exists against"
            )
        icon_file = bundle / "Contents" / "Resources" / icon_name
        if not icon_file.is_file():
            return fail(
                f"CFBundleIconFile names {icon_name}, and {icon_file} does not exist — a dangling reference, "
                "which macOS resolves to the generic icon with no diagnostic"
            )
        elements = read_icns(icon_file)
        if isinstance(elements, str):
            return fail(elements)
        missing = [kind.decode("latin1") for kind in ICNS_ELEMENTS if kind not in elements]
        if missing:
            return fail(
                f"{icon_file.name} lacks element(s) {missing} of the ten a modern application icon carries — "
                "the Finder picks by (size, scale) and draws the generic icon for a pair it cannot find"
            )
        icon_summary = f"icon: {icon_name} with {len(elements)} PNG elements ({min(elements.values())}..{max(elements.values())} px)"
    elif "CFBundleIconFile" in plist:
        return fail(f"{info} names an icon for a bundle with no desktop entry (a CLI), which stages none — the key would dangle")

    # The executable the plist NAMES has to be there and has to be executable.
    # This is the assertion that distinguishes a bundle from a well-formed XML
    # file: LaunchServices execs exactly this path, and nothing else in the
    # pipeline compares the two.
    exe = bundle / "Contents" / "MacOS" / plist["CFBundleExecutable"]
    if not exe.is_file():
        return fail(f"CFBundleExecutable names {plist['CFBundleExecutable']}, and {exe} does not exist")
    if not exe.stat().st_mode & 0o111:
        return fail(f"{exe} is not executable ({exe.stat().st_mode & 0o777:04o}) — the bundle would not start")

    pkginfo = bundle / "Contents" / "PkgInfo"
    if not pkginfo.is_file():
        return fail(f"{pkginfo} does not exist")
    raw = pkginfo.read_bytes()
    if raw != f"{PACKAGE_TYPE}{SIGNATURE}".encode("ascii"):
        # Byte-exact, and the commonest way to be wrong is a trailing newline —
        # nine bytes where the format says eight, which nothing complains about
        # and every byte comparison notices.
        return fail(f"{pkginfo} is {len(raw)} byte(s) {raw!r}; the format is {PKGINFO_BYTES} bytes, no terminator")

    print(f"{info}: plistlib parsed {len(plist)} key(s), all agreeing with the stage manifest")
    print(f"{pkginfo}: {raw.decode('ascii')} ({len(raw)} bytes, no terminator)")
    print(f"{bundle.name}: {icon_summary}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
