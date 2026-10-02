// @gjsify/devtools — the client side of a screenshot: the bytes the control plane answered,
// turned into a file and into a size that cannot be faked.
//
// The two halves that matter are the ones a rig gets wrong silently, so both are pinned here
// against FAKE sources rather than a live window: an empty answer must never become a file,
// and the reported size must come from the bytes and not from what was asked for.

import { describe, expect, it } from '@gjsify/unit';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import { CaptureShotError, captureShot, pngSize } from './shot.js';

/** A PNG header carrying `width`×`height`, so `pngSize` reads what a real file carries. */
function fakePng(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(32);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return bytes;
}

function tmpPath(name: string): string {
    return GLib.build_filenamev([GLib.get_tmp_dir(), `gjsify-shot-spec-${name}`]);
}

function exists(path: string): boolean {
    return GLib.file_test(path, GLib.FileTest.EXISTS);
}

function readBack(path: string): Uint8Array | null {
    const [ok, bytes] = GLib.file_get_contents(path);
    return ok ? bytes : null;
}

function remove(path: string): void {
    if (exists(path)) Gio.File.new_for_path(path).delete(null);
}

async function reasonOf(run: () => Promise<unknown>): Promise<string | null> {
    try {
        await run();
    } catch (error) {
        return error instanceof CaptureShotError ? error.reason : `not-a-CaptureShotError:${error}`;
    }
    return null;
}

export default async () => {
    await describe('pngSize — the size the FILE carries', async () => {
        await it('reads width and height out of the IHDR header', async () => {
            const size = pngSize(fakePng(1280, 960));
            expect(size?.width).toBe(1280);
            expect(size?.height).toBe(960);
        });

        await it('returns null rather than a number for bytes that are not a PNG', async () => {
            expect(pngSize(new Uint8Array(64))).toBeNull();
            expect(pngSize(new Uint8Array(0))).toBeNull();
        });

        await it('returns null for a truncated header', async () => {
            expect(pngSize(fakePng(800, 600).slice(0, 20))).toBeNull();
        });
    });

    await describe('captureShot — an empty answer is a failure, not a picture', async () => {
        await it('retries while the app answers no bytes, and writes the first real one', async () => {
            const path = tmpPath('retry.png');
            const answers = [new Uint8Array(0), new Uint8Array(0), fakePng(640, 480)];
            let calls = 0;
            const result = await captureShot(async () => answers[calls++]!, path, 'window', {
                retryDelayMs: 1,
            });
            expect(calls).toBe(3);
            expect(result.width).toBe(640);
            expect(readBack(path)).toBeDefined();
            remove(path);
        });

        await it('throws rather than writing a 0-byte file once the retries are spent', async () => {
            const path = tmpPath('empty.png');
            remove(path);
            const reason = await reasonOf(() =>
                captureShot(async () => new Uint8Array(0), path, 'window', {
                    retries: 2,
                    retryDelayMs: 1,
                }),
            );
            expect(reason).toBe('empty-answer');
            // The failure that started it: no file at all, so nothing downstream can read a
            // broken PNG while believing it holds a screenshot.
            expect(exists(path)).toBe(false);
        });

        await it('refuses bytes that are not a PNG instead of writing them out as one', async () => {
            const path = tmpPath('garbage.png');
            remove(path);
            const reason = await reasonOf(() => captureShot(async () => new Uint8Array(64).fill(7), path));
            expect(reason).toBe('unreadable-png');
            expect(exists(path)).toBe(false);
        });

        await it('reports the size the bytes carry, not the size that was asked for', async () => {
            const path = tmpPath('size.png');
            // What a rig measures when the window ignored the resize: 1280 asked, 1100
            // delivered. Reporting the request is how four checks stayed green over a
            // picture at the wrong size.
            const result = await captureShot(async () => fakePng(1100, 900), path, 'window');
            expect(result.width).toBe(1100);
            expect(result.height).toBe(900);
            remove(path);
        });

        await it('replaces an existing file with the new bytes', async () => {
            const path = tmpPath('replace.png');
            remove(path);
            await captureShot(async () => fakePng(320, 240), path, 'window');
            await captureShot(async () => fakePng(800, 600), path, 'window');
            expect(pngSize(readBack(path)!)?.width).toBe(800);
            remove(path);
        });

        await it('reports a write failure instead of claiming a screenshot', async () => {
            const path = GLib.build_filenamev([GLib.get_tmp_dir(), 'no-such-dir-shot', 'x.png']);
            expect(await reasonOf(() => captureShot(async () => fakePng(10, 10), path))).toBe('write-failed');
        });
    });
};
