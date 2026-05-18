// @gjsify/sab-native — optional GjsifySabNative GI module loader + JS façade.
//
// Cross-process SharedArrayBuffer for @gjsify/worker_threads:
//   - SharedBuffer.create(size) allocates a memfd_create + mmap(MAP_SHARED)
//     region; the .fd can be passed to a child via SCM_RIGHTS.
//   - SharedBuffer.fromFd(fd, size) reattaches a region whose fd was
//     received from another process.
//   - Typed accessors (getInt32LE / setUint8 / …) — no typed-array views
//     yet (V1 — minimal method API).
//   - atomics.{add,load,store,xchg,cmpxchg,wait,notify}32 — operates on
//     `SharedBuffer` instances directly, no `Atomics.*` overload.
//
// The package is GJS-only by construction. On Node the lazy load returns
// null; consumers must guard with `hasNativeSab()` before calling
// `SharedBuffer.create()` (which throws if the prebuild is absent).

/* ── Native GI module surface ───────────────────────────────────────────── */

export interface NativeSharedBuffer {
    readonly fd: number;
    readonly byte_length: number;

    get_u8(offset: number): number;
    set_u8(offset: number, v: number): void;
    get_u32_le(offset: number): number;
    set_u32_le(offset: number, v: number): void;
    get_i32_le(offset: number): number;
    set_i32_le(offset: number, v: number): void;
    get_u64_le(offset: number): bigint;
    set_u64_le(offset: number, v: bigint): void;

    read_bytes(offset: number, length: number): unknown; // GLib.Bytes
    write_bytes(offset: number, data: unknown): void;   // GLib.Bytes

    atomic_add_i32(offset: number, v: number): number;
    atomic_sub_i32(offset: number, v: number): number;
    atomic_load_i32(offset: number): number;
    atomic_store_i32(offset: number, v: number): void;
    atomic_xchg_i32(offset: number, v: number): number;
    atomic_cmpxchg_i32(offset: number, expected: number, desired: number): number;

    futex_wait(offset: number, expected: number, timeout_ms: number): number;
    futex_wake(offset: number, count: number): number;
}

export interface NativeSharedBufferClass {
    create(size: number): NativeSharedBuffer | null;
    from_fd(fd: number, size: number): NativeSharedBuffer | null;
}

export interface NativeFdChannelClass {
    make_pair(): [boolean, number, number];
    send_fd(socket_fd: number, fd_to_send: number, tag: number): boolean;
    recv_fd(socket_fd: number): [number, number]; // [fd, tag]
    close_fd(fd: number): boolean;
}

export interface GjsifySabNativeModule {
    SharedBuffer: NativeSharedBufferClass;
    FdChannel: NativeFdChannelClass;
}

/* ── Lazy load via GJS legacy imports API ───────────────────────────────── */

let _mod: GjsifySabNativeModule | null = null;
const _gi: Record<string, unknown> | undefined = (globalThis as any).imports?.gi;
if (_gi) {
    try {
        _mod = _gi['GjsifySabNative'] as GjsifySabNativeModule;
    } catch {
        // GjsifySabNative typelib not installed — package is unusable;
        // SharedBuffer.create() will throw with a precise error message.
    }
}

/** The native GjsifySabNative module, or null if not installed. */
export const nativeSab: GjsifySabNativeModule | null = _mod;

/** Returns true when the GjsifySabNative native library is available. */
export function hasNativeSab(): boolean {
    return _mod !== null;
}

/* ── Public JS façade ───────────────────────────────────────────────────── */

const PREBUILD_MISSING = '@gjsify/sab-native prebuild is not loaded — ' +
    'install the package on a Linux system with the prebuild available, ' +
    'or build locally via `meson compile` in packages/node/sab-native/.';

/**
 * A shared-memory region backed by an anonymous memfd (Linux) and
 * mmap(MAP_SHARED). The `.fd` may be passed to a child process via
 * SCM_RIGHTS over a Unix-domain socket; the child mmaps the same fd via
 * `SharedBuffer.fromFd()` to share the backing store.
 *
 * Reads and writes are explicitly little-endian regardless of host
 * byte-order — the C shim swaps where needed (s390x / ppc64).
 *
 * Atomic operations on `SharedBuffer` go through the `atomics` namespace
 * exported from this module — they cannot use JS's built-in
 * `Atomics` because `Atomics` rejects non-SharedArrayBuffer views.
 *
 * Lifecycle: the underlying memfd is closed and the mmap freed when the
 * `SharedBuffer` instance is garbage-collected. Call `.close()` to
 * release explicitly.
 */
export class SharedBuffer {
    /** @internal */
    private _native: NativeSharedBuffer | null;

    private constructor(native: NativeSharedBuffer) {
        this._native = native;
    }

