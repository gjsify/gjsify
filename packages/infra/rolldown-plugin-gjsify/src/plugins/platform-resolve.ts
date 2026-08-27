// Platform file resolution — ONE plugin, ONE resolution order, two chains.
//
// Lets a shared codebase fork a single module per target by file name. An
// `import './foo'` (or `import './foo.js'`) resolves to the most specific
// variant on disk, in the priority order the caller's chain declares:
//
//   NativeScript (`--app nativescript`)     GTK / desktop (`--app gjs|node`)
//   ./foo.<android|ios|visionos>.<ext>      ./foo.gtk.<ext>
//   ./foo.native.<ext>                      ./foo.<linux|macos|windows>.<ext>
//   ./foo.<ext>                             ./foo.desktop.<ext>
//                                           ./foo.<ext>
//
// TWO CHAINS, NOT TWO PLUGINS (ADR 0032 § 9). A second plugin would give the
// tree two resolution orders that no single file states, and the order IS the
// contract — `.gtk` before `.<os>` before `.desktop` is a decision, not an
// implementation detail. So the chain is a PARAMETER and the builders below are
// the only way to spell one.
//
// WHY THIS LIVES IN GJSIFY (not just a dependency on @nativescript/vite):
// `@nativescript/vite` implements the same lookup as a Vite `resolve.alias`
// whose `replacement` is a FUNCTION. Vite 8 / Rolldown rejects function
// replacements on the native alias path (`Failed to convert builtin plugin
// 'ViteAlias' … function replacement into rust type String`), which breaks the
// NS production build under Vite 8. Implemented here as a proper `resolveId`
// plugin HOOK (not a `resolve.alias`), it works identically under Rolldown
// (the `gjsify build` CLI) AND under Vite 7/8 (the `gjsifyNativescript()`
// preset) — the function-alias limitation only affects the `resolve.alias`
// config shorthand, not plugin `resolveId` hooks.
//
// Reference: @nativescript/vite `helpers/package-platform-aliases.js`. Original
// Copyright (c) NativeScript contributors, Apache-2.0. Reimplemented for the
// gjsify Rolldown/Vite plugin pipeline.

import { readdirSync } from 'node:fs';
import { basename, dirname, resolve as resolvePath } from 'node:path';
import type { Plugin } from 'rolldown';

export type NativescriptPlatform = 'android' | 'ios' | 'visionos';

const PLATFORMS: readonly NativescriptPlatform[] = ['android', 'ios', 'visionos'];

// JS/TS extensions a source specifier may carry. Stripped so the platform
// suffix lands BEFORE the extension (`./foo.js` → `./foo.android`).
const KNOWN_EXT_RE = /\.(tsx?|jsx?|mts|cts|mjs|cjs)$/;

function isPlatform(value: string): value is NativescriptPlatform {
    return (PLATFORMS as readonly string[]).includes(value);
}

/**
 * The desktop suffix for one host OS, keyed by `process.platform`.
 *
 * TWO VOCABULARIES MEET HERE and neither is negotiable. The KEYS are
 * `process.platform`'s (`linux`/`darwin`/`win32`) — ADR 0018's target set, the
 * spelling `gjsify.os` and `gjsify.platforms` use, and what a running process
 * computes about itself. The VALUES are React Native's `Platform.OS` spelling
 * (`linux`/`macos`/`windows`), which is what ADR 0032 § 9 writes and what
 * `@gjsify/react-native`'s own `Platform.OS` reports — so a `foo.macos.tsx`
 * agrees with the `Platform.OS === 'macos'` branch beside it. Spelling the file
 * `foo.darwin.tsx` would make those two disagree in the one place a reader looks
 * to check them against each other.
 *
 * Exported so `platform-resolve.spec.ts` can iterate the real values instead of
 * a copy: nothing in the type system stops someone adding a `web` row here, and
 * that row is exactly what § 9 forbids.
 */
export const DESKTOP_OS_SUFFIXES: Readonly<Record<string, string>> = {
    linux: 'linux',
    darwin: 'macos',
    win32: 'windows',
};

