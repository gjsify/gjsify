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

  1. `7z l -slt <dmg>`      7-Zip's own `Dmg` handler over the UDIF container, which
                            AUTO-NESTS into the HFS volume inside it and lists the
                            files directly.  Measured on ubuntu-24.04 / 7-Zip 23.01
                            against a real `hdiutil` image: two archive headers
                            (`Type = Dmg`, then `Type = HFS` with `Method = HFS+`),
                            one nested-entry block for `4.hfs`, then the records.
                            That pair of types is the assertion that `-format UDZO
                            -fs HFS+J` took: an APFS image would say `Type = APFS`.
  2. `7z t <dmg>`           DECOMPRESSES every run and checks what it stored.  `l` is
                            a table-of-contents read and is structurally blind to a
                            byte flipped inside a compressed run — the same shape as
                            `unzip -Z1` being blind to a mode.  The Dmg entry reports
                            `Method = Zero0 Zero2 ZLIB CRC`, so there is a stored
                            checksum for this to disagree with.
  3. `dmg2img`              A SECOND, unrelated UDIF decoder, which writes the raw
                            volume out.  Two decoders agreeing is worth more than one
                            decoder twice, and it is what turns the next link's
                            subject from an archive listing into a filesystem.
  4. `fsck.hfsplus -f -n`   Apple's own fsck_hfs sources, built for Linux (hfsprogs).
                            Walks the catalog file, the extents overflow file and the
                            volume bitmap.  This is the only link that distinguishes
                            "a name appears in a listing" from "the volume is sound".
  5. `7z l -slt <volume>`   The same listing again, out of the volume the OTHER decoder
                            wrote.  Both go against `.gjsify-ship-stage.json` — the
                            same sidecar `verify-modes.py` holds the `.deb` against.

MODES ARE COMPARED, and the first draft of this file said they could not be.  That claim
came from an EMPTY `mkfs.hfsplus` volume, where 7-Zip reports `Mode = 0---------`, and it
did not survive contact with a real image: on an `hdiutil` volume the same reader prints
`Mode = -rwxr-xr-x` for `Contents/MacOS/<binary>` and `-rw-r--r--` for the rest
(measured, run 33283043393).  A measurement taken on a stand-in is a measurement about
the stand-in — so the mode plan in the sidecar is checked here too, which means this
chain covers the one failure a distributed bundle really has: a launcher that arrives
0644 and will not run.

WHY THE VERIFY PATH NEVER LOOKS AT THE BYTES ITSELF.  Nothing below reads a magic
number or an offset: every refusal comes from one of the three external readers or from
the listing comparison.  That is deliberate and it is what makes the negative control
mean anything — a script that checked `koly` itself would refuse the mutated image on
its OWN check, and the red run would prove this file works rather than proving 7-Zip
and dmg2img discriminate.  The byte offsets live in `--mutate`, which is the other half
of the program and never runs during a verification.

THE TWO JOURNAL FILES ARE EXPECTED AND THE LIST IS CLOSED.  `hdiutil -fs HFS+J` makes a
journaled volume, and a journaled HFS+ volume carries `.journal` and
`.journal_info_block` at its root — measured on ubuntu-24.04 against both
`mkfs.hfsplus -J` and a real `hdiutil` image.  They are filesystem bookkeeping, not
payload.  They are named here rather than skipped by a pattern: a glob over dotfiles
would also swallow a `.DS_Store` or an `.fseventsd` that hdiutil put in the image, which
is a real extra file in a user's download and something this comparison exists to notice.
The two HFS+ hard-link stores an `hdiutil` volume also carries — `.HFS+ Private Directory
Data` and `[HFS+ Private Data]` — need no allowance at all: both are DIRECTORIES, and the
comparison below is over files.

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


def parse_7z_slt(text: str) -> tuple[list[str], list[str], list[dict[str, str]]]:
    """Split `7z l -slt` into its archive header TYPES, its methods, and one record per entry.

    `-slt` and not the human table, for the reason every parser in this repository that
    reads a tool's output gives: the table's columns are laid out for a person and a path
    with two spaces in it is not recoverable from them. `-slt` is 7-Zip's own scripting
    form — one `Key = Value` per line, blank line between records.

    THE SEPARATOR IS THE LAST ONE, not the first, and the first draft got that wrong in a
    way that is worth keeping. 7-Zip AUTO-NESTS: handed a `.dmg` it opens the UDIF
    container, finds one partition, opens THAT, and prints two archive headers — so the
    text carries `Type = Dmg` and then `Type = HFS`, with the ten-dash separator appearing
    only once, after the second. Partitioning on the FIRST occurrence put both headers in
    the head block, the later key overwrote the earlier, and the check that meant to
    assert "this is a UDIF image" reported `7-Zip identified this file as HFS, not Dmg`
    against a perfectly good image (run 33281879121 → 33283043393).

    Which turns the header into a BETTER assertion than the one it replaced. The type
    SEQUENCE is what `-format UDZO -fs HFS+J` produces, and an APFS image — the default a
    modern `hdiutil` reaches for — would read `['Dmg', 'APFS']` right here.
    """
    marker = "\n----------\n"
    at = text.rfind(marker)
    if at == -1:
        # A listing with no records is legal (an empty volume) and is NOT decided here —
        # the caller's expected-file comparison is what refuses it. But a listing this
        # parser could not find its own delimiter in must FAIL: silently returning "no
        # entries" would read as "the image is empty", which is the parse-stopped-matching
        # class `check-ship-format-vocabulary.mjs` names.
        if "\n--\n" not in text:
            fail(
                "`7z l -slt` printed no header block this parser recognises, so it read nothing. "
                "A parse that stops matching must fail rather than report an empty archive."
            )
        head, body = text, ""
    else:
        head, body = text[:at], text[at + len(marker) :]

    types: list[str] = []
    methods: list[str] = []
    for line in head.splitlines():
        key, eq, value = line.partition(" = ")
        if not eq:
            continue
        if key.strip() == "Type":
            types.append(value.strip())
        elif key.strip() == "Method":
            methods.append(value.strip())

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
    return types, methods, records


