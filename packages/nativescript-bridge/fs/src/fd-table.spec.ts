// The descriptor contract of the synchronous bridge, over a fake backend (no device needed).

import { describe, it, expect } from '@gjsify/unit';

import { createFdTable, type FdBackend } from './fd-table.js';

const DATA = Uint8Array.from({ length: 100 }, (_, i) => i);

function fake(): { backend: FdBackend; closed: () => number } {
    let closed = 0;
    return {
        closed: () => closed,
        backend: {
            openRead: (path) =>
                path === '/data'
                    ? {
                          readAt: (position, length) => DATA.slice(position, position + length),
                          close: () => void closed++,
                      }
                    : null,
        },
    };
}

const codeOf = (fn: () => unknown): string | undefined => {
    try {
        fn();
    } catch (e) {
        return (e as { code?: string }).code;
    }
    return undefined;
};

export default async () => {
    await describe('native-fs-bridge descriptor table', async () => {
        await it('opens at a descriptor that is not stdio', () => {
            const t = createFdTable(fake().backend);
            expect(t.openSync('/data') >= 3).toBe(true);
        });

        await it('reads at an explicit position into a buffer offset', () => {
            const t = createFdTable(fake().backend);
            const fd = t.openSync('/data', 'r');
            const buf = new Uint8Array(8);
            expect(t.readSync(fd, buf, 2, 4, 10)).toBe(4);
            expect(Array.from(buf)).toStrictEqual([0, 0, 10, 11, 12, 13, 0, 0]);
        });

        await it('continues from the cursor for position null, and an explicit position does not move it', () => {
            const t = createFdTable(fake().backend);
            const fd = t.openSync('/data');
            const buf = new Uint8Array(3);
            t.readSync(fd, buf, 0, 3, null);
            t.readSync(fd, buf, 0, 3, 50);
            t.readSync(fd, buf, 0, 3, null);
            expect(Array.from(buf)).toStrictEqual([3, 4, 5]);
        });

        await it('accepts the options-object form', () => {
            const t = createFdTable(fake().backend);
            const fd = t.openSync('/data');
            const buf = new Uint8Array(4);
            expect(t.readSync(fd, buf, { position: 90, length: 4 })).toBe(4);
            expect(Array.from(buf)).toStrictEqual([90, 91, 92, 93]);
        });

        await it('answers a short count at EOF and 0 past it', () => {
            const t = createFdTable(fake().backend);
            const fd = t.openSync('/data');
            const buf = new Uint8Array(10);
            expect(t.readSync(fd, buf, 0, 10, 95)).toBe(5);
            expect(t.readSync(fd, buf, 0, 10, 100)).toBe(0);
        });

        await it('ENOENT for a missing file, ENOSYS for a write flag', () => {
            const t = createFdTable(fake().backend);
            expect(codeOf(() => t.openSync('/missing'))).toBe('ENOENT');
            expect(codeOf(() => t.openSync('/data', 'w'))).toBe('ENOSYS');
        });

        await it('EBADF for an unknown or closed descriptor; close reaches the handle once', () => {
            const f = fake();
            const t = createFdTable(f.backend);
            const fd = t.openSync('/data');
            t.closeSync(fd);
            expect(f.closed()).toBe(1);
            expect(codeOf(() => t.readSync(fd, new Uint8Array(1)))).toBe('EBADF');
            expect(codeOf(() => t.closeSync(fd))).toBe('EBADF');
        });

        await it('rejects a range outside the buffer', () => {
            const t = createFdTable(fake().backend);
            const fd = t.openSync('/data');
            expect(codeOf(() => t.readSync(fd, new Uint8Array(4), 0, 5, 0))).toBe('ERR_OUT_OF_RANGE');
        });
    });
};
