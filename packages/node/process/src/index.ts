// @gjsify/process — Node.js `process` polyfill for GJS.
//
// Reference: Node.js lib/internal/process/*.js
// Reimplemented for GJS using GLib (env, paths, platform detection) + EventEmitter.
//
// Composition layout:
//   - internal/gjs.ts      — runtime-aware imports.gi / imports.system access
//   - internal/detect.ts   — version / platform / arch / pid / ppid
//   - internal/env.ts      — process.env Proxy, argv, execPath, cwd, chdir
//   - internal/exit.ts     — process.exit with main-loop-aware scheduling
//   - internal/hrtime.ts   — process.hrtime (incl. bigint) backed by GLib monotonic time
//   - internal/system.ts   — kill, memoryUsage, cpuUsage with GJS-vs-Node guards
//   - streams.ts           — ProcessReadStream (stdin), ProcessWriteStream (stdout/stderr)
//   - process-class.ts     — Process class wiring it all together
//   - index.ts             — this file: instantiate + wire SIGWINCH + named exports

import { nativeTerminal } from '@gjsify/terminal-native';
import { Process } from './process-class.js';
import { hrtimeBigint } from './internal/hrtime.js';

const process = new Process();

// Wire SIGWINCH → process.stdout.emit('resize') when native terminal is available.
// Runs only on GJS (nativeTerminal is null on Node.js).
if (nativeTerminal) {
    try {
        const watcher = new nativeTerminal.ResizeWatcher();
        watcher.connect('resized', (_obj: unknown, _rows: number, _cols: number) => {
            // Re-emit on both streams; consumers (chalk, inquirer) listen on stdout.
            process.stdout.emit('resize');
            process.stderr.emit('resize');
        });
        watcher.start();
    } catch { /* ignore if ResizeWatcher instantiation fails */ }
}

// Named re-exports — match `import { x } from 'node:process'` shape.
export const platform = process.platform;
export const arch = process.arch;
export const env = process.env;
export const argv = process.argv;
export const argv0 = process.argv0;
export const execPath = process.execPath;
export const pid = process.pid;
export const ppid = process.ppid;
export const version = process.version;
export const versions = process.versions;
export const cwd = process.cwd.bind(process);
export const chdir = process.chdir.bind(process);
export const exit = process.exit.bind(process);
export const nextTick = process.nextTick.bind(process);
// `process.hrtime.bind(process)` loses the `.bigint` property attached to
// the underlying function (Function.prototype.bind does not copy own props),
// which breaks `import { hrtime } from 'node:process'; hrtime.bigint()` —
// the canonical perf-tracking pattern used by execa, ts-for-gir, etc.
// Re-attach `.bigint` to the bound export so the named-import shape matches
// Node's behavior.
export const hrtime = Object.assign(process.hrtime.bind(process), {
    bigint: hrtimeBigint,
});
export const uptime = process.uptime.bind(process);
export const memoryUsage = process.memoryUsage.bind(process);
export const cpuUsage = process.cpuUsage.bind(process);
export const kill = process.kill.bind(process);
export const abort = process.abort.bind(process);
export const umask = process.umask.bind(process);
export const emitWarning = process.emitWarning.bind(process);
export const execArgv = process.execArgv;
export const config = process.config;
export const stdout = process.stdout;
export const stderr = process.stderr;
export const stdin = process.stdin;

export default process;
