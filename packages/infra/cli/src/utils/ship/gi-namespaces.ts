// Which GI namespaces does this bundle actually load?
//
// Read off the emitted `--app gjs` bundle, because that is the file that gets
// installed. `gi://` is a real module protocol under GJS, so the bundler keeps
// those specifiers in the output verbatim (`rolldown-plugin-gjsify`'s externals
// plugin) — the artifact carries its own dependency list and nothing has to be
// declared twice.
//
// PARSED, not pattern-matched, and the first version of this file is why. A
// regex over the bundle text got it wrong in both directions at once:
//
//   * it missed `import "gi://Soup?version=3.0"` — the bare side-effect form,
//     which is exactly what `@gjsify/fetch` puts at the top of every bundle
//     that pulls it. The package would have shipped without libsoup, installed
//     cleanly, and died at the first request.
//   * it matched `gi://…` inside a diagnostic STRING containing the word
//     `from`, and since an unmapped namespace fails the build, that made a
//     correct project unbuildable.
//
// `moduleSpecifiers` answers the question exactly, and it is the same acorn
// pass the CLI already uses to compute its own runtime closure — so there is
// one definition of "what does this file import" rather than two.

import { moduleSpecifiers } from '../cli-runtime-closure.js';

/**
 * Extract the GI namespaces a bundle imports, as `Ns-Version` when the
 * specifier pins one and bare `Ns` when it does not.
 */
export function scanGiNamespaces(source: string): string[] {
    const found = new Set<string>();
    for (const specifier of moduleSpecifiers(source)) {
        const key = parseGiSpecifier(specifier);
        if (key !== null) found.add(key);
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
