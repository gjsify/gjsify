import { describe, it, expect } from '@gjsify/unit';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createGpuGuard, defaultGuardDir } from './index.js';

const AT = new Date('2026-11-05T12:00:00Z');

export default async () => {
    await describe('defaultGuardDir', async () => {
        await it('prefers XDG_STATE_HOME, then ~/.local/state, and LOCALAPPDATA on Windows', async () => {
            expect(defaultGuardDir('app', { XDG_STATE_HOME: '/s', HOME: '/h' }, 'linux')).toBe('/s/app');
            expect(defaultGuardDir('app', { HOME: '/h' }, 'linux')).toBe('/h/.local/state/app');
            expect(defaultGuardDir('app', { LOCALAPPDATA: 'C:/L', HOME: '/h' }, 'win32')).toBe(join('C:/L', 'app'));
        });
    });

    await describe('createGpuGuard', async () => {
        const fresh = () => mkdtempSync(join(tmpdir(), 'machine-fit-guard-'));

        await it('marks the process during the work and removes the mark after', async () => {
            const dir = fresh();
            const guard = createGpuGuard({ dir, pid: 100, alive: () => true, now: () => AT });
            let seen: string[] = [];
            await guard.during(async () => {
                seen = readdirSync(join(dir, 'gpu-sessions'));
            });
            expect(seen).toStrictEqual(['100.json']);
            expect(readdirSync(join(dir, 'gpu-sessions'))).toStrictEqual([]);
            rmSync(dir, { recursive: true, force: true });
        });

        await it('removes the mark when the work throws', async () => {
            const dir = fresh();
            const guard = createGpuGuard({ dir, pid: 100, alive: () => true });
            await guard.during(async () => Promise.reject(new Error('device lost'))).catch(() => undefined);
            expect(readdirSync(join(dir, 'gpu-sessions'))).toStrictEqual([]);
            rmSync(dir, { recursive: true, force: true });
        });

        await it('turns the mark of a process that died during the work into a pin', async () => {
            const dir = fresh();
            const dying = createGpuGuard({ dir, pid: 100, alive: () => true, now: () => AT });
            // The work never returns: the process is gone mid-call, as after an abort().
            void dying.during(() => new Promise(() => undefined));
            const next = createGpuGuard({ dir, pid: 200, alive: (pid) => pid !== 100, now: () => AT });
            expect(next.pin()).toStrictEqual({ at: AT.toISOString(), pid: 100 });
            expect(existsSync(join(dir, 'gpu-sessions', '100.json'))).toBe(false);
            next.clear();
            expect(next.pin()).toBe(undefined);
            rmSync(dir, { recursive: true, force: true });
        });

        await it("does not pin on a live process's mark, nor on overlapping calls ending", async () => {
            const dir = fresh();
            const guard = createGpuGuard({ dir, pid: 100, alive: () => true });
            let release: () => void = () => undefined;
            const long = guard.during(() => new Promise<void>((resolve) => (release = resolve)));
            await guard.during(async () => undefined);
            // The short call ended, the long one still holds the shared mark.
            expect(readdirSync(join(dir, 'gpu-sessions'))).toStrictEqual(['100.json']);
            expect(createGpuGuard({ dir, pid: 200, alive: () => true }).pin()).toBe(undefined);
            release();
            await long;
            expect(readdirSync(join(dir, 'gpu-sessions'))).toStrictEqual([]);
            rmSync(dir, { recursive: true, force: true });
        });

        await it('never fails the work when the directory cannot be written', async () => {
            // Below a regular file, so every write fails with ENOTDIR. (Not /proc: Node's recursive
            // mkdirSync loops forever there.)
            const dir = fresh();
            const file = join(dir, 'a-file');
            writeFileSync(file, '');
            const guard = createGpuGuard({ dir: join(file, 'state'), pid: 100 });
            expect(await guard.during(async () => 42)).toBe(42);
            expect(guard.pin()).toBe(undefined);
            rmSync(dir, { recursive: true, force: true });
        });
    });
};
