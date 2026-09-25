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
import pathlib
import sys
import time

VIGEM_ERROR_NONE = 0x20000000
XUSB_GAMEPAD_A = 0x1000


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
    if error != VIGEM_ERROR_NONE:
        raise SystemExit(f"vigem-pad: {what} failed: 0x{error & 0xFFFFFFFF:08x}")


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
