// The Windows driver's argv construction and mapping, run on Linux with a stand-in `reg.exe`.
// A real Windows run was not possible: spawning reg.exe and the registry layout are unverified.
import { describe, expect, it } from '@gjsify/unit';
import Gio from 'gi://Gio?version=2.0';
import type GLib from 'gi://GLib?version=2.0';

import { realHost, requestBackground, setBackgroundStatus, type BackgroundHost } from './background.js';
import {
    addArgv,
    applyRunKey,
    createWindowsPortal,
    deleteArgv,
    isPackagedProgram,
    queryArgv,
    quoteWindowsArg,
    RUN_KEY,
    type RunTool,
} from './portal.windows.js';

const APP = 'org.example.App';
const EXE = 'C:\\Program Files\\Example\\app.exe';

function recorder(answers: Record<string, string | null> = {}) {
    const calls: string[][] = [];
    const run: RunTool = async (argv) => {
        calls.push([...argv]);
        return argv[1] in answers ? answers[argv[1]] : '';
    };
    return { run, calls };
}

async function rejection(promise: Promise<unknown>): Promise<GLib.Error | undefined> {
    try {
        await promise;
    } catch (error) {
        return error as GLib.Error;
    }
    return undefined;
}

function windowsHost(run: RunTool): BackgroundHost {
    return {
        ...realHost,
        platform: () => 'windows',
        windowsPortal: (appId) =>
            createWindowsPortal(run, appId) as unknown as ReturnType<BackgroundHost['windowsPortal']>,
    };
}

export default async () => {
    await describe('quoteWindowsArg', async () => {
        await it('leaves a plain word alone', async () => {
            expect(quoteWindowsArg('--tray')).toBe('--tray');
        });
        await it('quotes a space and the empty argument', async () => {
            expect(quoteWindowsArg(EXE)).toBe(`"${EXE}"`);
            expect(quoteWindowsArg('')).toBe('""');
        });
        await it('escapes a quote and doubles the backslashes before it and at the end', async () => {
            expect(quoteWindowsArg('a"b')).toBe('"a\\"b"');
            expect(quoteWindowsArg('a\\"b')).toBe('"a\\\\\\"b"');
            expect(quoteWindowsArg('C:\\my dir\\')).toBe('"C:\\my dir\\\\"');
        });
        await it('rejects a newline', async () => {
            expect(() => quoteWindowsArg('a\nb')).toThrow();
        });
    });
    await describe('reg.exe argv', async () => {
        await it('add: an argv array with the Run key, REG_SZ and force', async () => {
            expect(JSON.stringify(addArgv(APP, [EXE, '--tray']))).toBe(
                JSON.stringify(['reg', 'add', RUN_KEY, '/v', APP, '/t', 'REG_SZ', '/d', `"${EXE}" --tray`, '/f']),
            );
        });
        await it('query and delete name the value', async () => {
            expect(JSON.stringify(queryArgv(APP))).toBe(JSON.stringify(['reg', 'query', RUN_KEY, '/v', APP]));
            expect(JSON.stringify(deleteArgv(APP))).toBe(JSON.stringify(['reg', 'delete', RUN_KEY, '/v', APP, '/f']));
        });
        await it('recognises a packaged program', async () => {
            expect(isPackagedProgram('C:\\Program Files\\WindowsApps\\Pkg_1.0\\app.exe')).toBe(true);
            expect(isPackagedProgram(EXE)).toBe(false);
        });
    });
    await describe('applyRunKey (whole wish)', async () => {
        await it('AUTOSTART writes the value', async () => {
            const { run, calls } = recorder();
            await applyRunKey(run, { appId: APP, commandline: [EXE], flags: 1 });
            expect(calls.length).toBe(1);
            expect(calls[0][1]).toBe('add');
        });
        await it('ACTIVATABLE alone is accepted, ignored, and removes the value', async () => {
            const { run, calls } = recorder();
            await applyRunKey(run, { appId: APP, commandline: [EXE], flags: 2 });
            expect(JSON.stringify(calls.map((c) => c[1]))).toBe(JSON.stringify(['query', 'delete']));
        });
        await it('removing a value that is not there is done, without a delete', async () => {
            const { run, calls } = recorder({ query: null });
            await applyRunKey(run, { appId: APP, flags: 0 });
            expect(JSON.stringify(calls.map((c) => c[1]))).toBe(JSON.stringify(['query']));
        });
        await it('a failing add throws FAILED', async () => {
            const { run } = recorder({ add: null });
            const error = await rejection(applyRunKey(run, { appId: APP, commandline: [EXE], flags: 1 }));
            expect(error?.matches(Gio.io_error_quark(), Gio.IOErrorEnum.FAILED)).toBe(true);
        });
        await it('a missing command line throws INVALID_ARGUMENT', async () => {
            const { run, calls } = recorder();
            const error = await rejection(applyRunKey(run, { appId: APP, flags: 1 }));
            expect(error?.matches(Gio.io_error_quark(), Gio.IOErrorEnum.INVALID_ARGUMENT)).toBe(true);
            expect(calls.length).toBe(0);
        });
        await it('a packaged (MSIX) app throws by name and writes nothing', async () => {
            const { run, calls } = recorder();
            const error = await rejection(
                applyRunKey(run, { appId: APP, commandline: ['C:\\Program Files\\WindowsApps\\P\\app.exe'], flags: 1 }),
            );
            expect(error?.message.includes('MSIX')).toBe(true);
            expect(calls.length).toBe(0);
        });
    });
    await describe('requestBackground on the Windows driver', async () => {
        await it('resolves granted and runs reg add', async () => {
            const { run, calls } = recorder();
            const outcome = await requestBackground({ appId: APP, commandline: [EXE], flags: 1 }, windowsHost(run));
            expect(outcome).toBe('granted');
            expect(calls[0][1]).toBe('add');
        });
        await it('set_background_status completes and spawns nothing', async () => {
            const { run, calls } = recorder();
            await setBackgroundStatus('syncing', null, windowsHost(run));
            expect(calls.length).toBe(0);
        });
        await it('a member outside the subset throws, naming it', async () => {
            const portal = createWindowsPortal(recorder().run, APP) as unknown as Record<string, unknown>;
            let message = '';
            try {
                void portal.open_file;
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message.includes('Portal.open_file')).toBe(true);
        });
    });
};