def octal_mode(mode: str) -> int | None:
    """`-rwxr-xr-x` → 0o755, and `None` for anything that is not a mode string.

    `None` rather than a guess: 7-Zip prints `0---------` for an entry whose catalog
    record carries no permissions (an empty `mkfs.hfsplus` volume's root is one), and
    reading that as 0 would compare a real plan against a number nobody wrote.
    """
    if len(mode) != 10 or mode[0] not in "-dl":
        return None
    bits = 0
    for index, char in enumerate(mode[1:]):
        if char != "-":
            bits |= 1 << (8 - index)
    return bits


def expected_files(manifest_path: str) -> tuple[str, dict[str, tuple[int, int]]]:
    """The volume name and every file the image must carry, with its size.

    Both come out of `.gjsify-ship-stage.json` rather than out of arguments: the
    sidecar is the closure the packing host was handed (ADR 0024 § A2), so comparing
    the artifact against it is comparing the artifact against what it was made from.
    A volume name passed on the command line would be this script and the workflow
    agreeing with each other.

    THE MODE TRAVELS TOO, and it is the field the artifact upload cannot carry: every
    staged file arrives on the packing host 0644, so the sidecar's `staged[].mode` is the
    only surviving record of what each mode should be — the same sentence
    `stage-writer.ts`'s `readStage` doc makes, one host further on.

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

    files: dict[str, tuple[int, int]] = {}
    for entry in manifest["staged"]:
        files[f"{name}/{entry['path']}"] = (int(entry["bytes"]), int(entry["mode"]) & 0o777)
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
        files[f"{name}/{entry['path']}"] = (
            len(entry["text"].encode("utf-8")),
            int(entry["mode"]) & 0o777,
        )
    return name, files


def compare_listing(records: list[dict[str, str]], manifest_path: str, where: str) -> int:
    """Hold one `7z l -slt` listing against the stage sidecar: names, sizes AND modes."""
    name, expected = expected_files(manifest_path)

    found: dict[str, tuple[int, int | None]] = {}
    for record in records:
        # DIRECTORIES ARE OUT, and that is what makes the extra-file allowance short:
        # an `hdiutil` volume carries `.HFS+ Private Directory Data` and
        # `[HFS+ Private Data]` — the HFS+ hard-link stores — and both are folders.
        if record.get("Folder") == "+":
            continue
        path = record.get("Path", "")
        size = record.get("Size", "")
        found[path] = (int(size) if size.isdigit() else -1, octal_mode(record.get("Mode", "")))

    # THE VOLUME NAME, asserted as its own sentence rather than left to fall out of the
    # file comparison. `7z l -slt` emits no `Volume Name` key for HFS, so the name reaches
    # a reader only as the first component of every path. Left implicit, a wrong
    # `-volname` would surface as "8 files are missing and 8 files are extra", which is
    # the same diagnosis as a wholly wrong image.
    roots = {path.split("/", 1)[0] for path in found}
    if roots != {name}:
        fail(
            f"{where}: the image mounts as {sorted(roots)} and the stage names the volume `{name}`. "
            "`hdiutil -volname` and `gjsify.ship.name` have to be the same string — the volume and the "
            "bundle inside it are the two names a user reads in one Finder window."
        )

    allowed_extra = {f"{name}/{leaf}" for leaf in JOURNAL_FILES}
    missing = sorted(set(expected) - set(found))
    extra = sorted(set(found) - set(expected) - allowed_extra)
    if missing:
        fail(
            f"{where}: {len(missing)} file(s) the stage names are not in the image: "
            f"{', '.join(missing[:5])}{', …' if len(missing) > 5 else ''}. "
            "A `.dmg` mounts and shows a window either way."
        )
    if extra:
        fail(
            f"{where}: {len(extra)} file(s) are in the image and not in the stage: "
            f"{', '.join(extra[:5])}{', …' if len(extra) > 5 else ''}. "
            "`hdiutil -srcfolder` copies whatever it finds, so an extra file means the volume root "
            "held something besides the bundle."
        )

    wrong = []
    executables = 0
    for path, (size, mode) in sorted(expected.items()):
        got_size, got_mode = found[path]
        if got_size != size:
            wrong.append(f"{path} is {got_size} bytes in the image and {size} in the stage")
        # THE MODE, and it is the assertion this format nearly shipped without. A `.app`
        # whose `Contents/MacOS/<binary>` arrives 0644 does not start, and every other
        # check here passes on it. `None` is a mode 7-Zip could not read, which is a
        # different failure from a wrong one and says so.
        elif got_mode is None:
            wrong.append(f"{path} carries no readable mode in the image, and the stage plans {oct(mode)}")
        elif got_mode != mode:
            wrong.append(f"{path} is {oct(got_mode)} in the image and {oct(mode)} in the stage")
        elif got_mode & 0o111:
            executables += 1
    if wrong:
        fail(f"{where}: " + "; ".join(wrong[:5]) + (", …" if len(wrong) > 5 else ""))

    # THE DISCRIMINATOR FOR THE COMPARISON ITSELF, twice over. An empty expectation set
    # makes every loop above vacuous; and a payload in which nothing is executable is a
    # tree that never had a launcher, where the mode comparison would agree with a staged
    # tree that is itself wrong.
    if len(expected) == 0:
        fail(f"{where}: the stage manifest named no files, so nothing above compared anything")
    if executables == 0:
        fail(
            f"{where}: no file in the image is executable, so the volume carries no launcher — "
            "a `.app` that cannot start, with every name and size correct."
        )
    print(f"{where}: {len(expected)} file(s) match the stage by name, size and mode ({executables} executable)")
    return len(expected)


def verify_volume(volume: str, manifest_path: str, where: str = "volume") -> None:
    """Links 4 and 5: the filesystem, then its contents against the sidecar."""
    proc = run(["fsck.hfsplus", "-f", "-n", volume], what="fsck.hfsplus -f -n")
    # The exit code alone is not the whole assertion: fsck_hfs prints its verdict, and a
    # run that checked a volume it did not understand is a different thing from a clean
    # one. `-f` forces the check on a volume marked clean; `-n` answers "no" to every
    # repair, so nothing here can write to the image it is reading.
    if "appears to be OK" not in proc.stdout:
        fail(
            "fsck.hfsplus exited 0 without saying the volume appears to be OK. Its output is above — "
            "an exit code that agrees with no verdict is the shape a reader takes when it read nothing."
        )

    types, methods, records = parse_7z_slt(run(["7z", "l", "-slt", volume], what="7z l -slt <volume>").stdout)
    if types != ["HFS"]:
        fail(f"7-Zip identified the converted volume as {types}, not ['HFS'].")
    if "HFS+" not in methods:
        fail(f"7-Zip reports the volume's method as {methods}, with no `HFS+` among them.")
    compare_listing(records, manifest_path, where)


def verify_dmg(image: str, manifest_path: str) -> None:
    """The whole chain: the container, its payload, a second decoder, the filesystem."""
    types, methods, records = parse_7z_slt(run(["7z", "l", "-slt", image], what="7z l -slt <dmg>").stdout)
    # THE TYPE SEQUENCE, not one type. 7-Zip auto-nests, so a UDIF image over an HFS+
    # volume reads exactly like this — and an APFS one, which is what a modern `hdiutil`
    # makes when `-fs` says nothing, would read `['Dmg', 'APFS']` and be refused here
    # rather than two links later as "dmg2img produced nothing".
    if types != ["Dmg", "HFS"]:
        fail(
            f"7-Zip read this file as {types}, not ['Dmg', 'HFS']. The artifact has to be a UDIF image "
            "over an HFS+ volume — `hdiutil create -format UDZO -fs HFS+J` writes one, and the two "
            "readers after this are an HFS+ chain with nothing to read otherwise."
        )
    if "HFS+" not in methods:
        fail(f"7-Zip reports the methods as {methods}, with no `HFS+` among them — the volume is not HFS+.")

    # The listing 7-Zip's own Dmg→HFS chain produced, against the sidecar.
    compare_listing(records, manifest_path, "7z over the .dmg")

    # LINK 2, and it is the one an `l`-only chain would be missing: `7z t` inflates every
    # stored run, so a byte flipped inside the compressed data is refused here and nowhere
    # earlier. The Dmg entry advertises `Method = … ZLIB CRC`, so there is a stored
    # checksum for it to disagree with.
    run(["7z", "t", image], what="7z t <dmg>")

    with tempfile.TemporaryDirectory() as work:
        volume = os.path.join(work, "volume.img")
        run(["dmg2img", image, volume], what="dmg2img")
        if not os.path.exists(volume) or os.path.getsize(volume) == 0:
            fail(
                "dmg2img exited 0 and produced no volume. An exit code without an output file is the "
                "shape a decoder takes when it recognised nothing."
            )
        # THE SAME COMPARISON AGAIN, over the volume the OTHER decoder wrote. Not a
        # duplicate: 7-Zip's chain and dmg2img are two independent UDIF implementations,
        # and the thing worth knowing is that they agree about the bytes inside.
        verify_volume(volume, manifest_path, "dmg2img + fsck.hfsplus")


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
