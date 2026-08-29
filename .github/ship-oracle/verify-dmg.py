#!/usr/bin/env python3
"""Read a `.dmg` this project did NOT write, with three readers that are not hdiutil.

WHY THIS FILE EXISTS.  Every other `gjsify ship` format is written by this tree, and
ADR 0024 § A3 records what that bought: writing the RPM header ourselves is what made
`rpm` an *independent* oracle, and it caught a real defect in the first artifact.  A
`.dmg` forfeits that — it is a UDIF image over a real HFS+ volume, the only writer of
one is `hdiutil`, and `hdiutil verify` is hdiutil reading what hdiutil wrote.  § A6
names the replacement in as many words: *`hdiutil` on a darwin runner, read back on
Linux with `7z` plus `dmg2img` -> `fsck.hfsplus -n`*.  This is that sentence.

THE CHAIN, and what each link is for — they are not redundant:

  1. `7z l -slt <dmg>`      7-Zip's own `Dmg` handler over the UDIF container.  Reads
                            the koly trailer and the blkx table.  Structure only.
  2. `7z t <dmg>`           DECOMPRESSES every run and checks what it stored.  `l` is
                            a table-of-contents read and is structurally blind to a
                            byte flipped inside a compressed run — the same shape as
                            `unzip -Z1` being blind to a mode.  This is the link that
                            sees the payload.
  3. `dmg2img`              A SECOND, unrelated UDIF decoder, which writes the raw
                            volume out.  Two decoders agreeing is worth more than one
                            decoder twice, and it is what turns the next link's
                            subject from an archive listing into a filesystem.
  4. `fsck.hfsplus -f -n`   Apple's own fsck_hfs sources, built for Linux (hfsprogs).
                            Walks the catalog file, the extents overflow file and the
                            volume bitmap.  This is the only link that distinguishes
                            "a name appears in a listing" from "the volume is sound".
  5. `7z l -slt <volume>`   The file listing, out of the converted volume, compared
                            against `.gjsify-ship-stage.json` — the same sidecar
                            `verify-modes.py` holds the `.deb` against.

WHAT THIS ORACLE DOES NOT CLAIM, stated so nobody reads it as more.  **It says nothing
about POSIX modes.**  7-Zip's HFS handler reports `Mode = 0---------` for entries in an
HFS+ volume — measured on ubuntu-24.04 / 7-Zip 23.01 against a `mkfs.hfsplus` image —
so the executable bit on `Contents/MacOS/<binary>` is invisible here.  That question is
answered for the same payload by `verify-app-zip.sh`, which reads the `.app` zip with
`zipinfo -l` and refuses an archive whose launcher is 0644.  A `.dmg` leg that pretended
to cover it would be the weaker reader silently replacing the stronger one.

WHY THE VERIFY PATH NEVER LOOKS AT THE BYTES ITSELF.  Nothing below reads a magic
number or an offset: every refusal comes from one of the three external readers or from
the listing comparison.  That is deliberate and it is what makes the negative control
mean anything — a script that checked `koly` itself would refuse the mutated image on
its OWN check, and the red run would prove this file works rather than proving 7-Zip
and dmg2img discriminate.  The byte offsets live in `--mutate`, which is the other half
of the program and never runs during a verification.

THE TWO JOURNAL FILES ARE EXPECTED AND THE LIST IS CLOSED.  `hdiutil -fs HFS+J` makes a
journaled volume, and a journaled HFS+ volume carries `.journal` and
`.journal_info_block` at its root — measured on ubuntu-24.04 against
`mkfs.hfsplus -J -v ShipDemo`, where `7z l` listed exactly those two beside the volume
directory.  They are filesystem bookkeeping, not payload.  They are named here rather
than skipped by a pattern: a glob over dotfiles would also swallow a `.DS_Store` or an
`.fseventsd` that hdiutil put in the image, which is a real extra file in a user's
download and something this comparison exists to notice.

DISCRIMINATOR (run it, do not trust it).  `--mutate` writes a corrupted COPY and prints
what it changed; re-running the verification on that copy must exit 1.  Three mutants,
one per reader, because a single byte flip does not red them all — measured on
ubuntu-24.04 against an 8 MiB `mkfs.hfsplus -J` volume, flipping one byte at offsets
1028, 1100 and 2048 left BOTH `fsck.hfsplus` and `7z l` at exit 0, while the same flip
at 1024 (the `H+` signature) gave fsck exit 8 and 7z exit 2.  "Flip a byte somewhere"
is not a negative control; flipping a byte that something reads is.

  koly     one byte of the UDIF trailer's magic.  Links 1 and 3 lose the container.
  payload  one byte inside the compressed data fork.  Link 2 is the one that sees it;
           link 1 need not, and that asymmetry is why `7z t` is in the chain.
  volume   the HFS+ volume signature, in the image dmg2img produces.  Link 4's
           subject, and the mutant is a raw volume rather than a `.dmg` — pass
           `--kind volume` when verifying it.

Usage:
    python3 verify-dmg.py <image> <stage manifest.json> [--kind dmg|volume]
    python3 verify-dmg.py <image> --mutate koly|payload|volume --out <path>
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

#: The UDIF trailer is the last 512 bytes of the file and begins with this magic.
KOLY_TRAILER_BYTES = 512
KOLY_MAGIC = b"koly"

#: HFS+ writes its volume header 1024 bytes in; `H+` is HFS+, `HX` is HFSX.
HFS_SIGNATURE_OFFSET = 1024

#: HFS+J bookkeeping — see the module docstring. A CLOSED list, never a pattern.
JOURNAL_FILES = (".journal", ".journal_info_block")

#: The format whose overlay this image carries.
FORMAT_ID = "macos-app-dmg"


def fail(message: str) -> None:
    print(f"::error title=Ship .dmg::{message}", file=sys.stderr)
    sys.exit(1)


def require(*tools: str) -> None:
    """No silent skip.

    `tests/e2e/ship`'s `probe()` settled this for the whole oracle family: every
    assertion here sits behind a reader, so a missing reader would leave the script
    green having read nothing. On the leg that runs this, all three arrive from one
    `apt-get install 7zip dmg2img hfsprogs`.
    """
    for tool in tools:
        if shutil.which(tool) is None:
            fail(
                f"{tool} is not on PATH. It is one of the three readers this artifact is checked with, "
                "so skipping it would make every assertion behind it vacuous. "
                "On ubuntu-latest: `sudo apt-get install -y 7zip dmg2img hfsprogs`."
            )


def run(argv: list[str], *, what: str, allow_fail: bool = False) -> subprocess.CompletedProcess[str]:
    """Run a reader, echo everything it said, and refuse a non-zero exit."""
    print(f"== {' '.join(argv)}")
    proc = subprocess.run(argv, capture_output=True, text=True)
    if proc.stdout:
        print(proc.stdout, end="" if proc.stdout.endswith("\n") else "\n")
    if proc.stderr:
        print(proc.stderr, end="" if proc.stderr.endswith("\n") else "\n", file=sys.stderr)
    if proc.returncode != 0 and not allow_fail:
        fail(f"{what} exited {proc.returncode}. The reader refused this image; its output is above.")
    return proc


def parse_7z_slt(text: str) -> tuple[dict[str, str], list[dict[str, str]]]:
    """Split `7z l -slt` into its archive header and one record per entry.

    `-slt` and not the human table, for the reason every parser in this repository
    that reads a tool's output gives: the table's columns are laid out for a person
    and a path with two spaces in it is not recoverable from them. `-slt` is 7-Zip's
    own scripting form — one `Key = Value` per line, blank line between records —
    and the header block is separated from the records by a line of dashes.
    """
    head, sep, body = text.partition("\n----------\n")
    if not sep:
        # A listing with no records is legal (an empty volume) and is NOT decided
        # here — the caller's expected-file comparison is what refuses it. But a
        # listing this parser could not find its own delimiter in must FAIL: silently
        # returning "no entries" would read as "the image is empty", which is the
        # parse-stopped-matching class `check-ship-format-vocabulary.mjs` names.
        if "\n--\n" not in text:
            fail(
                "`7z l -slt` printed no header block this parser recognises, so it read nothing. "
                "A parse that stops matching must fail rather than report an empty archive."
            )
        head, body = text, ""
    header: dict[str, str] = {}
    for line in head.splitlines():
        key, eq, value = line.partition(" = ")
        if eq:
            header[key.strip()] = value.strip()
    records: list[dict[str, str]] = []
    current: dict[str, str] = {}
    for line in body.splitlines():
        if line.strip() == "":
            if current:
                records.append(current)
                current = {}
            continue
        key, eq, value = line.partition(" = ")
        if eq:
            current[key.strip()] = value.strip()
    if current:
        records.append(current)
    return header, records


def expected_files(manifest_path: str) -> tuple[str, dict[str, int]]:
    """The volume name and every file the image must carry, with its size.

    Both come out of `.gjsify-ship-stage.json` rather than out of arguments: the
    sidecar is the closure the packing host was handed (ADR 0024 § A2), so comparing
    the artifact against it is comparing the artifact against what it was made from.
    A volume name passed on the command line would be this script and the workflow
    agreeing with each other.

    TWO SOURCES, and the second one is the interesting one. `staged[]` is the payload;
    `overlay["macos-app-dmg"]` is the licence file `planOverlay` rendered on the
    ASSEMBLING host — a stage whose overlay never travelled produces an image that is
    otherwise perfect and ships no licence, which is the failure Debian Policy § 12.5
    and `assertOverlayIsLicensed` both exist against, arriving one format further on.
    """
    with open(manifest_path, encoding="utf-8") as handle:
        manifest = json.load(handle)

    name = manifest.get("settings", {}).get("name")
    if not isinstance(name, str) or name.strip() == "":
        fail(f"{manifest_path} carries no `settings.name`, so nothing knows what the volume is called.")

    files: dict[str, int] = {}
    for entry in manifest["staged"]:
        files[f"{name}/{entry['path']}"] = int(entry["bytes"])
    overlay = manifest.get("overlay", {}).get(FORMAT_ID)
    if not overlay:
        fail(
            f"{manifest_path} carries no `overlay.{FORMAT_ID}`, so this stage was assembled without the "
            f"`.dmg` in `--target`. The image it produces ships no licence file and nothing downstream "
            "would say so. Re-run the `--stage` phase with `--target macos-app-dmg`."
        )
    for entry in overlay:
        # UTF-8 BYTES, not characters. The rendered licence in this repository's own
        # fixture ends `free of charge…` — one character, three bytes — so a `len()`
        # over the string reports a size two short and reds a correct image.
        files[f"{name}/{entry['path']}"] = len(entry["text"].encode("utf-8"))
    return name, files


def verify_volume(volume: str, manifest_path: str) -> None:
    """Links 4 and 5: the filesystem, then its contents against the sidecar."""
    proc = run(["fsck.hfsplus", "-f", "-n", volume], what="fsck.hfsplus -f -n")
    # The exit code alone is not the whole assertion: fsck_hfs prints its verdict, and
    # a run that checked a volume it did not understand is a different thing from a
    # clean one. `-f` forces the check on a volume marked clean; `-n` answers "no" to
    # every repair, so nothing here can write to the image it is reading.
    if "appears to be OK" not in proc.stdout:
        fail(
            "fsck.hfsplus exited 0 without saying the volume appears to be OK. Its output is above — "
            "an exit code that agrees with no verdict is the shape a reader takes when it read nothing."
        )

    header, records = parse_7z_slt(run(["7z", "l", "-slt", volume], what="7z l -slt <volume>").stdout)
    if header.get("Type") != "HFS":
        fail(
            f"7-Zip identified the converted volume as `{header.get('Type')}`, not `HFS`. "
            "`hdiutil` was asked for `-fs HFS+J`; an APFS volume here means the flag did not take, and "
            "two of this chain's three readers have no subject."
        )

    name, expected = expected_files(manifest_path)

    found: dict[str, int] = {}
    for record in records:
        if record.get("Folder") == "+":
            continue
        path = record.get("Path", "")
        size = record.get("Size", "")
        found[path] = int(size) if size.isdigit() else -1

    # THE VOLUME NAME, asserted as its own sentence rather than left to fall out of
    # the file comparison. `7z l -slt` emits no `Volume Name` key for HFS — measured
    # on ubuntu-24.04 / 7-Zip 23.01, where the header carried Type, Physical Size,
    # Method, Cluster Size, Free Space and the two timestamps and nothing else — so
    # the name reaches a reader only as the first component of every path. Left
    # implicit, a wrong `-volname` would surface as "11 files are missing and 11
    # files are extra", which is the same diagnosis as a wholly wrong image.
    roots = {path.split("/", 1)[0] for path in found}
    if roots != {name}:
        fail(
            f"the image mounts as {sorted(roots)} and the stage names the volume `{name}`. "
            "`hdiutil -volname` and `gjsify.ship.name` have to be the same string — the volume and the "
            "bundle inside it are the two names a user reads in one Finder window."
        )

    allowed_extra = {f"{name}/{leaf}" for leaf in JOURNAL_FILES}
    missing = sorted(set(expected) - set(found))
    extra = sorted(set(found) - set(expected) - allowed_extra)
    if missing:
        fail(
            f"{len(missing)} file(s) the stage names are not in the image: {', '.join(missing[:5])}"
            f"{', …' if len(missing) > 5 else ''}. A `.dmg` mounts and shows a window either way."
        )
    if extra:
        fail(
            f"{len(extra)} file(s) are in the image and not in the stage: {', '.join(extra[:5])}"
            f"{', …' if len(extra) > 5 else ''}. `hdiutil -srcfolder` copies whatever it finds, so an "
            "extra file means the volume root held something besides the bundle."
        )

    wrong = [
        f"{path} is {found[path]} bytes in the image and {size} in the stage"
        for path, size in sorted(expected.items())
        if found[path] != size
    ]
    if wrong:
        fail("; ".join(wrong[:5]) + (", …" if len(wrong) > 5 else ""))

    # THE DISCRIMINATOR FOR THE COMPARISON ITSELF. An empty expectation set makes every
    # loop above vacuous and every assertion pass — the shape a manifest parse failure
    # would take if it ever returned `{}` instead of throwing.
    if len(expected) == 0:
        fail("the stage manifest named no files, so nothing above compared anything")
    print(
        f"verify-dmg.py: {len(expected)} file(s) in volume `{name}` match the stage manifest "
        f"by name and size; fsck.hfsplus walked the catalog and called the volume OK"
    )


def verify_dmg(image: str, manifest_path: str) -> None:
    """Links 1-3, then the volume half."""
    header, _ = parse_7z_slt(run(["7z", "l", "-slt", image], what="7z l -slt <dmg>").stdout)
    if header.get("Type") != "Dmg":
        fail(
            f"7-Zip identified this file as `{header.get('Type')}`, not `Dmg`. The artifact is not a UDIF "
            "image — `hdiutil create -format UDZO` writes one, and every reader below expects it."
        )
    # LINK 2, and it is the one an `l`-only chain would be missing: `7z t` inflates
    # every stored run, so a byte flipped inside the compressed data is refused here
    # and nowhere earlier.
    run(["7z", "t", image], what="7z t <dmg>")

    with tempfile.TemporaryDirectory() as work:
        volume = os.path.join(work, "volume.img")
        run(["dmg2img", image, volume], what="dmg2img")
        if not os.path.exists(volume) or os.path.getsize(volume) == 0:
            fail(
                "dmg2img exited 0 and produced no volume. An exit code without an output file is the "
                "shape a decoder takes when it recognised nothing."
            )
        verify_volume(volume, manifest_path)


def mutate(image: str, kind: str, out: str) -> None:
    """Write a corrupted copy, and say exactly what changed.

    THE OFFSETS LIVE HERE AND NOWHERE ELSE. The verification path never reads a magic
    number, so this program's two halves cannot agree with each other by accident: the
    mutant is refused by 7-Zip, dmg2img or fsck.hfsplus, or it is not refused at all.
    """
    if kind == "volume":
        # The mutant is a raw volume rather than an image, because `fsck.hfsplus`'s
        # subject is the filesystem and the only way to hand it one is to convert
        # first. Verify it with `--kind volume`.
        require("dmg2img")
        run(["dmg2img", image, out], what="dmg2img")
        with open(out, "r+b") as handle:
            handle.seek(HFS_SIGNATURE_OFFSET)
            before = handle.read(1)
            handle.seek(HFS_SIGNATURE_OFFSET)
            handle.write(bytes([before[0] ^ 0xFF]))
        print(
            f"mutated {out}: HFS+ volume signature at offset {HFS_SIGNATURE_OFFSET}, "
            f"{before.hex()} -> {bytes([before[0] ^ 0xFF]).hex()}"
        )
        return

    shutil.copyfile(image, out)
    size = os.path.getsize(out)
    if kind == "koly":
        offset = size - KOLY_TRAILER_BYTES
        with open(out, "r+b") as handle:
            handle.seek(offset)
            magic = handle.read(len(KOLY_MAGIC))
            if magic != KOLY_MAGIC:
                # A mutation that did not land on the thing it names is a red run that
                # proves nothing — the same failure `dosMadeBy` in the zip suite
                # asserts against by counting the headers it rewrote.
                fail(
                    f"the last {KOLY_TRAILER_BYTES} bytes of {image} do not begin with `koly` "
                    f"(found {magic!r}), so this mutation would corrupt padding instead of the trailer."
                )
            handle.seek(offset)
            handle.write(bytes([magic[0] ^ 0xFF]))
        print(f"mutated {out}: UDIF trailer magic at offset {offset}, {magic[0]:02x} -> {magic[0] ^ 0xFF:02x}")
        return

    if kind == "payload":
        # Inside the DATA FORK: a UDZO image stores its compressed runs from offset 0
        # and puts the plist + trailer at the end, so a byte a little way in is
        # compressed data. Deliberately not the midpoint — for a small image the
        # middle can land in the XML property list, where a flip is a parse error
        # rather than a decompression one, and the two are different claims.
        offset = 512
        if size <= offset + KOLY_TRAILER_BYTES:
            fail(f"{image} is {size} bytes — too small for offset {offset} to be inside the data fork.")
        with open(out, "r+b") as handle:
            handle.seek(offset)
            before = handle.read(1)
            handle.seek(offset)
            handle.write(bytes([before[0] ^ 0xFF]))
        print(f"mutated {out}: data fork byte at offset {offset}, {before.hex()} -> {before[0] ^ 0xFF:02x}")
        return

    fail(f"unknown mutation `{kind}`")


def main() -> None:
    parser = argparse.ArgumentParser(add_help=True, description=__doc__)
    parser.add_argument("image")
    parser.add_argument("manifest", nargs="?")
    parser.add_argument("--kind", choices=["dmg", "volume"], default="dmg")
    parser.add_argument("--mutate", choices=["koly", "payload", "volume"])
    parser.add_argument("--out")
    args = parser.parse_args()

    if not os.path.exists(args.image):
        fail(f"{args.image} does not exist")

    if args.mutate:
        if not args.out:
            fail("--mutate needs --out <path> to write the corrupted copy to")
        mutate(args.image, args.mutate, args.out)
        return

    if not args.manifest:
        fail("usage: verify-dmg.py <image> <stage manifest.json> [--kind dmg|volume]")
    if not os.path.exists(args.manifest):
        fail(f"{args.manifest} does not exist — it is the stage sidecar the image is compared against")

    require("7z", "dmg2img", "fsck.hfsplus")
    if args.kind == "volume":
        verify_volume(args.image, args.manifest)
    else:
        verify_dmg(args.image, args.manifest)


if __name__ == "__main__":
    main()