    /**
     * Allocate a fresh anonymous shared-memory region.
     * @param size byte length. SHOULD be a multiple of the system page size
     *             (4096 on x86_64) for efficient mmap; smaller values work
     *             but waste a whole page per region.
     * @throws Error if the prebuild is not loaded, or if memfd_create/mmap fail.
     */
    static create(size: number): SharedBuffer {
        if (!_mod) throw new Error(PREBUILD_MISSING);
        if (!Number.isInteger(size) || size <= 0) {
            throw new TypeError('SharedBuffer.create: size must be a positive integer');
        }
        const native = _mod.SharedBuffer.create(size);
        if (!native) throw new Error('memfd_create or mmap failed');
        return new SharedBuffer(native);
    }

    /**
     * Map an existing shared-memory fd into this process. The fd is dup'd
     * — the caller retains ownership of their copy and may close it.
     *
     * @param fd file descriptor for a shared-memory object (typically
     *           received via SCM_RIGHTS from a parent process).
     * @param size MUST match the sender's view of the region size; the
     *             kernel does not check this for memfd, so a mismatch
     *             results in silent partial maps.
     */
    static fromFd(fd: number, size: number): SharedBuffer {
        if (!_mod) throw new Error(PREBUILD_MISSING);
        if (!Number.isInteger(fd) || fd < 0) {
            throw new TypeError('SharedBuffer.fromFd: fd must be a non-negative integer');
        }
        if (!Number.isInteger(size) || size <= 0) {
            throw new TypeError('SharedBuffer.fromFd: size must be a positive integer');
        }
        const native = _mod.SharedBuffer.from_fd(fd, size);
        if (!native) throw new Error('mmap failed');
        return new SharedBuffer(native);
    }

    /** Region size in bytes. */
    get byteLength(): number {
        return this._assertOpen().byte_length;
    }

    /**
     * File descriptor of the backing memfd. Pass this to a child process
     * via Gio.SubprocessLauncher.take_fd() (pre-spawn) or SCM_RIGHTS
     * (post-spawn) so the child can call `SharedBuffer.fromFd(fd, size)`.
     */
    get fd(): number {
        return this._assertOpen().fd;
    }

    /** True if this region has been released via close(). */
    get closed(): boolean { return this._native === null; }

    /**
     * Release the underlying memfd + mmap explicitly. Idempotent. The
     * backing store survives in any other process that still has the fd
     * mapped.
     */
    close(): void {
        // The native GObject's destructor releases the memory when the
        // JS reference is GC'd; setting _native=null here just makes
        // subsequent access throw instead of segfaulting.
        this._native = null;
    }

    /* ── Plain read / write ─────────────────────────────────────────────── */

    getUint8(offset: number): number   { return this._assertOpen().get_u8(offset); }
    setUint8(offset: number, v: number): void  {     this._assertOpen().set_u8(offset, v & 0xff); }

    getUint32LE(offset: number): number { return this._assertOpen().get_u32_le(offset); }
    setUint32LE(offset: number, v: number): void {  this._assertOpen().set_u32_le(offset, v >>> 0); }

    getInt32LE(offset: number): number  { return this._assertOpen().get_i32_le(offset); }
    setInt32LE(offset: number, v: number): void  {  this._assertOpen().set_i32_le(offset, v | 0); }

    getBigUint64LE(offset: number): bigint  { return this._assertOpen().get_u64_le(offset); }
    setBigUint64LE(offset: number, v: bigint): void  {  this._assertOpen().set_u64_le(offset, v); }

    /**
     * Read a byte range out as a Uint8Array. ONE-TIME COPY — modifications
     * to the returned array do NOT propagate back to the region. Use
     * `writeBytes()` to commit changes back.
     */
    readBytes(offset: number, length: number): Uint8Array {
        const bytes = this._assertOpen().read_bytes(offset, length);
        // GJS exposes GLib.Bytes-like values via imports.byteArray.fromGBytes
        // → Uint8Array. The copy keeps GC ownership inside SpiderMonkey.
        const byteArray = (globalThis as any).imports?.byteArray;
        if (byteArray && typeof byteArray.fromGBytes === 'function') {
            const arr = byteArray.fromGBytes(bytes) as Uint8Array;
            return new Uint8Array(arr); // detach from internal GByteArray
        }
        // Fallback: assume the returned object exposes a .toArray() method
        // (older GJS). Wrapped in Uint8Array so callers don't see GByteArray.
        return new Uint8Array((bytes as { toArray(): Uint8Array }).toArray());
    }

    /**
     * Write a byte range into the region. memcpy on the C side.
     */
    writeBytes(offset: number, data: Uint8Array): void {
        const byteArray = (globalThis as any).imports?.byteArray;
        let bytes: unknown;
        if (byteArray && typeof byteArray.toGBytes === 'function') {
            bytes = byteArray.toGBytes(data);
        } else {
            // Fallback: GLib.Bytes from a Uint8Array via global GLib.
            const GLib = (globalThis as any).imports?.gi?.GLib;
            bytes = GLib?.Bytes ? new GLib.Bytes(data) : data;
        }
        this._assertOpen().write_bytes(offset, bytes);
    }

