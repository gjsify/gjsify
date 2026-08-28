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
 * The Node the `--app node` bundles target, as a MAJOR.
 *
 * Node 24 is the LTS line `@gjsify/node-runtime-*` bundles for macOS and
 * Windows, and this is the Linux half of the same decision: where an
 * interpreter is bundled, the floor is what was bundled; where it is depended
 * on, the floor is what the bundle needs.
 *
 * It excludes EVERY current DEB stable/LTS — Debian 13 trixie 20, Ubuntu 24.04
 * LTS 18, Ubuntu 26.04 LTS 22; only Debian 14 forky has 24. `warnAboutNodeFloor`
 * is what makes that visible at ship time, and `gjsify.ship.minNodeVersion` is
 * how a project whose bundle really does run on an older Node lowers it. The
 * same honest-floor-plus-warning answer as {@link DEFAULT_GJS_FLOOR}, one axis
 * over — and it will fire far more often.
 */
export const DEFAULT_NODE_FLOOR = '24';

/**
 * The package providing a Node interpreter, per format.
 *
 * ⚠️ THE TWO STRINGS ARE NOT THE SAME NAME, and getting rpm's wrong is silent.
 * `Requires: nodejs >= 24` is a NO-OP on Fedora. Measured with `dnf repoquery`
 * on Fedora 44:
 *
 *     --whatprovides 'nodejs >= 24'          → nodejs22-1:22.23.1-2.fc44
 *     --whatprovides 'nodejs(engine) >= 24'  → nodejs24-1:24.18.0-1.fc44
 *
 * F44 has no real `nodejs` package at all — the name is a virtual Provide of the
 * stream packages, which carry **Epoch 1**. A bare `>= 24` desugars to `0:24`,
 * and `1:22.23.1` beats it on epoch alone, so the floor admits the very version
 * it was written to exclude. `nodejs(engine)` carries no epoch and compares as
 * written. (Streams 20/22/24 are parallel-installable, which is why the name has
 * to be a Provide in the first place.) The spelling appears nowhere in the
 * Fedora packaging guideline's own source — it comes from real spec files.
 *
 * No `/usr/bin/node` file dependency beside it — right answer, and the FIRST
 * reason written here for it was wrong, so both are recorded. It is not that
 * `nodejs24` pulls the symlink in: `/usr/bin/node` is provided by `nodejs20-bin`,
 * `nodejs22-bin` AND `nodejs24-bin`, all three of which
 * `Provides`/`Conflicts: alternative-for(nodejs-bin)` and are therefore mutually
 * exclusive. `nodejs24` itself installs `/usr/bin/node-24`. So the file
 * dependency is satisfied by ANY stream's `-bin`, which makes it worthless as a
 * version constraint — that is why it is not emitted.
 *
 * ⚠️ AND THAT LEAVES A REAL HOLE, which no dependency this writer can emit
 * closes. Measured on Fedora 44:
 *
 *     dnf install --assumeno nodejs22-bin 'nodejs(engine) >= 24'
 *       → installs nodejs22-bin, nodejs22, nodejs24, nodejs24-libs
 *       → and NOT nodejs24-bin
 *
 * Every requirement is met and `node` on `PATH` is still 22. rpm's alternatives
 * scheme has no vocabulary for "the stream that owns the symlink must be at
 * least 24", so an app that must have 24 on `PATH` has to check at runtime; a
 * package cannot ask for it. Recorded here because the gap is invisible from the
 * emitted `Requires:` line, which looks correct and is.
 *
 * (`nodejs24` carries no bare `nodejs` Provide at all — only `nodejs22` does on
 * F44, which is the other half of why the epoch trap above bites.)
 *
 * A `Record`, for the reason {@link SCHEMA_COMPILER_PACKAGE} records: a ternary
 * reads as a two-way choice and is really "deb, or ELSE rpm's name", and a third
 * format silently inheriting rpm's spelling has happened here before, at exit 0.
 */
const NODE_PACKAGE: Record<DistroFormatId, string> = { deb: 'nodejs', rpm: 'nodejs(engine)' };

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

/**
 * Node majors per DEB suite, as measured 2026-08-28 — see {@link warnAboutNodeFloor}.
 */
const DEBIAN_NODE = 'trixie ships 20, forky 24; Ubuntu 24.04 LTS ships 18 and 26.04 LTS 22';

