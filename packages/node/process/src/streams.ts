// process.stdin / process.stdout / process.stderr — terminal-aware streams
// backed by Gio.{,Unix}{Input,Output}Stream on GJS. ANSI escape sequences
// stay readable thanks to write_all (no LF appended). Native terminal info
// (isTTY, columns, rows, raw mode) comes from @gjsify/terminal-native when
// installed; otherwise GLib + env fallbacks handle the readable cases.

import { EventEmitter } from '@gjsify/events';
import { ensureMainLoop, quitMainLoop } from '@gjsify/utils/core';
import { nativeTerminal } from '@gjsify/terminal-native';
import { StringDecoder } from '@gjsify/string_decoder';
import { getGjsGlobal, getGioNamespace } from './internal/gjs.js';

const _encoder = new TextEncoder();

export class ProcessWriteStream extends EventEmitter {
    readonly fd: number;
    // Required by Stream.pipe(): without this, pipe skips dest.write() entirely.
    writable = true;
    // oxlint-disable-next-line typescript/no-explicit-any -- GI introspection boundary: Gio/GLib namespaces and stream/result instances are runtime-injected via globalThis.imports.gi and would require @girs/* imports to type statically (coupling this file's TS compile to GJS); matches the gioAsync per-line-disable convention noted in AGENTS.md
    private _outGio: any = null;

    constructor(fd: number) {
        super();
        this.fd = fd;
        const gio = getGioNamespace();
        if (gio) {
            const Cls = gio.UnixOutputStream ?? gio.OutputStream;
            if (Cls) {
                try {
                    this._outGio = Cls.new(this.fd, false);
                } catch {
                    /* fallback */
                }
            }
        }
    }

    write(data: string | Uint8Array): boolean {
        if (this._outGio) {
            try {
                const bytes = typeof data === 'string' ? _encoder.encode(data) : data;
                this._outGio.write_all(bytes, null);
                return true;
            } catch {
                /* fall through to console fallback */
            }
        }
        // Fallback: console adds a trailing newline which breaks terminal UI,
        // but is acceptable when Gio streams are unavailable.
        if (this.fd === 2) {
            console.error(data);
        } else {
            console.log(data);
        }
        return true;
    }

    get isTTY(): boolean {
        if (nativeTerminal) return nativeTerminal.Terminal.is_tty(this.fd);
        try {
            const GLib = getGjsGlobal().imports?.gi?.GLib;
            if (GLib) return !!(GLib as Record<string, Function>).log_writer_supports_color(this.fd);
        } catch {
            /* ignore */
        }
        return false;
    }

    get columns(): number {
        if (nativeTerminal) {
            const [ok, , cols] = nativeTerminal.Terminal.get_size(this.fd);
            if (ok && cols > 0) return cols;
        }
        try {
            const GLib = getGjsGlobal().imports?.gi?.GLib;
            if (GLib) {
                const c = parseInt((GLib as Record<string, Function>).getenv('COLUMNS') ?? '0', 10);
                if (c > 0) return c;
            }
        } catch {
            /* ignore */
        }
        return 80;
    }

    // stdout/stderr must never be closed — the process owns the fds.
    // pipe() calls end() when its source emits 'end' (e.g. MuteStream); no-op here.
    end(): void {}
    destroy(): void {}

    get rows(): number {
        if (nativeTerminal) {
            const [ok, rows] = nativeTerminal.Terminal.get_size(this.fd);
            if (ok && rows > 0) return rows;
        }
        try {
            const GLib = getGjsGlobal().imports?.gi?.GLib;
            if (GLib) {
                const r = parseInt((GLib as Record<string, Function>).getenv('LINES') ?? '0', 10);
                if (r > 0) return r;
            }
        } catch {
            /* ignore */
        }
        return 24;
    }
}

