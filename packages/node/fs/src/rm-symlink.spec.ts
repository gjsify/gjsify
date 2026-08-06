// Regression — fs.rm{,Sync} must NOT walk into a symlinked directory's
// target. Surfaced as the "workspace-source-wipe" data-loss bug when
// gjsify install issued `rmSync(<root>/node_modules/@pkg/foo, {recursive:
// true})` against a symlink pointing at `packages/foo`: the legacy impl
// stat-followed the symlink, detected it as a directory, and recursively
// deleted every file under `packages/foo`. Node's `fs.rmSync` removes a
// top-level symlink as one entry — match that.
import { describe, it, expect } from '@gjsify/unit';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CAN_SYMLINK, NO_SYMLINK_REASON } from './capabilities.spec.js';

export default async () => {
    await describe('fs.rmSync — symlinks must not leak into target tree', async () => {
        await it.failing(
            'removes the symlink, leaves the target directory + contents intact',
            async () => {
                const tmp = mkdtempSync(join(tmpdir(), 'rm-symlink-sync-'));
                const target = join(tmp, 'workspace');
                const link = join(tmp, 'link-to-workspace');

                mkdirSync(join(target, 'src'), { recursive: true });
                writeFileSync(join(target, 'src', 'index.ts'), 'export const ok = 1;\n');
                writeFileSync(join(target, 'package.json'), '{"name":"workspace"}\n');
                symlinkSync(target, link);

                rmSync(link, { recursive: true, force: true });

                // The symlink itself is gone.
                expect(existsSync(link)).toBe(false);
                // The TARGET directory and its contents survive.
                expect(existsSync(target)).toBe(true);
                expect(existsSync(join(target, 'src', 'index.ts'))).toBe(true);
                expect(readFileSync(join(target, 'src', 'index.ts'), 'utf8')).toBe('export const ok = 1;\n');
                expect(readdirSync(join(target, 'src'))).toStrictEqual(['index.ts']);

                rmSync(tmp, { recursive: true, force: true });
            },
            NO_SYMLINK_REASON,
            { when: !CAN_SYMLINK },
        );

        await it.failing(
            'removes the symlink without --recursive, target untouched',
            async () => {
                const tmp = mkdtempSync(join(tmpdir(), 'rm-symlink-sync-no-recursive-'));
                const target = join(tmp, 'workspace');
                const link = join(tmp, 'link');
                mkdirSync(target, { recursive: true });
                writeFileSync(join(target, 'file.txt'), 'survive');
                symlinkSync(target, link);

                rmSync(link, { force: true });

                expect(existsSync(link)).toBe(false);
                expect(existsSync(target)).toBe(true);
                expect(existsSync(join(target, 'file.txt'))).toBe(true);

                rmSync(tmp, { recursive: true, force: true });
            },
            NO_SYMLINK_REASON,
            { when: !CAN_SYMLINK },
        );

        await it('still recursively removes a real directory', async () => {
            const tmp = mkdtempSync(join(tmpdir(), 'rm-real-dir-'));
            const dir = join(tmp, 'real');
            mkdirSync(join(dir, 'inner'), { recursive: true });
            writeFileSync(join(dir, 'file.txt'), 'bye');
            writeFileSync(join(dir, 'inner', 'leaf.txt'), 'gone');

            rmSync(dir, { recursive: true });

            expect(existsSync(dir)).toBe(false);
            expect(existsSync(tmp)).toBe(true);

            rmSync(tmp, { recursive: true, force: true });
        });

        await it.failing(
            'removes a symlink to a single file without affecting the file',
            async () => {
                const tmp = mkdtempSync(join(tmpdir(), 'rm-symlink-file-'));
                const target = join(tmp, 'real.txt');
                const link = join(tmp, 'link.txt');
                writeFileSync(target, 'keep me');
                symlinkSync(target, link);

                rmSync(link, { force: true });

                expect(existsSync(link)).toBe(false);
                expect(existsSync(target)).toBe(true);
                expect(readFileSync(target, 'utf8')).toBe('keep me');

                rmSync(tmp, { recursive: true, force: true });
            },
            NO_SYMLINK_REASON,
            { when: !CAN_SYMLINK },
        );
    });

    await describe('fs.promises.rm — symlinks must not leak into target tree', async () => {
        await it.failing(
            'removes the symlink, leaves the target intact',
            async () => {
                const tmp = mkdtempSync(join(tmpdir(), 'rm-symlink-promise-'));
                const target = join(tmp, 'workspace');
                const link = join(tmp, 'link');

                mkdirSync(join(target, 'src'), { recursive: true });
                writeFileSync(join(target, 'src', 'index.ts'), 'export const ok = 1;\n');
                symlinkSync(target, link);

                await rm(link, { recursive: true, force: true });

                expect(existsSync(link)).toBe(false);
                expect(existsSync(target)).toBe(true);
                expect(existsSync(join(target, 'src', 'index.ts'))).toBe(true);

                rmSync(tmp, { recursive: true, force: true });
            },
            NO_SYMLINK_REASON,
            { when: !CAN_SYMLINK },
        );
    });
};
