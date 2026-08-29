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
character of `CFBundleIdentifier` and it must exit 1 naming the key. Both branches
are driven from `tests/e2e/ship-macos/run.mjs`, which mutates a COPY of the
bundle, so the failure path of this file runs on every PR rather than on the day
it is needed.
"""

import json
import plistlib
import sys
from pathlib import Path

# `CFBundlePackageType` and `CFBundleSignature` are constants of the FORMAT, not
# of this app, so they are the two values that cannot come from the sidecar.
# `refs/node/tools/gyp/pylib/gyp/mac_tool.py:232` writes a PkgInfo only when the
# type is `APPL`; line 239 defaults the signature to `????`.
PACKAGE_TYPE = "APPL"
SIGNATURE = "????"
# `refs/node/tools/gyp/pylib/gyp/mac_tool.py:245` — `fp.write(f"{type}{sig}")`,
# eight bytes and no terminator.
PKGINFO_BYTES = 8


def fail(message):
    print(f"::error title=Ship .app::{message}")
    return 1


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
    # left unmentioned. `CFBundleIconFile` is the one a hand will reach for, and
    # M2a ships no icon: `png2icns`, `icnsutil` and `iconutil` are all absent from
    # this workstation AND from the CI image, so an `.icns` written here could
    # only be read back by a reader written here — `selfReading: true`, which
    # `flatpak.spec.ts` reds for every format. Asserting the absence is what keeps
    # "we decided not to" from decaying into "somebody added it untested".
    for key in ("CFBundleIconFile", "LSMinimumSystemVersion", "NSHighResolutionCapable"):
        if key in plist:
            return fail(
                f"{info} carries {key}, which M2a does not emit and no reader here can check. "
                "If it is now justified, cite the file it was read off and give it a test — see "
                "packages/infra/cli/src/utils/ship/plist.ts."
            )

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
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
