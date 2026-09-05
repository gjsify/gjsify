import type { RolldownOptions, OutputOptions, RolldownPluginOption } from 'rolldown';
import type { App, SourceDialect } from '@gjsify/rolldown-plugin-gjsify';
import type { ConfigDataLibrary, ConfigDataTypescript } from './index.js';

/**
 * Plugin entry resolvable by package name from the project's `node_modules`, so
 * the plugin chain can be described in `package.json#gjsify` without dropping to
 * a JS-form config file. The CLI imports the named module, picks `export`
 * (default: `default`), and calls it with `options`.
 *
 * ```jsonc
 * { "name": "@gjsify/vite-plugin-blueprint", "options": { "minify": true } }
 * { "name": "@gjsify/vite-plugin-gettext", "export": "msgfmtPlugin", "options": { ... } }
 * ```
 */
export interface BundlerPluginByName {
    name: string;
    export?: string;
    options?: unknown;
}

/**
 * Subset of `RolldownOptions` accepted in `.gjsifyrc.js`, a thin pass-through:
 * the orchestrator applies platform defaults on top, so most projects only set
 * `output.file` / `output.dir`.
 *
 * `output` is a single `OutputOptions` object — Rolldown also accepts an array
 * for multi-output builds, but this CLI surface targets the single-output case.
 * `plugins` additionally accepts {@link BundlerPluginByName} entries, resolved
 * from `node_modules` before the Rolldown call.
 */
export type BundlerOptions = Omit<RolldownOptions, 'output' | 'plugins'> & {
    output?: OutputOptions;
    plugins?: Array<RolldownPluginOption | BundlerPluginByName>;
};

/**
 * Legacy `esbuild?: BuildOptions` shape, still read as a compatibility shim.
 * Setting it logs a deprecation warning; `legacyEsbuildToRolldown` maps the
 * supported subset into `bundler` at config-load time.
 */
export interface LegacyEsbuildOptions {
    outfile?: string;
    outdir?: string;
    format?: 'esm' | 'cjs' | 'iife';
    external?: string[];
    define?: Record<string, string>;
    inject?: string[];
    banner?: { js?: string };
    target?: string | string[];
    minify?: boolean;
    sourcemap?: boolean | 'inline' | 'external' | 'both';
    mainFields?: string[];
    conditions?: string[];
    platform?: 'browser' | 'node' | 'neutral';
    loader?: Record<string, string>;
}

