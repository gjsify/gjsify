// The Windows driver (ADR 0144 § 2): the HKCU Run key, written with `reg.exe`. It asks nothing, so
// it answers `granted`. GWin32RegistryKey cannot marshal a value in or out of JS (see
// adwaita-app's appearance/win32.ts), so `reg.exe` is the reachable API, run with an argv array.
//
// NOT MEASURED ON WINDOWS. The argv construction and the mapping are tested on every host
// (`portal.windows.spec.ts`); spawning reg.exe and the registry layout are not.

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import { refusal, subsetOf } from './refusal.js';
import { wantsAutostart } from './wish.js';

export const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

/** stdout when the tool exits 0, `null` otherwise (including a tool that is missing). */
export type RunTool = (argv: readonly string[]) => Promise<string | null>;

// An argument CommandLineToArgvW reads back unchanged: backslashes only matter before a quote.
export function quoteWindowsArg(arg: string): string {
    if (arg.includes('\0') || arg.includes('\n') || arg.includes('\r'))
        throw new RangeError('a Run-key command-line argument cannot contain a newline or NUL');
    if (arg !== '' && !/[\s"]/.test(arg)) return arg;
    let out = '"';
    let backslashes = 0;
    for (const char of arg) {
        if (char === '\\') {
            backslashes++;
            continue;
        }
        out += char === '"' ? '\\'.repeat(backslashes * 2 + 1) + '"' : '\\'.repeat(backslashes) + char;
        backslashes = 0;
    }
    return `${out}${'\\'.repeat(backslashes * 2)}"`;
}

export function runCommandLine(commandline: readonly string[]): string {
    if (commandline.length === 0) throw new RangeError('a Run-key command line needs at least the program');
    return commandline.map(quoteWindowsArg).join(' ');
}

export function addArgv(appId: string, commandline: readonly string[]): string[] {
    return ['reg', 'add', RUN_KEY, '/v', appId, '/t', 'REG_SZ', '/d', runCommandLine(commandline), '/f'];
}
export const queryArgv = (appId: string): string[] => ['reg', 'query', RUN_KEY, '/v', appId];
export const deleteArgv = (appId: string): string[] => ['reg', 'delete', RUN_KEY, '/v', appId, '/f'];

/** A packaged (MSIX) app lives under `WindowsApps` and needs `StartupTask`, which is not built. */
export function isPackagedProgram(program: string): boolean {
    return /[\\/]WindowsApps[\\/]/i.test(program);
}

export function failure(code: number, message: string): GLib.Error {
    return GLib.Error.new_literal(Gio.io_error_quark(), code, message);
}

/**
 * Make the Run value match the wish. Removing a missing value is done: it is looked up first,
 * because `reg delete` exits non-zero for "not there".
 */
export async function applyRunKey(
    run: RunTool,
    request: { appId: string; commandline?: readonly string[] | null; flags: number },
): Promise<void> {
    if (!wantsAutostart(request.flags)) {
        if ((await run(queryArgv(request.appId))) === null) return;
        if ((await run(deleteArgv(request.appId))) === null) {
            throw failure(Gio.IOErrorEnum.FAILED, `reg.exe could not delete the Run value "${request.appId}"`);
        }
        return;
    }
    const commandline = request.commandline;
    if (!commandline || commandline.length === 0) {
        throw failure(Gio.IOErrorEnum.INVALID_ARGUMENT, 'a command line is needed to write the Run value');
    }
    if (isPackagedProgram(commandline[0])) {
        throw refusal('request_background for a packaged (MSIX) app', 'windows');
    }
    if ((await run(addArgv(request.appId, commandline))) === null) {
        throw failure(Gio.IOErrorEnum.FAILED, `reg.exe could not write the Run value "${request.appId}"`);
    }
}

/** The same `runTool` shape as adwaita-app's appearance/run-tool.ts: argv array, no shell. */
export const spawnTool: RunTool = (argv) =>
    new Promise((resolve) => {
        let child: Gio.Subprocess;
        try {
            child = Gio.Subprocess.new([...argv], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch {
            resolve(null);
            return;
        }
        child.communicate_utf8_async(null, null, (source, result) => {
            try {
                const [, stdout] = (source as Gio.Subprocess).communicate_utf8_finish(result);
                resolve((source as Gio.Subprocess).get_successful() ? (stdout ?? '') : null);
            } catch {
                resolve(null);
            }
        });
    });

const MEMBERS: ReadonlySet<string | symbol> = new Set([
    'request_background',
    'request_background_finish',
    'set_background_status',
    'set_background_status_finish',
]);

type Settled = { readonly error: unknown } | { readonly error?: undefined };

/** The four Background members of `Xdp.Portal`, over the Run key; every other member throws by name. */
export function createWindowsPortal(run: RunTool, appId: string) {
    const settle = (promise: Promise<void>, callback: (source: object, result: object) => void) => {
        const source = {};
        promise.then(
            () => callback(source, { error: undefined } as Settled),
            (error) => callback(source, { error } as Settled),
        );
    };
    const portal = {
        request_background(
            _parent: unknown,
            _reason: string | null,
            commandline: string[] | null,
            flags: number,
            cancellable: Gio.Cancellable | null,
            callback: (source: object, result: object) => void,
        ) {
            settle(
                (async () => {
                    cancellable?.set_error_if_cancelled();
                    await applyRunKey(run, { appId, commandline, flags });
                })(),
                callback,
            );
        },
        request_background_finish(result: Settled): boolean {
            if (result.error !== undefined) throw result.error;
            return true;
        },
        // Decoration: there is no status line on the Run key, and a throw would make every caller guard it.
        set_background_status(_status: string | null, _cancellable: unknown, callback: (s: object, r: object) => void) {
            settle(Promise.resolve(), callback);
        },
        set_background_status_finish(_result: unknown): boolean {
            return true;
        },
    };
    return subsetOf(portal, MEMBERS, 'windows');
}
