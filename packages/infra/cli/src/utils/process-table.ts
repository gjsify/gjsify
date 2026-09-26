// SPDX-License-Identifier: MIT
// What the CLI asks the OS about OTHER processes — is this pid alive, who are
// its descendants — answered in ONE place, for Node and GJS hosts alike.
//
// Both questions used to be answered only by reading `/proc`, in two files
// (`install-lock.ts`, `commands/foreach.ts`). procfs is a LINUX filesystem, and
// on macOS neither reader failed — each returned a plausible, wrong answer:
//
//   - `foreach`'s fail-fast tree kill found NO descendants, so it signalled only
//     the direct `npm run` child and left its shell → gjs/node build grandchildren
//     running (the orphaned-bundler-at-100%-CPU shape the tree kill exists for).
//   - `install-lock`'s liveness probe fell back to `process.kill(pid, 0)`, whose
//     GJS implementation returned `true` for every pid, so a crashed install's
//     lock was never stolen as dead-owner — only after the 35-min budget.
//
// So every reader here is chosen by what the host HAS (procfs readable?), never
// by platform name — a Linux container can lack procfs too. Only the no-procfs
// fallback's COMMAND depends on the platform, because Windows has no `ps`.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

/**
 * Is `pid` a live process on this machine?
 *
 * `/proc/<pid>` where procfs exists (one stat, no subprocess, identical under
 * Node and GJS); elsewhere Node's signal-0 probe — `ESRCH` dead, `EPERM`
 * alive-but-foreign. Any OTHER outcome counts as ALIVE: callers use this to
 * decide whether something may be taken away from its owner, and "cannot tell"
 * must never read as "gone".
 */
export function isPidAlive(pid: number): boolean {
    // `existsSync` never throws by contract: Node returns false on any error, and
    // the GJS shim is a typeof guard + Gio `query_exists`.
    if (existsSync('/proc/self')) return existsSync(`/proc/${pid}`);
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return (err as NodeJS.ErrnoException).code !== 'ESRCH';
    }
}

/**
 * Parse `ps -A -o pid=,ppid=` output (two integer columns, blank headers) into
 * ppid → children. Exported for the unit test; the format is POSIX, so procps
 * on Linux and the BSD `ps` on macOS print the same shape.
 */
export function parsePsPidPpid(output: string): Map<number, number[]> {
    const map = new Map<number, number[]>();
    for (const line of output.split('\n')) {
        const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
        if (!m) continue;
        const pid = Number(m[1]);
        const ppid = Number(m[2]);
        if (pid <= 0 || ppid <= 0 || pid === ppid) continue;
        const siblings = map.get(ppid);
        if (siblings) siblings.push(pid);
        else map.set(ppid, [pid]);
    }
    return map;
}

// Direct children of `pid` from /proc/<pid>/task/*/children (Linux,
// CONFIG_PROC_CHILDREN — standard on every mainstream kernel). `null` when the
// files are unreadable, which sends the caller to the full-table fallback.
function readProcChildren(pid: number): number[] | null {
    let taskIds: string[];
    try {
        taskIds = readdirSync(`/proc/${pid}/task`);
    } catch {
        // Process already gone (common) or no procfs.
        return null;
    }
    const kids: number[] = [];
    let readAny = false;
    for (const tid of taskIds) {
        try {
            const data = readFileSync(`/proc/${pid}/task/${tid}/children`, 'utf-8');
            readAny = true;
            for (const tok of data.trim().split(/\s+/)) {
                const n = Number(tok);
                if (Number.isInteger(n) && n > 0) kids.push(n);
            }
        } catch {
            // Thread vanished mid-walk, or kernel lacks CONFIG_PROC_CHILDREN.
        }
    }
    return readAny ? kids : null;
}

// ppid → children from one /proc/*/stat scan. Empty when there is no procfs.
function procPpidMap(): Map<number, number[]> {
    const map = new Map<number, number[]>();
    let entries: string[] = [];
    try {
        entries = readdirSync('/proc');
    } catch {
        return map;
    }
    for (const entry of entries) {
        const pid = Number(entry);
        if (!Number.isInteger(pid) || pid <= 0) continue;
        try {
            const stat = readFileSync(`/proc/${pid}/stat`, 'utf-8');
            // comm (field 2) may contain spaces/parens — parse after last ')'.
            const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
            const ppid = Number(rest[1]);
            if (!Number.isInteger(ppid) || ppid <= 0) continue;
            const siblings = map.get(ppid);
            if (siblings) siblings.push(pid);
            else map.set(ppid, [pid]);
        } catch {
            // Process exited between readdir and read — fine.
        }
    }
    return map;
}

// ppid → children from the OS's process list where there is no procfs:
// `ps(1)` on macOS/BSD, CIM's Win32_Process on Windows (no `ps` there — Git's
// MSYS `ps` rejects `-o` and sees only MSYS processes). Both print "pid ppid"
// lines, so one parser serves. Empty when neither can be run, which degrades to
// "signal the direct child only".
function osPpidMap(): Map<number, number[]> {
    const [cmd, args] =
        process.platform === 'win32'
            ? [
                  'powershell.exe',
                  [
                      '-NoProfile',
                      '-NonInteractive',
                      '-Command',
                      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }',
                  ],
              ]
            : ['ps', ['-A', '-o', 'pid=,ppid=']];
    try {
        const res = spawnSync(cmd, args, { encoding: 'utf-8' });
        if (res.status !== 0 || typeof res.stdout !== 'string') return new Map();
        return parsePsPidPpid(res.stdout);
    } catch {
        return new Map();
    }
}

/**
 * Every transitive descendant of `pid`, breadth-first (reverse the list for
 * deepest-first signalling). A snapshot — processes spawned after it are not in
 * it, which is why `foreach` re-walks before escalating to SIGKILL.
 */
export function collectDescendants(pid: number): number[] {
    const result: number[] = [];
    const seen = new Set<number>([pid]);
    const queue = [pid];
    let table: Map<number, number[]> | null = null;
    while (queue.length > 0) {
        const cur = queue.shift()!;
        let kids = table ? null : readProcChildren(cur);
        if (kids === null) {
            // Per-task children files unreadable: one full table for this and
            // every later level. procfs first, the OS process list where there is none.
            if (!table) {
                table = procPpidMap();
                if (table.size === 0) table = osPpidMap();
            }
            kids = table.get(cur) ?? [];
        }
        for (const kid of kids) {
            if (seen.has(kid)) continue;
            seen.add(kid);
            result.push(kid);
            queue.push(kid);
        }
    }
    return result;
}
