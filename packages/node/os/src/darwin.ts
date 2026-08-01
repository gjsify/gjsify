// Reference: Node.js lib/os.js — macOS-specific os module helpers
// Reimplemented for GJS using GLib

import { createSubnet } from './createSubnet.js';
import { cli } from '@gjsify/utils';

const NOMAC = '00:00:00:00:00:00';

const getIPv6Subnet = createSubnet(128, 16, 16, ':');

const parseInterfaces = function (info) {
    info = info.trim();
    // `\binet\b` does NOT match `inet6` (no word boundary between `t` and `6`),
    // so keying the guard on it dropped every IPv6-ONLY interface — on a stock
    // macOS that is every `utun*` VPN/tunnel device, which Node reports.
    if (info.length < 1 || !/\binet6?\b/.test(info)) return;
    const lines = info.split('\n');
    const iface = [];
    const length = lines.length;
    let mac = NOMAC;
    // Node derives `internal` from the interface's IFF_LOOPBACK flag, not from
    // the address. `ifconfig` prints those flags in the group's header line
    // (`lo0: flags=8049<UP,LOOPBACK,…>`), which is the only place the loopback
    // property is stated for BOTH families — a loopback interface carries no
    // `ether` line, so the previous `mac !== NOMAC` test reported the exact
    // inverse for every IPv6 address: `::1` came back external while a real
    // NIC's `fe80::` came back internal.
    const internal = /<[^>]*\bLOOPBACK\b[^>]*>/.test(lines[0] ?? '');
    for (let line, i = 0; i < length; i++) {
        line = lines[i];
        switch (true) {
            case /ether\s+((?:\S{2}:)+\S{2})/.test(line):
                mac = RegExp.$1;
                break;
            case /inet\s+(\d+\.\d+\.\d+\.\d+)\s+netmask\s+0x(.{2})(.{2})(.{2})(.{2})/.test(line):
                iface.push({
                    address: RegExp.$1,
                    netmask: [
                        parseInt(RegExp.$2, 16),
                        parseInt(RegExp.$3, 16),
                        parseInt(RegExp.$4, 16),
                        parseInt(RegExp.$5, 16),
                    ].join('.'),
                    family: 'IPv4',
                    mac: mac,
                    internal,
                });
                break;
            // The address is captured up to the zone index, which `ifconfig`
            // appends for link-local addresses (`fe80::1%lo0`). The previous
            // `\S{1,4}` tail swallowed it into the address itself, yielding the
            // malformed `fe80::1%lo`; Node reports the bare `fe80::1`.
            case /inet6\s+([^\s%]+)(?:%\S+)?\s+prefixlen\s+(\d+)/.test(line):
                iface.push({
                    address: RegExp.$1,
                    netmask: getIPv6Subnet(RegExp.$2),
                    family: 'IPv6',
                    mac: mac,
                    internal,
                });
                break;
        }
    }
    this[info.slice(0, info.indexOf(':'))] = iface;
};

/**
 * Read one `sysctl` key, or `null` when the host does not have it.
 *
 * `cli()` throws whenever the child writes ANYTHING to stderr, and `sysctl`
 * does exactly that for an unknown key (`sysctl: unknown oid '…'`). Two of the
 * keys below are Intel-only — Apple Silicon publishes neither
 * `machdep.cpu.brand_string` nor `hw.cpufrequency` — so calling `cli()` bare
 * made `os.cpus()` THROW on every arm64 Mac rather than degrade.
 */
const sysctl = (key: string): string | null => {
    try {
        const value = cli(`sysctl -n ${key}`).trim();
        return value.length > 0 ? value : null;
    } catch {
        return null;
    }
};

// PORTED TO deno runtime
export const cpus = () => {
    const cores = parseFloat(cli('sysctl -n hw.ncpu'));
    // Hoisted out of the loop: these are per-MACHINE facts, so querying them
    // per core spawned one `sysctl` per CPU (64 subprocesses on a Mac Pro) to
    // recompute the same two strings.
    const model = sysctl('machdep.cpu.brand_string')?.replace(/\s+/g, ' ') ?? 'unknown';
    // Node reports MHz. Apple Silicon exposes no frequency oid at all and Node
    // reports 0 there, so an absent key degrades to 0 rather than NaN.
    const hz = sysctl('hw.cpufrequency');
    const speed = hz ? parseFloat(hz) / 1000 / 1000 : 0;
    const cpus = [];
    for (let i = 0; i < cores; i++) {
        cpus.push({
            model,
            speed,
            get times() {
                console.warn('cpus.times is not supported');
                return {};
            },
        });
    }
    return cpus;
};

