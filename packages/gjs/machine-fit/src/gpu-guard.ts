/**
 * A GPU that hangs takes the whole process with it, and this is how the next start knows.
 *
 * WHY A FILE. A driver that loses the device (`vk::DeviceLostError`, a Metal command-buffer error)
 * makes llama.cpp, whisper.cpp and their kin call `abort()`: no `try/catch`, no `exit` handler,
 * nothing runs afterwards. The only thing a dead process can leave behind is what it wrote BEFORE.
 * So a process writes a marker for as long as it is using the GPU and removes it again; a marker
 * whose process is gone is the proof that a GPU session did not end cleanly, and the CPU is pinned
 * from then on.
 *
 * THE MARKER COVERS A CALL, NOT THE SESSION. An app holds a loaded model for hours; a marker for
 * that whole time would also turn a `kill -9` of an idle window into a verdict on the GPU.
 * Loading, running and unloading are the moments a device is lost, so those are the ones wrapped —
 * one marker per process, counted, so overlapping calls share it.
 *
 * PER USER, NOT PER RUN: the GPU and its driver belong to the machine. The app lifts the pin with
 * {@link GpuGuard.clear}, typically when the user sets its GPU switch to `on` (see
 * `parseGpuSetting`).
 *
 * Extracted from Stamped's semantic search (ADR 0127 decision 11).
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

export interface GpuPin {
    /** When the dead session was noticed, ISO 8601. */
    at: string;
    /** The process that died with the GPU in use. */
    pid: number;
}

export interface GpuGuardOptions {
    /** Where the pin and the markers live; {@link defaultGuardDir} for the usual place. */
    dir: string;
    pid?: number;
    /** Is a process still there? Injected so a test does not need a second process. */
    alive?: (pid: number) => boolean;
    now?: () => Date;
}

export interface GpuGuard {
    /** The pin when an earlier GPU session died without closing, after sweeping dead markers. */
    pin(): GpuPin | undefined;
    /** Run `work` with this process marked as using the GPU. */
    during<T>(work: () => Promise<T>): Promise<T>;
    /** Lift the pin; the GPU is tried again. */
    clear(): void;
    /** Drop this process's marker; for the `exit` hook, where a counted call can no longer finish. */
    release(): void;
}

const PIN_FILE = 'gpu-pin.json';
const MARKER_DIR = 'gpu-sessions';

/** `EPERM` means the process exists and belongs to somebody else. */
export function processAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return (err as { code?: string }).code === 'EPERM';
    }
}

/**
 * `$XDG_STATE_HOME/<app>`, else `~/.local/state/<app>`; `%LOCALAPPDATA%\<app>` on Windows.
 *
 * State, not cache: deleting it forgets that the driver hung, which is the one thing it exists
 * to remember.
 */
export function defaultGuardDir(
    app: string,
    env: Readonly<Record<string, string | undefined>> = process.env,
    platform: string = process.platform,
): string {
    if (env.XDG_STATE_HOME !== undefined && env.XDG_STATE_HOME !== '') return join(env.XDG_STATE_HOME, app);
    if (platform === 'win32' && env.LOCALAPPDATA) return join(env.LOCALAPPDATA, app);
    return join(env.HOME ?? env.USERPROFILE ?? '.', '.local', 'state', app);
}

/**
 * The guard NEVER makes the work fail: a state directory that cannot be written (a read-only
 * home, a full disk) means no protection, not no feature.
 */
export function createGpuGuard(options: GpuGuardOptions): GpuGuard {
    const pid = options.pid ?? process.pid;
    const alive = options.alive ?? processAlive;
    const now = options.now ?? (() => new Date());
    const markerDir = join(options.dir, MARKER_DIR);
    const markerPath = join(markerDir, `${pid}.json`);
    let busy = 0;

    const attempt = (work: () => void): void => {
        try {
            work();
        } catch {
            /* see above */
        }
    };

    const readPin = (): GpuPin | undefined => {
        try {
            return JSON.parse(readFileSync(join(options.dir, PIN_FILE), 'utf8')) as GpuPin;
        } catch {
            return undefined;
        }
    };

    /** A marker of a process that is gone becomes the pin. */
    const sweep = (): void => {
        let names: string[];
        try {
            names = readdirSync(markerDir);
        } catch {
            return;
        }
        for (const name of names) {
            const other = Number.parseInt(name, 10);
            if (!Number.isInteger(other) || other === pid || alive(other)) continue;
            attempt(() => {
                mkdirSync(options.dir, { recursive: true });
                const pin: GpuPin = { at: now().toISOString(), pid: other };
                writeFileSync(join(options.dir, PIN_FILE), JSON.stringify(pin, null, 2));
                rmSync(join(markerDir, name), { force: true });
            });
        }
    };

    const enter = (): void => {
        if (busy++ > 0) return;
        attempt(() => {
            mkdirSync(markerDir, { recursive: true });
            writeFileSync(markerPath, JSON.stringify({ pid, at: now().toISOString() }));
        });
    };

    const leave = (): void => {
        if (--busy > 0) return;
        busy = 0;
        attempt(() => rmSync(markerPath, { force: true }));
    };

    return {
        pin(): GpuPin | undefined {
            sweep();
            return readPin();
        },
        async during<T>(work: () => Promise<T>): Promise<T> {
            enter();
            try {
                return await work();
            } finally {
                leave();
            }
        },
        clear(): void {
            attempt(() => rmSync(join(options.dir, PIN_FILE), { force: true }));
        },
        release(): void {
            busy = 0;
            attempt(() => rmSync(markerPath, { force: true }));
        },
    };
}
