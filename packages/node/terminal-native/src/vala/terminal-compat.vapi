/*
 * terminal-compat.vapi — portable declarations for the two symbols
 * @gjsify/terminal-native used to take from Vala's bundled `linux.vapi`.
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * `terminal.vala` needs exactly two things beyond POSIX: `struct winsize` and
 * the `TIOCGWINSZ` ioctl request. Both are declared in Vala's `linux.vapi`
 * (`Linux.winsize`, `Linux.Termios.TIOCGWINSZ`), which pulled a package named
 * after — and maintained for — Linux into a bridge that is otherwise plain
 * POSIX (isatty / termios / ioctl). That made the package look Linux-bound
 * when it is not, and made the build depend on which header `linux.vapi`
 * happens to attribute each symbol to (it attributes `struct winsize` to
 * <termios.h>, which on Linux defines it but on macOS does not — there it
 * lives in <sys/ttycom.h>, reachable via <sys/ioctl.h>).
 *
 * Declaring both symbols here against BOTH <sys/ioctl.h> and <termios.h> makes
 * the include set explicit and correct on every POSIX host, and lets
 * meson.build drop `--pkg=linux` entirely. Nothing else in this bridge is
 * Linux-specific:
 *   • Posix.isatty / termios / tcgetattr / tcsetattr — POSIX.1
 *   • TIOCGWINSZ                                     — BSD-derived, on Linux,
 *                                                      macOS and the BSDs
 *   • GLib.Unix.signal_add (SIGWINCH)                — supported by GLib on
 *                                                      every UNIX platform
 *
 * `TIOCGWINSZ` is spelled `ulong` to match the `request` parameter of the
 * `_ioctl_winsize` binding in terminal.vala: glibc declares ioctl(2)'s request
 * as `unsigned long`, and on macOS the constant itself is an `_IOR(...)`
 * expression that is unsigned. Using the same width on both sides avoids an
 * implicit narrowing conversion in the generated C.
 */

[CCode (cheader_filename = "sys/ioctl.h,termios.h")]
namespace GjsifyTerminalCompat {

    /**
     * winsize: terminal dimensions as returned by ioctl(TIOCGWINSZ).
     *
     * Defined by <sys/ioctl.h> (via <sys/ttycom.h>) on macOS/BSD and by
     * <termios.h> on Linux; both headers are requested above so the struct is
     * visible either way.
     */
    [CCode (cname = "struct winsize", has_type_id = false, destroy_function = "")]
    public struct Winsize {
        public ushort ws_row;
        public ushort ws_col;
        public ushort ws_xpixel;
        public ushort ws_ypixel;
    }

    /** ioctl(2) request code that fills a `struct winsize`. */
    [CCode (cname = "TIOCGWINSZ")]
    public const ulong TIOCGWINSZ;
}