/**
 * Suffixes that must NEVER be a rung of the DESKTOP chain, with § 9's reason.
 *
 * `.native` looks like an oversight and is the opposite: a `.native.tsx` is by
 * definition written for a React Native runtime, so reaching for it would
 * silently feed the GTK build code that expects `NativeModules` — a bridge that
 * exists only in the phone host. No import error, no type error, no failing
 * test; the divergence surfaces as a window that does not work. Falling through
 * to the BASE file is the honest outcome, because the base file at least has to
 * compile against what this target really has.
 *
 * `.web` is worse. It reads as the obvious pick for a desktop target — a desktop
 * is not a phone, so surely the web variant? — and it carries exactly the DOM
 * assumptions ADR 0032 rules out, the same two-lossy-mappings-stacked shape that
 * rules out react-native-web over a DOM (§ 3, Rejected).
 *
 * Not silence, though: when the desktop chain falls through to base and one of
 * these siblings exists, {@link platformResolvePlugin} warns naming the file.
 * Without that, an author's fork is dead code with nothing anywhere saying so.
 */
export const DESKTOP_REFUSED_SUFFIXES: readonly string[] = ['native', 'web'];

/**
 * The NativeScript chain: platform-specific first, then the platform-agnostic
 * `native` suffix. Without a known platform only `native` applies.
 */
export function nativescriptSuffixChain(platform?: NativescriptPlatform): readonly string[] {
    return platform ? [platform, 'native'] : ['native'];
}

/**
 * The GTK/desktop chain (ADR 0032 § 9): `.gtk` → `.<os>` → `.desktop` → base.
 *
 * `.gtk` outranks the OS because a GTK fork is a statement about the TOOLKIT,
 * which is the more specific claim: `foo.gtk.tsx` says "this is how the widget
 * tree does it", `foo.linux.tsx` says "this is how this kernel does it", and a
 * project holding both means the first on a GTK build.
 *
 * `os` is a suffix from {@link DESKTOP_OS_SUFFIXES}, never a `process.platform`
 * token — see {@link desktopOsSuffix}. Omitting it drops the OS rung rather than
 * guessing one.
 */
export function desktopSuffixChain(os?: string): readonly string[] {
    return os ? ['gtk', os, 'desktop'] : ['gtk', 'desktop'];
}

/**
 * The desktop suffix for the BUILD HOST, or `undefined` for a host outside
 * ADR 0018's target set.
 *
 * The host, not a cross-target: there is no cross-OS desktop build in this chain
 * (ADR 0032's Consequences put macOS and Windows on Node + `@gjsify/node-gi`,
 * whose installable artifact is ADR 0024 stages 4 and 5 and does not exist yet).
 * A future cross-build states its own suffix by passing one to
 * {@link desktopSuffixChain}, which is why the decision function takes the value
 * and only this one function reads the ambient.
 *
 * The ambient read is `process.platform` behind a defaulted parameter — the
 * shape `extractPackageSpec` and `isAbsoluteFsPath` already use in this package.
 * The canonical repo-wide spelling is `@gjsify/utils/core`'s `hostOs()`, and
 * `os-axis.mjs` sanctions infra keeping its own raw read for the purity reason
 * `cli/src/utils/platform-check.ts` documents. Here there is a second, harder
 * reason: `@gjsify/utils` is BUILT BY the CLI this package is part of, so
 * depending on it would make `build:infra` need its own output.
 * `package.json#gjsify.os` on this package already carries the ADR 0018 claim.
 */
export function desktopOsSuffix(platform: string = process.platform): string | undefined {
    return DESKTOP_OS_SUFFIXES[platform];
}

export interface PlatformResolvePluginOptions {
    /**
     * The suffix chain, most specific first. Build it with
     * {@link nativescriptSuffixChain} or {@link desktopSuffixChain} — a
     * hand-written array is a second resolution order the tree does not state.
     */
    suffixes: readonly string[];
    /**
     * Suffixes deliberately NOT resolved, but whose presence on disk is worth
     * saying out loud: {@link DESKTOP_REFUSED_SUFFIXES} for the desktop chain,
     * empty for NativeScript (where `.native` is a real rung). Probed only after
     * the chain found nothing, so an empty list costs zero extra resolves and
     * the NS path is byte-unchanged.
     */
    refusedSuffixes?: readonly string[];
    /**
     * Consult the importer's directory listing before entering the resolver.
     *
     * MEASURED, and the reason this option exists at all. The NativeScript chain
     * runs on one build target; the desktop chain runs on every `--app gjs` and
     * `--app node` build in the repository, and a three-rung chain costs up to
     * six failed `this.resolve` calls per relative import. On this repository's
     * largest bundle (`dist/cli.gjs.mjs`, ~1400 modules) that was 21.9–22.2 s
     * without the plugin against 25.0–26.3 s with it — about +14%, and Rolldown
     * reported the plugin as 49% of all plugin time. Skipping `node_modules`
     * importers recovered under a second of it: the cost is FIRST-PARTY imports,
     * which is exactly the population the feature is for.
     *
     * So the filter is a directory listing, cached per directory: one
     * `readdirSync` answers every suffix for every import in that directory, and
     * the resolver is entered only for a candidate that has a matching sibling.
     * Same bundle, 22.0–22.8 s and 25% of plugin time — the surcharge is gone and
     * the plugin now sits alongside its four siblings instead of ahead of them.
     * The listing is a FILTER and never an answer — a directory it cannot read
     * (a virtual importer id, a `\0`-prefixed module) falls straight through to
     * the resolver, and names are compared lowercased so a case-insensitive
     * filesystem can only make the filter more permissive, never less.
     *
     * OFF for NativeScript, deliberately: `@nativescript/core` ships
     * `.android`/`.ios` siblings and imports them relatively, and the mandate on
     * that chain is byte-identical behaviour — a filter that another plugin's
     * virtual `resolveId` could see past is not something to switch on there
     * without a measurement of that tree.
     */
    siblingIndex?: boolean;
}

