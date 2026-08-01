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
// Platform scope (ADR 0013, docs/adr/0013-sab-native-platform-scope.md):
// the native backend is **Linux-only** today — it is built on memfd_create(2),
// the non-private SYS_futex flavour and SCM_RIGHTS, and prebuilds ship for
// linux-{x64,arm64,ppc64,s390x,riscv64} only. macOS is a decided but
// not-yet-implemented port (shm_open + os_sync_wait_on_address, macOS 14.4+);
// Windows is blocked (no GJS host, and no cross-process address-keyed wait
// primitive exists there).
//
// The package is GJS-only by construction. On Node — and on any platform or
// build without the prebuild — the lazy load yields null; consumers MUST guard
// with `hasNativeSab()` before touching `SharedBuffer`, which throws a
// descriptive error rather than failing obscurely.

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
    write_bytes(offset: number, data: unknown): void; // GLib.Bytes

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

/**
 * Module-local typed view of the GJS-runtime globals this file reads.
 * `globalThis.imports` is the GJS bootstrap object — it exists before any
 * `@girs/*` modules resolve, so we read it via a structural type instead
 * of importing `@girs/glib-2.0` from a node-side polyfill.
 */
interface _GjsRuntimeGlobals {
    imports?: {
        gi?: Record<string, unknown>;
        byteArray?: { fromGBytes(bytes: unknown): Uint8Array; toGBytes(arr: Uint8Array): unknown };
    };
    Buffer?: { from(view: Uint8Array): unknown };
}

const _runtime = globalThis as unknown as _GjsRuntimeGlobals;

/**
 * Resolve the `GjsifySabNative` GI module out of a GJS `imports.gi` object,
 * normalising **every** unavailable case to `null`.
 *
 * Exported so the degradation contract can be pinned by a spec without a
 * second process (see `shared-buffer.gjs.spec.ts`). Three ways this returns
 * `null`, all of which must behave identically to the caller:
 *
 * 1. `gi` itself is absent — we are not on GJS at all (Node, browser).
 * 2. The property access throws — GJS raises when the typelib is not on
 *    `GI_TYPELIB_PATH`, i.e. no prebuild for this platform. This is the
 *    macOS/Windows case.
 * 3. The access succeeds but yields something that is not the module we
 *    expect — a stale, partial or shadowed typelib. Without the shape check
 *    a `undefined`/partial value would leave `hasNativeSab()` reporting
 *    `true` and then blow up with an opaque `TypeError` at first use; the
 *    check converts that into the same clean "unavailable" answer.
 *
 * @internal
 */
export function resolveNativeSab(gi: Record<string, unknown> | undefined): GjsifySabNativeModule | null {
    if (!gi) return null;
    let candidate: unknown;
    try {
        candidate = gi['GjsifySabNative'];
    } catch {
        // Typelib not installed for this platform/arch — the package is
        // unusable here; SharedBuffer.create() throws a descriptive error.
        return null;
    }
    if (!candidate || typeof candidate !== 'object') return null;
    const mod = candidate as Partial<GjsifySabNativeModule>;
    if (typeof mod.SharedBuffer?.create !== 'function') return null;
    if (typeof mod.FdChannel?.make_pair !== 'function') return null;
    return mod as GjsifySabNativeModule;
}

const _mod: GjsifySabNativeModule | null = resolveNativeSab(_runtime.imports?.gi);

/** The native GjsifySabNative module, or null if not installed. */
export const nativeSab: GjsifySabNativeModule | null = _mod;

/**
 * Returns true when the GjsifySabNative native library is available.
 *
 * This is THE gate for cross-process `SharedBuffer` support and it is
 * platform-conditional by design: it is `true` only on Linux (see ADR 0013),
 * and `false` on macOS, Windows, Node and the browser. Guard every use of
 * `SharedBuffer` / `atomics` / `fdChannel` with it.
 */
export function hasNativeSab(): boolean {
    return _mod !== null;
}

/* ── Public JS façade ───────────────────────────────────────────────────── */

/**
 * Message thrown by `SharedBuffer.create()` / `.fromFd()` when the native
 * backend is unavailable. Names the actual situation — a platform-scoped
 * capability — instead of implying a broken install.
 *
 * @internal exported so specs and docs can assert the exact contract text.
 */
