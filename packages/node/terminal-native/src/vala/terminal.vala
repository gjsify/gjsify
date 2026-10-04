/*
 * GjsifyTerminal — POSIX terminal primitives for GJS.
 *
 * Exposes POSIX syscalls that have no GLib equivalent:
 *   • Posix.isatty()      — reliable TTY detection
 *   • ioctl(TIOCGWINSZ)   — actual terminal dimensions
 *   • termios raw mode    — keypress-level input for interactive prompts
 *   • SIGWINCH watcher    — notify on terminal resize (GLib.Unix.signal_add)
 *
 * No dependencies beyond glib-2.0 / gobject-2.0. Portable across POSIX hosts
 * (Linux, macOS, the BSDs): `struct winsize` + `TIOCGWINSZ` come from the
 * sibling `terminal-compat.vapi` rather than Vala's Linux-specific
 * `linux.vapi` — see that file for why.
 */

using GLib;

namespace GjsifyTerminal {

    // Specific ioctl binding for TIOCGWINSZ — avoids variadic ambiguity.
    [CCode (cname = "ioctl", cheader_filename = "sys/ioctl.h,termios.h")]
    private static extern int _ioctl_winsize (int fd, ulong request,
                                              ref GjsifyTerminalCompat.Winsize ws);

    // Explicit tcgetattr / tcsetattr with ref to match C pointer semantics.
    [CCode (cname = "tcgetattr", cheader_filename = "termios.h")]
    private static extern int _tcgetattr (int fd, ref Posix.termios t);

    [CCode (cname = "tcsetattr", cheader_filename = "termios.h")]
    private static extern int _tcsetattr (int fd, int action, ref Posix.termios t);

    /**
     * Terminal — static helpers wrapping Posix / Linux ioctl syscalls.
     */
    public class Terminal : GLib.Object {

        /**
         * is_tty:
         * @fd: file descriptor to test (0=stdin, 1=stdout, 2=stderr)
         *
         * Returns %TRUE if @fd refers to an interactive terminal.
         * Uses Posix.isatty() — more accurate than GLib.log_writer_supports_color().
         */
        public static bool is_tty (int fd) {
            return Posix.isatty (fd);
        }

        /**
         * get_size:
         * @fd:     file descriptor (use 1 for stdout)
         * @rows:   (out) terminal height in character rows
         * @cols:   (out) terminal width in character columns
         * @xpixel: (out) terminal width in pixels (0 on most terminals)
         * @ypixel: (out) terminal height in pixels (0 on most terminals)
         *
         * Queries terminal dimensions via ioctl(TIOCGWINSZ).
         * Returns %TRUE on success.  All out-params are 0 on failure.
         */
        public static bool get_size (int fd, out int rows, out int cols,
                                     out int xpixel, out int ypixel) {
            rows = 0; cols = 0; xpixel = 0; ypixel = 0;
            var ws = GjsifyTerminalCompat.Winsize ();
            if (_ioctl_winsize (fd, GjsifyTerminalCompat.TIOCGWINSZ, ref ws) != 0) {
                return false;
            }
            rows   = (int) ws.ws_row;
            cols   = (int) ws.ws_col;
            xpixel = (int) ws.ws_xpixel;
            ypixel = (int) ws.ws_ypixel;
            return true;
        }

        /**
         * set_raw_mode:
         * @fd:     file descriptor (typically stdin = 0)
         * @enable: %TRUE to enter raw mode, %FALSE to restore canonical mode
         *
         * Toggles terminal raw mode so interactive prompts can read
         * individual keystrokes without line-buffering or echo.
         * Returns %TRUE on success.
         */
        public static bool set_raw_mode (int fd, bool enable) {
            var t = Posix.termios ();
            if (_tcgetattr (fd, ref t) != 0) return false;
            if (enable) {
                // Node-parity raw mode: also clear ISIG so Ctrl-C / Ctrl-Z
                // arrive as keystrokes (\x03 / \x1a) for the app to handle,
                // not as signals that would kill the process and leave the
                // terminal stuck in raw mode. Matches Node's tty
                // ReadStream.setRawMode(true).
                t.c_lflag &= ~(Posix.ICANON | Posix.ECHO | Posix.ISIG);
                t.c_iflag &= ~Posix.ICRNL;
                t.c_cc[Posix.VMIN]  = 1;
                t.c_cc[Posix.VTIME] = 0;
            } else {
                t.c_lflag |= (Posix.ICANON | Posix.ECHO | Posix.ISIG);
                t.c_iflag |= Posix.ICRNL;
            }
            return _tcsetattr (fd, Posix.TCSAFLUSH, ref t) == 0;
        }
    }

    /**
     * ResizeWatcher — fires #GjsifyTerminal.ResizeWatcher::resized whenever
     * the terminal window is resized (SIGWINCH).
     *
     * The signal is dispatched on the GLib main context via GLib.Idle so
     * JavaScript signal handlers run on the main thread.
     *
     * LIFECYCLE: `start()` takes a GLib source on the DEFAULT main context and
     * that source holds a strong reference to the watcher (it is the callback's
     * user_data), so a watcher that was started and never stopped is immortal —
     * it can never be finalized, keeps its signal handlers alive, and is only
     * torn down when GLib unrefs it during the host's own shutdown. `stop()`
     * releases that reference and `dispose()` calls it, so a caller that is
     * done with a watcher MUST stop or dispose it. Keeping the source id is
     * what makes that possible; discarding it (as this class used to) leaves
     * no way to reach the source again.
     */
    public class ResizeWatcher : GLib.Object {

        /**
         * resized:
         * @rows: new terminal height in character rows
         * @cols: new terminal width in character columns
         */
        public signal void resized (int rows, int cols);

        private bool _active = false;
        private uint _winch_source = 0;

        /**
         * start:
         *
         * Begin watching SIGWINCH.  Idempotent — safe to call multiple times,
         * and safe to call again after stop().
         */
        public void start () {
            if (_active) return;
            _active = true;

            _winch_source = (uint) GLib.Unix.signal_add (Posix.Signal.WINCH, () => {
                int r = 0, c = 0, xp = 0, yp = 0;
                if (Terminal.get_size (1, out r, out c, out xp, out yp)) {
                    int rows_snap = r;
                    int cols_snap = c;
                    GLib.Idle.add (() => {
                        this.resized (rows_snap, cols_snap);
                        return GLib.Source.REMOVE;
                    });
                }
                return GLib.Source.CONTINUE;
            });
        }

        /**
         * stop:
         *
         * Stop watching SIGWINCH and drop the source's reference to this
         * watcher, so it can be finalized.  Idempotent — safe on a watcher
         * that was never started, and safe to call twice.
         *
         * A resize already dispatched to GLib.Idle still fires `resized`:
         * that idle holds its own reference, so a watcher is never emitted on
         * after it is gone.
         */
        public void stop () {
            if (!_active) return;
            _active = false;

            if (_winch_source != 0) {
                GLib.Source.remove (_winch_source);
                _winch_source = 0;
            }
        }

        /**
         * dispose:
         *
         * Release the SIGWINCH source on an explicit `run_dispose()`.  This is
         * NOT reached when the last JavaScript reference is dropped: the source
         * holds its own reference, so a started watcher is never disposed by
         * garbage collection.  Call stop() for that.
         */
        public override void dispose () {
            stop ();
            base.dispose ();
        }
    }
}