/** Thrown when a variant is on disk but the resolver hands it back as external. */
export class PlatformVariantExternalError extends Error {
    override readonly name = 'PlatformVariantExternalError';
    constructor(
        readonly candidate: string,
        readonly importer: string,
    ) {
        super(
            `gjsify platform resolve: "${candidate}" (imported by ${importer}) resolved to an EXTERNAL id, ` +
                `so the platform fork cannot be bundled. A platform variant is first-party source by ` +
                `construction — it is a sibling file — so an externals pattern or a user --external is ` +
                `claiming it. Narrow that pattern, or rename the variant.`,
        );
    }
}

/**
 * Resolve platform-specific source-file variants ahead of the base file.
 *
 * Relative imports only — bare/package specifiers are left to the normal
 * resolver chain (package platform-`main` fields are a separate, rarer concern
 * handled by the alias layer).
 */
export function platformResolvePlugin(options: PlatformResolvePluginOptions): Plugin {
    const suffixes = options.suffixes;
    if (suffixes.length === 0) {
        // A caller meaning "no platform forks" composes no plugin at all. An
        // EMPTY chain is one that was computed and came out empty — the shape a
        // mis-wired orchestrator has — and it would send every import to base
        // while looking installed.
        throw new Error(
            'gjsify platform resolve: the suffix chain is empty. Pass nativescriptSuffixChain(…) or ' +
                'desktopSuffixChain(…), or omit the plugin.',
        );
    }
    const refused = options.refusedSuffixes ?? [];
    const useIndex = options.siblingIndex ?? false;
    // Per-directory listing cache, lowercased. `null` marks a directory that
    // could not be read, which means "no opinion" — the resolver decides.
    const listings = new Map<string, ReadonlySet<string> | null>();
    const listingFor = (dir: string): ReadonlySet<string> | null => {
        const cached = listings.get(dir);
        if (cached !== undefined) return cached;
        let entries: ReadonlySet<string> | null;
        try {
            entries = new Set(readdirSync(dir).map((name) => name.toLowerCase()));
        } catch {
            // An unreadable directory is the normal case for a virtual importer
            // id, not an error worth reporting: the resolver still gets asked.
            entries = null;
        }
        listings.set(dir, entries);
        return entries;
    };
    /** Could a `<stem>.<suffix>` sibling exist in `dir`? A file OR a directory. */
    const hasSibling = (entries: ReadonlySet<string>, stem: string, suffix: string): boolean => {
        const name = `${stem}.${suffix}`.toLowerCase();
        if (entries.has(name)) return true;
        for (const entry of entries) {
            if (entry.startsWith(`${name}.`)) return true;
        }
        return false;
    };
    // One warning per resolved variant id, not per import site: a shared module
    // reached from twenty files would print twenty identical lines and train the
    // reader to skip them.
    const warned = new Set<string>();

    return {
        name: 'gjsify-platform-resolve',
        resolveId: {
            order: 'pre' as const,
            async handler(source, importer, extraOptions) {
                // Only relative source imports get platform variants.
                if (!importer) return null;
                if (!source.startsWith('./') && !source.startsWith('../')) return null;

                const extMatch = KNOWN_EXT_RE.exec(source);
                const origExt = extMatch ? extMatch[0] : '';
                const base = origExt ? source.slice(0, -origExt.length) : source;
                const kind = extraOptions?.kind ? { kind: extraOptions.kind } : {};

                // The filter, only when the caller asked for it — the NS path does
                // not even resolve the sibling directory. `null` = no opinion.
                let entries: ReadonlySet<string> | null = null;
                let stem = '';
                if (useIndex) {
                    const target = resolvePath(dirname(importer), base);
                    entries = listingFor(dirname(target));
                    stem = basename(target);
                }
                const worthProbing = (suffix: string) => entries === null || hasSibling(entries, stem, suffix);

                // `skipSelf: true` re-runs the resolver chain WITHOUT this
                // plugin → no recursion on the nested resolve.
                const tryResolve = (candidate: string) =>
                    this.resolve(candidate, importer, { skipSelf: true, ...kind });

                for (const suffix of suffixes) {
                    if (!worthProbing(suffix)) continue;
                    // Try the bare form first (the resolver extension-probes,
                    // so `./foo.android` finds `./foo.android.ts`), then the
                    // extension-preserving form as a fallback.
                    const candidates =
                        origExt && `${base}.${suffix}` !== `${base}.${suffix}${origExt}`
                            ? [`${base}.${suffix}`, `${base}.${suffix}${origExt}`]
                            : [`${base}.${suffix}`];

                    for (const candidate of candidates) {
                        if (candidate === source) continue;
                        const resolved = await tryResolve(candidate);
                        if (!resolved) continue;
                        // An external variant is NOT a miss to walk past: the
                        // file is there and the author expects it in the bundle.
                        if (resolved.external) throw new PlatformVariantExternalError(candidate, importer);
                        return resolved;
                    }
                }

                // No variant on disk → the default chain resolves the base. Say
                // so when a REFUSED sibling exists: § 9 wants the fall-through,
                // not the silence around it.
                for (const suffix of refused) {
                    if (!worthProbing(suffix)) continue;
                    const probe = await tryResolve(`${base}.${suffix}`);
                    if (!probe || warned.has(probe.id)) continue;
                    warned.add(probe.id);
                    this.warn(
                        `gjsify platform resolve: "${base}.${suffix}" exists but is NOT a rung of this ` +
                            `target's chain (${suffixes.join(' → ')} → base), so ${importer} gets the base ` +
                            `file. ADR 0032 § 9: a .${suffix} variant is written for a runtime this build ` +
                            `is not, and reaching for it would hand this target code whose failure only ` +
                            `shows up on screen. Move what applies here into a .${suffixes[0]} or ` +
                            `.desktop variant.`,
                    );
                }

                return null;
            },
        },
    };
}

