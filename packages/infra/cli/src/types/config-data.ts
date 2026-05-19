import type { RolldownOptions, OutputOptions, RolldownPluginOption } from 'rolldown';
import type { ConfigDataLibrary, ConfigDataTypescript } from './index.js';

/**
 * Plugin entry resolvable by package name from the project's `node_modules`.
 * Lets users describe the plugin chain in `package.json#gjsify` without
 * dropping to a JS-form config file. The CLI imports the named module,
 * picks the chosen export (defaults to `default`), and calls it with
 * `options`.
 *
 * Example:
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
 * Subset of `RolldownOptions` accepted in `.gjsifyrc.js`. Mirrors the legacy
 * `esbuild?: BuildOptions` field — a thin pass-through. The orchestrator
 * applies platform defaults on top of these, so most projects only need
 * `output.file` / `output.dir` here.
 *
 * `output` is constrained to a single `OutputOptions` object (Rolldown also
 * accepts an array for multi-output builds, but the CLI surface targets the
 * single-output use case).
 *
 * `plugins` is widened to also accept `BundlerPluginByName` entries — these
 * are resolved by the CLI from the project's `node_modules` before the
 * Rolldown call.
 */
export type BundlerOptions = Omit<RolldownOptions, 'output' | 'plugins'> & {
    output?: OutputOptions;
    plugins?: Array<RolldownPluginOption | BundlerPluginByName>;
};

/**
 * Legacy `esbuild?: BuildOptions` shape — kept as a compatibility shim for
 * one minor release. Setting it logs a deprecation warning; the supported
 * subset of fields is mapped into `bundler` at config-load time.
 *
 * Drop in 0.5.0.
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
    /** Switch on the verbose mode */
    verbose?: boolean;
    /**
     * Bundler-level options forwarded to Rolldown. Replaces the legacy
     * `esbuild` field. The orchestrator applies platform-specific defaults
     * on top — most projects only need to set `output.file` / `output.dir`.
     */
    bundler?: BundlerOptions;
    /**
     * @deprecated Use `bundler` instead. Will be removed in 0.5.0. The shim
     * maps the supported subset of esbuild fields into the equivalent
     * Rolldown shape and logs a deprecation warning.
     */
    esbuild?: LegacyEsbuildOptions;
    library?: ConfigDataLibrary;
    typescript?: ConfigDataTypescript;
    /** An array of glob patterns to exclude matches and aliases */
    exclude?: string[];
    /**
     * Inject a console shim into GJS builds for clean output (no GLib prefix, ANSI colors work).
     * Only applies to GJS app builds. Default: true.
     */
    consoleShim?: boolean;
    /**
     * Comma-separated list of global identifiers to register in the bundle.
     * See CliBuildOptions for format.
     */
    globals?: string;
    /**
     * Prepend a shebang to the output bundle and mark it executable.
     *
     *   `true`  → use the default `#!/usr/bin/env -S gjs -m` line
     *   `false` → no shebang (default)
     *   `"…"`   → custom line. Supports `${env:NAME}` and `${env:NAME:-default}`
     *             placeholders against `process.env`. The leading `#!` is
     *             added automatically if omitted. Useful when an outer
     *             build tool (Meson, Flatpak) exports the GJS interpreter
     *             path as `GJS_CONSOLE` (e.g. `/usr/bin/gjs-console`).
     *
     * Example: `"shebang": "${env:GJS_CONSOLE:-/usr/bin/env -S gjs} -m"`
     *
     * See also `CliBuildOptions.shebang`.
     */
    shebang?: boolean | string;
    /**
     * Extra module aliases layered on top of the built-in alias map.
     * Comes from `gjsify build --alias FROM=TO`.
     */
    aliases?: Record<string, string>;
    /**
     * Global identifiers to remove from the auto-detected set before writing
     * the inject stub. Useful for false positives from dead browser-compat
     * code in npm dependencies whose polyfills require unavailable native libs.
     * Example: `["fetch", "XMLHttpRequest"]` excludes the HTTP polyfill stack.
     */
    excludeGlobals?: string[];
    /**
     * Compile-time defines populated from `package.json` fields. Each entry
     * maps a JS identifier (the define key) to a dotted package.json path.
     * Values are JSON-stringified before merging into `bundler.transform.define`.
     *
     * Example:
     * ```jsonc
     * "defineFromPackageJson": {
     *   "__PACKAGE_VERSION__": { "field": "version" },
     *   "__PACKAGE_NAME__":    { "field": "name" }
     * }
     * ```
     *
     * Replaces the wrapper-script pattern (`spawnSync('gjsify', ['build',
     * '--define', '__VERSION__=' + JSON.stringify(pkg.version)])`) used by
     * `@ts-for-gir/cli` before this option existed.
     */
    defineFromPackageJson?: Record<string, { field: string }>;
    /**
     * Compile-time defines populated from `process.env` at config-load time.
     * Each entry maps a JS identifier to an environment variable name with an
     * optional default. Values are JSON-stringified before merging into
     * `bundler.transform.define`. When the variable is unset and no default
     * is provided, the identifier is replaced with the literal `undefined`
     * so consumer code can safely guard with `typeof X === 'undefined'` or
     * `X ?? fallback`.
     *
     * Example:
     * ```jsonc
     * "defineFromEnv": {
     *   "__APPLICATION_ID__": { "env": "APPLICATION_ID", "default": "org.example.App" },
     *   "__PREFIX__":         { "env": "PREFIX" }
     * }
     * ```
     *
     * Designed for projects whose build is driven by an outer tool (Meson,
     * Make, CI) that exports environment variables — avoids a wrapper script
     * just to thread them through to the bundler.
     */
    defineFromEnv?: Record<string, { env: string; default?: string }>;
    /**
     * Extension → loader-kind map for files Rolldown does not classify
     * natively. Currently only `'text'` is implemented — the file's content
     * becomes the JS string default export (`export default "<content>"`).
     * Replaces the legacy esbuild `loader: { '.ui': 'text' }` pattern.
     *
     * Example:
     * ```jsonc
     * "loaders": { ".ui": "text", ".asm": "text" }
     * ```
     *
     * Lives at the top level (not under `bundler`) so it doesn't leak into
     * Rolldown's options on pass-through; the CLI converts it into a
     * `text-loader` plugin prepended to the bundler's plugin chain.
     */
    loaders?: Record<string, 'text'>;
    /**
     * Flatpak-related configuration consumed by `gjsify flatpak <sub>`.
     * Lives in its own top-level namespace so the bundler config doesn't
     * accumulate concerns and `flatpak init` / `flatpak ci` can read defaults
     * declaratively. CLI flags override these values.
     */
    flatpak?: ConfigDataFlatpak;
    /**
     * Format/lint config consumed by `gjsify format` / `gjsify lint` /
     * `gjsify fix`. Thin shell — Biome's own `biome.json` is the real
     * configuration file; we only need a pointer here.
     */
    format?: ConfigDataFormat;
    /**
     * Test-runner configuration consumed by `gjsify test`. CLI flags
     * (--entry, --outdir, --runtime) override these values.
     */
    test?: ConfigDataTest;
}

