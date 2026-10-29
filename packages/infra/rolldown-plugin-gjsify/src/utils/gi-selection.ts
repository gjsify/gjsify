// Which GI namespaces does this Android APK carry? — ADR 0117 § 2, the CLI half.
//
// THE CONFIG DECIDES AND THE BUNDLE IS CHECKED AGAINST IT, which is the asymmetry
// the ADR turns on. The payload is cross-compiled hours earlier by
// `build-gi-runtime-android.mjs` against a sha256-pinned sysroot; nothing at app-build
// time can conjure a typelib that is not in it. So the config is the input, and the
// scan of the emitted bundle is the EVIDENCE that the input is complete.
//
// The scan is a LOWER BOUND, and the two directions of disagreement are therefore not
// symmetric:
//
//   * IMPORTED, NOT CONFIGURED → build error naming the namespace. The scanner found a
//     real import; the APK will not have the typelib; the device throws at that import,
//     after the download, reading like an application bug. This is the same failure
//     `deriveDepends` refuses for distro packages (ADR 0024 § 6), reached from Android.
//   * CONFIGURED, NOT IMPORTED → warning. `scanGiNamespaces` reads the emitted file and
//     cannot see a namespace reached through a computed specifier, nor one loaded by a
//     native dependency. Refusing here would make a correct project unbuildable on the
//     scanner's blind spot — so it reports a probably-larger-than-necessary APK and
//     builds it.
//
// COMPARED BY NAMESPACE, NOT BY STRING. A config may pin an ABI (`Gtk-4.0`) where the
// bundle's specifier carries no version (`import 'gi://Gtk'`), and vice versa. Both
// sides mean the same namespace, and string equality would fail a correct project on
// the spelling.

/** `Gtk-4.0` → `Gtk`; `Gtk` → `Gtk`. */
function namespaceOf(entry: string): string {
    const dash = entry.indexOf('-');
    return dash === -1 ? entry : entry.slice(0, dash);
}

/** `Ns` or `Ns-Version` — what the AAR builder resolves against the sysroot's typelib names. */
const GI_SELECTION_ENTRY = /^[A-Za-z][A-Za-z\d_]*(-\d+(\.\d+)*)?$/;

/**
 * Refuse a `giNamespaces` entry that is not a GI namespace, naming the entry.
 *
 * ONE definition for both paths that accept the key — `gjsify build`'s config loader
 * and `defineNativescriptConfig` — because a shape check that holds on one of them is
 * a project that builds through Vite and fails through the CLI for a typo. A free-form
 * string surfaces as "the prefix has no typelib for …" hours later in the AAR build,
 * naming the sysroot rather than the mistake.
 *
 * @param where how the caller spells the key, so the message points at the file the
 *   reader is editing (`nativescript.giNamespaces` vs `giNamespaces`).
 */
export function assertGiNamespaceEntries(declared: readonly string[], where: string): void {
    for (const entry of declared) {
        if (!GI_SELECTION_ENTRY.test(entry)) {
            throw new Error(`${where} entry "${entry}" is not a GI namespace. Write it as \`Gtk\` or \`Gtk-4.0\`.`);
        }
    }
}

/**
 * The namespaces every AAR carries whether or not anything declares them.
 *
 * These back `libnode_gi.so` itself, so they are in the payload's DT_NEEDED closure
 * before any selection happens (ADR 0110's measured core set). Demanding them in the
 * config would make the key boilerplate and fail every project that exists today, for
 * a selection that cannot change the bytes.
 */
const ALWAYS_PRESENT = new Set(['GLib', 'GObject', 'Gio', 'GioUnix', 'GLibUnix', 'GModule', 'GIRepository']);

/** What {@link planGiSelection} decided, and what it wants the build to say out loud. */
export interface GiSelection {
    /** The namespaces to hand the AAR builder, as the config spells them, deduped and sorted. */
    selected: string[];
    /** Declared but not found in the bundle — worth a warning, never a refusal. */
    unscanned: string[];
}

/**
 * Reconcile the configured namespace set with the one the emitted bundle imports.
 *
 * @param spec.declared `nativescript.giNamespaces`, as `Ns` or `Ns-Version`
 * @param spec.scanned what {@link scanGiNamespaces} read off the emitted bundle
 * @throws when the bundle imports a namespace the config does not cover
 */
export function planGiSelection({ declared, scanned }: { declared: string[]; scanned: string[] }): GiSelection {
    // A bare and a pinned declaration of one namespace are one selection, and the
    // pinned spelling wins: it says something the bare one does not.
    const byNamespace = new Map<string, string>();
    for (const entry of declared) {
        const ns = namespaceOf(entry);
        const held = byNamespace.get(ns);
        if (held === undefined || (held === ns && entry !== ns)) byNamespace.set(ns, entry);
    }

    const missing = [
        ...new Set(scanned.map(namespaceOf).filter((ns) => !byNamespace.has(ns) && !ALWAYS_PRESENT.has(ns))),
    ].sort();
    if (missing.length > 0) {
        throw new Error(
            `The bundle imports ${missing.join(', ')}, which nativescript.giNamespaces does not declare. ` +
                'An Android APK carries only the typelibs the config selects (ADR 0117), so this would ' +
                `install and then throw at the import. Add ${missing.length === 1 ? 'it' : 'them'} to ` +
                'nativescript.giNamespaces, or stop importing ' +
                `${missing.length === 1 ? 'it' : 'them'}.`,
        );
    }

    const seen = new Set(scanned.map(namespaceOf));
    const unscanned = [...byNamespace.entries()]
        .filter(([ns]) => !seen.has(ns))
        .map(([, entry]) => entry)
        .sort();

    return { selected: [...byNamespace.values()].sort(), unscanned };
}