    /** @internal Internal escape-hatch for atomics + worker_threads transfer. */
    get _nativeHandle(): NativeSharedBuffer {
        return this._assertOpen();
    }

    private _assertOpen(): NativeSharedBuffer {
        if (!this._native) throw new Error('SharedBuffer has been closed');
        return this._native;
    }
}

/* ── Atomics namespace ──────────────────────────────────────────────────── */

/**
 * Atomic operations against a `SharedBuffer`. Memory order: SEQ_CST.
 *
 * **Cannot be used with `Atomics.*` built-ins** — those reject anything
 * that isn't a typed-array view over a real `SharedArrayBuffer`. This
 * namespace mirrors the most common Atomics surface against our
 * memfd-backed regions instead.
 */
export const atomics = {
    /** `[*(int32_t*)(sb+offset)] += v`, returns previous value. */
    add32(sb: SharedBuffer, offset: number, v: number): number {
        return sb._nativeHandle.atomic_add_i32(offset, v | 0);
    },
    sub32(sb: SharedBuffer, offset: number, v: number): number {
        return sb._nativeHandle.atomic_sub_i32(offset, v | 0);
    },
    load32(sb: SharedBuffer, offset: number): number {
        return sb._nativeHandle.atomic_load_i32(offset);
    },
    store32(sb: SharedBuffer, offset: number, v: number): void {
        sb._nativeHandle.atomic_store_i32(offset, v | 0);
    },
    exchange32(sb: SharedBuffer, offset: number, v: number): number {
        return sb._nativeHandle.atomic_xchg_i32(offset, v | 0);
    },
    /**
     * Strong compare-and-swap. Returns the previous value. CAS succeeded iff
     * `returned === expected`.
     */
    compareExchange32(sb: SharedBuffer, offset: number, expected: number, desired: number): number {
        return sb._nativeHandle.atomic_cmpxchg_i32(offset, expected | 0, desired | 0);
    },
    /**
     * Linux futex_wait. Compare `*(int32_t*)(sb+offset)` to `expected`; if
     * equal, block until woken or timeout (0 ms = non-blocking probe;
     * `-1` ms = infinite).
     *
     * Returns:
     *   - `'ok'`         — woken by a matching `notify32()` call.
     *   - `'not-equal'`  — value didn't match `expected`; no wait happened.
     *   - `'timed-out'`  — timeout expired before any wake.
     *   - `'interrupted'` — interrupted by signal (EINTR); caller may retry.
     */
    wait32(sb: SharedBuffer, offset: number, expected: number, timeoutMs: number): 'ok' | 'not-equal' | 'timed-out' | 'interrupted' {
        const r = sb._nativeHandle.futex_wait(offset, expected | 0, timeoutMs | 0);
        if (r === 0)  return 'ok';
        if (r === -1) return 'not-equal';
        if (r === -2) return 'timed-out';
        if (r === -3) return 'interrupted';
        throw new Error(`futex_wait returned errno ${-r}`);
    },
    /** Wake up to `count` waiters on `sb+offset`. Returns number actually woken. */
    notify32(sb: SharedBuffer, offset: number, count: number): number {
        return sb._nativeHandle.futex_wake(offset, count | 0);
    },
};

/* ── Internal: fd-passing channel (used by @gjsify/worker_threads) ──────── */

/**
 * Unix-domain socket pair + SCM_RIGHTS fd-transfer helper.
 *
 * **Internal API.** Exposed for `@gjsify/worker_threads` to wire up the
 * cross-process SharedBuffer transfer at `Worker` spawn time. Direct
 * consumers should use `Worker.postMessage(value, [sb])` instead.
 */
export const fdChannel = _mod ? {
    makePair(): { parentFd: number; childFd: number } {
        const [ok, parent_fd, child_fd] = _mod!.FdChannel.make_pair();
        if (!ok) throw new Error('socketpair() failed');
        return { parentFd: parent_fd, childFd: child_fd };
    },
    /**
     * Send one fd over an open SOCK_SEQPACKET pair via SCM_RIGHTS. Returns
     * `true` on success, `false` on `sendmsg()` failure (errno preserved on
     * the calling thread — caller surfaces the error in whatever shape
     * makes sense for the situation).
     */
    sendFd(socketFd: number, fdToSend: number, tag: number): boolean {
        return _mod!.FdChannel.send_fd(socketFd, fdToSend, tag >>> 0);
    },
    /**
     * Blocking recv of one fd. Returns the received fd + tag, or null on
     * orderly EOF.
     */
    recvFd(socketFd: number): { fd: number; tag: number } | null {
        const [fd, tag] = _mod!.FdChannel.recv_fd(socketFd);
        if (fd === 0)  return null;       // orderly EOF
        if (fd < 0)    throw new Error('recvmsg failed');
        return { fd, tag: tag >>> 0 };
    },
    /**
     * close(2) on a fd previously created by `makePair()` (or any fd, really).
     * Idempotent — closing an already-closed fd is fine.
     */
    closeFd(fd: number): void {
        _mod!.FdChannel.close_fd(fd);
    },
} : null;
