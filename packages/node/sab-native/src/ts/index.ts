// @gjsify/sab-native — optional GjsifySabNative GI module loader + JS façade.
//
// Cross-process shared memory for @gjsify/worker_threads: `SharedBuffer.create()`
// makes a memfd_create + mmap(MAP_SHARED) region whose `.fd` travels to a child via
// SCM_RIGHTS, and `SharedBuffer.fromFd()` reattaches it there. Access is through
// typed accessors and the `atomics` namespace — never `Atomics.*`, see there.
//
// Platform scope is Linux-only (ADR 0013): memfd_create(2), the non-private
// SYS_futex flavour and SCM_RIGHTS. macOS is a decided but unimplemented port
// (shm_open + os_sync_wait_on_address, 14.4+); Windows is blocked outright, having
// no cross-process address-keyed wait primitive at all.
//
// GJS-only by construction: on Node, or any build without the prebuild, the lazy
// load yields null and consumers MUST gate on `hasNativeSab()`.

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

/**
 * Structural view of the GJS-runtime globals this file reads. `globalThis.imports`
 * is the GJS bootstrap object, available before any `@girs/*` module resolves —
 * hence a structural type rather than importing `@girs/glib-2.0` into a module that
 * also loads under Node.
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
 * Resolve the `GjsifySabNative` GI module, normalising EVERY unavailable case to
 * `null`: no `gi` at all (not GJS), a throwing property access (typelib not on
 * `GI_TYPELIB_PATH` — the macOS/Windows case), and a value that is not the module
 * we expect (stale, partial or shadowed typelib). The third needs the shape check:
 * a partial value otherwise leaves `hasNativeSab()` reporting `true` and fails with
 * an opaque `TypeError` at first use.
 *
 * @internal exported so a spec can pin the degradation contract in-process
 * (`shared-buffer.gjs.spec.ts`).
 */