export class ProcessReadStream extends EventEmitter {
    readonly fd: number;
    isRaw = false;
    // Do NOT expose `readableFlowing` as an instance property: @inquirer/core uses
    // `'readableFlowing' in input` to defer startCycle() via setImmediate. In GJS,
    // setImmediate fires as a microtask — the property must stay absent so
    // @inquirer/core calls startCycle() synchronously on its own schedule.

    // oxlint-disable-next-line typescript/no-explicit-any -- GI introspection boundary: Gio/GLib namespaces and stream/result instances are runtime-injected via globalThis.imports.gi and would require @girs/* imports to type statically (coupling this file's TS compile to GJS); matches the gioAsync per-line-disable convention noted in AGENTS.md
    private _gio: any = null;
    // oxlint-disable-next-line typescript/no-explicit-any -- GI introspection boundary: Gio/GLib namespaces and stream/result instances are runtime-injected via globalThis.imports.gi and would require @girs/* imports to type statically (coupling this file's TS compile to GJS); matches the gioAsync per-line-disable convention noted in AGENTS.md
    private _stdinGio: any = null;
    private _reading = false;
    private _flowing = false;
    private _sttyCleanupRegistered = false;
    private _mainLoopHeld = false;
    // True while a read_bytes_async is in-flight. Prevents a second concurrent
    // read from starting when pause()+resume() fires between GLib iterations.
    private _pendingRead = false;
    // Set by setEncoding(): when present, 'data' emits decoded strings (Node
    // contract) instead of Buffers. A StringDecoder buffers partial multi-byte
    // sequences split across reads, so a UTF-8 char straddling two 4 KiB chunks
    // is never mangled.
    private _decoder: InstanceType<typeof StringDecoder> | null = null;

    constructor(fd: number) {
        super();
        this.fd = fd;
        // GioUnix.InputStream (GJS ≥ 1.88) supersedes Gio.UnixInputStream; fall back to Gio.
        this._gio = getGioNamespace();
    }

    get isTTY(): boolean {
        if (nativeTerminal) return nativeTerminal.Terminal.is_tty(this.fd);
        return false;
    }

    setRawMode(mode: boolean): this {
        if (nativeTerminal) {
            const ok = nativeTerminal.Terminal.set_raw_mode(this.fd, mode);
            if (ok) {
                this.isRaw = mode;
                return this;
            }
            // set_raw_mode returned false — fd may not be a TTY (e.g. piped stdin).
            // Fall through to stty fallback.
        }
        // Fallback: spawn `stty raw -echo` / `stty sane` with stdin inherited so it
        // sees the real terminal and the setting persists in the kernel tty driver.
        // Only works when fd 0 is actually a TTY.
        this._setRawModeViaStty(mode);
        this.isRaw = mode;
        return this;
    }

    private _setRawModeViaStty(mode: boolean): void {
        try {
            const _gi: Record<string, unknown> | undefined = (
                globalThis as { imports?: { gi?: Record<string, unknown> } }
            ).imports?.gi;
            // oxlint-disable-next-line typescript/no-explicit-any -- GI introspection boundary: Gio/GLib namespaces and stream/result instances are runtime-injected via globalThis.imports.gi and would require @girs/* imports to type statically (coupling this file's TS compile to GJS); matches the gioAsync per-line-disable convention noted in AGENTS.md
            const Gio: any = _gi?.Gio ?? _gi?.['Gio'];
            if (!Gio) return;
            // G_SUBPROCESS_FLAGS_STDIN_INHERIT = 1 << 1 = 2
            // Makes stty inherit our fd 0 (the real TTY) so tcsetattr targets the same tty.
            const STDIN_INHERIT = Gio.SubprocessFlags?.STDIN_INHERIT ?? 2;
            // Match the termios settings from GjsifyTerminal's set_raw_mode:
            //   c_lflag &= ~(ICANON | ECHO | ISIG)  →  -icanon -echo -isig
            //   c_iflag &= ~ICRNL                   →  -icrnl
            //   VMIN=1, VTIME=0                      →  min 1 time 0
            // -isig keeps Ctrl-C a keystroke (\x03) the prompt restores from,
            // rather than a SIGINT that would leave the tty in raw mode.
            const argv = mode
                ? ['stty', '-icanon', '-echo', '-icrnl', '-isig', 'min', '1', 'time', '0']
                : ['stty', 'icanon', 'echo', 'icrnl', 'isig'];
            const launcher = new Gio.SubprocessLauncher({ flags: STDIN_INHERIT });
            const proc = launcher.spawnv(argv);
            proc.wait(null);

            // Register a one-time exit handler to restore cooked mode when the process
            // exits — without this the shell inherits raw mode and becomes unusable.
            if (mode && !this._sttyCleanupRegistered) {
                this._sttyCleanupRegistered = true;
                const proc_ = (globalThis as { process?: { once?: (e: string, fn: () => void) => void } }).process;
                if (proc_?.once && typeof proc_.once === 'function') {
                    proc_.once('exit', () => this._setRawModeViaStty(false));
                }
            }
        } catch {
            /* stty not available or not a TTY */
        }
    }