/** Optional pointer to a non-default biome.json. */
export interface ConfigDataFormat {
    /**
     * Path to biome.json. Default: walks up from cwd to find one;
     * falls back to the recommended template shipped with `gjsify`
     * (writable via `gjsify format --init`).
     */
    configPath?: string;
}

/**
 * `gjsify test` configuration. All fields optional — sensible defaults
 * apply when missing.
 */
export interface ConfigDataTest {
    /** Path to the test entry. Default: `src/test.mts`. */
    entry?: string;
    /** Output directory for the built test bundles. Default: `dist/`. */
    outdir?: string;
    /** Default runtimes when `--runtime` not specified. Default: `['gjs', 'node']`. */
    runtimes?: Array<'gjs' | 'node'>;
}

/**
 * Flatpak-toolchain config consumed by the `gjsify flatpak` subcommand
 * group. All fields optional — sensible defaults apply when missing.
 */
export interface ConfigDataFlatpak {
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
     * Extra SDK extensions to include in the manifest, e.g.
     * `['org.freedesktop.Sdk.Extension.llvm17']` for projects with native
     * code that needs a specific toolchain. Leave empty (the default) for
     * pure gjsify projects — the GNOME runtime already ships GJS + GLib
     * + libsoup, and `gjsify build` produces a self-contained bundle that
     * needs no build-time Node anymore. (Before Phase D-3 we added
     * `org.freedesktop.Sdk.Extension.node24` here by default for the
     * yarn-install + esbuild build step — that's no longer required.)
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
    /** Cleanup glob patterns applied to the final manifest, e.g. `['/include', '/lib/pkgconfig']`. */
    cleanup?: string[];
    /** Source-of-truth lockfile for `gjsify flatpak deps` — `yarn.lock` or `package-lock.json`. */
    lockfile?: string;
    /**
     * GitHub-Actions container image override for `gjsify flatpak ci`.
     * Default derived from runtime + runtimeVersion:
     *   gnome+50 → `ghcr.io/flathub-infra/flatpak-github-actions:gnome-50`
     */
    ciContainer?: string;
    /** Branches the generated workflow triggers on. Default `['main']`. */
    ciBranches?: string[];

    // ─── Phase F.9: MetaInfo / .desktop / flathub.json scaffolding ─────────

    /**
     * App kind. `'app'` (default) → desktop-application MetaInfo, GUI
     * finish-args, .desktop + icon required. `'cli'` → console-application
     * MetaInfo with `<provides><binary>`, no .desktop, flathub.json sets
     * `skip-icons-check`. Supersedes the older `--cli-only` flag on
     * `gjsify flatpak init`.
     */
    kind?: 'app' | 'cli';
    /**
     * App display name (`.desktop` `Name=` + MetaInfo `<name>`). Defaults
     * to a friendly derivation of `package.json#name` — that works when
     * `name` is the reverse-DNS app id, but breaks when it's an npm
     * package name like `learn6502`. Set this explicitly to the
     * human-readable name shown in app stores (e.g. `"Learn 6502 Assembly"`).
     */
    name?: string;
    /**
     * Developer attribution required by Flathub. `id` must be reverse-DNS.
     * `email` (optional) becomes `<email>` inside `<developer>`.
     * `nameTranslatable: false` (default) emits `translate="no"` on the
     * `<name>` tag — recommended for personal/brand names that should not
     * be translated. Set to `true` if the name is a descriptive phrase
     * that translators should localise.
     */
    developer?: {
        id: string;
        name: string;
        email?: string;
        nameTranslatable?: boolean;
    };
    /**
     * One-line summary, ≤80 chars, no trailing period (Flathub rule).
     * Translatable — gettext's `msgfmt --xml --template` substitutes
     * `<summary>` from `.po` files at build time. Set
     * `summaryTranslatorHint` to emit a `<!-- TRANSLATORS: ... -->`
     * comment before the tag.
     */
    summary?: string;
    /** Translator hint emitted as `<!-- TRANSLATORS: ... -->` before `<summary>`. */
    summaryTranslatorHint?: string;
    /**
     * Long description. Two forms:
     * - **String** — split on blank lines into `<p>` blocks. Best for
     *   simple descriptions without bullet lists.
     * - **Block array** — explicit blocks (`{p:..., translatorHint?:...}`
     *   for paragraphs or `{ul:[...], translatorHint?:...}` for bullet
     *   lists). Each block can carry its own translator hint. Use this
     *   form when you need bullet lists or per-string translator context.
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
     * License SPDX identifiers. `project` is the project's source license
     * (mandatory). `metadata` is the license under which the MetaInfo XML
     * is distributed (default `'CC0-1.0'`).
     */
    license?: { metadata?: string; project: string };
    /**
     * Content-rating policy. Two forms:
     * - **String** — just the spec keyword (default `'oars-1.1'`), emits
     *   an empty `<content_rating type="..."/>` block.
     * - **Object** — keyword + `attributes` map. Each attribute is an
     *   OARS key (`violence-cartoon`, `social-info`, etc.) → severity
     *   (`none`, `mild`, `moderate`, `intense`). Flathub recommends
     *   declaring attributes explicitly even when they're `none` so the
     *   rating audit is auditable.
     */
    contentRating?: string | {
        type?: string;
        attributes?: Record<string, 'none' | 'mild' | 'moderate' | 'intense'>;
    };
    /** Freedesktop Menu categories (e.g. `['Development', 'Utility']`). */
    categories?: string[];
    /** Search keywords for app stores. */
    keywords?: string[];
    /**
     * Release history. Most recent first. Each entry produces a
     * `<release version=… date=…>` block. `description` accepts the
     * same string-or-block-array shape as the top-level `description`
     * field — use the array form for release notes with bullet lists
     * or per-string translator hints.
     */
    releases?: Array<{
        version: string;
        date: string;
        description?: string | DescriptionBlock[];
    }>;
    /**
     * Screenshots for app-stores. `url` is an absolute HTTPS URL to a PNG.
     * `caption` is optional and translatable — set `captionTranslatorHint`
     * for a `<!-- TRANSLATORS: ... -->` hint. `environment` is one of
     * `'plasma'|'gnome'|'cli'` — Flathub uses it to group by desktop.
     * First entry defaults to `type="default"`; override with `type`.
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
     * Path to a scalable SVG icon. Flathub requires SVG (`/app/share/icons/
     * hicolor/scalable/apps/<app-id>.svg`). When set, init verifies the file
     * exists; when unset on `--kind app`, init prints a Flathub hint.
     */
    icon?: string;

    // ─── Phase F.9.6: Rich AppStream surface ───────────────────────────────

    /**
     * Remote-hosted icon URL — emitted as `<icon type="remote">`. Useful
     * for the Flathub app-store thumbnail before the local SVG ships.
     */
    iconRemote?: string;
    /**
     * Translation platform URL (Weblate, Crowdin, Transifex, etc.).
     * Emitted as `<url type="translate">`. Set this when your app accepts
     * community translation contributions through a hosted platform.
     */
    translateUrl?: string;
    /**
     * AppStream kudos — Flathub recognises a fixed set of "well-behaved"
     * markers. Common values: `ModernToolkit`, `HiDpiIcon`,
     * `TouchscreenSupport`, `UserDocs`, `HighContrast`, `Notifications`,
     * `SearchProvider`. Full list at
     * https://www.freedesktop.org/software/appstream/docs/sect-Metadata-DesktopApps.html#tag-dapp-kudos
     */
    kudos?: string[];
    /**
     * Things this app provides to the system. `<binary>` is auto-included
     * with the value of `command` when omitted (apps + CLIs both need
     * this for AppStream to register the binary correctly).
     */
    provides?: {
        binaries?: string[];
        mimetypes?: string[];
        dbus?: Array<{ type: 'user' | 'system'; id: string }>;
    };
    /**
     * Hardware controls the app supports (best-effort declaration —
     * AppStream `<supports>`). Common values:
     * `keyboard`, `pointing`, `touch`, `gamepad`, `tablet`, `console`,
     * `vision`.
     */
    supports?: {
        controls?: Array<'keyboard' | 'pointing' | 'touch' | 'gamepad' | 'tablet' | 'console' | 'vision'>;
        /** Internet connectivity requirement. */
        internet?: 'always' | 'offline-only' | 'first-run';
    };
    /**
     * Hard requirements — AppStream `<requires>`. App won't function
     * without these. `displayLengthMin` is the minimum display length in
     * pixels (logical units) — typical phone-portrait minimum is 360.
     */
    requires?: {
        displayLengthMin?: number;
        internet?: 'always' | 'offline-only' | 'first-run';
        controls?: Array<'keyboard' | 'pointing' | 'touch' | 'gamepad' | 'tablet' | 'console'>;
    };
    /**
     * Soft recommendations — AppStream `<recommends>`. App works better
     * with these but functions without them. `displayLengthMin` typical
     * tablet-min recommendation is 480.
     */
    recommends?: {
        displayLengthMin?: number;
        controls?: Array<'keyboard' | 'pointing' | 'touch' | 'gamepad' | 'tablet' | 'console'>;
    };
    /**
     * Flathub tracking-repo override for `gjsify flatpak sync-flathub` /
     * `gjsify flatpak diff`. Default: `flathub/<appId>` (e.g.
     * `flathub/eu.jumplink.Learn6502`). Set this when the upstream repo
     * deviates from that convention.
     */
    flathubRepo?: string;
}

/**
 * A single block inside a MetaInfo `<description>`. Either a paragraph
 * (`{p}`) or a bullet list (`{ul}`). Each block can carry an optional
 * `translatorHint` that becomes a `<!-- TRANSLATORS: ... -->` comment
 * before the block in the emitted `.metainfo.xml.in` template — gives
 * translators context when the string lands in their `.po` file.
 */
export type DescriptionBlock =
    | { p: string; translatorHint?: string }
    | { ul: Array<string | { item: string; translatorHint?: string }>; translatorHint?: string };
