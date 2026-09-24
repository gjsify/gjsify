// Unit tests for `gjsify env`'s argv split and environment merge — the parts that
// decide WHAT runs; the spawn itself is `spawnToCompletion`'s, tested there.

import { describe, expect, it } from '@gjsify/unit';
import { applyAssignments, splitEnvArgv } from './env.js';

export default async () => {
    await describe('gjsify env — splitEnvArgv', async () => {
        await it('takes leading NAME=VALUE words, then the command and its args', () => {
            const r = splitEnvArgv(['LC_ALL=C', 'NODE_GI_NATIVE=build', 'node', '--test', '--expose-gc']);
            expect(r?.assignments).toStrictEqual([
                ['LC_ALL', 'C'],
                ['NODE_GI_NATIVE', 'build'],
            ]);
            expect(r?.command).toBe('node');
            expect(r?.args).toStrictEqual(['--test', '--expose-gc']);
        });

        await it('passes a later X=y through as an argument, as env(1) does', () => {
            const r = splitEnvArgv(['A=1', 'node', 'B=2']);
            expect(r?.command).toBe('node');
            expect(r?.args).toStrictEqual(['B=2']);
        });

        await it('keeps an empty value and a value containing `=`', () => {
            const r = splitEnvArgv(['EMPTY=', 'URL=a=b', 'cmd']);
            expect(r?.assignments).toStrictEqual([
                ['EMPTY', ''],
                ['URL', 'a=b'],
            ]);
        });

        await it('is null when no command follows', () => {
            expect(splitEnvArgv(['A=1'])).toBeNull();
            expect(splitEnvArgv([])).toBeNull();
        });

        await it('runs a command with no assignments at all', () => {
            expect(splitEnvArgv(['node', '-v'])?.command).toBe('node');
        });
    });

    await describe('gjsify env — applyAssignments', async () => {
        await it('overrides and adds without touching the base object', () => {
            const base = { HOME: '/h', LC_ALL: 'de_DE.UTF-8' };
            const env = applyAssignments(
                base,
                [
                    ['LC_ALL', 'C'],
                    ['NEW', '1'],
                ],
                'linux',
            );
            expect(env.LC_ALL).toBe('C');
            expect(env.NEW).toBe('1');
            expect(base.LC_ALL).toBe('de_DE.UTF-8');
        });

        await it('on win32, replaces a differently-cased key instead of adding a second one', () => {
            const env = applyAssignments({ Path: 'C:\\old' }, [['PATH', 'C:\\new']], 'win32');
            expect(Object.keys(env)).toStrictEqual(['PATH']);
            expect(env.PATH).toBe('C:\\new');
        });

        await it('off win32, names are case-sensitive and both survive', () => {
            const env = applyAssignments({ Path: '/old' }, [['PATH', '/new']], 'linux');
            expect(Object.keys(env).sort()).toStrictEqual(['PATH', 'Path']);
        });
    });
};
