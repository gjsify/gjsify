/*
 * Tiny C shim around Linux shared-memory + atomics primitives that Vala
 * can't express cleanly:
 *
 *   - memfd_create(2)         — anonymous shared-memory fd (no path needed)
 *   - mmap(2) / munmap(2)     — MAP_SHARED region creation
 *   - SYS_futex (FUTEX_WAIT_PRIVATE / FUTEX_WAKE_PRIVATE) — wait/notify
 *   - __atomic_* GCC builtins — load/store/add/cmpxchg with SEQ_CST
 *   - socketpair(AF_UNIX, SOCK_SEQPACKET) — IPC side-channel for fd-passing
 *   - sendmsg/recvmsg + SCM_RIGHTS — cross-process fd transfer
 *
 * Same design as @gjsify/http2-native: opaque struct (full definition in .c),
 * `gjsify_sab_<verb>` naming, `_free` paired with `_new`. Buffer ownership
 * stays C-side; JS only sees the GObject wrapper from shared-buffer.vala
 * and the GBytes objects returned by read_bytes (which borrow the mmap'd
 * memory, so callers can do zero-copy reads via imports.byteArray.toArray).
 *
 * Reference: man 2 memfd_create, man 2 mmap, man 2 futex, man 3 cmsg.
 */

#ifndef GJSIFY_SAB_HELPERS_H
#define GJSIFY_SAB_HELPERS_H

#include <glib.h>
#include <glib-object.h>

G_BEGIN_DECLS

/* ────────────────────────────────────────────────────────────────────── *
 * Shared-memory region (opaque)
 * ────────────────────────────────────────────────────────────────────── */

typedef struct _GjsifySabRegion GjsifySabRegion;

/**
 * gjsify_sab_region_new_anonymous:
 * @size: byte length of the region (multiple-of-page strongly preferred)
 *
 * Allocate a fresh memfd, ftruncate it to @size, and mmap it MAP_SHARED.
 * Region owns the fd and will close+munmap it on free. Returns %NULL on
 * any syscall failure (errno preserved).
 */
GjsifySabRegion *gjsify_sab_region_new_anonymous (gsize size);

/**
 * gjsify_sab_region_new_from_fd:
 * @fd:   caller-owned fd referring to a shared-memory object (typically
 *        received via SCM_RIGHTS from a parent process). Will be dup'd —
 *        caller retains ownership of the original fd.
 * @size: byte length of the region (must match the sender's view)
 *
 * mmap the fd MAP_SHARED into the calling process's address space.
 * Returns %NULL on dup() or mmap() failure (errno preserved).
 */
GjsifySabRegion *gjsify_sab_region_new_from_fd  (gint fd, gsize size);

void              gjsify_sab_region_free        (GjsifySabRegion *region);

gint  gjsify_sab_region_get_fd   (const GjsifySabRegion *region);
gsize gjsify_sab_region_get_size (const GjsifySabRegion *region);

/* ────────────────────────────────────────────────────────────────────── *
 * Plain read / write (no memory barriers — see _atomic_* below for SEQ_CST)
 * ────────────────────────────────────────────────────────────────────── *
 *
 * All multi-byte accessors are little-endian on the wire. On x86_64 /
 * aarch64 (the native arches) this is a no-op; on s390x / ppc64 the C
 * shim swaps via __builtin_bswap*. Bounds-check `offset + sizeof(T) <=
 * size`; on overflow we g_error() (programmer error, fail-fast).
 */
guint8  gjsify_sab_region_read_u8     (const GjsifySabRegion *region, gsize offset);
void    gjsify_sab_region_write_u8    (GjsifySabRegion *region,       gsize offset, guint8  v);
guint32 gjsify_sab_region_read_u32_le (const GjsifySabRegion *region, gsize offset);
void    gjsify_sab_region_write_u32_le(GjsifySabRegion *region,       gsize offset, guint32 v);
gint32  gjsify_sab_region_read_i32_le (const GjsifySabRegion *region, gsize offset);
void    gjsify_sab_region_write_i32_le(GjsifySabRegion *region,       gsize offset, gint32  v);
guint64 gjsify_sab_region_read_u64_le (const GjsifySabRegion *region, gsize offset);
void    gjsify_sab_region_write_u64_le(GjsifySabRegion *region,       gsize offset, guint64 v);

