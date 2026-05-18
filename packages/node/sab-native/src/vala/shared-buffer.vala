/*
 * SharedBuffer — JS-visible wrapper around a memfd-backed mmap region.
 *
 * Lifecycle
 * ─────────
 * Two construction paths:
 *
 *   1. `SharedBuffer.create(size)` — allocates a fresh memfd, ftruncates to
 *      @size, and mmaps MAP_SHARED. The region owns the fd; it is closed
 *      and the mapping freed when the SharedBuffer instance is collected.
 *
 *   2. `SharedBuffer.from_fd(fd, size)` — mmaps a fd received from another
 *      process (typically via SCM_RIGHTS in @gjsify/worker_threads). The
 *      original fd is dup'd, so the caller can close their copy safely.
 *
 * Wire protocol
 * ─────────────
 * All multi-byte accessors are explicitly LE on the wire (little-endian),
 * so a SharedBuffer written on x86_64 and read on s390x sees the same
 * values. The C shim handles byte-swapping where needed.
 *
 * Atomics
 * ───────
 * `atomic_*_i32` family operates with SEQ_CST memory ordering via GCC
 * `__atomic_*` builtins. `futex_wait` / `futex_wake` give cross-process
 * wait/notify via Linux SYS_futex (FUTEX_*_PRIVATE flavour).
 *
 * Buffer ownership: read_bytes returns a GLib.Bytes that borrows the
 * mmap'd memory (no copy) and ref-counts the region so the mapping
 * survives until every outstanding bytes reference is released.
 */

namespace GjsifySabNative {

    /* ── Opaque pointer wrappers + C entry points ───────────────────────── *
     * Same pattern as @gjsify/http2-native: opaque region travels as void*
     * across the FFI boundary; Vala destructor explicitly calls free. */

    [CCode (cname = "gjsify_sab_region_new_anonymous",
            cheader_filename = "sab-helpers.h")]
    private extern void* _region_new_anonymous (size_t size);

    [CCode (cname = "gjsify_sab_region_new_from_fd",
            cheader_filename = "sab-helpers.h")]
    private extern void* _region_new_from_fd (int fd, size_t size);

    [CCode (cname = "gjsify_sab_region_free",
            cheader_filename = "sab-helpers.h")]
    private extern void _region_free (void* region);

    [CCode (cname = "gjsify_sab_region_get_fd",
            cheader_filename = "sab-helpers.h")]
    private extern int _region_get_fd (void* region);

    [CCode (cname = "gjsify_sab_region_get_size",
            cheader_filename = "sab-helpers.h")]
    private extern size_t _region_get_size (void* region);

    /* Read/write */

    [CCode (cname = "gjsify_sab_region_read_u8",   cheader_filename = "sab-helpers.h")]
    private extern uint8 _region_read_u8 (void* region, size_t offset);
    [CCode (cname = "gjsify_sab_region_write_u8",  cheader_filename = "sab-helpers.h")]
    private extern void _region_write_u8 (void* region, size_t offset, uint8 v);
    [CCode (cname = "gjsify_sab_region_read_u32_le",  cheader_filename = "sab-helpers.h")]
    private extern uint32 _region_read_u32_le (void* region, size_t offset);
    [CCode (cname = "gjsify_sab_region_write_u32_le", cheader_filename = "sab-helpers.h")]
    private extern void _region_write_u32_le (void* region, size_t offset, uint32 v);
    [CCode (cname = "gjsify_sab_region_read_i32_le",  cheader_filename = "sab-helpers.h")]
    private extern int32 _region_read_i32_le (void* region, size_t offset);
    [CCode (cname = "gjsify_sab_region_write_i32_le", cheader_filename = "sab-helpers.h")]
    private extern void _region_write_i32_le (void* region, size_t offset, int32 v);
    [CCode (cname = "gjsify_sab_region_read_u64_le",  cheader_filename = "sab-helpers.h")]
    private extern uint64 _region_read_u64_le (void* region, size_t offset);
    [CCode (cname = "gjsify_sab_region_write_u64_le", cheader_filename = "sab-helpers.h")]
    private extern void _region_write_u64_le (void* region, size_t offset, uint64 v);

    /* Bulk */
    [CCode (cname = "gjsify_sab_region_read_bytes",  cheader_filename = "sab-helpers.h")]
    private extern GLib.Bytes _region_read_bytes (void* region, size_t offset, size_t length);
    [CCode (cname = "gjsify_sab_region_write_bytes", cheader_filename = "sab-helpers.h")]
    private extern void _region_write_bytes (void* region, size_t offset, GLib.Bytes data);

    /* Atomics */
    [CCode (cname = "gjsify_sab_region_atomic_add_i32",     cheader_filename = "sab-helpers.h")]
    private extern int32 _region_atomic_add_i32 (void* region, size_t offset, int32 v);
    [CCode (cname = "gjsify_sab_region_atomic_sub_i32",     cheader_filename = "sab-helpers.h")]
    private extern int32 _region_atomic_sub_i32 (void* region, size_t offset, int32 v);
    [CCode (cname = "gjsify_sab_region_atomic_load_i32",    cheader_filename = "sab-helpers.h")]
    private extern int32 _region_atomic_load_i32 (void* region, size_t offset);
    [CCode (cname = "gjsify_sab_region_atomic_store_i32",   cheader_filename = "sab-helpers.h")]
    private extern void _region_atomic_store_i32 (void* region, size_t offset, int32 v);
    [CCode (cname = "gjsify_sab_region_atomic_xchg_i32",    cheader_filename = "sab-helpers.h")]
    private extern int32 _region_atomic_xchg_i32 (void* region, size_t offset, int32 v);
    [CCode (cname = "gjsify_sab_region_atomic_cmpxchg_i32", cheader_filename = "sab-helpers.h")]
    private extern bool _region_atomic_cmpxchg_i32 (void* region, size_t offset, ref int32 expected, int32 desired);

