// Reference: Node.js lib/internal/worker.js
// Reimplemented for GJS using Gio.Subprocess (subprocess-based workers)
//
// Limitations:
// - Worker scripts must be pre-built .mjs files (no on-the-fly TypeScript)
// - Higher overhead than native threading (process spawning)
// - eval mode code must be self-contained (no bare specifier imports)
//
// Cross-process SharedBuffer:
// - At spawn time, the parent creates a SOCK_SEQPACKET socketpair via
//   @gjsify/sab-native's FdChannel and passes the child end as inherited
//   fd 3 (Gio.SubprocessLauncher.take_fd). The parent retains the other
//   end for sending fds via SCM_RIGHTS.
// - postMessage walks the value tree for SharedBuffer instances, sends
//   each fd over the side-channel with a sequence-allocated tag, and
//   serialises a {__sab: tag, size: N} placeholder in the JSON message.
// - The child bootstrap drains fds from fd 3 into a Map<tag, fd> and
//   materialises placeholders into SharedBuffer.fromFd(fd, size) before
//   dispatching the message to user code.
//
// Composition layout (see each module's header for details):
//   - worker.ts            (this file) — Worker class + WorkerOptions
//                                        interface + parent-side IPC,
//                                        SCM_RIGHTS fd shipping, and
//                                        cross-process MessagePort routing.
//   - worker-bootstrap.ts  — BOOTSTRAP_CODE string template (the JS body
//                            that runs in the spawned gjs child).

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { EventEmitter } from 'node:events';
import { fdChannel } from '@gjsify/sab-native';
import { extractSharedBuffers } from './sab-transfer.js';
import { MessagePort } from './message-port.js';
import {
    SubprocessPortTransport,
    nextParentPortId,
    type CrossProcessPortRegistry,
} from './subprocess-port-transport.js';
import { BOOTSTRAP_CODE } from './worker-bootstrap.js';

let _nextThreadId = 1;
const _encoder = new TextEncoder();

const BOOTSTRAP_BYTES = _encoder.encode(BOOTSTRAP_CODE);

export interface WorkerOptions {
    argv?: unknown[];
    env?: Record<string, string> | symbol;
    execArgv?: string[];
    stdin?: boolean;
    stdout?: boolean;
    stderr?: boolean;
    workerData?: unknown;
    eval?: boolean;
    transferList?: unknown[];
    resourceLimits?: Record<string, number>;
    name?: string;
}

export class Worker extends EventEmitter {
    readonly threadId: number;
    readonly resourceLimits: Record<string, unknown>;

    private _subprocess: Gio.Subprocess | null = null;
    private _stdinPipe: Gio.OutputStream | null = null;
    private _exited = false;
    private _bootstrapFile: Gio.File | null = null;
    /** Parent-side end of the SCM_RIGHTS side-channel for SharedBuffer fds.
     *  -1 when sab-native's prebuild isn't loaded → SharedBuffer transfer is
     *  unavailable but everything else works. Closed in `_cleanup()`. */
    private _sabSocketFd = -1;
    /** Per-Worker sequence counter for SharedBuffer transfer tags. Resets
     *  to 0 at spawn; each postMessage call increments it by the number of
     *  unique SharedBuffer instances in the value tree. */
    private _sabNextTag = 0;
    /** Parent-side registry of cross-process MessagePort instances keyed by
     *  the portId allocated when each port was transferred to the child.
     *  Incoming `{ __msgport, op }` JSON lines from the child stdout look
     *  up the kept-end port here and dispatch via the wrapper's
     *  `_receiveMessage()` / `_inner.close()`. Cleared when the Worker
     *  exits — `SubprocessPortTransport.close()` also removes individual
     *  entries on lifecycle close. */
    private _portRegistry: CrossProcessPortRegistry = new Map();

