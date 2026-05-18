/*
 * sab-helpers.c — see sab-helpers.h for the contract.
 *
 * Linux-only. Compile with -D_GNU_SOURCE so memfd_create, MFD_CLOEXEC,
 * and the FUTEX_*_PRIVATE constants are visible.
 */

#include "sab-helpers.h"

#include <errno.h>
#include <fcntl.h>
#include <linux/futex.h>
#include <stdatomic.h>
#include <stdint.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>

/* glibc < 2.27 doesn't expose memfd_create() as a libc wrapper. We use the
 * raw syscall to stay portable across the prebuild distro matrix. */
#ifndef MFD_CLOEXEC
#  define MFD_CLOEXEC 0x0001U
#endif

static int
gjsify_memfd_create (const char *name, unsigned int flags)
{
  return (int) syscall (SYS_memfd_create, name, flags);
}

/* ────────────────────────────────────────────────────────────────────── *
 * GjsifySabRegion: opaque shared-memory region
 * ────────────────────────────────────────────────────────────────────── */

struct _GjsifySabRegion {
  void  *ptr;
  gsize  size;
  gint   fd;
  /* Refcount for GBytes-borrow lifetimes (read_bytes returns a GBytes that
   * pins the region until the bytes object is released).  Strong count is
   * always ≥ 1 (the JS-side SharedBuffer owns one); each outstanding GBytes
   * adds one more. */
  gint   refcount;
};

static GjsifySabRegion *
region_ref (GjsifySabRegion *region)
{
  g_atomic_int_inc (&region->refcount);
  return region;
}

static void
region_unref (gpointer data)
{
  GjsifySabRegion *region = (GjsifySabRegion *) data;
  if (!g_atomic_int_dec_and_test (&region->refcount)) return;

  if (region->ptr != NULL && region->ptr != MAP_FAILED) {
    munmap (region->ptr, region->size);
  }
  if (region->fd >= 0) {
    close (region->fd);
  }
  g_slice_free (GjsifySabRegion, region);
}

GjsifySabRegion *
gjsify_sab_region_new_anonymous (gsize size)
{
  if (size == 0) { errno = EINVAL; return NULL; }

  int fd = gjsify_memfd_create ("gjsify-sab", MFD_CLOEXEC);
  if (fd < 0) return NULL;

  if (ftruncate (fd, (off_t) size) < 0) {
    int e = errno;
    close (fd);
    errno = e;
    return NULL;
  }

  void *ptr = mmap (NULL, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  if (ptr == MAP_FAILED) {
    int e = errno;
    close (fd);
    errno = e;
    return NULL;
  }

  GjsifySabRegion *region = g_slice_new0 (GjsifySabRegion);
  region->ptr = ptr;
  region->size = size;
  region->fd = fd;
  region->refcount = 1;
  return region;
}

GjsifySabRegion *
gjsify_sab_region_new_from_fd (gint fd, gsize size)
{
  if (fd < 0 || size == 0) { errno = EINVAL; return NULL; }

  /* dup so the caller can close their copy without unmapping ours. */
  int dup_fd = fcntl (fd, F_DUPFD_CLOEXEC, 0);
  if (dup_fd < 0) return NULL;

  void *ptr = mmap (NULL, size, PROT_READ | PROT_WRITE, MAP_SHARED, dup_fd, 0);
  if (ptr == MAP_FAILED) {
    int e = errno;
    close (dup_fd);
    errno = e;
    return NULL;
  }

  GjsifySabRegion *region = g_slice_new0 (GjsifySabRegion);
  region->ptr = ptr;
  region->size = size;
  region->fd = dup_fd;
  region->refcount = 1;
  return region;
}

void
gjsify_sab_region_free (GjsifySabRegion *region)
{
  if (region == NULL) return;
  region_unref (region);
}

gint  gjsify_sab_region_get_fd   (const GjsifySabRegion *region) { return region->fd;   }
gsize gjsify_sab_region_get_size (const GjsifySabRegion *region) { return region->size; }

/* ────────────────────────────────────────────────────────────────────── *
 * Plain read / write
 * ────────────────────────────────────────────────────────────────────── */

#define BOUNDS_CHECK(reg, off, sz) do {                                                  \
    if (G_UNLIKELY ((off) + (sz) > (reg)->size)) {                                       \
      g_error ("gjsify-sab: out-of-bounds access (offset=%" G_GSIZE_FORMAT               \
               ", size=%zu, region=%" G_GSIZE_FORMAT ")", (gsize)(off), (size_t)(sz),    \
               (reg)->size);                                                             \
    }                                                                                    \
} while (0)

guint8
gjsify_sab_region_read_u8 (const GjsifySabRegion *region, gsize offset)
{
  BOUNDS_CHECK (region, offset, 1);
  return ((const guint8 *) region->ptr)[offset];
}

void
gjsify_sab_region_write_u8 (GjsifySabRegion *region, gsize offset, guint8 v)
{
  BOUNDS_CHECK (region, offset, 1);
  ((guint8 *) region->ptr)[offset] = v;
}