/**
 * Which formats the Node-floor warning is ABOUT.
 *
 * `rpm` is false, and it is a measured fact about Fedora rather than a default:
 * F43/44/45 default to Node 22 but ship `nodejs24` in the base repository,
 * parallel-installable, so `nodejs(engine) >= 24` resolves without an extra
 * repository. Debian and Ubuntu have no such stream packages — one `nodejs` per
 * suite, and it is older than 24 in every current stable/LTS.
 *
 * A `Record` and not `format !== 'deb'`, for the reason
 * {@link GJS_FLOOR_IS_DEBIAN_NEWS} spells out: the negative form answers "stay
 * quiet" for every format that will ever exist, including ones nobody has
 * checked a distribution for.
 */
const NODE_FLOOR_IS_DEBIAN_NEWS: Record<DistroFormatId, boolean> = { deb: true, rpm: false };

/**
 * Warn when the Node floor cannot be satisfied by a released Debian or Ubuntu.
 * Returns the warning lines; empty when the floor is fine.
 *
 * Only reached when the payload actually needs an interpreter — a `--app gjs`
 * package declares no Node dependency, so warning about its floor would be
 * noise attached to a line that is never emitted.
 */
export function warnAboutNodeFloor(format: DistroFormatId, floor: string): string[] {
    if (!NODE_FLOOR_IS_DEBIAN_NEWS[format]) return [];
    // Ubuntu 26.04 LTS's 22 is the newest a current DEB stable/LTS carries;
    // trixie's 20 is older still. A floor of 22 or below is satisfiable
    // somewhere released and stays quiet.
    if (compareVersions(floor, '22') <= 0) return [];
    return [
        `gjsify ship: \`Depends: nodejs (>= ${floor})\` is not satisfiable on any current DEB stable/LTS — ` +
            `${DEBIAN_NODE}. The package installs on forky/sid and on distributions with a newer Node. Set ` +
            '`gjsify.ship.minNodeVersion` if this bundle genuinely runs on an older Node; do NOT lower it ' +
            'to make apt happy, because the result is an install that succeeds and an app that dies on the ' +
            'first syntax or API the older interpreter does not have.',
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
    /**
     * The interpreter the launcher execs — `settings.app`, the SAME field
     * `renderLauncher` branches on.
     *
     * Not a payload fact, and the attempt to make it one is worth keeping: the
     * first cut derived it from a staged FILENAME (`*.node.mjs`), which is wrong
     * in both directions. `discoverPayload` stages the whole directory beside
     * the bundle and `dist/<name>.gjs.js` next to `dist/<name>.node.mjs` is the
     * documented normal layout, so a pure `--app gjs` project that also builds a
     * Node bundle declared a Node dependency it never execs — and with a `>= 24`
     * floor that `.deb` is REFUSED by apt on trixie, Ubuntu 24.04 and Ubuntu
     * 26.04. A working package made uninstallable is not "one extra package
     * installed".
     *
     * The honest source is the one thing that decides both the launcher and this
     * list. `assertLauncherMatchesInterpreter` re-reads the staged launcher and
     * refuses a package where the two disagree, which is the check a payload
     * heuristic could never be.
     *
     * macOS and Windows never reach here: there the interpreter is CARRIED, from
     * `@gjsify/node-runtime-<target>`.
     */
    interpreter: 'gjs' | 'node';
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
    /** Minimum Node major, when one is depended on. Default {@link DEFAULT_NODE_FLOOR}. */
    minNodeVersion?: string;
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
    // The interpreter the launcher execs, and nothing else: a package declares ONE.
    // Linux is the only place this is a dependency at all — macOS and Windows have
    // no system Node, so an artifact for those CARRIES one from
    // `@gjsify/node-runtime-<target>`, and that is the whole reason those three
    // packages exist and this one line is their opposite.
    const out: string[] =
        inputs.interpreter === 'node'
            ? [`${NODE_PACKAGE[format]} >= ${inputs.minNodeVersion ?? DEFAULT_NODE_FLOOR}`]
            : [`gjs >= ${inputs.minGjsVersion ?? DEFAULT_GJS_FLOOR}`];
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

    // Set-dedupe keeps first-insertion order, so the interpreter stays first and
    // the list is stable across runs.
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
