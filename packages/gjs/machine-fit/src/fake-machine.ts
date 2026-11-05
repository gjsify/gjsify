import type { MachineProbe } from './machine-probe.js';

export interface FakeMachine {
    platform?: string;
    arch?: string;
    env?: Record<string, string | undefined>;
    /** Path → file content; a directory exists when some path lies below it. */
    files?: Record<string, string>;
    /** `"file arg arg"` → stdout. A command not listed is not installed. */
    commands?: Record<string, string>;
    totalmem?: number;
    freemem?: number;
}

/** A made-up machine for tests: no test in this package reads the real hardware. */
export function fakeMachine(machine: FakeMachine = {}): MachineProbe & { readonly ran: string[] } {
    const files = machine.files ?? {};
    const ran: string[] = [];
    return {
        ran,
        env: machine.env ?? {},
        platform: machine.platform ?? 'linux',
        arch: machine.arch ?? 'x64',
        exists: (path) => path in files || Object.keys(files).some((file) => file.startsWith(`${path}/`)),
        list: (dir) => [
            ...new Set(
                Object.keys(files)
                    .filter((file) => file.startsWith(`${dir}/`))
                    .map((file) => file.slice(dir.length + 1).split('/')[0]),
            ),
        ],
        read: (path) => files[path]?.trim(),
        run: (file, args) => {
            const command = [file, ...args].join(' ');
            ran.push(command);
            return machine.commands?.[command];
        },
        totalmem: () => machine.totalmem ?? 16 * 1024 ** 3,
        freemem: () => machine.freemem ?? 8 * 1024 ** 3,
    };
}