guint32
gjsify_sab_region_read_u32_le (const GjsifySabRegion *region, gsize offset)
{
  BOUNDS_CHECK (region, offset, 4);
  guint32 v;
  memcpy (&v, (const guint8 *) region->ptr + offset, 4);
  return GUINT32_FROM_LE (v);
}

void
gjsify_sab_region_write_u32_le (GjsifySabRegion *region, gsize offset, guint32 v)
{
  BOUNDS_CHECK (region, offset, 4);
  guint32 le = GUINT32_TO_LE (v);
  memcpy ((guint8 *) region->ptr + offset, &le, 4);
}

gint32
gjsify_sab_region_read_i32_le (const GjsifySabRegion *region, gsize offset)
{
  BOUNDS_CHECK (region, offset, 4);
  guint32 u;
  memcpy (&u, (const guint8 *) region->ptr + offset, 4);
  u = GUINT32_FROM_LE (u);
  gint32 i;
  memcpy (&i, &u, 4);
  return i;
}

void
gjsify_sab_region_write_i32_le (GjsifySabRegion *region, gsize offset, gint32 v)
{
  BOUNDS_CHECK (region, offset, 4);
  guint32 u;
  memcpy (&u, &v, 4);
  u = GUINT32_TO_LE (u);
  memcpy ((guint8 *) region->ptr + offset, &u, 4);
}

guint64
gjsify_sab_region_read_u64_le (const GjsifySabRegion *region, gsize offset)
{
  BOUNDS_CHECK (region, offset, 8);
  guint64 v;
  memcpy (&v, (const guint8 *) region->ptr + offset, 8);
  return GUINT64_FROM_LE (v);
}

void
gjsify_sab_region_write_u64_le (GjsifySabRegion *region, gsize offset, guint64 v)
{
  BOUNDS_CHECK (region, offset, 8);
  guint64 le = GUINT64_TO_LE (v);
  memcpy ((guint8 *) region->ptr + offset, &le, 8);
}

/* ────────────────────────────────────────────────────────────────────── *
 * Bulk read / write (zero-copy for read, memcpy for write)
 * ────────────────────────────────────────────────────────────────────── */

GBytes *
gjsify_sab_region_read_bytes (GjsifySabRegion *region, gsize offset, gsize length)
{
  BOUNDS_CHECK (region, offset, length);
  /* GBytes wraps the mmap'd memory without copying. We hand the GBytes a
   * region_ref so the mmap survives until the bytes object is released. */
  region_ref (region);
  return g_bytes_new_with_free_func ((const guint8 *) region->ptr + offset,
                                     length,
                                     region_unref,
                                     region);
}

void
gjsify_sab_region_write_bytes (GjsifySabRegion *region, gsize offset, GBytes *data)
{
  gsize len = 0;
  gconstpointer src = g_bytes_get_data (data, &len);
  BOUNDS_CHECK (region, offset, len);
  if (len > 0) memcpy ((guint8 *) region->ptr + offset, src, len);
}

/* ────────────────────────────────────────────────────────────────────── *
 * Atomics: __atomic_* builtins with SEQ_CST memory order
 * ────────────────────────────────────────────────────────────────────── */

static inline int32_t *
i32_ptr (const GjsifySabRegion *region, gsize offset)
{
  BOUNDS_CHECK (region, offset, 4);
  return (int32_t *) ((guint8 *) region->ptr + offset);
}

gint32
gjsify_sab_region_atomic_add_i32 (GjsifySabRegion *region, gsize offset, gint32 v)
{
  /* fetch_add: returns the value BEFORE the addition. */
  return __atomic_fetch_add (i32_ptr (region, offset), v, __ATOMIC_SEQ_CST);
}

gint32
gjsify_sab_region_atomic_sub_i32 (GjsifySabRegion *region, gsize offset, gint32 v)
{
  return __atomic_fetch_sub (i32_ptr (region, offset), v, __ATOMIC_SEQ_CST);
}

gint32
gjsify_sab_region_atomic_load_i32 (const GjsifySabRegion *region, gsize offset)
{
  return __atomic_load_n (i32_ptr (region, offset), __ATOMIC_SEQ_CST);
}

void
gjsify_sab_region_atomic_store_i32 (GjsifySabRegion *region, gsize offset, gint32 v)
{
  __atomic_store_n (i32_ptr (region, offset), v, __ATOMIC_SEQ_CST);
}

gint32
gjsify_sab_region_atomic_xchg_i32 (GjsifySabRegion *region, gsize offset, gint32 v)
{
  return __atomic_exchange_n (i32_ptr (region, offset), v, __ATOMIC_SEQ_CST);
}

gboolean
gjsify_sab_region_atomic_cmpxchg_i32 (GjsifySabRegion *region,
                                      gsize            offset,
                                      gint32          *expected,
                                      gint32           desired)
{
  /* weak=FALSE so spurious failures don't happen — JS caller expects a
   * strong CAS. */
  return __atomic_compare_exchange_n (i32_ptr (region, offset),
                                      expected, desired,
                                      FALSE,
                                      __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST)
         ? TRUE : FALSE;
}

