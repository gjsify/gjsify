// `openSync` / `readSync` / `fstatSync` / `closeSync` of `@gjsify/native-fs-bridge` ON THE DEVICE: the Java
// `RandomAccessFile` half that the off-device fd-table spec fakes.
import { File, knownFolders } from '@nativescript/core';
import { closeSync, fstatSync, openSync, readSync } from '@gjsify/native-fs-bridge';

import { describe, expect, it } from '../reporter.js';

export default async function fsFdSpec(): Promise<void> {
    await describe('native-fs-bridge: openSync / readSync / fstatSync / closeSync', async () => {
        const path = `${knownFolders.documents().path}/gjsify-fd-probe.bin`;
        File.fromPath(path).writeTextSync('0123456789abcdef');
        const text = (buf: Uint8Array, n: number) => new TextDecoder().decode(buf.subarray(0, n));

        await it('reads at a position, then continues from the cursor', () => {
            const fd = openSync(path, 'r');
            const buf = new Uint8Array(4);
            expect(readSync(fd, buf, 0, 4, 10)).toBe(4);
            expect(text(buf, 4)).toBe('abcd');
            // position != null leaves the cursor at 0
            expect(readSync(fd, buf, 0, 4, null)).toBe(4);
            expect(text(buf, 4)).toBe('0123');
            expect(readSync(fd, buf, 0, 4, null)).toBe(4);
            expect(text(buf, 4)).toBe('4567');
            closeSync(fd);
        });

        await it('answers 0 at EOF', () => {
            const fd = openSync(path, 'r');
            expect(readSync(fd, new Uint8Array(4), 0, 4, 16)).toBe(0);
            closeSync(fd);
        });

        await it('EBADF after close', () => {
            const fd = openSync(path, 'r');
            closeSync(fd);
            let code = '';
            try {
                readSync(fd, new Uint8Array(1), 0, 1, 0);
            } catch (error) {
                code = (error as { code?: string }).code ?? String(error);
            }
            expect(code).toBe('EBADF');
        });

        await it('fstatSync answers the size of the open file', () => {
            const fd = openSync(path, 'r');
            const st = fstatSync(fd);
            expect(st.size).toBe(16);
            expect(st.isFile()).toBe(true);
            closeSync(fd);
        });

        await it('ENOENT for a missing file', () => {
            let code = '';
            try {
                openSync(`${path}.missing`, 'r');
            } catch (error) {
                code = (error as { code?: string }).code ?? String(error);
            }
            expect(code).toBe('ENOENT');
        });
    });
}