    // Node contract: after setEncoding(enc), 'data' events emit decoded STRINGS
    // (not Buffers). Previously this was a no-op stub that silently ignored the
    // encoding while `_pushData` always emitted a Buffer — so any consumer that
    // relied on `setEncoding('utf-8')` (e.g. a raw-mode TTY reader iterating
    // chars) received bytes and broke (`ch === '\r'` never matched). Now we
    // honour it via StringDecoder, exactly as Node's Readable does internally.
    setEncoding(enc: string): this {
        this._decoder = new StringDecoder(enc);
        return this;
    }

    // Single emit path shared by the real Gio read callback AND the test
    // harness. Applies the StringDecoder set by setEncoding() — emit a decoded
    // string when an encoding is active, otherwise the raw Buffer. An empty
    // decoded string (a chunk that is only the tail of a split multi-byte
    // sequence) is held back, never emitted as `''`.
    protected _pushData(buf: Buffer): void {
        if (this._decoder) {
            const str = this._decoder.write(buf);
            if (str.length > 0) this.emit('data', str);
        } else {
            this.emit('data', buf);
        }
    }

    // Node contract: attaching a 'data' listener switches a Readable to flowing
    // mode automatically (no explicit .resume() needed). The MCP SDK's
    // StdioServerTransport and many other stdin-driven libraries rely on this.
    // We override the listener-management methods to enforce the Node semantics:
    //   - first 'data' listener added  → resume()
    //   - last 'data' listener removed → pause()

    override on(type: string | symbol, listener: (...args: unknown[]) => void): this {
        const wasEmpty = type === 'data' && this.listenerCount('data') === 0;
        super.on(type, listener);
        if (wasEmpty && type === 'data') this.resume();
        return this;
    }

    override addListener(type: string | symbol, listener: (...args: unknown[]) => void): this {
        return this.on(type, listener);
    }

    override once(type: string | symbol, listener: (...args: unknown[]) => void): this {
        // super.once() calls this.on() internally (via _onceWrap), so our on()
        // override already handles the resume() call for 'data' events.
        super.once(type, listener);
        return this;
    }

    override removeListener(type: string | symbol, listener: (...args: unknown[]) => void): this {
        super.removeListener(type, listener);
        if (type === 'data' && this.listenerCount('data') === 0) this.pause();
        return this;
    }

    override off(type: string | symbol, listener: (...args: unknown[]) => void): this {
        return this.removeListener(type, listener);
    }

    override removeAllListeners(type?: string | symbol): this {
        const hadData = type === undefined || type === 'data' ? this.listenerCount('data') > 0 : false;
        super.removeAllListeners(type);
        if (hadData && this.listenerCount('data') === 0) this.pause();
        return this;
    }

    resume(): this {
        this._flowing = true;
        if (this._gio && this.fd === 0 && !this._reading) {
            this._startReading();
        }
        return this;
    }