    constructor(filename: string | URL, options?: WorkerOptions) {
        super();
        this.threadId = _nextThreadId++;
        this.resourceLimits = options?.resourceLimits || {};

        const isEval = options?.eval === true;
        const resolvedFilename = Worker._resolveFilename(filename, isEval);

        // Write bootstrap script to temp file
        const tmpDir = GLib.get_tmp_dir();
        const bootstrapPath = `${tmpDir}/gjsify-worker-${this.threadId}-${Date.now()}.mjs`;
        this._bootstrapFile = Gio.File.new_for_path(bootstrapPath);

        try {
            this._bootstrapFile.replace_contents(
                BOOTSTRAP_BYTES,
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null,
            );
        } catch (err) {
            throw new Error(`Failed to create worker bootstrap: ${err instanceof Error ? err.message : err}`);
        }

        // Spawn GJS subprocess
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });

        if (options?.env && typeof options.env === 'object') {
            for (const [key, value] of Object.entries(options.env as Record<string, string>)) {
                launcher.setenv(key, String(value), true);
            }
        }

        // SharedBuffer side-channel: create a SOCK_SEQPACKET socketpair via
        // @gjsify/sab-native and pass the child end as inherited fd 3 (the
        // bootstrap recv-loop checks for that fd explicitly). Quiet no-op when
        // sab-native's prebuild is unavailable — SharedBuffer transfer just
        // stays unsupported in that case (matches the prior "no SAB" status).
        let sabChildFd = -1;
        if (fdChannel) {
            const pair = fdChannel.makePair();
            if (pair) {
                this._sabSocketFd = pair.parentFd;
                sabChildFd = pair.childFd;
                // `take_fd(source_fd, target_fd)` transfers ownership of source_fd
                // to the launcher; on spawn it dup2's onto target_fd in the child.
                launcher.take_fd(sabChildFd, 3);
            }
        }

        try {
            this._subprocess = launcher.spawnv(['gjs', '-m', bootstrapPath]);
        } catch (err) {
            this._cleanup();
            throw new Error(`Failed to spawn worker: ${err instanceof Error ? err.message : err}`);
        }

        this._stdinPipe = this._subprocess.get_stdin_pipe();
        const stdoutPipe = this._subprocess.get_stdout_pipe();

        // Verify file exists for non-eval workers
        if (!isEval) {
            const filePath = resolvedFilename.startsWith('file://') ? resolvedFilename.slice(7) : resolvedFilename;
            const file = Gio.File.new_for_path(filePath);
            if (!file.query_exists(null)) {
                this._cleanup();
                const err: NodeJS.ErrnoException = new Error(`Cannot find module '${filePath}'`);
                err.code = 'ERR_MODULE_NOT_FOUND';
                // Emit error asynchronously to match Node.js behavior
                Promise.resolve().then(() => {
                    this.emit('error', err);
                    this._exited = true;
                    this.emit('exit', 1);
                });
                // Return early — subprocess was already cleaned up
                return;
            }
        }

        // Walk workerData for SharedBuffer instances + route their fds over
        // the SCM_RIGHTS channel before the JSON init line lands on stdin,
        // exactly like postMessage does for subsequent messages. This makes
        // `workerData = { sab }` work at construction time.
        const initWorkerData = this._serializeWithSabTransfer(options?.workerData ?? null);

        const initData =
            JSON.stringify({
                threadId: this.threadId,
                workerData: initWorkerData,
                eval: isEval,
                filename: isEval ? undefined : resolvedFilename,
                code: isEval ? resolvedFilename : undefined,
                sabSocketFd: this._sabSocketFd !== -1 ? 3 : -1,
            }) + '\n';

        try {
            this._stdinPipe!.write_all(_encoder.encode(initData), null);
        } catch (err) {
            this._cleanup();
            throw new Error(`Failed to send init data: ${err instanceof Error ? err.message : err}`);
        }

        // Read IPC messages from subprocess stdout
        if (stdoutPipe) {
            const dataStream = Gio.DataInputStream.new(stdoutPipe);
            this._readMessages(dataStream);
        }

        // Read stderr for error reporting
        const stderrPipe = this._subprocess.get_stderr_pipe();
        if (stderrPipe) {
            this._readStderr(Gio.DataInputStream.new(stderrPipe));
        }

        // Wait for process exit
        this._subprocess.wait_async(null, () => {
            this._onExit();
        });
    }

    postMessage(value: unknown, transferList?: unknown[]): void {
        if (this._exited || !this._stdinPipe) return;
        try {
            // Cross-process MessagePort handling. For each MessagePort listed
            // in transferList: detach the in-process partnership, attach a
            // SubprocessPortTransport to the kept end's `_inner._transport`,
            // register the kept end in `_portRegistry` keyed by a fresh portId,
            // and substitute the port in the value tree with a
            // `{ __gjsifyTransferredPort: true, portId }` placeholder. The
            // child bootstrap's materialise() rebuilds a child-side port-like
            // object that routes traffic back over the same portId.
            let processed = value;
            if (transferList && transferList.length > 0) {
                processed = this._extractCrossProcessPorts(value, transferList);
            }
            // _serializeWithSabTransfer walks for SharedBuffer instances and
            // sends each fd over the SCM_RIGHTS channel BEFORE we write the
            // JSON line — the child's recv-loop populates its fd map first,
            // then materialise() finds every tag when the JSON arrives. The
            // ordering is load-bearing: kernel guarantees ordered delivery
            // within each fd (stdin, side-channel) but the two fds are
            // independent.
            const serialised = this._serializeWithSabTransfer(processed);
            const line = JSON.stringify({ type: 'message', data: serialised }) + '\n';
            this._stdinPipe.write_all(_encoder.encode(line), null);
        } catch {
            // Worker stdin closed
        }
    }

    /**
     * Write a raw JSON line to the worker's stdin. Used by
     * SubprocessPortTransport (via its sendLine callback) so a kept-end
     * MessagePort's `postMessage` can travel over the same wire as
     * `Worker.postMessage` without each port carrying a write-stream
     * reference of its own. No-op when the worker has exited or the pipe
     * is closed.
     */
    private _writeStdinLine = (line: string): void => {
        if (this._exited || !this._stdinPipe) return;
        try {
            this._stdinPipe.write_all(_encoder.encode(line), null);
        } catch {
            // Worker stdin closed mid-send — best-effort.
        }
    };

    /**
     * Walk transferList for MessagePort entries and convert each to a
     * cross-process port: detach the in-process partnership, assign a
     * fresh portId, wire the kept-end's `_inner._transport`, register the
     * kept end, and substitute every occurrence of the transferred port
     * in the value tree with the placeholder. Returns the (possibly
     * substituted) value tree.
     *
     * Validation is intentionally narrow: duplicate transfers, transfer
     * of an already-closed port, and self-references currently surface as
     * silently-dropped — full DataCloneError-shaped validation lives in
     * the in-process `MessagePort.postMessage` (which Worker.postMessage
     * does NOT call, so we accept the more permissive shape here). Bring
     * up the same validation in a follow-up if a real bug shakes loose.
     */
    private _extractCrossProcessPorts(value: unknown, transferList: unknown[]): unknown {
        const portToPlaceholder = new Map<MessagePort, { __gjsifyTransferredPort: true; portId: number }>();
        for (const item of transferList) {
            if (!(item instanceof MessagePort)) continue;
            const transferredPort = item;
            const portId = nextParentPortId();
            // Identify the in-process kept end (the OTHER side of the channel).
            // If the user only had one end and is transferring it (no in-process
            // partner) we still create a placeholder but no kept-end registry
            // entry — the child will be able to send but parent has nothing to
            // route inbound traffic to. That edge case is OK for v1 — most
            // callers transfer port2 and keep port1.
            const keptPort = transferredPort._otherPort;
            if (keptPort) {
                // Sever the in-process link in both directions.
                keptPort._otherPort = null;
                transferredPort._otherPort = null;
                // Wire the kept end's W3C inner with the cross-process transport.
                // _inner.postMessage() will now call transport.send(portId, ...),
                // which writes a `{__msgport, op:'send', data}` line on stdin.
                keptPort._inner._portId = portId;
                keptPort._inner._partner = null;
                keptPort._inner._transport = new SubprocessPortTransport(this._writeStdinLine, this._portRegistry);
                this._portRegistry.set(portId, keptPort);
            }
            // The transferred port itself is detached on the parent. Mark it as
            // such so any attempt to reuse it surfaces clearly.
            (transferredPort as unknown as { _detached: boolean })._detached = true;
            (transferredPort as unknown as { _closed: boolean })._closed = true;
            transferredPort._inner.close();
            portToPlaceholder.set(transferredPort, { __gjsifyTransferredPort: true, portId });
        }

        if (portToPlaceholder.size === 0) return value;

        function walk(v: unknown, seen: Map<object, unknown>): unknown {
            if (v === null || typeof v !== 'object') return v;
            if (v instanceof MessagePort) {
                const ph = portToPlaceholder.get(v);
                return ph ?? v;
            }
            if (seen.has(v)) return seen.get(v);
            if (Array.isArray(v)) {
                const out: unknown[] = [];
                seen.set(v, out);
                for (let i = 0; i < v.length; i++) if (i in v) out[i] = walk(v[i], seen);
                return out;
            }
            const tag = Object.prototype.toString.call(v).slice(8, -1);
            if (tag === 'Object') {
                const out: Record<string, unknown> = {};
                seen.set(v, out);
                for (const k of Object.keys(v as Record<string, unknown>)) {
                    out[k] = walk((v as Record<string, unknown>)[k], seen);
                }
                return out;
            }
            return v;
        }

        return walk(value, new Map());
    }

    /**
     * Walk `value` for SharedBuffer instances, ship each fd over the
     * parent-side end of the FdChannel socketpair, return the placeholder-
     * substituted tree ready to JSON-serialise. No-op (returns value
     * untouched) when sab-native's prebuild isn't loaded or the side-
     * channel was never opened.
     */
    private _serializeWithSabTransfer(value: unknown): unknown {
        if (!fdChannel || this._sabSocketFd === -1) return value;
        const { value: substituted, table, nextTag } = extractSharedBuffers(value, this._sabNextTag);
        this._sabNextTag = nextTag;
        for (const { tag, buffer } of table) {
            const ok = fdChannel.sendFd(this._sabSocketFd, buffer.fd, tag);
            if (!ok) {
                // Side-channel failure is fatal for this transfer — surface as a
                // SharedBuffer-specific error rather than silently dropping the
                // placeholder, which would leave the child looking for a fd that
                // never arrives.
                throw new Error(`Failed to send SharedBuffer fd over worker side-channel (tag ${tag})`);
            }
        }
        return substituted;
    }

    terminate(): Promise<number> {
        if (this._exited) return Promise.resolve(0);

        // Register listener before sending terminate to avoid race
        const exitPromise = new Promise<number>((resolve) => {
            this.once('exit', (code: number) => resolve(code));
        });

        // Send terminate command
        try {
            if (this._stdinPipe) {
                const msg = JSON.stringify({ type: 'terminate' }) + '\n';
                this._stdinPipe.write_all(_encoder.encode(msg), null);
            }
        } catch {
            // The child may already have exited (write on a broken pipe
            // throws) — the force_exit timer below is the backstop either way.
        }

        // Force-exit after timeout
        setTimeout(() => {
            if (!this._exited && this._subprocess) {
                this._subprocess.force_exit();
            }
        }, 500);

        return exitPromise;
    }

    ref(): this {
        return this;
    }
    unref(): this {
        return this;
    }

    /**
     * Resolve a worker filename to an absolute path or file:// URL.
     *
     * - URL instances → href string
     * - file:// URLs → kept as-is
     * - Absolute paths → converted to file:// URL
     * - Relative paths (./foo, ../bar) → resolved relative to cwd, converted to file:// URL
     * - eval mode → returned as-is (it's code, not a path)
     */
    private static _resolveFilename(filename: string | URL, isEval: boolean): string {
        if (isEval) return String(filename);

        if (filename instanceof URL) return filename.href;

        const str = String(filename);

        // Already a URL
        if (str.startsWith('file://') || str.startsWith('http://') || str.startsWith('https://')) {
            return str;
        }

        // Absolute path → file:// URL
        if (str.startsWith('/')) {
            return 'file://' + str;
        }

        // Relative path → resolve from cwd
        if (str.startsWith('./') || str.startsWith('../') || !str.includes('/')) {
            const cwd = GLib.get_current_dir();
            const resolved = GLib.build_filenamev([cwd, str]);
            // Canonicalize (resolve ./ and ../)
            const file = Gio.File.new_for_path(resolved);
            const canonical = file.get_path();
            return 'file://' + (canonical || resolved);
        }

        // Fallback — treat as absolute
        return 'file://' + str;
    }

    private _readMessages(dataStream: Gio.DataInputStream): void {
        dataStream.read_line_async(GLib.PRIORITY_DEFAULT, null, (_source: unknown, result: Gio.AsyncResult) => {
            try {
                const [line] = dataStream.read_line_finish_utf8(result);
                if (line === null) return; // EOF

                const msg = JSON.parse(line);
                // Cross-process MessagePort traffic from child stdout. Look up
                // the kept-end port in the parent registry and route. 'send' →
                // wrapper's _receiveMessage (which fans out to EventEmitter +
                // W3C surface); 'close' → _inner.close() so onclose listeners
                // fire and the transport drops its registry entry.
                if (typeof msg.__msgport === 'number') {
                    const keptPort = this._portRegistry.get(msg.__msgport);
                    if (keptPort) {
                        if (msg.op === 'send') {
                            (keptPort as unknown as { _receiveMessage(m: unknown): void })._receiveMessage(msg.data);
                        } else if (msg.op === 'close') {
                            this._portRegistry.delete(msg.__msgport);
                            // _inner.close() flips the W3C-side state; close() on the
                            // wrapper additionally emits 'close' on the EventEmitter
                            // surface.
                            (keptPort as unknown as { close(): void }).close();
                        }
                    }
                    this._readMessages(dataStream);
                    return;
                }
                switch (msg.type) {
                    case 'online':
                        this.emit('online');
                        break;
                    case 'message':
                        this.emit('message', msg.data);
                        break;
                    case 'error': {
                        const err = new Error(msg.message);
                        if (msg.stack) err.stack = msg.stack;
                        this.emit('error', err);
                        break;
                    }
                }

                this._readMessages(dataStream);
            } catch {
                // Stream closed or parse error
            }
        });
    }

    private _stderrChunks: string[] = [];

    private _readStderr(dataStream: Gio.DataInputStream): void {
        dataStream.read_line_async(GLib.PRIORITY_DEFAULT, null, (_source: unknown, result: Gio.AsyncResult) => {
            try {
                const [line] = dataStream.read_line_finish_utf8(result);
                if (line === null) {
                    // EOF — if we collected stderr output and worker errored, emit it
                    if (this._stderrChunks.length > 0) {
                        const stderrText = this._stderrChunks.join('\n');
                        // Only emit if no IPC error was already emitted
                        if (this.listenerCount('error') === 0) {
                            this.emit('error', new Error(stderrText));
                        }
                    }
                    return;
                }
                this._stderrChunks.push(line);
                this._readStderr(dataStream);
            } catch {
                // Stream closed
            }
        });
    }

    private _onExit(): void {
        if (this._exited) return;
        this._exited = true;

        const exitCode = this._subprocess?.get_if_exited() ? this._subprocess.get_exit_status() : 1;

        this._cleanup();
        this.emit('exit', exitCode);
    }

    private _cleanup(): void {
        if (this._bootstrapFile) {
            try {
                this._bootstrapFile.delete(null);
            } catch {
                // The bootstrap temp file may already be gone; failing to
                // remove it must not derail the exit path.
            }
            this._bootstrapFile = null;
        }
        if (this._stdinPipe) {
            try {
                this._stdinPipe.close(null);
            } catch {
                // Already closed when the child died first — cleanup continues.
            }
            this._stdinPipe = null;
        }
        if (this._sabSocketFd !== -1 && fdChannel?.closeFd) {
            // FdChannel.close_fd() is non-throwing (returns a bool the wrapper
            // discards) — best-effort is ignoring that result, not a catch.
            fdChannel.closeFd(this._sabSocketFd);
            this._sabSocketFd = -1;
        }
        // Drop every cross-process port the registry was holding. Each kept
        // end was attached to a SubprocessPortTransport whose sendLine writes
        // to the now-closed stdin pipe; bail out cleanly so subsequent
        // `port.postMessage` calls become no-ops (the wrapper's `_closed`
        // path returns early).
        for (const port of this._portRegistry.values()) {
            try {
                (port as unknown as { _inner: { _closed: boolean; _transport: unknown } })._inner._closed = true;
                (port as unknown as { _inner: { _transport: unknown } })._inner._transport = null;
            } catch {
                /* defensive */
            }
        }
        this._portRegistry.clear();
        this._subprocess = null;
    }
}
