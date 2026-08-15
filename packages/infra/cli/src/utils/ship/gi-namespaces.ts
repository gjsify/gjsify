// Which GI namespaces does this bundle actually load?
//
// Read off the emitted `--app gjs` bundle, because that is the file that gets
// installed. `gi://` is a real module protocol under GJS, so the bundler leaves
// those specifiers in the output verbatim — the artifact carries its own
// dependency list and nothing has to be declared twice.
//
// Deliberately narrow: only `from <spec>` and `import(<spec>)` count. A broad
// `gi:\/\/(\w+)` sweep would also match the string inside a diagnostic message,
// and since an unknown namespace FAILS the build (`depends.ts`), a false
// positive there is a build that cannot be made to pass.
//
// All three quote characters, and no space assumed anywhere. Measured on a real
// `--app gjs` bundle rather than on the source: the minifier emits
// `import e from"gi://Gtk?version=4.0"` (no space) and rewrites a dynamic
// import to a TEMPLATE LITERAL — ``await import(`gi://GLib?version=2.0`)``.
// A quote-only pattern therefore missed every dynamic import, which is the
// silent half of this feature's whole failure mode: the package would install
// without the dependency and die when the import ran.
//
// A specifier containing `$` is skipped: it is a template with a substitution,
// so there is no static answer to give, and guessing one would fail the build
// on a namespace the author never named.

/** `import X from 'gi://Ns?version=1.0'` and ``await import(`gi://Ns`)``. */
const FROM_SPECIFIER = /\bfrom\s*(["'`])(gi:\/\/[^"'`$\n]+)\1/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*(["'`])(gi:\/\/[^"'`$\n]+)\1\s*\)/g;

/**
 * Extract the GI namespaces a bundle imports, as `Ns-Version` when the
 * specifier pins one and bare `Ns` when it does not.
 */
export function scanGiNamespaces(source: string): string[] {
    const found = new Set<string>();
    for (const pattern of [FROM_SPECIFIER, DYNAMIC_IMPORT]) {
        pattern.lastIndex = 0;
        for (const match of source.matchAll(pattern)) {
            const key = parseGiSpecifier(match[2] ?? '');
            if (key !== null) found.add(key);
        }
    }
    return [...found].sort();
}

/** `gi://Gtk?version=4.0` → `Gtk-4.0`; `gi://Gtk` → `Gtk`; anything else → null. */
export function parseGiSpecifier(specifier: string): string | null {
    if (!specifier.startsWith('gi://')) return null;
    const rest = specifier.slice('gi://'.length);
    const [namespace, query] = rest.split('?', 2);
    if (namespace === undefined || !/^[A-Za-z][A-Za-z0-9_]*$/.test(namespace)) return null;
    if (query === undefined) return namespace;
    const version = /(?:^|&)version=([^&]+)/.exec(query)?.[1];
    return version === undefined ? namespace : `${namespace}-${version}`;
}
