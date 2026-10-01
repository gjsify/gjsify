"""A virtual Xbox 360 pad on Windows, for CI: ViGEmBus's kernel driver plus its
user-mode client, driven through ctypes. It connects, holds A and the left stick
fully right, and disconnects after HOLD seconds — the input path the shim reads
through XInput, on a runner that has no controller.

    python vigem-pad.py <ViGEmClient.dll> <ready-file> [hold-seconds]

Writes <ready-file> once the pad exists and its report is sent, so the reader
starts only then. Both binaries come from the vgamepad 0.1.0 sdist, fetched and
checksum-pinned by prebuilds.yml.
"""
import ctypes
import os
import pathlib
import sys
import time

VIGEM_ERROR_NONE = 0x20000000
XUSB_GAMEPAD_A = 0x1000

# meson's SKIP, and the same convention test/uinput-pad.c already uses for a
# device the host cannot give us.
SKIP = 77

# vgamepad's own error table (vgamepad/win/vigem_commons.py in the pinned
# 0.1.0 sdist), so a failure names itself instead of being a bare number.
VIGEM_ERRORS = {
    0xE0000001: "BUS_NOT_FOUND",
    0xE0000005: "ALREADY_CONNECTED",
    0xE0000006: "TARGET_UNINITIALIZED",
    0xE0000007: "TARGET_NOT_PLUGGED_IN",
    0xE0000008: "BUS_VERSION_MISMATCH",
    0xE0000009: "BUS_ACCESS_FAILED",
}

# Why the bus can be unusable, said once, in full, where a reader will find it.
# The pinned sdist carries ViGEmBus 1.17.333, and GitHub's `windows-2022` label
# is Windows SERVER 2022. That driver version on that OS family installs
# cleanly and opens its bus, then the virtual device is never enumerated by the
# system: upstream issue nefarius/ViGEmBus#85 ("Installation was successful and
# driver is visible in Device Manager. Unfortunately I cannot communication with
# the driver"), on a repository archived in 2023. No call sequence in this file
# changes that, and a PR cannot be merged against a driver the runner's OS will
# not run — so this leg skips there, loudly, and the shim's device path is
# measured instead by test/virtual-pad.c, which needs no driver at all.
SKIP_REASON = (
    "the ViGEm bus cannot give this host a device; the shim's device path is "
    "covered without a driver by the meson test 'virtual-pad' (SDL's own "
    "virtual joystick), and test/win32-message-queue.c still measures the "
    "message pump with no device. Set GJSIFY_GAMEPAD_REQUIRE_VIGEM=1 on a host "
    "that can host ViGEmBus to make this a failure instead."
)


class XusbReport(ctypes.Structure):
    _fields_ = [
        ("wButtons", ctypes.c_ushort),
        ("bLeftTrigger", ctypes.c_ubyte),
        ("bRightTrigger", ctypes.c_ubyte),
        ("sThumbLX", ctypes.c_short),
        ("sThumbLY", ctypes.c_short),
        ("sThumbRX", ctypes.c_short),
        ("sThumbRY", ctypes.c_short),
    ]


def check(what, error):
    if error == VIGEM_ERROR_NONE:
        return
    code = error & 0xFFFFFFFF
    msg = f"vigem-pad: {what} failed: 0x{code:08x} ({VIGEM_ERRORS.get(code, 'UNKNOWN')})"
    # The counterpart of GJSIFY_GAMEPAD_REQUIRE_UINPUT: set to 1 where the host
    # is known to be able to host ViGEmBus, and an unusable bus is then a
    # failure rather than a skip. CI sets it for uinput and deliberately not
    # here — see SKIP_REASON for why a Windows Server runner cannot.
    if os.environ.get("GJSIFY_GAMEPAD_REQUIRE_VIGEM") == "1":
        raise SystemExit(msg)
    print(msg, file=sys.stderr)
    print(f"vigem-pad: SKIP ({SKIP}) — {SKIP_REASON}", file=sys.stderr)
    sys.exit(SKIP)


def main():
    client_dll, ready_file = sys.argv[1], pathlib.Path(sys.argv[2])
    hold = float(sys.argv[3]) if len(sys.argv) > 3 else 15.0
    vigem = ctypes.CDLL(client_dll)
    vigem.vigem_alloc.restype = ctypes.c_void_p
    vigem.vigem_target_x360_alloc.restype = ctypes.c_void_p
    for fn in ("vigem_connect", "vigem_target_add", "vigem_target_remove", "vigem_target_x360_update"):
        getattr(vigem, fn).restype = ctypes.c_uint32

    client = ctypes.c_void_p(vigem.vigem_alloc())
    check("vigem_connect (is the ViGEmBus driver installed?)", vigem.vigem_connect(client))
    pad = ctypes.c_void_p(vigem.vigem_target_x360_alloc())
    check("vigem_target_add", vigem.vigem_target_add(client, pad))
    report = XusbReport(wButtons=XUSB_GAMEPAD_A, sThumbLX=32767)
    check("vigem_target_x360_update", vigem.vigem_target_x360_update(client, pad, report))
    print(f"vigem-pad: X360 pad connected, A held, left stick right; holding {hold:.0f} s", flush=True)
    ready_file.write_text("ready")

    time.sleep(hold)
    check("vigem_target_remove", vigem.vigem_target_remove(client, pad))
    print("vigem-pad: removed", flush=True)


if __name__ == "__main__":
    main()
