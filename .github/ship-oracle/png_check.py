"""Decode a PNG far enough to know it is one — with CPython's zlib, not ours.

Shared by `verify-program-dir.py` (the PNGs inside the launcher's resource
directory) and `verify-app-plist.py` (the PNGs inside the `.icns`). Both
containers are written by `gjsify ship` from rasters `utils/ship/icons.ts`
rendered, and both are the kind of file that "looks fine" — a valid header over
a body that decodes to nothing draws the generic icon on the target OS with no
error anywhere. So this reads the IHDR, inflates every IDAT byte and checks the
inflated length against what the IHDR promises: the one check that is cheap,
needs no image library, and cannot be satisfied by a header alone.

WHAT IT IS NOT: a renderer. It says the file is a structurally whole PNG of the
size it claims; whether the pixels are the icon is what Pillow (on the
workstation), `iconutil` (on a Mac) and the shell (on Windows) decide.
"""

import struct
import zlib

SIGNATURE = b"\x89PNG\r\n\x1a\n"

# Channels per colour type: greyscale, RGB, palette, greyscale+alpha, RGBA.
CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}


def _row_bytes(width, depth, channels):
    return 1 + (width * depth * channels + 7) // 8


def _expected_length(width, height, depth, colour, interlace):
    channels = CHANNELS[colour]
    if interlace == 0:
        return height * _row_bytes(width, depth, channels)
    # Adam7: seven passes, each a sub-image with its own filter byte per row.
    total = 0
    for x0, y0, dx, dy in ((0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4), (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2)):
        pw = (width - x0 + dx - 1) // dx
        ph = (height - y0 + dy - 1) // dy
        if pw > 0 and ph > 0:
            total += ph * _row_bytes(pw, depth, channels)
    return total


def check_png(data, what):
    """`(width, height)` of a whole, decodable PNG — or raise `ValueError` saying why not.

    `what` names the file in the message; the caller turns the exception into
    its own `::error` annotation.
    """
    if not data.startswith(SIGNATURE):
        raise ValueError(f"{what} does not start with the PNG signature")
    at = len(SIGNATURE)
    ihdr = None
    idat = []
    ended = False
    while at + 8 <= len(data):
        (length,) = struct.unpack_from(">I", data, at)
        kind = data[at + 4 : at + 8]
        body = data[at + 8 : at + 8 + length]
        if len(body) != length:
            raise ValueError(f"{what} is truncated inside its {kind.decode('latin1')} chunk")
        (crc,) = struct.unpack_from(">I", data, at + 8 + length)
        if zlib.crc32(kind + body) & 0xFFFFFFFF != crc:
            raise ValueError(f"{what} has a bad CRC on its {kind.decode('latin1')} chunk")
        if kind == b"IHDR":
            ihdr = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            idat.append(body)
        elif kind == b"IEND":
            ended = True
            at += 12 + length
            break
        at += 12 + length
    if ihdr is None:
        raise ValueError(f"{what} has no IHDR chunk")
    if not ended:
        raise ValueError(f"{what} has no IEND chunk — the file is not all there")
    if at != len(data):
        raise ValueError(f"{what} carries {len(data) - at} byte(s) after IEND")
    width, height, depth, colour, compression, filt, interlace = ihdr
    if colour not in CHANNELS or compression != 0 or filt != 0 or interlace not in (0, 1):
        raise ValueError(f"{what} has an IHDR this reader does not know: {ihdr}")
    try:
        raw = zlib.decompress(b"".join(idat))
    except zlib.error as error:
        raise ValueError(f"{what}: its image data does not inflate ({error})") from error
    expected = _expected_length(width, height, depth, colour, interlace)
    if len(raw) != expected:
        raise ValueError(
            f"{what} inflates to {len(raw)} byte(s) of image data and a {width}x{height} image of its "
            f"depth needs {expected} — the header and the body describe different pictures"
        )
    return width, height