/* ────────────────────────────────────────────────────────────────────── *
 * Futex wait / wake
 * ────────────────────────────────────────────────────────────────────── */

gint
gjsify_sab_region_futex_wait (GjsifySabRegion *region,
                              gsize            offset,
                              gint32           expected,
                              gint64           timeout_ms)
{
  BOUNDS_CHECK (region, offset, 4);
  int32_t *addr = (int32_t *) ((guint8 *) region->ptr + offset);

  struct timespec ts;
  struct timespec *ts_ptr = NULL;
  if (timeout_ms >= 0) {
    ts.tv_sec  = timeout_ms / 1000;
    ts.tv_nsec = (timeout_ms % 1000) * 1000000L;
    ts_ptr = &ts;
  }

  long ret = syscall (SYS_futex, addr, FUTEX_WAIT_PRIVATE,
                      (int) expected, ts_ptr, NULL, 0);
  if (ret == 0) return 0;             /* woken via FUTEX_WAKE */
  int e = errno;
  if (e == EAGAIN)    return -1;      /* value didn't match expected */
  if (e == ETIMEDOUT) return -2;
  if (e == EINTR)     return -3;
  return -e;
}

gint
gjsify_sab_region_futex_wake (GjsifySabRegion *region,
                              gsize            offset,
                              gint             count)
{
  BOUNDS_CHECK (region, offset, 4);
  int32_t *addr = (int32_t *) ((guint8 *) region->ptr + offset);
  long ret = syscall (SYS_futex, addr, FUTEX_WAKE_PRIVATE, count,
                      NULL, NULL, 0);
  return (gint) ret;
}

/* ────────────────────────────────────────────────────────────────────── *
 * IPC side-channel: socketpair + SCM_RIGHTS
 * ────────────────────────────────────────────────────────────────────── */

gboolean
gjsify_sab_socketpair (gint *parent_fd, gint *child_fd)
{
  int sv[2];
  if (socketpair (AF_UNIX, SOCK_SEQPACKET | SOCK_CLOEXEC, 0, sv) < 0) {
    return FALSE;
  }
  *parent_fd = sv[0];
  *child_fd  = sv[1];
  return TRUE;
}

gboolean
gjsify_sab_send_fd (gint socket_fd, gint fd_to_send, guint32 tag)
{
  struct msghdr msg;
  struct iovec  iov;
  union {
    char           buf[CMSG_SPACE (sizeof (int))];
    struct cmsghdr align;
  } cmsg_buf;

  /* Payload: 4-byte big-endian tag. */
  guint32 tag_be = GUINT32_TO_BE (tag);

  memset (&msg, 0, sizeof msg);
  memset (&cmsg_buf, 0, sizeof cmsg_buf);

  iov.iov_base = &tag_be;
  iov.iov_len  = sizeof tag_be;
  msg.msg_iov  = &iov;
  msg.msg_iovlen = 1;
  msg.msg_control    = cmsg_buf.buf;
  msg.msg_controllen = sizeof cmsg_buf.buf;

  struct cmsghdr *cmsg = CMSG_FIRSTHDR (&msg);
  cmsg->cmsg_level = SOL_SOCKET;
  cmsg->cmsg_type  = SCM_RIGHTS;
  cmsg->cmsg_len   = CMSG_LEN (sizeof (int));
  memcpy (CMSG_DATA (cmsg), &fd_to_send, sizeof (int));

  ssize_t n;
  do {
    n = sendmsg (socket_fd, &msg, MSG_NOSIGNAL);
  } while (n < 0 && errno == EINTR);
  return n >= 0;
}

gint
gjsify_sab_recv_fd (gint socket_fd, guint32 *tag)
{
  struct msghdr msg;
  struct iovec  iov;
  union {
    char           buf[CMSG_SPACE (sizeof (int))];
    struct cmsghdr align;
  } cmsg_buf;

  guint32 tag_be = 0;

  memset (&msg, 0, sizeof msg);
  memset (&cmsg_buf, 0, sizeof cmsg_buf);

  iov.iov_base = &tag_be;
  iov.iov_len  = sizeof tag_be;
  msg.msg_iov  = &iov;
  msg.msg_iovlen = 1;
  msg.msg_control    = cmsg_buf.buf;
  msg.msg_controllen = sizeof cmsg_buf.buf;

  ssize_t n;
  do {
    n = recvmsg (socket_fd, &msg, MSG_CMSG_CLOEXEC);
  } while (n < 0 && errno == EINTR);

  if (n == 0) return 0;       /* orderly EOF */
  if (n < 0)  return -1;      /* error — errno preserved */

  *tag = GUINT32_FROM_BE (tag_be);

  /* Extract the fd from the control message. */
  for (struct cmsghdr *cm = CMSG_FIRSTHDR (&msg); cm != NULL; cm = CMSG_NXTHDR (&msg, cm)) {
    if (cm->cmsg_level == SOL_SOCKET && cm->cmsg_type == SCM_RIGHTS) {
      int fd;
      memcpy (&fd, CMSG_DATA (cm), sizeof (int));
      return fd;
    }
  }

  /* No fd in the message — protocol violation. */
  errno = EBADMSG;
  return -1;
}