export interface ConfigData {
    verbose?: boolean;
    /**
     * Build target for an application build. Resolved in `Config.forBuild` as CLI
     * flag (`--app`) > `package.json#gjsify.app` > host-runtime default (`gjs` when
     * the CLI runs under gjs, `node` under node/bun/deno).
     */
    app?: App;
    /**
     * Bundler-level options forwarded to Rolldown. The orchestrator applies
     * platform-specific defaults on top — most projects only set `output.file` /
     * `output.dir`.
     */
    bundler?: BundlerOptions;
    /**
     * @deprecated Use `bundler`. The shim maps the supported subset of esbuild
     * fields into the equivalent Rolldown shape and logs a deprecation warning.
     */
    esbuild?: LegacyEsbuildOptions;
    library?: ConfigDataLibrary;
    typescript?: ConfigDataTypescript;
    /** An array of glob patterns to exclude matches and aliases */
    exclude?: string[];
    /**
     * Inject a console shim into GJS app builds for clean output (no GLib prefix,
     * working ANSI colors). Default: true.
     */
    consoleShim?: boolean;
    /**
     * The dialect the SOURCE is written in (ADR 0032 § 2 + § 8). `'react-native'`
     * aliases `react-native` onto `@gjsify/react-native` and gates every named
     * import against the support table at BUILD time. `gjs` and `node` app builds.
     * Default: unset.
     *
     * Opt-in and never inferred from the dependency list: a monorepo with a phone
     * leg installs the real `react-native` on purpose, and redirecting the
     * specifier for every build in that tree would change what that leg resolves.
     *
     * NOT `gjsify.runtimes['react-native']`, which answers the opposite question —
     * see the header of `SourceDialect`.
     */
    dialect?: SourceDialect;
    /** Comma-separated global identifiers to register. Format: see CliBuildOptions. */
    globals?: string;
    /**
     * Prepend a shebang to the output bundle and mark it executable.
     *
     *   `true`  → the default `#!/usr/bin/env -S gjs -m` line
     *   `false` → no shebang (default)
     *   `"…"`   → custom line, supporting `${env:NAME}` and `${env:NAME:-default}`
     *             placeholders against `process.env`; a leading `#!` is added if
     *             omitted. For outer build tools (Meson, Flatpak) that export the
     *             interpreter path, e.g.
     *             `"${env:GJS_CONSOLE:-/usr/bin/env -S gjs} -m"`.
     */
    shebang?: boolean | string;
    /** Extra module aliases layered on the built-in map (`build --alias FROM=TO`). */
    aliases?: Record<string, string>;
    /**
     * Global identifiers to remove from the auto-detected set before writing the
     * inject stub — for false positives from dead browser-compat code in npm deps
     * whose polyfills need unavailable native libs. `["fetch", "XMLHttpRequest"]`
     * excludes the HTTP polyfill stack.
     */
    excludeGlobals?: string[];
    /**
     * Overrides for the ad-hoc bundle `gjsify run --node-script <file>` builds under
     * GJS. Unset keys fall through to the package-level `globals` / `excludeGlobals`
     * above, so most packages need only those. `@gjsify/adwaita-web` forced the split:
     * its browser bundle wants the DOM registers, while the script that COMPILES its
     * stylesheet must not have them — injecting them made that bundle demand `gi://Gdk`
     * and believe it was running on Node (#1053).
     */
    nodeScript?: {
        globals?: string;
        excludeGlobals?: string[];
    };
    /**
     * Compile-time defines from `package.json` fields: JS identifier → dotted
     * package.json path. Values are JSON-stringified before merging into
     * `bundler.transform.define`.
     *
     * ```jsonc
     * "defineFromPackageJson": {
     *   "__PACKAGE_VERSION__": { "field": "version" },
     *   "__PACKAGE_NAME__":    { "field": "name" }
     * }
     * ```
     */
    defineFromPackageJson?: Record<string, { field: string }>;
    /**
     * Compile-time defines from `process.env` at config-load time, for projects
     * whose build is driven by an outer tool (Meson, Make, CI) that exports
     * variables. Values are JSON-stringified into `bundler.transform.define`; an
     * unset variable with no `default` becomes the literal `undefined`, so consumers
     * can guard with `typeof X === 'undefined'` or `X ?? fallback`.
     *
     * ```jsonc
     * "defineFromEnv": {
     *   "__APPLICATION_ID__": { "env": "APPLICATION_ID", "default": "org.example.App" },
     *   "__PREFIX__":         { "env": "PREFIX" }
     * }
     * ```
     */
    defineFromEnv?: Record<string, { env: string; default?: string }>;
    /**
     * Extension → loader-kind map for files Rolldown does not classify natively,
     * e.g. `{ ".ui": "text", ".glsl": "text", ".png": "dataurl" }`.
     *
     *   `'text'`    — contents as a JS string default export. GLSL shaders, `.ui`
     *                 GtkBuilder XML, `.asm`.
     *   `'dataurl'` — `data:<mime>;base64,<b64>` string default export, MIME inferred
     *                 from the extension (fallback `application/octet-stream`). For
     *                 anything accepting a data: URL rather than a separate asset,
     *                 e.g. Excalibur's `ImageSource`.
     *
     * Top-level rather than under `bundler` so it does not leak into Rolldown's
     * options on pass-through; the CLI turns it into a plugin prepended to the chain.
     */
    loaders?: Record<string, 'text' | 'dataurl'>;
    /**
     * Config for `gjsify flatpak <sub>`, in its own namespace so the bundler config
     * does not accumulate concerns and `flatpak init` / `flatpak ci` can read
     * defaults declaratively. CLI flags override these.
     */
    flatpak?: ConfigDataFlatpak;
    /**
     * Config for `gjsify ship` — the installable artifacts (`.deb`, `.rpm`)
     * built from one staged payload. Metadata left unset here falls back to
     * `gjsify.flatpak`, because both blocks describe the SAME application
     * (ADR 0024 § 8) and no project should have to write it twice.
     */
    ship?: ConfigDataShip;
    /**
     * Config for `gjsify format` / `lint` / `fix`. A thin shell: oxc's own
     * `.oxfmtrc.json` / `.oxlintrc.json` are the real configuration files.
     */
    format?: ConfigDataFormat;
    /** Config for `gjsify test`. `--entry`, `--outdir`, `--runtime` override these. */
    test?: ConfigDataTest;
}

/** Optional pointer to a non-default oxc config file. */
export interface ConfigDataFormat {
    /**
     * Path to an `.oxfmtrc.json` / `.oxlintrc.json`. Default: walks up from
     * cwd to find one; falls back to the recommended templates shipped with
     * `gjsify` (writable via `gjsify format --init`).
     */
    configPath?: string;
}

