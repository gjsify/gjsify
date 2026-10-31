#!/usr/bin/env python3
"""What libgjsifysherpa.so links and exports, read back from the built file
rather than from meson.build.

  1. DT_NEEDED names only libc, libm, libdl, libpthread, libstdc++, the dynamic
     loader, GLib/GObject — and `libonnxruntime.so`, which is REQUIRED to be
     there and REQUIRED to exist beside the library. sherpa-onnx is linked
     statically but onnxruntime cannot be (meson.build § onnxruntime: the
     prebuilt static archive collides with a current GCC's own vague-linkage
     symbols and corrupts the heap on the first inference session). What makes
     the shared engine safe to ship rather than a dependency on the host is that
     it travels in the same prebuild and is found through RUNPATH `$ORIGIN`;
     this test is what holds that true.
  2. The dynamic symbol table exports only `gjsify_sherpa_*`. ELF has ONE flat
     symbol namespace, so an exported `OrtGetApiBase` or `SherpaOnnxCreateOfflineRecognizer`
     here would interpose on — or be interposed by — any other onnxruntime in
     the process. That is not hypothetical: Fedora 44 ships libonnxruntime.so.1
     (1.22.2) while this library carries 1.28.2 beside it, and the two ABIs are
     not interchangeable.
  3. The engine's OWN exports, for the same reason one level down. It is a
     second shared object in the prebuild, so whatever it exports is in that
     flat namespace too — and the premise of linking libstdc++ statically into
     libgjsifysherpa.so is that no C++ symbol crosses either boundary.
  4. The engine's GLIBCXX floor. It is prebuilt against glibc 2.17 by an old
     GCC, and that is the only reason its own DT_NEEDED on libstdc++.so.6 does
     not cost the prebuild its portability. A wrap bump to an archive built by a
     newer toolchain would raise the floor silently, so the bound is asserted
     rather than assumed.

Prints every list so the CI log carries the measurement, and exits 1 on anything
outside them. Uses `readelf` (binutils) — the file format is the contract, not
whatever meson was asked to do. Mirrors
packages/web/gamepad-native/test/check-elf-deps.py, which makes the same promise
about SDL.
"""
import os
import re
import subprocess
import sys

# `libmvec.so.1` is glibc's vectorised libm, and it is on this list for a
# measured reason rather than a hopeful one: GCC auto-vectorises the feature
# maths in kaldi-native-fbank, and from glibc 2.22 onward `-lm` resolves the
# resulting `_ZGVbN2v_*` calls out of libmvec, which ld then records. It ships
# as part of glibc itself — the same package as libc.so.6 and libm.so.6 — so a
# host that can load one can load it. Keeping it out of the allowlist would red
# this test for a dependency on the C library.
ALLOWED_NEEDED = re.compile(
    r"^(libc\.so\.6|libm\.so\.6|libmvec\.so\.1|libdl\.so\.2|libpthread\.so\.0"
    r"|ld-linux[-\w.]*\.so\.\d+"
    r"|libstdc\+\+\.so\.6|libgcc_s\.so\.1|libglib-2\.0\.so\.0|libgobject-2\.0\.so\.0"
    r"|libonnxruntime\.so)$"
)

# Unversioned on purpose: that is the SONAME of the archive the wrap pins, and
# an unversioned name is only resolvable through RUNPATH to the sibling copy —
# never accidentally against a distribution's `libonnxruntime.so.1`.
ENGINE = "libonnxruntime.so"

# With `--require-static-libstdcxx` these two become failures for
# libgjsifysherpa.so. They are allowed above because a host without
# `libstdc++.a` still gets a working build (meson.build § THE LIBSTDC++
# DECISION) — it is only a SHIPPABLE prebuild that must not have them, since
# each carries a GLIBCXX_/GCC_ version floor set by the build host, and that
# floor is what makes a prebuild from a new Fedora refuse to load on an older
# Debian. Measured on Fedora 44 / GCC 16: a dynamic libstdc++ here demands
# GLIBCXX_3.4.30, against the ENGINE's 3.4.19 — so linking it dynamically would
# raise the floor of the pair to this build host's.
#
# It is only the GLIBCXX axis that this buys. The GLIBC floor is the build
# image's either way (Fedora 44 measures sqrtf@GLIBC_2.43 out of the feature
# maths no matter how libstdc++ is linked), which is why prebuilds.yml pins
# fedora:43 — see the banner over its `container:`. Not asserted here: it is a
# property of the image, identical for every prebuild in the tree, and
# `gjsify.glibcRequires` is where the tree records it.
#
# The ENGINE is exempt and is checked by ENGINE_MAX_GLIBCXX below instead: it is
# a binary release that always links libstdc++ dynamically, and this is not a
# flag that could change that.
STATIC_LIBSTDCXX_FORBIDS = re.compile(r"^(libstdc\+\+\.so\.6|libgcc_s\.so\.1)$")

