// @gjsify/devtools — get a screenshot OUT of the control plane and onto disk.
//
// The in-app half of this pair is `captureWidgetPng`; this is the half every caller had to
// write for itself. `Screenshot` answers a GVariant `ay`, and `gdbus` cannot write binary, so
// the first consumer of this package wrote a 60-line GJS script to unpack the variant and
// save the bytes — and every consumer since would have written its own, each with its own
// idea of what an empty answer means.
//
// WHY EMPTY BYTES ARE A FAILURE AND NOT A PICTURE: the service answers `ay[0]` when there is
// no active window or the window was never realised (a deliberate contract, see
// `CaptureBlocker`). Writing that produces a 0-byte file named `.png`, prints a success line
// and exits 0 — a screenshot workflow that reports success while handing on a file nothing can
// open. So a capture retries first, and then REFUSES, rather than writing the nothing.
//
// WHY THE SIZE COMES FROM THE PNG AND NOT FROM THE CALL: `ResizeWindow` answers with the size
// it was ASKED for, whether or not the window honoured it, and the window's `default-width`
// reads back that same asked-for value — so a resize the app ignored still looks like it
// worked. Measured in a consumer app: 1280 requested, 1100 in the file, four checks green.
// The IHDR header is the one number about a screenshot that cannot be faked.
//
// The seam is a FUNCTION, not a client class, so this stays transport-free: the D-Bus caller
// is `devtools-mcp`'s `DbusDevtoolsClient`, and the `gjsify devtools` CLI wires the two
// together. A caller with its own transport (the peer socket, a fake in a test) passes its own
// one-liner.

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

/** Fetches PNG bytes for a scope (`''`/`window` for the active window, a widget path for one widget). */
export type PngSource = (scope: string) => Promise<Uint8Array>;

/** The pixel dimensions read out of a PNG's own IHDR header. */
export interface PngSize {
    width: number;
    height: number;
}

/** A written screenshot: where it is, how big the file is, and how big the PICTURE is. */
export interface ShotResult {
    path: string;
    /** Bytes on disk. Never 0 — a capture that produced none throws instead. */
    byteLength: number;
    /** From the PNG header, so it is what the file actually contains. */
    width: number;
    height: number;
}

/** Tunables for {@link captureShot}; the defaults are the measured ones from a consumer rig. */
export interface CaptureShotOptions {
    /**
     * How many extra attempts after an empty answer. The window is often mid-layout, so one
     * empty reply is normal right after `present()` — 8 × 250 ms was enough for every cold
     * start measured, and 0 is the right answer for a caller that drives its own settling.
     */
    retries?: number;
    /** Gap between attempts, milliseconds. */
    retryDelayMs?: number;
    /** Pause before the FIRST capture — the counterpart of a rig's `--settle`. */
    settleMs?: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** IHDR is always the first chunk, so its payload starts 16 bytes in: 8 sig + 4 len + 4 type. */
const IHDR_WIDTH_OFFSET = 16;
const IHDR_HEIGHT_OFFSET = 20;

/** Why {@link captureShot} gave up. Named, because "it wrote nothing" is not a diagnosis. */
export type ShotFailure = 'empty-answer' | 'unreadable-png' | 'write-failed';

/** The capture that did not happen. Thrown so a caller cannot mistake it for a picture. */
export class CaptureShotError extends Error {
    constructor(
        readonly scope: string,
        readonly reason: ShotFailure,
        message: string,
        readonly cause?: unknown,
    ) {
        super(message);
        this.name = 'CaptureShotError';
    }
}

/**
 * The pixel size of a PNG, read from its IHDR chunk — the width and height are the first two
 * big-endian `uint32`s after the 8-byte signature and the chunk header.
 *
 * Returns `null` for anything that is not a PNG carrying an IHDR, rather than guessing: a
 * caller printing a size is reporting what the file contains, and a plausible number derived
 * from bytes that are not a header is worse than no number. Zero width or height cannot occur
 * in a valid PNG (both are `>= 1`), so `null` is not reachable for a well-formed file.
 */
export function pngSize(bytes: Uint8Array): PngSize | null {
    if (bytes.length < IHDR_HEIGHT_OFFSET + 4) return null;
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
        if (bytes[i] !== PNG_SIGNATURE[i]) return null;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
        width: view.getUint32(IHDR_WIDTH_OFFSET),
        height: view.getUint32(IHDR_HEIGHT_OFFSET),
    };
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

/**
 * Write the bytes, replacing whatever is at `path` — `REPLACE_DESTINATION` so a stale symlink
 * or an existing file is replaced rather than followed.
 */
function writeBytes(path: string, bytes: Uint8Array): void {
    Gio.File.new_for_path(path).replace_contents(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

/**
 * Capture a screenshot through `source` and save it to `path`.
 *
 * Retries while the app answers empty bytes (see the file header), then throws
 * {@link CaptureShotError} instead of writing a 0-byte file. The returned size is the PNG's
 * own, not the size that was asked for.
 *
 * @throws {CaptureShotError} `empty-answer` after the retries are spent, `unreadable-png` when
 * the bytes are not a PNG (a control plane that answered with something else is a different
 * bug and must not be written out as an image), `write-failed` when the path is not writable.
 */
export async function captureShot(
    source: PngSource,
    path: string,
    scope = 'window',
    options: CaptureShotOptions = {},
): Promise<ShotResult> {
    const { retries = 8, retryDelayMs = 250, settleMs = 0 } = options;
    if (settleMs > 0) await delay(settleMs);

    let bytes: Uint8Array = new Uint8Array(0);
    for (let attempt = 0; attempt <= retries; attempt++) {
        bytes = await source(scope);
        if (bytes.length > 0) break;
        if (attempt < retries) await delay(retryDelayMs);
    }
    if (bytes.length === 0) {
        throw new CaptureShotError(
            scope,
            'empty-answer',
            `no image for scope "${scope}" after ${retries + 1} attempts — the window is absent or was never realised`,
        );
    }

    const size = pngSize(bytes);
    if (!size) {
        throw new CaptureShotError(
            scope,
            'unreadable-png',
            `scope "${scope}" answered ${bytes.length} bytes that are not a PNG — refusing to write them out as an image`,
        );
    }

    try {
        // Gio's `replace_contents` takes the bytes as a GLib.Bytes, so it needs a plain
        // ArrayBuffer-backed view; `source` hands back whatever the wire produced.
        writeBytes(path, new Uint8Array(bytes));
    } catch (error) {
        throw new CaptureShotError(scope, 'write-failed', `cannot write ${path}`, error);
    }

    return { path, byteLength: bytes.length, width: size.width, height: size.height };
}
