// The `share/` subdirectories a payload installs into — ONE definition.
//
// WHY THIS FILE EXISTS, and it is a repair rather than a tidy-up. Four call
// sites answer questions about the same directories and every one of them spelled
// them out again: `plan.ts` stages a file there, `readPayloadFacts` asks whether
// the payload put anything there, `cacheRefreshCommands` emits the install step
// that makes it WORK, and `linuxInstallDependent` names the ones a non-Linux
// layout carries without that step. `share/glib-2.0/schemas` alone existed as
// five independent string literals across the tree.
//
// A comment claiming they "cannot drift" was measured FALSE: pointing one rule in
// `linuxInstallDependent` at a directory that matches nothing silently dropped a
// file from the warning `gjsify ship` prints, and the whole suite stayed green at
// exit 0. The prose was the mechanism, which is to say there was none. Importing
// one constant makes the compiler the mechanism instead.
//
// PREFIX-RELATIVE and POSIX-separated, like every path in the plan. The layout
// map (`layout.ts`) is what turns these into `Contents/Resources/share/…` or a
// Windows program directory's `share\`; nothing here knows about that, and
// nothing here is absolute — `scripts.ts` prepends the format's install prefix,
// which is `/usr` for a `.deb` and `/app` for a Flatpak.

/**
 * Each entry is a directory the freedesktop/GNOME stack looks in BY NAME. None of
 * them is ours to choose: `bindtextdomain` reads `share/locale/<lang>/LC_MESSAGES`,
 * `glib-compile-schemas` compiles `share/glib-2.0/schemas`, and the icon theme
 * spec fixes `share/icons/hicolor`. That is also why this is a closed set rather
 * than a convention — a typo in any of them installs a file nothing ever reads.
 */
export const SHARE = {
    /** freedesktop desktop entries. */
    applications: 'share/applications',
    /** The hicolor icon theme, whose cache `gtk-update-icon-cache` builds. */
    icons: 'share/icons/hicolor',
    /** GSettings schema sources, compiled into `gschemas.compiled` at install. */
    schemas: 'share/glib-2.0/schemas',
    /** shared-mime-info documents, folded into the mime cache at install. */
    mime: 'share/mime/packages',
    /** AppStream components. */
    metainfo: 'share/metainfo',
    /** Compiled gettext catalogues, read directly — no install step. */
    locale: 'share/locale',
    /**
     * Font faces the application ships — ONE directory, and three different things
     * reach it (ADR 0038). No install step on any of them.
     *
     * On LINUX fontconfig scans it, by two rules that are both the stock
     * `fonts.conf`'s rather than ours: `<dir>/usr/share/fonts</dir>` unconditionally,
     * which covers a `.deb`/`.rpm`, and `<dir prefix="xdg">fonts</dir>`, which
     * fontconfig expands over `XDG_DATA_DIRS` as well as `XDG_DATA_HOME` — so the
     * variable the launcher already exports covers `/app` in a Flatpak and any other
     * prefix. `fonts-conf(5)` documents only `XDG_DATA_HOME` there; the expansion was
     * measured in EIGHT independently built fontconfigs (2.14.1 through 2.18.3), in
     * every list position, recursively, with a cold cache and a negative control.
     * Behaviour, not documentation — which is why it is written here and in ADR 0038
     * § *What was measured* rather than re-derived from the man page.
     *
     * On MACOS none of that applies and the directory is the same: Pango there is
     * CoreText-backed and GTK is not built against fontconfig, so `Info.plist`'s
     * `ATSApplicationFontsPath` points at this directory instead (`layout.ts`).
     *
     * On WINDOWS nothing reaches it by configuration at all — measured there, not
     * inferred: the default font map does not read fontconfig even when the staged
     * directory is the ONLY configuration it is given, while `add_font_file` on that
     * same map does register the family. So the launcher's `GJSIFY_FONT_DIR` hands
     * the directory to the app to register. `Layout.fontGap` carries the numbers and
     * the three candidates that look like they would work and do not.
     *
     * That the PATH is one while the mechanisms are three is the point: `planStage`
     * keeps emitting one payload, and every per-OS answer is a layout decision.
     */
    fonts: 'share/fonts',
} as const;

/** Is `path` inside `dir`? Directory-boundary aware, so `share/mimetypes` is not inside `share/mime`. */
export function isUnder(path: string, dir: string): boolean {
    return path.startsWith(`${dir}/`);
}