export const endianness = () => 'LE';

/**
 * Get free memory on macOS using vm_stat.
 * vm_stat reports memory pages; multiply by page size to get bytes.
 * "free" pages + "speculative" pages approximate available memory.
 * Falls back to (hw.memsize - hw.physmem) if vm_stat is unavailable.
 */
export const freemem = () => {
    try {
        const vmstat = cli('vm_stat');
        // Parse page size from first line: "Mach Virtual Memory Statistics: (page size of 16384 bytes)"
        const pageSizeMatch = /page size of (\d+) bytes/.exec(vmstat);
        const pageSize = pageSizeMatch ? parseInt(pageSizeMatch[1], 10) : 16384;

        // Parse "Pages free" and "Pages speculative" (inactive can be reclaimed too)
        let freePages = 0;
        const freeMatch = /Pages free:\s+(\d+)/.exec(vmstat);
        if (freeMatch) freePages += parseInt(freeMatch[1], 10);

        // "Pages speculative" are also considered free/available
        const specMatch = /Pages speculative:\s+(\d+)/.exec(vmstat);
        if (specMatch) freePages += parseInt(specMatch[1], 10);

        // Include purgeable pages as available (can be reclaimed)
        const purgeMatch = /Pages purgeable:\s+(\d+)/.exec(vmstat);
        if (purgeMatch) freePages += parseInt(purgeMatch[1], 10);

        if (freePages > 0) return freePages * pageSize;
    } catch {
        // vm_stat not available, fall back
    }

    // Fallback: difference between hw.memsize and hw.physmem
    // (not accurate but better than 0)
    try {
        return parseFloat(cli('sysctl -n hw.memsize')) - parseFloat(cli('sysctl -n hw.physmem'));
    } catch {
        return 0;
    }
};

// PORTED TO deno runtime
/**
 * Node's `os.loadavg()` is typed `number[]` and documented to always yield the
 * 1/5/15-minute triple. The `&&` form returned the BOOLEAN `false` whenever the
 * `uptime` output did not match, so a caller doing `loadavg()[0]` crashed
 * instead of reading a zero.
 */
export const loadavg = (): number[] =>
    /load\s+averages:\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/.test(cli('uptime'))
        ? [parseFloat(RegExp.$1), parseFloat(RegExp.$2), parseFloat(RegExp.$3)]
        : [0, 0, 0];

export const networkInterfaces = () => {
    const ifaces = {};
    const groups = [];
    const lines = cli('ifconfig').split(/\r\n|\n/);
    const length = lines.length;
    for (let group = [], re = /^\S+?:/, i = 0; i < length; i++) {
        if (re.test(lines[i])) {
            group = [lines[i]];
            while (++i < length && !re.test(lines[i])) {
                group.push(lines[i]);
            }
            --i;
        }
        groups.push(group.join('\n'));
    }
    groups.forEach(parseInterfaces, ifaces);
    return ifaces;
};

/**
 * Get total memory on macOS using sysctl hw.memsize.
 */
export const totalmem = () => {
    try {
        return parseFloat(cli('sysctl -n hw.memsize'));
    } catch {
        return 0;
    }
};

// PORTED TO deno runtime
export const uptime = () => {
    // Try sysctl kern.boottime first (most reliable)
    try {
        const boottime = cli('sysctl -n kern.boottime');
        // Format: "{ sec = 1711234567, usec = 123456 } Mon Mar 25 ..."
        const secMatch = /sec\s*=\s*(\d+)/.exec(boottime);
        if (secMatch) {
            const bootSec = parseInt(secMatch[1], 10);
            const nowSec = Math.floor(Date.now() / 1000);
            return nowSec - bootSec;
        }
    } catch {
        // fall through
    }

    // Fallback: parse uptime command output
    const output = cli('uptime');
    const up = /up\s+([^,]+)?,/.test(output) && RegExp.$1;
    switch (true) {
        case /^(\d+):(\d+)$/.test(up as string):
            return (parseInt(RegExp.$1, 10) * 60 + parseInt(RegExp.$2, 10)) * 60;
        case /^(\d+)\s+mins?$/.test(up as string):
            return parseInt(RegExp.$1, 10) * 60;
        case /^(\d+)\s+days?$/.test(up as string): {
            const days = parseInt(RegExp.$1, 10) * 86400;
            // Check for "N days, HH:MM" format
            const timeMatch = /days?,\s+(\d+):(\d+)/.exec(output);
            if (timeMatch) {
                return days + (parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10)) * 60;
            }
            return days;
        }
    }
    return 0;
};