/** `gjsify test` configuration. */
export interface ConfigDataTest {
    /** Path to the test entry. Default: `src/test.mts`. */
    entry?: string;
    /** Output directory for the built test bundles. Default: `dist/`. */
    outdir?: string;
    /** Default runtimes when `--runtime` not specified. Default: `['gjs', 'node']`. */
    runtimes?: Array<'gjs' | 'node'>;
}
/**
 * The app metadata every install format needs — AppStream MetaInfo fields plus
 * what a freedesktop `.desktop` entry is built from. Shared on purpose: a
 * `.deb`, an `.rpm`, a Flatpak and a macOS bundle all describe the SAME
 * application, so this block belongs to the app rather than to whichever packer
 * happens to read it (ADR 0024 § 8).
 */
export interface AppMetadata {
    /**
     * `'app'` (default) → desktop-application MetaInfo, GUI finish-args, .desktop +
     * icon required. `'cli'` → console-application MetaInfo with
     * `<provides><binary>`, no .desktop, and `skip-icons-check` in flathub.json.
     * Supersedes the older `--cli-only` flag on `gjsify flatpak init`.
     */
    kind?: 'app' | 'cli';
    /**
     * App display name (`.desktop` `Name=` + MetaInfo `<name>`). The default derives
     * it from `package.json#name`, which works when that is the reverse-DNS app id
     * and breaks when it is an npm name like `learn6502` — set it explicitly to the
     * human-readable store name, e.g. `"Learn 6502 Assembly"`.
     */
    name?: string;
    /**
     * Developer attribution required by Flathub; `id` must be reverse-DNS.
     * `nameTranslatable: false` (default) emits `translate="no"` on `<name>`, right
     * for personal/brand names; set it `true` for a descriptive phrase translators
     * should localise.
     */
    developer?: {
        id: string;
        name: string;
        email?: string;
        nameTranslatable?: boolean;
    };
    /**
     * One-line summary, ≤80 chars, no trailing period (Flathub rule). Translatable:
     * gettext's `msgfmt --xml --template` substitutes `<summary>` from `.po` files
     * at build time.
     */
    summary?: string;
    /** Translator hint emitted as `<!-- TRANSLATORS: ... -->` before `<summary>`. */
    summaryTranslatorHint?: string;
    /**
     * Long description, either a string split on blank lines into `<p>` blocks, or
     * an explicit {@link DescriptionBlock} array when you need bullet lists or
     * per-string translator context.
     */
    description?: string | DescriptionBlock[];
    /** Project homepage URL. Recommended; required for Flathub submission. */
    homepageUrl?: string;
    /** Bug tracker URL. */
    bugtrackerUrl?: string;
    /** VCS browser URL (e.g. GitHub repo). */
    vcsBrowserUrl?: string;
    /** Donation URL (e.g. OpenCollective / GitHub Sponsors). */
    donationUrl?: string;
    /**
     * License SPDX identifiers: `project` is the source license (mandatory),
     * `metadata` the license the MetaInfo XML ships under (default `'CC0-1.0'`).
     */
    license?: { metadata?: string; project: string };
    /**
     * Content-rating policy: either the bare spec keyword (default `'oars-1.1'`,
     * emitting an empty `<content_rating type="…"/>`), or keyword + an `attributes`
     * map of OARS key → severity. Flathub recommends declaring attributes explicitly
     * even when they are `none`, so the rating stays auditable.
     */
    contentRating?:
        | string
        | {
              type?: string;
              attributes?: Record<string, 'none' | 'mild' | 'moderate' | 'intense'>;
          };
    /** Freedesktop Menu categories (e.g. `['Development', 'Utility']`). */
    categories?: string[];
    /** Search keywords for app stores. */
    keywords?: string[];
    /**
     * Release history, most recent first; each entry produces a
     * `<release version=… date=…>` block. `description` takes the same
     * string-or-block-array shape as the top-level `description`.
     */
    releases?: Array<{
        version: string;
        date: string;
        description?: string | DescriptionBlock[];
    }>;
    /**
     * App-store screenshots. `url` must be an absolute HTTPS URL to a PNG;
     * `environment` lets Flathub group by desktop; the first entry defaults to
     * `type="default"`.
     */
    screenshots?: Array<{
        url: string;
        caption?: string;
        captionTranslatorHint?: string;
        environment?: 'plasma' | 'gnome' | 'cli';
        type?: 'default' | 'source';
    }>;
    /** Light/dark accent colours (hex `#rrggbb`) — emit `<branding>` block. */
    branding?: { accentLight: string; accentDark: string };
    /**
     * Path to a scalable SVG icon; Flathub requires SVG
     * (`/app/share/icons/hicolor/scalable/apps/<app-id>.svg`). When set, init
     * verifies the file exists; when unset on `--kind app`, init prints a hint.
     */
    icon?: string;

