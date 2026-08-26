// Runtime dependencies, derived from the artifact rather than declared.
//
// The namespaces come out of the BUILT BUNDLE, not out of a config key: the
// bundle is what ships, so it is the only honest source. A declaration can be
// stale in a way nothing notices until a user's dynamic linker complains.
//
// An unmapped namespace FAILS the build (ADR 0024 § 6). The reference
// implementation returns `[]` for anything its four-entry table does not know,
// which produces a package that installs cleanly and dies on first launch —
// the failure lands on the user's machine, after the download, and reads as an
// application bug. A table will always be incomplete; what may not stay is the
// silence — so `gjsify.ship.typelibPackages` lets a project add the row itself
// and the error prints the exact JSON to paste. That is deliberately a
// different key from `gjsify.ship.depends`, which appends free-form
// dependencies and does NOT silence this: a hatch that turns the check off is
// how the check stops meaning anything.
//
// Not to be confused with `utils/check-system-deps.ts`'s `PM_PACKAGES`: that
// maps BUILD-time `-dev` packages (headers, pkg-config files) for a developer
// machine. What an installed app needs is the runtime typelib, and on Debian
// those live in separate `gir1.2-*` packages — the two tables answer different
// questions and would be wrong as one.

import type { DistroFormatId } from './types.js';

/**
 * The GJS the bundles target (root AGENTS.md § Constraints: GJS 1.86 /
 * SpiderMonkey 140, Rolldown `firefox140`). A `--app gjs` bundle can carry
 * ES2024 syntax an older SpiderMonkey does not parse, so this is a real floor
 * and not a formality.
 *
 * It is also, today, UNSATISFIABLE ON DEBIAN — measured, not assumed: Debian
 * went 1.82.3 (trixie) straight to 1.88.1 (forky), skipping 1.84 and 1.86, so
 * no Debian suite ships a `gjs` that satisfies `>= 1.86`. Emitting the honest
 * floor means a `.deb` apt REFUSES on trixie; lowering it silently would mean
 * one apt installs and the app then dies on a syntax error. `warnAboutGjsFloor`
 * exists so the choice is visible at ship time, and `gjsify.ship.minGjsVersion`
 * is how a project whose bundle really does run on older GJS lowers it.
 */
export const DEFAULT_GJS_FLOOR = '1.86';

/**
 * The package providing `glib-compile-schemas`, per format.
 *
 * A record, not `format === 'deb' ? … : …`. The ternary reads as a two-way
 * choice and is really "deb, or ELSE rpm's package name" — measured on a third
 * format, `dmg` got `glib2`, at exit 0, in the `Depends:` of a package that has
 * no such thing. Adding a `DistroFormatId` now fails to build here instead.
 */
const SCHEMA_COMPILER_PACKAGE: Record<DistroFormatId, string> = { deb: 'libglib2.0-bin', rpm: 'glib2' };

/** Debian's `gjs` versions per suite, as measured 2026-08-15 — see {@link warnAboutGjsFloor}. */
const DEBIAN_GJS = 'trixie ships 1.82.3 and forky 1.88.1; 1.84 and 1.86 were skipped';

/**
 * Warn when the derived floor cannot be satisfied by a released Debian.
 * Returns the warning lines; empty when the floor is fine.
 */
/**
 * Which formats this Debian-suite warning is ABOUT.
 *
 * A `Record<DistroFormatId, …>` and not `format !== 'deb'`: the negative form answers
 * for every format that will ever exist, and answers "stay quiet" — so a third
 * format would inherit silence about a floor nobody has checked for its distro,
 * with no compile error. As a record, adding a `DistroFormatId` fails to build until
 * someone decides. `rpm` is false because Fedora ships a current GJS, which is a
 * measured fact about Fedora, not a default.
 */
const GJS_FLOOR_IS_DEBIAN_NEWS: Record<DistroFormatId, boolean> = { deb: true, rpm: false };