export const NATIVE_SAB_UNAVAILABLE =
    '@gjsify/sab-native: the native backend is not available on this platform. ' +
    'Cross-process SharedBuffer is currently Linux-only (memfd_create + futex + SCM_RIGHTS); ' +
    'prebuilds ship for linux-{x64,arm64,ppc64,s390x,riscv64} only — ' +
    'macOS support is planned and Windows is unsupported (see docs/adr/0013-sab-native-platform-scope.md). ' +
    'Guard with hasNativeSab() before using SharedBuffer. ' +
    'On Linux, a missing prebuild can be built locally with `gjsify workspace @gjsify/sab-native build:prebuilds`.';

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
        if (!_mod) throw new Error(NATIVE_SAB_UNAVAILABLE);
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
        if (!_mod) throw new Error(NATIVE_SAB_UNAVAILABLE);
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
    get closed(): boolean {
        return this._native === null;
    }

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

    getUint8(offset: number): number {
        return this._assertOpen().get_u8(offset);
    }
    setUint8(offset: number, v: number): void {
        this._assertOpen().set_u8(offset, v & 0xff);
    }

    getUint32LE(offset: number): number {
        return this._assertOpen().get_u32_le(offset);
    }
    setUint32LE(offset: number, v: number): void {
        this._assertOpen().set_u32_le(offset, v >>> 0);
    }

    getInt32LE(offset: number): number {
        return this._assertOpen().get_i32_le(offset);
    }
    setInt32LE(offset: number, v: number): void {
        this._assertOpen().set_i32_le(offset, v | 0);
    }

    getBigUint64LE(offset: number): bigint {
        return this._assertOpen().get_u64_le(offset);
    }
    setBigUint64LE(offset: number, v: bigint): void {
        this._assertOpen().set_u64_le(offset, v);
    }

    /**
     * Read a byte range out as a Uint8Array. ONE-TIME COPY — modifications
     * to the returned array do NOT propagate back to the region. Use
     * `writeBytes()` to commit changes back, or `viewBytes()` for a
     * zero-copy view.
     */
    readBytes(offset: number, length: number): Uint8Array {
        const bytes = this._assertOpen().read_bytes(offset, length);
        // GJS exposes GLib.Bytes-like values via imports.byteArray.fromGBytes
        // → Uint8Array. The copy keeps GC ownership inside SpiderMonkey.
        const byteArray = _runtime.imports?.byteArray;
        if (byteArray && typeof byteArray.fromGBytes === 'function') {
            const arr = byteArray.fromGBytes(bytes);
            return new Uint8Array(arr); // detach from internal GByteArray
        }
        // Fallback: assume the returned object exposes a .toArray() method
        // (older GJS). Wrapped in Uint8Array so callers don't see GByteArray.
        return new Uint8Array((bytes as { toArray(): Uint8Array }).toArray());
    }

    /**
     * Return a fresh `Uint8Array` containing the bytes at `[offset, offset+length)`.
     * Same semantics as `readBytes()` — kept under this name because
     * downstream tooling (`Buffer.from`, `node:crypto`'s `Hash.update`,
     * `fs.writeSync`) calls into this method via duck-typing and the
     * `viewBytes` name reads more naturally there.
     *
     * **NOT zero-copy in current GJS.** GJS's `byteArray.fromGBytes`
     * (`refs/gjs/gjs/byteArray.cpp::from_gbytes_func`) allocates a fresh
     * `JS::ArrayBuffer` and memcpy's the GBytes data into it — by design,
     * for alignment + immutability reasons.
     *
     * **Why no internal fix is possible**: a true zero-copy view would need
     * `JS::NewExternalArrayBuffer` against the mmap pointer, but that JSAPI
     * call requires a `JSContext*` which GJS does not expose to
     * GObject-introspected `.so` plugins. The fix has to land in GJS
     * itself (e.g. a `byteArray.fromGBytesShared` helper). Tracked under
     * status/upstream-patch-candidates.md.
     *
     * Modifications to the returned array therefore do NOT propagate back
     * to the region — use `writeBytes()` to commit changes.
     *
     * @throws Error if `byteArray.fromGBytes` is not available (GJS < 1.66).
     */
    viewBytes(offset: number, length: number): Uint8Array {
        // Reuse readBytes — same C-side GBytes wrap + same SpiderMonkey
        // copy. Method exists as a stable duck-type entry for Buffer.from.
        return this.readBytes(offset, length);
    }

    /**
     * Return a `Buffer` containing the bytes at `[offset, offset+length)`.
     * The Buffer is a fresh allocation (see `viewBytes()` for the "not
     * zero-copy in current GJS" caveat — the limitation is in GJS'
     * `byteArray.fromGBytes`, not bypassable from a `.so` plugin without
     * upstream patching GJS) — `buf.writeUInt32LE(...)`, `buf.subarray(...)`,
     * `buf.toString('hex')`, `createHash().update(buf)` all work, but
     * writes do NOT propagate back to the shared region.
     *
     * Requires `globalThis.Buffer` to be registered (via
     * `@gjsify/buffer/register`) — otherwise throws. Consumers running
     * under the standard gjsify CLI bundle have Buffer registered via
     * `--globals auto`; for ad-hoc scripts, add an explicit
     * `import '@gjsify/buffer/register'` at the entry point.
     *
     * Return type is generic to avoid an import dependency on
     * `@gjsify/buffer` — the concrete return is a `Buffer` (subclass of
     * `Uint8Array`). Default `T = Uint8Array` is always safe;
     * `toBuffer<Buffer>()` gets the full Buffer surface.
     *
     * @param offset byte offset into the shared region. Defaults to 0.
     * @param length byte length. Defaults to `byteLength - offset`.
     */
    toBuffer<T extends Uint8Array = Uint8Array>(offset = 0, length?: number): T {
        const len = length ?? this.byteLength - offset;
        const view = this.viewBytes(offset, len);
        // Buffer is registered globally by `@gjsify/buffer/register`. We
        // type the structural `Buffer.from(ArrayBuffer, …)` overload via
        // the runtime-globals view.
        interface _BufferStatic {
            from(buffer: ArrayBufferLike, byteOffset?: number, length?: number): unknown;
        }
        const BufferCtor = (_runtime as unknown as { Buffer?: _BufferStatic }).Buffer;
        if (typeof BufferCtor?.from !== 'function') {
            throw new Error(
                'SharedBuffer.toBuffer: globalThis.Buffer is not registered. ' +
                    'Import "@gjsify/buffer/register" or rely on --globals auto.',
            );
        }
        // Buffer.from(ArrayBuffer, byteOffset, length) is zero-copy in
        // @gjsify/buffer (constructor reuses the ArrayBuffer directly) —
        // the underlying ArrayBuffer is already a SpiderMonkey-owned copy
        // produced by readBytes, so no further copy happens here.
        return BufferCtor.from(view.buffer, view.byteOffset, view.byteLength) as T;
    }

    /**
     * Write a byte range into the region. memcpy on the C side.
     */
    writeBytes(offset: number, data: Uint8Array): void {
        const byteArray = _runtime.imports?.byteArray;
        let bytes: unknown;
        if (byteArray && typeof byteArray.toGBytes === 'function') {
            bytes = byteArray.toGBytes(data);
        } else {
            // Fallback: GLib.Bytes from a Uint8Array via global GLib.
            interface _GLibBytesCtor {
                Bytes?: new (data: Uint8Array) => unknown;
            }
            const GLib = _runtime.imports?.gi?.GLib as _GLibBytesCtor | undefined;
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
    wait32(
        sb: SharedBuffer,
        offset: number,
        expected: number,
        timeoutMs: number,
    ): 'ok' | 'not-equal' | 'timed-out' | 'interrupted' {
        const r = sb._nativeHandle.futex_wait(offset, expected | 0, timeoutMs | 0);
        if (r === 0) return 'ok';
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
export const fdChannel = _mod
    ? {
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
              if (fd === 0) return null; // orderly EOF
              if (fd < 0) throw new Error('recvmsg failed');
              return { fd, tag: tag >>> 0 };
          },
          /**
           * close(2) on a fd previously created by `makePair()` (or any fd, really).
           * Idempotent — closing an already-closed fd is fine.
           */
          closeFd(fd: number): void {
              _mod!.FdChannel.close_fd(fd);
          },
      }
    : null;