    pause(): this {
        this._flowing = false;
        this._reading = false;
        if (this._mainLoopHeld) {
            this._mainLoopHeld = false;
            // Defer the quit via GLib idle so microtask continuations run first.
            // If the next prompt's Interface calls resume() before this idle fires,
            // it sets _mainLoopHeld = true again and the quit is skipped.
            // This mirrors Node.js libuv unref: pausing stdin allows the event loop
            // to drain when no more prompts follow, but not between sequential prompts.
            const _gi: Record<string, unknown> | undefined = (
                globalThis as { imports?: { gi?: Record<string, unknown> } }
            ).imports?.gi;
            // oxlint-disable-next-line typescript/no-explicit-any -- GI introspection boundary: Gio/GLib namespaces and stream/result instances are runtime-injected via globalThis.imports.gi and would require @girs/* imports to type statically (coupling this file's TS compile to GJS); matches the gioAsync per-line-disable convention noted in AGENTS.md
            const GLib: any = _gi?.GLib ?? _gi?.['GLib'];
            if (GLib?.idle_add) {
                GLib.idle_add(300 /* PRIORITY_LOW */, () => {
                    if (!this._mainLoopHeld) quitMainLoop();
                    return false; // SOURCE_REMOVE
                });
            } else {
                quitMainLoop();
            }
        }
        return this;
    }

    read(): null {
        return null;
    }

    private _startReading(): void {
        if (!this._gio || this._reading) return;

        // If a read_bytes_async is already in-flight from the previous loop cycle
        // (queued before pause() set _reading = false), don't start a second
        // concurrent read on the same fd. Just re-enable _reading so the pending
        // callback continues the loop when it fires.
        if (this._pendingRead) {
            this._reading = true;
            if (!this._mainLoopHeld) {
                this._mainLoopHeld = true;
                ensureMainLoop();
            }
            return;
        }

        this._reading = true;
        // Keep the GLib main loop alive while waiting for stdin — same as
        // http.Server.listen() does for network sockets. Without this, gjs -m
        // exits as soon as module evaluation completes even though read_bytes_async
        // is pending, because GJS only stays alive when runAsync() registered a hook.
        if (!this._mainLoopHeld) {
            this._mainLoopHeld = true;
            ensureMainLoop();
        }

        if (!this._stdinGio) {
            // GioUnix: class is `InputStream`. Gio: concrete class is `UnixInputStream`;
            // `InputStream` is abstract. The ?? chain picks the right one for each namespace.
            const Cls = this._gio.UnixInputStream ?? this._gio.InputStream;
            if (!Cls) {
                this._reading = false;
                return;
            }
            try {
                this._stdinGio = Cls.new(this.fd, false);
            } catch {
                this._reading = false;
                return;
            }
        }

        const loop = () => {
            if (!this._reading) {
                this._pendingRead = false;
                return;
            }
            this._pendingRead = true;
            // oxlint-disable-next-line typescript/no-explicit-any -- GI introspection boundary: Gio/GLib namespaces and stream/result instances are runtime-injected via globalThis.imports.gi and would require @girs/* imports to type statically (coupling this file's TS compile to GJS); matches the gioAsync per-line-disable convention noted in AGENTS.md
            this._stdinGio.read_bytes_async(4096, 0, null, (src: any, res: any) => {
                this._pendingRead = false;
                try {
                    const bytes = src.read_bytes_finish(res);
                    const data: Uint8Array | null = bytes?.get_data?.() ?? null;
                    if (data && data.byteLength > 0) {
                        this._pushData(Buffer.from(data));
                    } else if (data !== null && data.byteLength === 0) {
                        this._reading = false;
                        // Flush any buffered partial multi-byte sequence before end.
                        if (this._decoder) {
                            const tail = this._decoder.end();
                            if (tail.length > 0) this.emit('data', tail);
                        }
                        this.emit('end');
                        return;
                    }
                } catch {
                    this._reading = false;
                    return;
                }
                if (this._reading) loop();
            });
        };
        loop();
    }
}