    /** Remote-hosted icon URL, emitted as `<icon type="remote">`. */
    iconRemote?: string;
    /**
     * Translation-platform URL (Weblate, Crowdin, …), emitted as
     * `<url type="translate">`.
     */
    translateUrl?: string;
    /**
     * AppStream kudos — a fixed set of "well-behaved" markers, e.g.
     * `ModernToolkit`, `HiDpiIcon`, `TouchscreenSupport`, `UserDocs`.
     * https://www.freedesktop.org/software/appstream/docs/sect-Metadata-DesktopApps.html#tag-dapp-kudos
     */
    kudos?: string[];
    /**
     * File types this package DEFINES for the whole system — a shared-mime-info
     * document staged into `share/mime/packages/`.
     *
     * Distinct from `provides.mimetypes`, which only says the app HANDLES a type.
     * For a standard type (`text/plain`, `application/pdf`) handling is all you
     * need: the distribution already defines it. For a type of your own
     * (`application/x-bauplan`) handling it is not enough and the failure is
     * silent — nothing on the system knows the type exists, so a `.bauplan` file
     * is never recognised as one, `MimeType=` in the desktop entry matches
     * nothing, and double-clicking the file does nothing at all. No error, no
     * log line: the association simply never fires.
     *
     * Every type declared here is added to the handled set automatically, because
     * defining a file type in your own package and then not opening it is not a
     * thing anyone means to do.
     */
    mimeTypes?: Array<{
        /** `<media>/<subtype>`, e.g. `application/x-bauplan`. */
        type: string;
        /**
         * What a file manager shows instead of the raw type string. Required:
         * a type with no comment is listed to the user as `application/x-bauplan`.
         */
        comment: string;
        /** Filename patterns, e.g. `["*.bauplan"]`. */
        globs?: string[];
        /** A registered type to inherit from, e.g. `application/zip` for a zip container. */
        subClassOf?: string;
        /** Fallback icon name when no type-specific icon is installed. */
        genericIcon?: string;
    }>;
    /**
     * What this app provides to the system. `<binary>` is auto-included with the
     * value of `command` when omitted — AppStream needs it to register the binary
     * for both apps and CLIs.
     */
    provides?: {
        binaries?: string[];
        mimetypes?: string[];
        dbus?: Array<{ type: 'user' | 'system'; id: string }>;
    };
    /** Best-effort hardware-support declaration — AppStream `<supports>`. */
    supports?: {
        controls?: Array<'keyboard' | 'pointing' | 'touch' | 'gamepad' | 'tablet' | 'console' | 'vision'>;
        internet?: 'always' | 'offline-only' | 'first-run';
    };
    /**
     * Hard requirements — AppStream `<requires>`; the app will not function without
     * them. `displayLengthMin` is in logical pixels (phone-portrait minimum: 360).
     */
    requires?: {
        displayLengthMin?: number;
        internet?: 'always' | 'offline-only' | 'first-run';
        controls?: Array<'keyboard' | 'pointing' | 'touch' | 'gamepad' | 'tablet' | 'console'>;
    };
    /**
     * Soft recommendations — AppStream `<recommends>`; the app works better with
     * them but functions without. Typical tablet `displayLengthMin`: 480.
     */
    recommends?: {
        displayLengthMin?: number;
        controls?: Array<'keyboard' | 'pointing' | 'touch' | 'gamepad' | 'tablet' | 'console'>;
    };
}

/**
 * `gjsify ship` configuration — the packaging half of {@link AppMetadata}.
 *
 * Everything here has a derived default; a project that already has a
 * `gjsify.flatpak` block usually needs no `gjsify.ship` block at all.
 */