/**
 * Best-effort detection of the NativeScript target platform from the
 * environment NS' CLI sets when it spawns a bundler (`NATIVESCRIPT_BUNDLER_ENV`
 * / `NATIVESCRIPT_WEBPACK_ENV` carry the platform; `NATIVESCRIPT_PLATFORM` is
 * an explicit override). Returns `undefined` when no platform is discernible —
 * callers then fall back to `.native`-only resolution + neutral defines.
 */
export function detectNativescriptPlatform(
    env: Record<string, string | undefined> = process.env,
): NativescriptPlatform | undefined {
    const direct = env.NATIVESCRIPT_PLATFORM ?? env.NS_PLATFORM;
    if (direct && isPlatform(direct)) return direct;

    const raw = env.NATIVESCRIPT_BUNDLER_ENV ?? env.NATIVESCRIPT_WEBPACK_ENV;
    if (raw) {
        try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            // NS' webpack/vite env historically uses `{ android: true }` /
            // `{ ios: true }` booleans; newer paths may pass `platform`.
            if (parsed.android === true) return 'android';
            if (parsed.ios === true) return 'ios';
            if (parsed.visionos === true) return 'visionos';
            if (typeof parsed.platform === 'string' && isPlatform(parsed.platform)) {
                return parsed.platform;
            }
        } catch {
            // Malformed env JSON → undefined (native-only fallback).
        }
    }
    return undefined;
}

/**
 * The standard NativeScript compile-time platform flags, matching the globals
 * `@nativescript/vite` seeds in its main entry (`__ANDROID__` / `__IOS__` /
 * `__APPLE__` / `__VISIONOS__` / `__DEV__`). Fed into the bundler's
 * `transform.define` (Rolldown) / `define` (Vite) so NS app code branching on
 * these constants is statically resolved + dead-code-eliminated per target.
 */
export function nativescriptPlatformDefines(
    platform: NativescriptPlatform | undefined,
    opts: { dev?: boolean } = {},
): Record<string, string> {
    const isAndroid = platform === 'android';
    const isIos = platform === 'ios';
    const isVisionOs = platform === 'visionos';
    return {
        __ANDROID__: String(isAndroid),
        __IOS__: String(isIos),
        __VISIONOS__: String(isVisionOs),
        __APPLE__: String(isIos || isVisionOs),
        __DEV__: String(opts.dev ?? false),
    };
}
