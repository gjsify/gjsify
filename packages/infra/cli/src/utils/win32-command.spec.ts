// Unit tests for the Windows command rewrite behind `spawnToCompletion`.
//
// The whole point of `utils/win32-command.ts` taking `platform`, `env`, `exists`
// and `join` as INJECTED context is that this suite runs on every host — the
// Linux/GJS CI included, which is where a regression in the Windows branch would
// otherwise go unseen until the weekly `cli-cross-platform` run. Same reasoning
// (and same shape) as `utils/bin-shim.spec.ts`.

import { describe, expect, it } from '@gjsify/unit';
import {
    buildCmdExeInvocation,
    escapeCmdArgument,
    escapeCmdCommand,
    lookupEnv,
    resolveWin32Command,
} from './win32-command.js';

/** Windows-shaped join, so a POSIX host still exercises backslash paths. */
const winJoin = (dir: string, file: string) => `${dir.replace(/[\\/]+$/, '')}\\${file}`;

/** Build a context whose filesystem is exactly the given set of paths. */
function ctx(files: readonly string[], env: NodeJS.ProcessEnv = {}, platform = 'win32') {
    const set = new Set(files.map((f) => f.toLowerCase()));
    return {
        platform,
        env: { PATH: 'C:\\bin', PATHEXT: '.COM;.EXE;.BAT;.CMD', ...env },
        exists: (p: string) => set.has(p.toLowerCase()),
        join: winJoin,
    };
}

export default async () => {
    await describe('resolveWin32Command — when it declines', async () => {
        await it('is a no-op off win32', () => {
            const files = ['C:\\bin\\npm.cmd'];
            expect(resolveWin32Command('npm', ['-v'], ctx(files, {}, 'linux'))).toBeUndefined();
            expect(resolveWin32Command('npm', ['-v'], ctx(files, {}, 'darwin'))).toBeUndefined();
        });

        await it('leaves a command that already carries a path or an extension alone', () => {
            const c = ctx(['C:\\bin\\npm.cmd']);
            expect(resolveWin32Command('C:\\tools\\thing.exe', [], c)).toBeUndefined();
            expect(resolveWin32Command('./local/thing', [], c)).toBeUndefined();
            expect(resolveWin32Command('npm.cmd', [], c)).toBeUndefined();
        });

        await it('declines when the command is not on PATH, so spawn still fails with ENOENT', () => {
            // The ENOENT contract is load-bearing: `notFound` install hints and
            // the `gjs`-absent fallback in commands/tsc.ts both key on it.
            expect(resolveWin32Command('nope', [], ctx([]))).toBeUndefined();
        });
    });

    await describe('resolveWin32Command — resolution', async () => {
        await it('spawns an .exe directly, by absolute path and with no interpreter', () => {
            const r = resolveWin32Command('node', ['-v'], ctx(['C:\\bin\\node.exe']));
            // The extension's CASE comes from PATHEXT (conventionally upper),
            // not from the directory entry — harmless, because Windows paths
            // are case-insensitive and both classifying regexes use /i.
            expect(r?.cmd.toLowerCase()).toBe('c:\\bin\\node.exe');
            expect(r?.args).toStrictEqual(['-v']);
            expect(r?.windowsVerbatimArguments).toBeUndefined();
        });

        await it('routes a .cmd through the interpreter — the npm case', () => {
            const r = resolveWin32Command('npm', ['run', 'build'], ctx(['C:\\bin\\npm.cmd']));
            expect(r?.cmd).toBe('cmd.exe');
            expect(r?.args[0]).toBe('/d');
            expect(r?.args[1]).toBe('/s');
            expect(r?.args[2]).toBe('/c');
            expect(r?.windowsVerbatimArguments).toBe(true);
            expect(r?.args[3].toLowerCase()).toContain('c:\\bin\\npm.cmd');
            expect(r?.args[3]).toContain('build');
        });

        await it('honours %COMSPEC% when set', () => {
            const c = ctx(['C:\\bin\\npm.cmd'], { COMSPEC: 'D:\\alt\\cmd.exe' });
            expect(resolveWin32Command('npm', [], c)?.cmd).toBe('D:\\alt\\cmd.exe');
        });

        await it('searches every PATHEXT within a directory before moving on', () => {
            // `.EXE` precedes `.CMD` in PATHEXT, so the second directory's .exe
            // must NOT win over the first directory's .cmd.
            const c = ctx(['C:\\a\\tool.cmd', 'C:\\b\\tool.exe'], { PATH: 'C:\\a;C:\\b' });
            expect(resolveWin32Command('tool', [], c)?.cmd).toBe('cmd.exe');
        });

        await it('reads PATH case-insensitively, as Windows does', () => {
            const c = ctx(['C:\\bin\\npm.cmd'], { PATH: undefined, Path: 'C:\\bin' });
            expect(resolveWin32Command('npm', [], c)?.cmd).toBe('cmd.exe');
        });
    });

    await describe('lookupEnv', async () => {
        await it('matches regardless of key case', () => {
            expect(lookupEnv({ Path: 'x' }, 'PATH')).toBe('x');
            expect(lookupEnv({ PATHEXT: '.EXE' }, 'pathext')).toBe('.EXE');
            expect(lookupEnv({ other: 'x' }, 'PATH')).toBeUndefined();
        });
    });

    await describe('cmd.exe escaping', async () => {
        await it('quotes an argument and escapes cmd meta characters', () => {
            expect(escapeCmdArgument('plain')).toBe('^"plain^"');
            expect(escapeCmdArgument('a b')).toBe('^"a^ b^"');
            expect(escapeCmdArgument('a&b')).toBe('^"a^&b^"');
        });

        await it('doubles a backslash run that precedes a quote', () => {
            // qntm.org/cmd: the run before `"` is doubled and the quote escaped,
            // then the quote is ALSO caret-escaped as a cmd meta char.
            expect(escapeCmdArgument('a\\"b')).toBe('^"a\\\\\\^"b^"');
        });

        await it('doubles a trailing backslash run so it cannot escape the closing quote', () => {
            expect(escapeCmdArgument('dir\\')).toBe('^"dir\\\\^"');
        });

        await it('escapes meta characters twice for a node_modules/.bin cmd-shim', () => {
            // The shim is itself a batch file that re-enters cmd.exe, so its meta
            // chars are interpreted a second time.
            const single = buildCmdExeInvocation('C:\\p\\bin\\tool.cmd', ['a&b']);
            const shim = buildCmdExeInvocation('C:\\p\\node_modules\\.bin\\tool.cmd', ['a&b']);
            expect(single.args[3]).toContain('^&');
            expect(shim.args[3]).toContain('^^^&');
        });

        await it('escapes the command path itself but does not quote it', () => {
            expect(escapeCmdCommand('C:\\bin\\np&m.cmd')).toBe('C:\\bin\\np^&m.cmd');
        });
    });
};