export interface ConfigDataShip extends AppMetadata {
    /** Reverse-DNS app id. Falls back to `gjsify.flatpak.appId`, then `package.json#name`. */
    appId?: string;
    /**
     * Package name and `bin/` entry. Default: `package.json#name` with the npm
     * scope stripped, lowercased, non-alphanumerics folded to `-`.
     */
    binaryName?: string;
    /** Override the upstream version. Default: `package.json#version`, normalised. */
    version?: string;
    /** Package revision within one upstream version (deb revision / rpm release). Default `'1'`. */
    release?: string;
    /** `Maintainer:` / `Packager:` as `Name <email>`. Default: `package.json#author`. */
    maintainer?: string;
    /**
     * The runtime a shipped artifact runs, PER TARGET — `gjsify.app` is the
     * default and a key here overrides it for one layout.
     *
     * KEYED IN THE `process.platform` SPELLING, like {@link ShipSignOptions} and
     * for the same reason: the value that resolves is chosen by the LAYOUT being
     * assembled — `FormatDescriptor.layoutOs` and the stage manifest's `target.os`
     * — never by the host doing the assembling. `macos` and `windows` are the
     * `gjsify ship <os>` POSITIONAL's spelling, and both `gjsify ship` and
     * `manifest-conformance`'s `ship` rule refuse them BY NAME, because a runtime
     * under a key nothing reads is a target that silently keeps the project-wide
     * answer.
     *
     * `resolveShipApp` (`utils/ship/settings.ts`) is the only reader of this key
     * or of `gjsify.app`, and holds the rest: what one field could not answer,
     * the measurement behind it, and why an absent key means `gjsify.app` and
     * never `Layout.shippedRuntime`.
     */
    app?: ShipAppOptions;
    /**
     * Formats to build when `--target` is not given. Default `['deb', 'rpm']`.
     *
     * A project-level DEFAULT, so it is filtered to the layout `gjsify ship <os>`
     * assembles rather than refused against it — a name here that wraps another
     * OS's layout is dropped, and `gjsify ship` prints which. A `--target` on the
     * command line is a claim about ONE run and is refused instead. Without that
     * split, declaring this key made `gjsify ship darwin --stage` impossible.
     */
    targets?: string[];
    /** Output root, relative to the project. Default `'ship'`. */
    outDir?: string;
    /**
     * The built bundle `bin/<name>` executes. Default: `gjsify.main`, then
     * `package.json#main`. Its whole directory is staged into `lib/<name>/`.
     *
     * A STRING is one entry for every target; a TABLE names one per OS, keyed
     * like {@link ShipAppOptions} and resolved beside it. An application with two
     * hosts has two bundles built from one source — `gjsify.app` decides which
     * runtime a target execs, and this decides which of those bundles it hands
     * that runtime (#1545).
     */
    bundle?: string | ShipBundleOptions;
    /** Icon file, or a directory of them. Sizes are read from the path or the filename. */
    icon?: string;
    /** A `*.gschema.xml` file, or a directory of them. */
    schemas?: string;
    /** Licence file. Default: the first of LICENSE, LICENSE.md, LICENSE.txt, COPYING. */
    licenseFile?: string;
    /**
     * The project's own changelog, rendered into the `.deb`'s
     * `share/doc/<package>/changelog.Debian.gz` (Debian Policy § 4.4).
     * Default: the first of CHANGELOG.md, CHANGELOG, CHANGELOG.txt, NEWS.md,
     * searched up to the repository root exactly as `licenseFile` is.
     */
    changelogFile?: string;
    /** deb `Section:`. Default: derived from `categories`. */
    section?: string;
    /** rpm `Group:`. Default: derived from `categories`. */
    group?: string;
    /**
     * Minimum GJS the emitted dependency asks for. Default `'1.86'` — what the
     * bundler targets. Lower it only if the bundle genuinely runs on an older
     * GJS: no released Debian ships 1.86, so the default makes a `.deb` that
     * apt refuses on trixie rather than one that installs and then fails to
     * start.
     */
    minGjsVersion?: string;
    /**
     * Minimum Node major the emitted dependency asks for, when the payload is a
     * `--app node` bundle. Default `'24'` — the LTS line the
     * `@gjsify/node-runtime-*` packages bundle for macOS and Windows.
     *
     * Lower it only if the bundle genuinely runs on an older Node. The default
     * excludes every current DEB stable/LTS (trixie 20, Ubuntu 24.04 18, Ubuntu
     * 26.04 22), so it makes a `.deb` that apt refuses there rather than one that
     * installs and then dies on the first unsupported syntax — the same trade
     * `minGjsVersion` makes, and `gjsify ship` warns about it either way.
     */
    minNodeVersion?: string;
    /**
     * Runtime dependencies appended to the set derived from the bundle's
     * `gi://` imports — the escape hatch for a namespace the table does not
     * know, and for anything that is not a typelib at all.
     */
    depends?: { deb?: string[]; rpm?: string[] };
    /**
     * GI namespace → the package that ships its typelib, filling gaps in the
     * built-in table (`Nautilus-3.0`, a namespace from a private library, …).
     * A row here wins over the built-in one.
     *
     * This is what unblocks a namespace `gjsify ship` does not know; `depends`
     * is for dependencies that are not typelibs at all and deliberately does
     * not silence the unmapped-namespace failure.
     */
    typelibPackages?: Record<string, { deb: string; rpm: string }>;
    /**
     * Directories whose `*.typelib` and `lib*.so*` the package CARRIES ITSELF, e.g.
     * `["../node_modules/@gjsify/webgl-linux-x64/prebuilds/linux-x64"]`.
     *
     * gjsify's own GI libraries — `Gwebgl`, the GTK runtime bundles, the napi host — arrive as npm
     * prebuilds, not as distro packages, so an app that imports one has no `gir1.2-…` to depend on.
     * Staging them here puts them in `lib/<binary>/gi/` and makes the launcher point
     * `GI_TYPELIB_PATH` and `LD_LIBRARY_PATH` at that directory.
     *
     * The namespaces this covers are read back off the STAGED FILES, not from a separate list:
     * a declaration that a namespace is bundled, without the file being there, is exactly the lie
     * the dependency check exists to prevent.
     */
    bundledTypelibs?: string[];
    /**
     * Directory holding COMPILED gettext catalogues in the layout `bindtextdomain` reads —
     * `<lang>/LC_MESSAGES/<domain>.mo` — e.g. `"dist/locale"`, which is what
     * `@gjsify/vite-plugin-gettext`'s `gettextPlugin` writes by default.
     *
     * Staged into `share/locale/` with that structure preserved, and the launcher then exports
     * `GJSIFY_LOCALE_DIR` so the app can call `bindtextdomain(domain, dir)` without knowing which
     * prefix it was installed under.
     *
     * `.po` sources are NOT accepted: `bindtextdomain` reads `.mo` only, and staging a `.po`
     * produces a package that installs its translations and shows none of them.
     */
    localeDir?: string;
    /**
     * A font file, or a directory of them, the application SHIPS (ADR 0038).
     * Default: `data/fonts` when it exists.
     *
     * Staged into `share/fonts/<appId>/`, which is where fontconfig looks: under a
     * `/usr` prefix through the stock `fonts.conf`'s unconditional
     * `<dir>/usr/share/fonts</dir>`, and under every other prefix through
     * `<dir prefix="xdg">fonts</dir>` plus the `XDG_DATA_DIRS` the launcher already
     * exports. The app names the FAMILY in its styles and needs no install-layout
     * knowledge, exactly as it needs none for icons or schemas.
     *
     * This is what a branded application needs: on a GNOME host the family is
     * usually installed anyway, and on macOS, on Windows and on any Linux that is
     * not GNOME it is not — so without shipping it Pango silently substitutes a
     * fallback and the app merely looks wrong, at exit 0.
     *
     * `.woff` / `.woff2` / `.eot` are REFUSED. Whether FreeType opens a web-font
     * wrapper is a BUILD option of the FreeType the app runs against (brotli for
     * woff2, zlib for woff), so it is a property of the host's or the bundle's
     * closure rather than of the file — and a font that resolves on the developer's
     * box and not in the shipped bundle is the exact silent substitution this key
     * exists to prevent. Ship the desktop face.
     */
    fonts?: string;
    /** Extra payload entries: prefix-relative destination → project-relative source. */
    extraFiles?: Record<string, string>;
    /** Arguments the launcher appends before the user's own. */
    execArgs?: string[];
    /**
     * How `--target flatpak` builds the app: the runtime it links against and
     * what the finished app is allowed to do.
     *
     * The new home of the `gjsify.flatpak` BUILD keys (ADR 0024 § 8). The old
     * spelling still resolves and warns — the window, and what deliberately did
     * NOT move, is `utils/ship/flatpak-config.ts`.
     */
    flatpak?: ShipFlatpakOptions;
    /**
     * The signing identity this project uses by default, per OS.
     *
     * `--sign <identity>` on the command line wins. Absent means unsigned, which
     * is the default path and a legitimate output (ADR 0024 § A13).
     */
    sign?: ShipSignOptions;
}

