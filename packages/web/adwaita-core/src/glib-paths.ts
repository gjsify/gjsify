// The path helpers of `gi://GLib` that need no filesystem: `MAXUINT32`, `build_filenamev`, and the two
// questions a host without a POSIX filesystem has to answer by choice, `get_current_dir` and
// `get_system_data_dirs`.
//
// A browser page has no working directory and no `/usr/share`; an Android app (NativeScript) has no
// `XDG_DATA_DIRS`. GLib's answer for "I have nothing here" is the empty list, and for the working
// directory the root of the one namespace of paths the host has. So:
//
//   · `get_current_dir()` is `"/"` — the root, which is also an Android process's own working directory.
//   · `get_system_data_dirs()` is `[]` — no directory is searched, and a caller that walks the list to
//     find its installed data (Learn6502's style schemes) falls through to its default.
//
// These are the defaults of the GTK port. A port that has a real answer (an app bundling data under a
// virtual root, an Android `filesDir`) replaces the member in its own `.web.ts` / platform file; nothing
// here is a hook because nothing needs one. `Gio.File` is the other half of "does this path exist" and
// is ADR 0100's, which refuses `query_exists` by name until a path can be named.
//
// Reference: GLib glib/gfileutils.c (g_build_path_va), glib/gutils.c (g_get_system_data_dirs),
// glib/gmacros.h (G_MAXUINT32)
// Copyright (c) GNOME contributors (GLib). LGPLv2.1+.

/** `G_MAXUINT32`. */
export const MAXUINT32 = 0xffffffff;

/**
 * `g_build_filenamev` on a POSIX host (separator `/`), ported line for line from `g_build_path_va`.
 *
 * At each boundary between two elements the trailing separators of the first and the leading ones of
 * the second are dropped and exactly one is inserted. Empty elements are ignored. The result keeps as
 * many leading separators as the first non-empty element had and as many trailing ones as the last had;
 * separators INSIDE an element are left alone (`a//b` stays). Not `path.join`: that normalises `.`,
 * `..` and inner runs, which GLib never does.
 */
export function buildFilenamev(elements: readonly string[]): string {
    let result = '';
    let isFirst = true;
    let haveLeading = false;
    let singleElement: string | null = null;
    let lastTrailing: string | null = null;

    for (const element of elements) {
        if (element === '') continue;

        let start = 0;
        while (element[start] === '/') start++;

        let end = element.length;
        while (end >= start + 1 && element[end - 1] === '/') end--;

        let trailing = end;
        while (trailing >= 1 && element[trailing - 1] === '/') trailing--;
        lastTrailing = element.slice(trailing);

        if (!haveLeading) {
            // Leading and trailing separators overlap: the element is nothing but separators.
            if (trailing <= start) singleElement = element;
            result += element.slice(0, start);
            haveLeading = true;
        } else {
            singleElement = null;
        }

        if (end === start) continue;

        if (!isFirst) result += '/';
        result += element.slice(start, end);
        isFirst = false;
    }

    return singleElement ?? result + (lastTrailing ?? '');
}

/** `g_get_current_dir` where the host has no working directory: the root. */
export function getCurrentDir(): string {
    return '/';
}

/** `g_get_system_data_dirs` where the host has no system data directories: none. */
export function getSystemDataDirs(): string[] {
    return [];
}