/* Bulk: return a fresh GBytes that borrows the mmap'd memory (no copy).
 * Caller must release the GBytes BEFORE freeing the region — we wrap with
 * g_bytes_new_with_free_func(ptr, length, region_ref, region_unref) so the
 * region is reference-counted via a tiny refcount in the shim. */
GBytes *gjsify_sab_region_read_bytes (GjsifySabRegion *region, gsize offset, gsize length);
void    gjsify_sab_region_write_bytes(GjsifySabRegion *region, gsize offset, GBytes *data);

/* ────────────────────────────────────────────────────────────────────── *
 * Atomics — __atomic_* builtins, memory_order = SEQ_CST
 * ────────────────────────────────────────────────────────────────────── *
 *
 * `cmpxchg32`: weak compare-and-swap. *expected is updated to the actual
 * value on failure (standard C11 pattern). Returns TRUE on success.
 */
gint32   gjsify_sab_region_atomic_add_i32     (GjsifySabRegion *region, gsize offset, gint32 v);
gint32   gjsify_sab_region_atomic_sub_i32     (GjsifySabRegion *region, gsize offset, gint32 v);
gint32   gjsify_sab_region_atomic_load_i32    (const GjsifySabRegion *region, gsize offset);
void     gjsify_sab_region_atomic_store_i32   (GjsifySabRegion *region, gsize offset, gint32 v);
gint32   gjsify_sab_region_atomic_xchg_i32    (GjsifySabRegion *region, gsize offset, gint32 v);
gboolean gjsify_sab_region_atomic_cmpxchg_i32 (GjsifySabRegion *region, gsize offset, gint32 *expected, gint32 desired);

/* ────────────────────────────────────────────────────────────────────── *
 * Futex wait / wake (Linux SYS_futex, FUTEX_*_PRIVATE flavour)
 * ────────────────────────────────────────────────────────────────────── *
 *
 * `futex_wait`:
 *   - Compares *(int32_t*)(ptr+offset) against `expected`.
 *   - If equal: blocks until woken or timeout (`timeout_ms` < 0 = infinite).
 *   - If not equal: returns immediately (no block).
 * Returns:
 *    0 = woken via FUTEX_WAKE
 *   -1 = value did not match expected (EAGAIN) — no wait happened
 *   -2 = timed out (ETIMEDOUT)
 *   -3 = interrupted by signal (EINTR) — caller may retry
 *   other negative = generic errno, sign-flipped
 *
 * `futex_wake`:
 *   Wakes up to @count waiters on the address. Returns number actually woken.
 */
gint    gjsify_sab_region_futex_wait (GjsifySabRegion *region, gsize offset, gint32 expected, gint64 timeout_ms);
gint    gjsify_sab_region_futex_wake (GjsifySabRegion *region, gsize offset, gint count);

/* ────────────────────────────────────────────────────────────────────── *
 * IPC side-channel: AF_UNIX/SOCK_SEQPACKET pair + SCM_RIGHTS fd transfer
 * ────────────────────────────────────────────────────────────────────── *
 *
 * Used by @gjsify/worker_threads to attach the fd of a SharedBuffer to a
 * postMessage() call. The parent calls _socketpair() at worker spawn,
 * inherits the child end via Gio.SubprocessLauncher.take_fd(child_fd, 3),
 * then send_fd() each SharedBuffer's fd over the parent end. Child runs a
 * recv_fd() loop on its end to pick them up in lockstep with the JSON IPC.
 *
 * Tag is a 4-byte sequence number the sender encodes so the receiver can
 * map the received fd back to the JSON placeholder {__sab: <tag>, size: N}.
 */
gboolean gjsify_sab_socketpair (gint *parent_fd, gint *child_fd);
gboolean gjsify_sab_send_fd    (gint socket_fd, gint fd_to_send, guint32 tag);

/* recv_fd: returns received fd, or -1 on error (errno preserved).
 * Returns 0 on orderly EOF (peer closed socket). *tag receives the
 * sender-encoded tag value. */
gint     gjsify_sab_recv_fd    (gint socket_fd, guint32 *tag);

/* close_fd: just `close(2)` wrapped so JS callers don't have to drag in
 * GioUnix's typelib for a single syscall. Returns TRUE on success
 * (or EBADF — already closed is harmless), FALSE on other errno. */
gboolean gjsify_sab_close_fd   (gint fd);

G_END_DECLS

#endif /* GJSIFY_SAB_HELPERS_H */