# GCC 4.9. The pinned archive measures 3.4.19 (GCC 4.8), so there is one release
# of slack; anything above this is a newer toolchain than the glibc2_17 releases
# use, which is the signal worth failing on. GLIBCXX_3.4.20 is in Debian 8 and
# RHEL 7, so the bound is also roughly where "runs anywhere" stops being true.
ENGINE_MAX_GLIBCXX = (3, 4, 20)

# The two entry points sherpa-onnx calls, plus the version-node name readelf
# lists alongside them. Nothing else may be visible — above all nothing `std::`.
ENGINE_ALLOWED_EXPORTS = {
    "OrtGetApiBase",
    "OrtSessionOptionsAppendExecutionProvider_CPU",
    "VERS_1.28.2",
}


def readelf(*args):
    return subprocess.run(["readelf", "--wide", *args], check=True, capture_output=True, text=True).stdout


def needed_of(path):
    return re.findall(r"\(NEEDED\)\s+Shared library: \[([^\]]+)\]", readelf("-d", path))


def exports_of(path):
    out = []
    for line in readelf("--dyn-syms", path).splitlines():
        cols = line.split()
        # Num: Value Size Type Bind Vis Ndx Name — defined (Ndx != UND), GLOBAL/WEAK.
        if len(cols) >= 8 and cols[4] in ("GLOBAL", "WEAK") and cols[6] != "UND":
            out.append(cols[7].split("@")[0])
    return out


def glibcxx_versions(path):
    found = re.findall(r"GLIBCXX_(\d+(?:\.\d+)*)", readelf("-V", path))
    return sorted({tuple(int(n) for n in v.split(".")) for v in found})


def check_engine(path):
    """The engine's own surface and portability floor. Returns a problem list."""
    exported = sorted(set(exports_of(path)))
    stray = [s for s in exported if s not in ENGINE_ALLOWED_EXPORTS]
    versions = glibcxx_versions(path)
    floor = versions[-1] if versions else (0, 0, 0)

    print(f"  {ENGINE} exported ({len(exported)}): {', '.join(exported) or '(none)'}")
    print(f"  {ENGINE} GLIBCXX floor: {'.'.join(str(n) for n in floor)}")

    problems = [f"{ENGINE} exports {s}, which is not one of the Ort entry points"
                for s in stray[:20]]
    if floor > ENGINE_MAX_GLIBCXX:
        problems.append(
            f"{ENGINE} needs GLIBCXX_{'.'.join(str(n) for n in floor)}, above the "
            f"{'.'.join(str(n) for n in ENGINE_MAX_GLIBCXX)} this prebuild promises — "
            "the wrap now points at an archive built by a newer toolchain"
        )
    if not exported:
        problems.append(f"{ENGINE} exports nothing at all — readelf's format moved")
    return problems


def main(path, require_static_libstdcxx=False):
    needed = needed_of(path)
    exported = exports_of(path)
    stray = [s for s in exported if not s.startswith("gjsify_sherpa_")]

    print(f"{path}")
    print(f"  NEEDED   ({len(needed)}): {', '.join(needed)}")
    print(f"  exported ({len(exported)}): "
          + ("all gjsify_sherpa_*" if not stray else ", ".join(stray[:20])))

    problems = [f"NEEDED {n} is not an OS/GLib library or the engine" for n in needed
                if not ALLOWED_NEEDED.match(n)]
    problems += [f"exports {s}, which is not gjsify_sherpa_*" for s in stray[:20]]
    if require_static_libstdcxx:
        problems += [f"NEEDED {n}, but this build linked libstdc++ statically"
                     for n in needed if STATIC_LIBSTDCXX_FORBIDS.match(n)]
    # An empty parse would pass everything above; the library links libc and
    # exports the whole API, so zero of either means the parse stopped reading.
    if not needed or len(exported) < 20:
        problems.append(f"parsed {len(needed)} NEEDED / {len(exported)} exports — readelf's format moved")

    # The engine, from both sides: recorded as a dependency, and present as a
    # sibling. Either one alone is a prebuild that fails to load.
    engine_path = os.path.join(os.path.dirname(os.path.abspath(path)), ENGINE)
    if ENGINE not in needed:
        problems.append(
            f"no DT_NEEDED on {ENGINE} — sherpa-onnx was linked against a STATIC "
            "onnxruntime, which corrupts the heap on the first inference session "
            "(meson.build § onnxruntime)"
        )
    if not os.path.exists(engine_path):
        problems.append(
            f"{ENGINE} is not beside the library. meson.build copies it into the build "
            "directory so that scripts/stage-prebuild.mjs picks it up; without the "
            "sibling, RUNPATH $ORIGIN has nothing to resolve"
        )
    else:
        problems += check_engine(engine_path)

    for p in problems:
        print(f"  FAIL: {p}")
    return 1 if problems else 0


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    sys.exit(main(args[0], "--require-static-libstdcxx" in sys.argv[1:]))