export function resolveNativeSab(gi: Record<string, unknown> | undefined): GjsifySabNativeModule | null {
    if (!gi) return null;
    let candidate: unknown;
    try {
        candidate = gi['GjsifySabNative'];
    } catch {
        // Typelib not installed for this platform/arch.
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
 * THE gate for cross-process `SharedBuffer`, and platform-conditional by design:
 * `true` only on Linux (ADR 0013), `false` on macOS, Windows, Node and the browser.
 * Guard every use of `SharedBuffer` / `atomics` / `fdChannel` with it.
 */
export function hasNativeSab(): boolean {
    return _mod !== null;
}

/**
 * Thrown by `SharedBuffer.create()` / `.fromFd()` when the native backend is
 * unavailable. Says "platform-scoped capability", not "broken install".
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
 * A shared-memory region backed by an anonymous memfd and mmap(MAP_SHARED). The
 * `.fd` may be passed to a child over a Unix-domain socket via SCM_RIGHTS; the
 * child mmaps the same fd with `SharedBuffer.fromFd()` to share the backing store.
 *
 * Reads and writes are little-endian regardless of host byte-order — the C shim
 * swaps where needed (s390x / ppc64).
 *
 * Lifecycle: the memfd is closed and the mmap freed by the native destructor, i.e.
 * when this instance is garbage-collected. `.close()` does NOT release the region;
 * it only drops our reference so later access throws.
 */
export class SharedBuffer {
    /** @internal */
    private _native: NativeSharedBuffer | null;

    private constructor(native: NativeSharedBuffer) {
        this._native = native;
    }

    /**
     * Allocate a fresh anonymous shared-memory region. `size` SHOULD be a multiple
     * of the page size — smaller values work but waste a whole page per region.
     *
     * @throws if the prebuild is not loaded, or memfd_create/mmap fail.
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
     * Map an existing shared-memory fd — typically received via SCM_RIGHTS — into
     * this process. The fd is dup'd, so the caller keeps ownership of their copy.
     *
     * `size` MUST match the sender's view of the region: the kernel does not check
     * it for a memfd, so a mismatch silently produces a partial map.
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
     * File descriptor of the backing memfd — hand it to a child via
     * `Gio.SubprocessLauncher.take_fd()` pre-spawn or SCM_RIGHTS post-spawn.
     */
    get fd(): number {
        return this._assertOpen().fd;
    }

    /** True if this region has been released via close(). */
    get closed(): boolean {
        return this._native === null;
    }

    /**
     * Drop this view of the region. Idempotent. NOT a release: the memfd and mmap go
     * away with the native GObject's destructor, so this only makes later access
     * throw rather than segfault. The backing store also survives in any other
     * process still holding the fd mapped.
     */
    close(): void {
        this._native = null;
    }

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
     * Read a byte range as a Uint8Array. ONE-TIME COPY — modifications do NOT
     * propagate back; use `writeBytes()` to commit changes.
     */
    readBytes(offset: number, length: number): Uint8Array {
        const bytes = this._assertOpen().read_bytes(offset, length);
        const byteArray = _runtime.imports?.byteArray;
        if (byteArray && typeof byteArray.fromGBytes === 'function') {
            const arr = byteArray.fromGBytes(bytes);
            return new Uint8Array(arr); // detach from the internal GByteArray
        }
        // Older GJS: the GBytes-like value exposes `.toArray()` instead. Wrapped so
        // callers never see a GByteArray.
        return new Uint8Array((bytes as { toArray(): Uint8Array }).toArray());
    }

    /**
     * Identical to `readBytes()`, under a second name because downstream tooling
     * (`Buffer.from`, `node:crypto`'s `Hash.update`, `fs.writeSync`) duck-types into
     * it and `viewBytes` reads naturally there.
     *
     * Despite the name it is NOT zero-copy, and cannot be made so from here: GJS's
     * `byteArray.fromGBytes` (`refs/gjs/gjs/byteArray.cpp::from_gbytes_func`)
     * allocates a fresh `JS::ArrayBuffer` and memcpys into it, deliberately, for
     * alignment and immutability. A real view needs `JS::NewExternalArrayBuffer`
     * over the mmap pointer, which needs a `JSContext*` that GJS does not hand to
     * introspected `.so` plugins — so the fix belongs in GJS (a
     * `byteArray.fromGBytesShared`). Tracked in status/upstream-patch-candidates.md.
     */
    viewBytes(offset: number, length: number): Uint8Array {
        return this.readBytes(offset, length);
    }

    /**
     * The bytes at `[offset, offset+length)` as a `Buffer`, so `writeUInt32LE`,
     * `subarray`, `toString('hex')` and `createHash().update()` all work — on a
     * COPY, per `viewBytes()`, so writes do not reach the shared region.
     *
     * Needs `globalThis.Buffer` registered, which `--globals auto` does for the
     * standard CLI bundle; an ad-hoc script needs an explicit
     * `import '@gjsify/buffer/register'`.
     *
     * The return type is generic only to avoid a dependency on `@gjsify/buffer`; the
     * concrete value is always a `Buffer`, so `toBuffer<Buffer>()` gets the full
     * surface and the `Uint8Array` default is always safe.
     */
    toBuffer<T extends Uint8Array = Uint8Array>(offset = 0, length?: number): T {
        const len = length ?? this.byteLength - offset;
        const view = this.viewBytes(offset, len);
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
        // No second copy: `@gjsify/buffer`'s `Buffer.from(ArrayBuffer, …)` reuses the
        // ArrayBuffer, which `readBytes` already made SpiderMonkey-owned.
        return BufferCtor.from(view.buffer, view.byteOffset, view.byteLength) as T;
    }

    /** Write a byte range into the region. memcpy on the C side. */
    writeBytes(offset: number, data: Uint8Array): void {
        const byteArray = _runtime.imports?.byteArray;
        let bytes: unknown;
        if (byteArray && typeof byteArray.toGBytes === 'function') {
            bytes = byteArray.toGBytes(data);
        } else {
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

/**
 * Atomic operations against a `SharedBuffer`. Memory order: SEQ_CST.
 *
 * The `Atomics.*` built-ins are not an option: GJS does not expose `Atomics` at all
 * (verified on gjs 1.88.1), and a `SharedBuffer` is not a typed-array view in any
 * case. This namespace mirrors the common surface over the memfd-backed region.
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

/**
 * Unix-domain socket pair + SCM_RIGHTS fd transfer.
 *
 * @internal for `@gjsify/worker_threads` to wire up the cross-process SharedBuffer
 * transfer at `Worker` spawn time; direct consumers use
 * `Worker.postMessage(value, [sb])`.
 */
export const fdChannel = _mod
    ? {
          makePair(): { parentFd: number; childFd: number } {
              const [ok, parent_fd, child_fd] = _mod!.FdChannel.make_pair();
              if (!ok) throw new Error('socketpair() failed');
              return { parentFd: parent_fd, childFd: child_fd };
          },
          /**
           * Send one fd over an open SOCK_SEQPACKET pair via SCM_RIGHTS. `false` on
           * `sendmsg()` failure, with errno left on the calling thread for the caller
           * to shape into an error.
           */
          sendFd(socketFd: number, fdToSend: number, tag: number): boolean {
              return _mod!.FdChannel.send_fd(socketFd, fdToSend, tag >>> 0);
          },
          /** Blocking recv of one fd + tag, or `null` on orderly EOF. */
          recvFd(socketFd: number): { fd: number; tag: number } | null {
              const [fd, tag] = _mod!.FdChannel.recv_fd(socketFd);
              if (fd === 0) return null; // orderly EOF
              if (fd < 0) throw new Error('recvmsg failed');
              return { fd, tag: tag >>> 0 };
          },
          /** close(2) on any fd. Idempotent: the shim reports success on EBADF too. */
          closeFd(fd: number): void {
              _mod!.FdChannel.close_fd(fd);
          },
      }
    : null;