/**
 * `gjsify.ship.app` — the shipped runtime per OS, overriding `gjsify.app`.
 *
 * All three keys are present, which is where this differs from
 * {@link ShipSignOptions}: `linux` is absent there because a `.deb` carries no
 * per-file signature, while a Linux artifact very much has a runtime — it is the
 * one that emits `Depends: gjs (>= 1.86)` or `Depends: nodejs (>= 24)`, and the
 * whole point of this table is that stating darwin's answer must not move it.
 *
 * Only `gjs` and `node` are shippable. `browser` has no process to launch and
 * `nativescript` ships as an APK/IPA through another pipeline (ADR 0024 § 4), so
 * either one is refused here exactly as it is on `gjsify.app`.
 */
export interface ShipAppOptions {
    /** What a `.deb`/`.rpm`/Flatpak depends on and what its launcher execs. */
    linux?: 'gjs' | 'node';
    /** What a `<App>.app` carries. `node` is the only value the macOS formats accept. */
    darwin?: 'gjs' | 'node';
    /** What a Windows program directory carries. `node` is the only value its formats accept. */
    win32?: 'gjs' | 'node';
}

/**
 * `gjsify.ship.bundle` — the ENTRY per OS, the twin of {@link ShipAppOptions}.
 *
 * The two answer one question between them, and answering only half of it is
 * what #1545 measured: `gjsify.ship.app.darwin: "node"` pointed the launcher at
 * `node` while the payload stayed the project's `main` — a `--app gjs` bundle,
 * because Linux is that project's primary target. Both halves were honoured,
 * they contradicted each other, and the `.app` died on its first import.
 *
 * Same OS spelling as everywhere else in this block (`process.platform`), and
 * the same fall-through: a target with no key here keeps `gjsify.main`. What it
 * does NOT keep is another target's entry — a bundle declared for one OS is
 * dropped from every other OS's payload, since no interpreter but that one can
 * load it.
 */