export function warnAboutGjsFloor(format: DistroFormatId, floor: string): string[] {
    if (!GJS_FLOOR_IS_DEBIAN_NEWS[format]) return [];
    // Only a floor forky ACTUALLY satisfies is quiet. The first cut tested
    // `>= 1.88.1` and therefore went silent for 1.90 and 2.0 as well — the
    // floors no Debian will satisfy for years.
    if (compareVersions(floor, '1.82.3') <= 0) return [];
    if (compareVersions(floor, '1.88.1') === 0) return [];
    return [
        `gjsify ship: \`Depends: gjs (>= ${floor})\` is not satisfiable on Debian stable — ${DEBIAN_GJS}. ` +
            'The package installs on forky/sid and on distributions with a newer GJS. Set ' +
            '`gjsify.ship.minGjsVersion` if this bundle genuinely runs on an older GJS; do NOT lower it ' +
            'to make apt happy, because the result is an install that succeeds and an app that does not start.',
    ];
}

/** Numeric dotted-version compare. Enough for `1.82.3` vs `1.86`. */
function compareVersions(a: string, b: string): number {
    const left = a.split('.').map(Number);
    const right = b.split('.').map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const diff = (left[i] ?? 0) - (right[i] ?? 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

/**
 * GI namespace → the package that ships its typelib.
 *
 * Fedora entries were read off this project's own CI image with
 * `rpm -qf /usr/lib64/girepository-1.0/<Ns>.typelib`; Debian ships the typelib
 * in a `gir1.2-*` package separate from the runtime library, which is why the
 * two columns look nothing alike for the same namespace.
 */
const TYPELIB_PACKAGES: Record<string, Record<DistroFormatId, string>> = {
    // GLib stack — one package each side covers all four namespaces.
    'GLib-2.0': { deb: 'gir1.2-glib-2.0', rpm: 'glib2' },
    'GObject-2.0': { deb: 'gir1.2-glib-2.0', rpm: 'glib2' },
    'Gio-2.0': { deb: 'gir1.2-glib-2.0', rpm: 'glib2' },
    'GioUnix-2.0': { deb: 'gir1.2-glib-2.0', rpm: 'glib2' },
    'GModule-2.0': { deb: 'gir1.2-glib-2.0', rpm: 'glib2' },
    // GTK4 — Gdk/Gsk/Gtk all live in the same shared object.
    'Gtk-4.0': { deb: 'gir1.2-gtk-4.0', rpm: 'gtk4' },
    'Gdk-4.0': { deb: 'gir1.2-gtk-4.0', rpm: 'gtk4' },
    'Gsk-4.0': { deb: 'gir1.2-gtk-4.0', rpm: 'gtk4' },
    'Adw-1': { deb: 'gir1.2-adw-1', rpm: 'libadwaita' },
    'GdkPixbuf-2.0': { deb: 'gir1.2-gdkpixbuf-2.0', rpm: 'gdk-pixbuf2' },
    'Pango-1.0': { deb: 'gir1.2-pango-1.0', rpm: 'pango' },
    'PangoCairo-1.0': { deb: 'gir1.2-pango-1.0', rpm: 'pango' },
    'Graphene-1.0': { deb: 'gir1.2-graphene-1.0', rpm: 'graphene' },
    // cairo's typelib is packaged with gobject-introspection on Fedora and in
    // the catch-all gir1.2-freedesktop on Debian.
    'cairo-1.0': { deb: 'gir1.2-freedesktop', rpm: 'gobject-introspection' },
    'GtkSource-5': { deb: 'gir1.2-gtksource-5', rpm: 'gtksourceview5' },
    'WebKit-6.0': { deb: 'gir1.2-webkit-6.0', rpm: 'webkitgtk6.0' },
    'Soup-3.0': { deb: 'gir1.2-soup-3.0', rpm: 'libsoup3' },
    'Json-1.0': { deb: 'gir1.2-json-1.0', rpm: 'json-glib' },
    'Gst-1.0': { deb: 'gir1.2-gstreamer-1.0', rpm: 'gstreamer1' },
    'Secret-1': { deb: 'gir1.2-secret-1', rpm: 'libsecret' },
    'Notify-0.7': { deb: 'gir1.2-notify-0.7', rpm: 'libnotify' },
    'Vte-3.91': { deb: 'gir1.2-vte-3.91', rpm: 'vte291-gtk4' },
    'Manette-0.2': { deb: 'gir1.2-manette-0.2', rpm: 'libmanette' },
    // libgda — what `@gjsify/sqlite` binds, so every project with a local database lands here.
    // The rpm name is measured on this machine (`rpm -qf …/Gda-6.0.typelib` → libgda); the deb name
    // follows the `gir1.2-<name>-<version>` convention every row above uses and is NOT verified
    // against a Debian system. Said plainly because a wrong name fails at `apt install` with a
    // clear error, while no row at all fails the BUILD of every such project.
    'Gda-6.0': { deb: 'gir1.2-gda-6.0', rpm: 'libgda' },
};

export interface DependsInputs {
    /** GI namespaces the bundle imports, in `Ns-Version` spelling. */
    namespaces: readonly string[];
    /**
     * Whether the payload installs into `share/icons/hicolor/`.
     *
     * Was `kind: 'app' | 'cli'`, which is a proxy for the question and not the question:
     * `hicolor-icon-theme` is depended on because it OWNS that directory, so an app that
     * installs no icon used to declare a dependency it never touched. Derived from the payload
     * (`readPayloadFacts`), which is also the only thing the packing host has (ADR 0024 § A2).
     */
    hasIcons: boolean;
    /** Whether the payload installs GSettings schemas. */
    hasSchemas: boolean;
    /** User-supplied additions for this format. */
    extra: readonly string[];
    /** Project-supplied table rows, filling gaps in {@link TYPELIB_PACKAGES}. */
    typelibPackages?: Record<string, Record<DistroFormatId, string>>;
    /**
     * Paths of typelib files the payload carries itself. The namespaces they cover need no distro
     * dependency — and are derived from these filenames, never declared separately.
     */
    bundledTypelibs?: readonly string[];
    /** Minimum GJS. Default {@link DEFAULT_GJS_FLOOR}. */
    minGjsVersion?: string;
}

/**
 * A typelib the payload CARRIES, rather than one the system provides.
 *
 * `@gjsify/*`'s native bridges ship their own `.typelib` inside the package —
 * `GjsifyHttpSoupBridge`, which `@gjsify/http`'s server pulls in unconditionally,
 * plus `GjsifyHttp2`, `GjsifySabNative` and the rest of the `*-native` set. No
 * distribution has ever packaged a `gir1.2-gjsifyhttpsoupbridge` and none can:
 * the file is in the tarball being built. So these are not a gap in the table.
 * Mapping one would emit a dependency apt and dnf must fail to resolve, and the
 * module header's rule — an unmapped namespace FAILS the build — is about a
 * SYSTEM library nobody declared, which is the opposite situation.
 *
 * Excluding them is a precondition for widening the namespace scanner rather
 * than a refinement of it: without this, `gjsify ship` throws on every project
 * whose bundle reaches one, which includes every `@gjsify/http` server.
 */
const BUNDLED_TYPELIB = /^Gjsify[A-Z]/;

/**
 * The `Depends:` / `Requires:` list for one format.
 *
 * @throws when a namespace has no entry in the table — see the module header.
 */
export function deriveDepends(format: DistroFormatId, inputs: DependsInputs): string[] {
    const out: string[] = [`gjs >= ${inputs.minGjsVersion ?? DEFAULT_GJS_FLOOR}`];
    const unmapped: string[] = [];

    // Namespaces the package SHIPS ITSELF, read off the staged filenames rather than from a
    // separate declaration: `Gwebgl-0.1.typelib` → `Gwebgl-0.1` and `Gwebgl`. Deriving it is the
    // point — a project that declared a namespace bundled without the file being there would get
    // a package that installs and dies at the first import, which is exactly what this check
    // exists to prevent.
    const shipped = new Set<string>();
    for (const file of inputs.bundledTypelibs ?? []) {
        const match = /([A-Za-z0-9]+)-([\d.]+)\.typelib$/.exec(file);
        if (!match) continue;
        shipped.add(`${match[1]}-${match[2]}`);
        shipped.add(match[1]);
    }

    for (const namespace of [...new Set(inputs.namespaces)].sort()) {
        if (BUNDLED_TYPELIB.test(namespace) || shipped.has(namespace)) continue;
        const entry = lookupTypelib(namespace, inputs.typelibPackages);
        if (entry === undefined) {
            unmapped.push(namespace);
            continue;
        }
        out.push(entry[format]);
    }

    if (unmapped.length > 0) {
        throw new Error(
            `gjsify ship: the bundle imports ${unmapped.map((n) => `gi://${n.split('-')[0]}`).join(', ')}, ` +
                `and no ${format} package is known to ship ${unmapped.length > 1 ? 'those typelibs' : 'that typelib'}. ` +
                "An undeclared runtime dependency does not fail here — it fails on a user's machine after the " +
                'download. Fill the gap in package.json:\n' +
                `  "gjsify": { "ship": { "typelibPackages": { ${JSON.stringify(unmapped[0])}: ` +
                '{ "deb": "gir1.2-…", "rpm": "…" } } } }\n' +
                'and please contribute the mapping back to `utils/ship/depends.ts` so the next project does not ' +
                'have to. (`gjsify.ship.depends.<format>` is for dependencies that are not typelibs at all — it ' +
                'appends, and deliberately does not silence this.)',
        );
    }

    // The package that owns `/usr/share/icons/hicolor` — so this follows the icons, not the
    // app/cli distinction that used to stand in for them.
    if (inputs.hasIcons) out.push('hicolor-icon-theme');
    // The package that ships `glib-compile-schemas`, NOT `gsettings-desktop-schemas`
    // (which ships GNOME's own `org.gnome.desktop.*` schemas and has nothing to
    // do with compiling ours). Measured: `rpm -qf /usr/bin/glib-compile-schemas`
    // → glib2; on Debian the binary lives in `libglib2.0-bin`, which none of the
    // `gir1.2-*` packages pull in. Without it the postinst's `command -v` guard
    // silently skips, the schema is never compiled, and the first
    // `Gio.Settings.new()` aborts the app — an install that succeeds and an app
    // that does not start.
    if (inputs.hasSchemas) out.push(SCHEMA_COMPILER_PACKAGE[format]);
    out.push(...inputs.extra);

    // Set-dedupe keeps first-insertion order, so `gjs` stays first and the
    // list is stable across runs.
    return [...new Set(out)];
}

/**
 * Resolve a scanned specifier to a table row.
 *
 * `gi://Gtk?version=4.0` arrives as `Gtk-4.0` and matches directly. A bare
 * `gi://Gtk` arrives as `Gtk` — GJS then loads whichever version the host has,
 * so the honest answer is the table's single `Gtk-*` row, and an ambiguity
 * (two rows for one namespace) has to be a build failure rather than a guess:
 * picking one would silently declare a dependency on a different library than
 * the one the app will load.
 */
function lookupTypelib(
    specifier: string,
    overrides: Record<string, Record<DistroFormatId, string>> = {},
): Record<DistroFormatId, string> | undefined {
    // A project row wins over the built-in one: the table here is a snapshot
    // of what two distributions call things today, and a project that knows
    // better must not have to wait for a gjsify release to say so.
    const table = { ...TYPELIB_PACKAGES, ...overrides };
    const exact = table[specifier];
    if (exact !== undefined) return exact;
    if (specifier.includes('-')) return undefined;
    const candidates = Object.keys(table).filter((key) => key.startsWith(`${specifier}-`));
    if (candidates.length !== 1) return undefined;
    return table[candidates[0] as string];
}

/** One parsed dependency. `relation`/`version` are absent for an unversioned one. */
export interface ParsedDepend {
    name: string;
    relation?: '>=' | '>' | '<=' | '<' | '=';
    version?: string;
}

/** `gjs >= 1.86` → its parts. Both packers need this; only the spelling differs. */
export function parseDepend(depend: string): ParsedDepend {
    const match = /^(\S+)\s*(>=|<=|=|>|<)\s*(\S+)$/.exec(depend);
    if (!match) return { name: depend.trim() };
    return { name: match[1] as string, relation: match[2] as ParsedDepend['relation'], version: match[3] as string };
}

/**
 * Format a dependency for `Depends:`.
 *
 * dpkg puts the bound in parentheses and spells strict inequality `<<`/`>>` —
 * bare `<`/`>` are deprecated aliases for `<=`/`>=`, so emitting them means the
 * opposite of what it reads like.
 */
export function formatDebDepend(depend: string): string {
    const parsed = parseDepend(depend);
    if (parsed.relation === undefined) return parsed.name;
    const relation = parsed.relation === '>' ? '>>' : parsed.relation === '<' ? '<<' : parsed.relation;
    return `${parsed.name} (${relation} ${parsed.version})`;
}

/** The namespaces the table knows — exported so the unit tests can assert on the set. */
export function knownNamespaces(): string[] {
    return Object.keys(TYPELIB_PACKAGES).sort();
}
