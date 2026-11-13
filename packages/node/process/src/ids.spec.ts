import { describe, it, expect } from '@gjsify/unit';

import process from 'node:process';
import { execFileSync } from 'node:child_process';

const IS_WIN32 = process.platform === 'win32';

const idOf = (flag: string): number => Number(execFileSync('id', [flag], { encoding: 'utf8' }).trim());

export default async () => {
    if (IS_WIN32) return;

    await describe('process: getuid / geteuid / getgid / getegid', async () => {
        await it('are functions on POSIX', async () => {
            expect(typeof process.getuid).toBe('function');
            expect(typeof process.geteuid).toBe('function');
            expect(typeof process.getgid).toBe('function');
            expect(typeof process.getegid).toBe('function');
        });

        await it('getuid() matches `id -ru`', async () => {
            expect(process.getuid!()).toBe(idOf('-ru'));
        });

        await it('geteuid() matches `id -u`', async () => {
            expect(process.geteuid!()).toBe(idOf('-u'));
        });

        await it('getgid() matches `id -rg`', async () => {
            expect(process.getgid!()).toBe(idOf('-rg'));
        });

        await it('getegid() matches `id -g`', async () => {
            expect(process.getegid!()).toBe(idOf('-g'));
        });

        await it('return non-negative integers', async () => {
            for (const id of [process.getuid!(), process.geteuid!(), process.getgid!(), process.getegid!()]) {
                expect(Number.isInteger(id) && id >= 0).toBe(true);
            }
        });
    });
};
