/**
 * Everything this package asks the machine, behind one interface, so that every answer can be
 * tested against a made-up machine: a fake `/sys`, a fake `nvidia-smi`, a fake RAM size. No test
 * in this package reads the real hardware.
 *
 * Pure `node:*` calls, no GObject: the same code runs under Node (a plain dependency, nothing of
 * gjsify needed) and under GJS, where the build substitutes the `@gjsify/*` implementations.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { arch, freemem, platform, totalmem } from 'node:os';
import process from 'node:process';

export interface MachineProbe {
    readonly env: Readonly<Record<string, string | undefined>>;
    /** As `process.platform` spells it. */
    readonly platform: string;
    /** As `process.arch` spells it. */
    readonly arch: string;
    exists(path: string): boolean;
    /** The names in `dir`, or `[]` when it cannot be read. */
    list(dir: string): string[];
    /** The file's text, trimmed, or `undefined` when it cannot be read. */
    read(path: string): string | undefined;
    /** The program's stdout, or `undefined` when it is missing, fails or outlasts `timeoutMs`. */
    run(file: string, args: readonly string[], timeoutMs: number): string | undefined;
    totalmem(): number;
    /** What a new allocation can get without swapping: `MemAvailable` on Linux, not `MemFree`. */
    freemem(): number;
}

export function systemProbe(): MachineProbe {
    return {
        env: process.env,
        platform: platform(),
        arch: arch(),
        exists: (path) => existsSync(path),
        list: (dir) => {
            try {
                return readdirSync(dir);
            } catch {
                return [];
            }
        },
        read: (path) => {
            try {
                return readFileSync(path, 'utf8').trim();
            } catch {
                return undefined;
            }
        },
        run: (file, args, timeoutMs) => {
            try {
                return execFileSync(file, [...args], {
                    encoding: 'utf8',
                    timeout: timeoutMs,
                    stdio: ['ignore', 'pipe', 'ignore'],
                });
            } catch {
                return undefined;
            }
        },
        totalmem: () => totalmem(),
        freemem: () => freemem(),
    };
}