    /* Futex */
    [CCode (cname = "gjsify_sab_region_futex_wait", cheader_filename = "sab-helpers.h")]
    private extern int _region_futex_wait (void* region, size_t offset, int32 expected, int64 timeout_ms);
    [CCode (cname = "gjsify_sab_region_futex_wake", cheader_filename = "sab-helpers.h")]
    private extern int _region_futex_wake (void* region, size_t offset, int count);

    /* ── Public GObject wrapper ─────────────────────────────────────────── */

    public class SharedBuffer : GLib.Object {
        /* Opaque region pointer. Lifetime: bound to this instance, freed
         * in the destructor. */
        private void* _region;

        /* Default constructor — never used directly from JS (factory only). */
        private SharedBuffer.with_region (void* region) {
            this._region = region;
        }

        /**
         * Allocate a fresh anonymous shared-memory region. Returns null if
         * the underlying memfd_create / mmap fails (errno preserved on
         * the calling thread).
         */
        public static SharedBuffer? create (size_t size) {
            void* r = _region_new_anonymous (size);
            if (r == null) return null;
            return new SharedBuffer.with_region (r);
        }

        /**
         * Map an existing shared-memory fd into this process. The fd is
         * dup'd; the caller retains ownership of their copy and may close
         * it after this call returns.
         */
        public static SharedBuffer? from_fd (int fd, size_t size) {
            void* r = _region_new_from_fd (fd, size);
            if (r == null) return null;
            return new SharedBuffer.with_region (r);
        }

        public int    fd          { get { return _region_get_fd   (_region); } }
        public size_t byte_length { get { return _region_get_size (_region); } }

        /* Read / write — slow path, one accessor per integer width.
         * For bulk operations use read_bytes / write_bytes. */

        public uint8  get_u8     (size_t offset)                { return _region_read_u8     (_region, offset); }
        public void   set_u8     (size_t offset, uint8 v)       {        _region_write_u8    (_region, offset, v); }
        public uint32 get_u32_le (size_t offset)                { return _region_read_u32_le (_region, offset); }
        public void   set_u32_le (size_t offset, uint32 v)      {        _region_write_u32_le(_region, offset, v); }
        public int32  get_i32_le (size_t offset)                { return _region_read_i32_le (_region, offset); }
        public void   set_i32_le (size_t offset, int32 v)       {        _region_write_i32_le(_region, offset, v); }
        public uint64 get_u64_le (size_t offset)                { return _region_read_u64_le (_region, offset); }
        public void   set_u64_le (size_t offset, uint64 v)      {        _region_write_u64_le(_region, offset, v); }

        /* Bulk: zero-copy read (Bytes borrows the mmap), memcpy write. */
        public GLib.Bytes read_bytes  (size_t offset, size_t length) { return _region_read_bytes  (_region, offset, length); }
        public void       write_bytes (size_t offset, GLib.Bytes data) {       _region_write_bytes (_region, offset, data); }

        /* Atomics — SEQ_CST. fetch-style: return value BEFORE the op. */
        public int32 atomic_add_i32   (size_t offset, int32 v) { return _region_atomic_add_i32  (_region, offset, v); }
        public int32 atomic_sub_i32   (size_t offset, int32 v) { return _region_atomic_sub_i32  (_region, offset, v); }
        public int32 atomic_load_i32  (size_t offset)          { return _region_atomic_load_i32 (_region, offset); }
        public void  atomic_store_i32 (size_t offset, int32 v) {        _region_atomic_store_i32(_region, offset, v); }
        public int32 atomic_xchg_i32  (size_t offset, int32 v) { return _region_atomic_xchg_i32 (_region, offset, v); }

        /**
         * Strong compare-and-swap on a 32-bit slot.
         * Returns the actual previous value. CAS succeeded iff the
         * returned value === @expected.
         */
        public int32 atomic_cmpxchg_i32 (size_t offset, int32 expected, int32 desired) {
            int32 actual = expected;
            _region_atomic_cmpxchg_i32 (_region, offset, ref actual, desired);
            return actual;
        }

        /**
         * Linux futex_wait. Compares *((int32_t*)region+offset) to @expected;
         * if equal, blocks until woken or timeout. timeout_ms < 0 = infinite.
         *
         * Return: 0 woken, -1 not-equal (EAGAIN), -2 timed-out, -3 interrupted,
         * other negative = generic errno.
         */
        public int futex_wait (size_t offset, int32 expected, int64 timeout_ms) {
            return _region_futex_wait (_region, offset, expected, timeout_ms);
        }

        /**
         * Wake up to @count waiters on this address. Returns number actually
         * woken (can be less than count).
         */
        public int futex_wake (size_t offset, int count) {
            return _region_futex_wake (_region, offset, count);
        }

        ~SharedBuffer () {
            if (_region != null) {
                _region_free (_region);
                _region = null;
            }
        }
    }
}