export interface ShipBundleOptions {
    /** The entry a `.deb`/`.rpm`/Flatpak installs. */
    linux?: string;
    /** The entry `<App>.app/Contents/Resources/lib/` carries. */
    darwin?: string;
    /** The entry the Windows program directory carries. */
    win32?: string;
}

/**
 * `gjsify.ship.sign` — an IDENTITY per OS, and never a certificate.
 *
 * KEYED PER OS, and the two keys must not be one field: a Developer ID string
 * and an Authenticode subject name live in different namespaces, and the value
 * that resolves is chosen by the LAYOUT being packed (`FormatDescriptor.layoutOs`
 * and the stage manifest's `target.os`), not by the host doing the packing
 * (ADR 0024 § A12).
 *
 * `linux` is deliberately absent: a `.deb` and an `.rpm` carry no per-file
 * signature — the artifact is signed as a whole by the repository that serves
 * it, with that repository's key. A key here would look like it did something.
 *
 * WHAT IS NOT HERE, and each is a decision rather than an omission:
 *  - a certificate, a `.p12` path or a password. `codesign` and `signtool` are
 *    handed a NAME and resolve the private key themselves, so `gjsify ship`
 *    never sees a secret and nothing on this surface has to be redacted from a
 *    log line (§ A14).
 *  - an `entitlements` key. § A16 leaves library validation vs. hardened runtime
 *    explicitly unmeasured, and a config key for an unmeasured mechanism is a
 *    promise the implementation cannot keep.
 *  - a notarisation credential. That is a per-RUN account credential, not a
 *    machine-held identity, and a config key for one is an invitation to commit
 *    it — `--notarize <keychain-profile>` is the only way to pass it.
 */
export interface ShipSignOptions {
    /** `codesign --sign <identity>`. `'-'` is ad-hoc and needs no developer identity. */
    darwin?: { identity?: string };
    /** `signtool sign /n <identity>` — the certificate's SUBJECT NAME in a Windows store. */
    win32?: { identity?: string };
}

/**
 * The Flatpak knobs `gjsify ship` reads. Every one has a derived default.
 *
 * There is no `modules` / `extraModules` here, and that is a decision rather
 * than an omission: under `ship` the module list IS the staged payload
 * (`buildsystem: simple` + `cp -a stage/.`), and an escape hatch injecting
 * arbitrary build modules would put the second staging model back in the tree —
 * the one thing ADR 0024 § 8 gates the whole migration on. A project that has
 * to BUILD something inside the sandbox still has `gjsify flatpak init` +
 * `gjsify flatpak build`, unchanged.
 */
export interface ShipFlatpakOptions {
    /**
     * Runtime family. Default `'gnome'` — a GJS bundle needs GLib/GObject/GIO at
     * runtime, and no GJS interpreter ships in the Freedesktop runtime.
     */
    runtime?: 'gnome' | 'freedesktop';
    /** Runtime/SDK version, e.g. `'50'` for GNOME or `'24.08'` for Freedesktop. */
    runtimeVersion?: string;
    /**
     * The branch the app is exported under — the last segment of
     * `app/<id>/<arch>/<branch>`. Default `'stable'`, which is what Flathub
     * publishes and what `flatpak install` resolves without being told.
     */
    branch?: string;
    /** Extra SDK extensions, e.g. `['org.freedesktop.Sdk.Extension.llvm17']`. */
    sdkExtensions?: string[];
    /**
     * Path components prepended to `PATH` inside the build sandbox. Derived from
     * `sdkExtensions` when unset, because an extension whose `bin` is not on
     * PATH is one the build cannot use.
     */
    appendPath?: string[];
    /** Finish-args (capabilities). Default depends on `kind`: GUI args for an app, none for a CLI. */
    finishArgs?: string[];
    /** Cleanup globs applied to `/app`, e.g. `['/include', '/lib/pkgconfig']`. */
    cleanup?: string[];
}

