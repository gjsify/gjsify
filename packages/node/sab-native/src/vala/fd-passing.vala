/*
 * FdChannel — Unix-domain socketpair + SCM_RIGHTS fd-transfer helper.
 *
 * Used by @gjsify/worker_threads to attach the fd of a SharedBuffer to a
 * postMessage() call. Workflow:
 *
 *   1. Before spawning the child Worker, the parent calls
 *      `FdChannel.make_pair()` — returns (parent_fd, child_fd).
 *   2. `Gio.SubprocessLauncher.take_fd(child_fd, 3)` makes the child end
 *      inherit at fd 3 in the worker process. Parent retains parent_fd.
 *   3. For each postMessage() that contains SharedBuffer instances, the
 *      parent calls `FdChannel.send_fd(parent_fd, sb.fd, tag)` for each
 *      buffer, then writes a JSON message with placeholders
 *      `{__sab: <tag>, size: N}` over stdin.
 *   4. The child runs `FdChannel.recv_fd(socket_fd=3, out tag)` in a loop
 *      and maintains a Map<tag, fd> that the bootstrap consults when it
 *      sees placeholders in incoming JSON messages.
 *
 * Socket type: SOCK_SEQPACKET so each fd-transfer is one atomic message,
 * never split across recvmsg calls. SOCK_CLOEXEC on both ends so the
 * child's `gjs` inherits the fd but the grand-child of any nested
 * subprocess doesn't.
 *
 * The tag is a 4-byte big-endian integer (caller-allocated sequence
 * number). 4 G fd-transfers per worker lifetime — plenty.
 */

namespace GjsifySabNative {

    /* C externs — defined in sab-helpers.c. */

    [CCode (cname = "gjsify_sab_socketpair",
            cheader_filename = "sab-helpers.h")]
    private extern bool _socketpair (out int parent_fd, out int child_fd);

    [CCode (cname = "gjsify_sab_send_fd",
            cheader_filename = "sab-helpers.h")]
    private extern bool _send_fd (int socket_fd, int fd_to_send, uint32 tag);

    [CCode (cname = "gjsify_sab_recv_fd",
            cheader_filename = "sab-helpers.h")]
    private extern int _recv_fd (int socket_fd, out uint32 tag);

    [CCode (cname = "gjsify_sab_close_fd",
            cheader_filename = "sab-helpers.h")]
    private extern bool _close_fd (int fd);

    /* ── Public static API ──────────────────────────────────────────────── */

    public class FdChannel : GLib.Object {

        /**
         * Create an AF_UNIX/SOCK_SEQPACKET socketpair. Both fds have
         * SOCK_CLOEXEC set.
         *
         * Caller MUST close both fds eventually:
         *   - parent_fd: typically closed in `Worker.terminate()` / dispose.
         *   - child_fd:  closed by `Gio.SubprocessLauncher.take_fd()` when
         *                ownership transfers to the spawned child.
         *
         * Returns false on socketpair() failure (errno preserved).
         */
        public static bool make_pair (out int parent_fd, out int child_fd) {
            return _socketpair (out parent_fd, out child_fd);
        }

        /**
         * Send a single fd over a previously-paired SOCK_SEQPACKET socket
         * via SCM_RIGHTS. The payload is a 4-byte big-endian tag so the
         * receiver can map back to the JSON-side placeholder.
         *
         * Returns false on sendmsg() failure (errno preserved).
         */
        public static bool send_fd (int socket_fd, int fd_to_send, uint32 tag) {
            return _send_fd (socket_fd, fd_to_send, tag);
        }

        /**
         * Receive one fd from the paired socket. Blocks until a message
         * arrives, the peer closes (orderly EOF, returns 0), or an error
         * occurs.
         *
         * Returns:
         *   > 0  received fd; @tag is set to the sender's tag value
         *   = 0  orderly EOF (peer closed the socket); @tag undefined
         *   < 0  error; errno preserved; @tag undefined
         */
        public static int recv_fd (int socket_fd, out uint32 tag) {
            return _recv_fd (socket_fd, out tag);
        }

        /**
         * Wrap close(2) so JS callers don't have to pull in GioUnix just for
         * a one-shot fd close on cleanup. Returns true on success or if the
         * fd was already closed (EBADF — caller's intent satisfied either way).
         */
        public static bool close_fd (int fd) {
            return _close_fd (fd);
        }
    }
}
