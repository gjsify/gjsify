/*
 * GjsifyTerminal — Linux terminal primitives for GJS.
 *
 * Exposes Posix/Linux syscalls that have no GLib equivalent:
 *   • Posix.isatty()      — reliable TTY detection
 *   • ioctl(TIOCGWINSZ)   — actual terminal dimensions
 *   • termios raw mode    — keypress-level input for interactive prompts
 *   • SIGWINCH watcher    — notify on terminal resize (GLib.Unix.signal_add)
 *
 * No dependencies beyond glib-2.0 / gobject-2.0.
 */

using GLib;

namespace GjsifyTerminal {

    // Specific ioctl binding for TIOCGWINSZ — avoids variadic ambiguity.
    [CCode (cname = "ioctl", cheader_filename = "sys/ioctl.h,termios.h")]
    private static extern int _ioctl_winsize (int fd, ulong request, ref Linux.winsize ws);

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
            var ws = Linux.winsize ();
            if (_ioctl_winsize (fd, Linux.Termios.TIOCGWINSZ, ref ws) != 0) {
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
                t.c_lflag &= ~(Posix.ICANON | Posix.ECHO);
                t.c_iflag &= ~Posix.ICRNL;
                t.c_cc[Posix.VMIN]  = 1;
                t.c_cc[Posix.VTIME] = 0;
            } else {
                t.c_lflag |= (Posix.ICANON | Posix.ECHO);
                t.c_iflag |= Posix.ICRNL;
            }
            return _tcsetattr (fd, Posix.TCSAFLUSH, ref t) == 0;
        }
    }

    /**
     * ResizeWatcher — fires #GjsifyTerminal.ResizeWatcher::resized whenever
     * the terminal window is resized (SIGWINCH).
     *
     * Call start() once; the watcher stays active for the process lifetime.
     * The signal is dispatched on the GLib main context via GLib.Idle so
     * JavaScript signal handlers run on the main thread.
     */
    public class ResizeWatcher : GLib.Object {

        /**
         * resized:
         * @rows: new terminal height in character rows
         * @cols: new terminal width in character columns
         */
        public signal void resized (int rows, int cols);

        private bool _active = false;

        /**
         * start:
         *
         * Begin watching SIGWINCH.  Idempotent — safe to call multiple times.
         */
        public void start () {
            if (_active) return;
            _active = true;

            GLib.Unix.signal_add (Posix.Signal.WINCH, () => {
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
    }
}