/**
 * Flatpak-toolchain config for the `gjsify flatpak` subcommand group.
 *
 * Six of these keys — `runtime`, `runtimeVersion`, `sdkExtensions`,
 * `appendPath`, `finishArgs`, `cleanup` — have a second home at
 * {@link ShipFlatpakOptions}, and `gjsify ship` warns when it reads them from
 * here (ADR 0024 § 8; the window is `utils/ship/flatpak-config.ts`). They are
 * NOT marked `@deprecated`: for the subcommands in this group they are still
 * the only spelling, and those commands have not moved under `ship` yet
 * (`status/open-todos.md`). Nothing else in this block is deprecated at all —
 * the {@link AppMetadata} half is a designed alias, not a legacy one.
 */
export interface ConfigDataFlatpak extends AppMetadata {
    /** Reverse-DNS app id, e.g. `eu.jumplink.Learn6502`. Defaults to `package.json#name` if it looks like a reverse-DNS id. */
    appId?: string;
    /**
     * Runtime family. Default `'gnome'` — needed at runtime by GJS bundles
     * for GLib/GObject/GIO. `'freedesktop'` is only suitable for non-gjsify
     * CLI tools (no GJS interpreter ships in the Freedesktop runtime).
     */
    runtime?: 'gnome' | 'freedesktop';
    /** Runtime/SDK version, e.g. `'50'` for GNOME or `'24.08'` for Freedesktop. */
    runtimeVersion?: string;
    /**
     * Extra SDK extensions for the manifest, e.g.
     * `['org.freedesktop.Sdk.Extension.llvm17']` for native code needing a specific
     * toolchain. Leave empty for pure gjsify projects: the GNOME runtime already
     * ships GJS + GLib + libsoup and `gjsify build` produces a self-contained bundle
     * that needs no build-time Node.
     */
    sdkExtensions?: string[];
    /** Path components prepended to PATH inside the build sandbox. */
    appendPath?: string[];
    /** The binary name to run (`/app/bin/<command>`). Defaults to `appId`. */
    command?: string;
    /** Finish-args (capabilities). Default depends on `runtime` + `--cli-only`. */
    finishArgs?: string[];
    /** Extra Flatpak modules prepended before the app's own meson/simple module (e.g. `blueprint-compiler` build). */
    extraModules?: unknown[];
    /**
     * Full replacement for the manifest's `modules` array: used verbatim, with
     * neither `extraModules` nor the meson default added. For CLI tools that ship a
     * pre-built bundle and install via shell commands (`buildsystem: simple`).
     */
    modules?: unknown[];
    /** Cleanup glob patterns applied to the final manifest, e.g. `['/include', '/lib/pkgconfig']`. */
    cleanup?: string[];
    /** Source-of-truth lockfile for `gjsify flatpak deps` — `yarn.lock` or `package-lock.json`. */
    lockfile?: string;
    /**
     * GitHub-Actions container image override for `gjsify flatpak ci`. Default is
     * derived from runtime + runtimeVersion, e.g. gnome+50 →
     * `ghcr.io/flathub-infra/flatpak-github-actions:gnome-50`.
     */
    ciContainer?: string;
    /** Branches the generated workflow triggers on. Default `['main']`. */
    ciBranches?: string[];

    /**
     * Flathub tracking-repo override for `gjsify flatpak sync-flathub` / `diff`.
     * Default `flathub/<appId>`; set when the upstream repo deviates.
     */
    flathubRepo?: string;
}

/**
 * One block inside a MetaInfo `<description>`: a paragraph (`{p}`) or a bullet
 * list (`{ul}`). An optional `translatorHint` becomes a `<!-- TRANSLATORS: … -->`
 * comment before the block in the emitted `.metainfo.xml.in`, giving translators
 * context once the string lands in their `.po` file.
 */
export type DescriptionBlock =
    | { p: string; translatorHint?: string }
    | { ul: Array<string | { item: string; translatorHint?: string }>; translatorHint?: string };
