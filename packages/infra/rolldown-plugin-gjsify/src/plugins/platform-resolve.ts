// NativeScript / React-Native-style platform file resolution.
//
// Lets a shared codebase fork a single module per target platform by file
// name — `foo.android.ts` / `foo.ios.ts` (platform-specific) or `foo.native.ts`
// (any native platform, as opposed to the browser's `foo.ts`). An
// `import './foo'` (or `import './foo.js'`) resolves to the most specific
// variant that exists, in priority order:
//
//   ./foo.<platform>.<ext>   (e.g. ./foo.android.ts) — when a platform is known
//   ./foo.native.<ext>       — native-but-not-browser
//   ./foo.<ext>              — the base file (default resolver fallthrough)
//
// WHY THIS LIVES IN GJSIFY (not just a dependency on @nativescript/vite):
// `@nativescript/vite` implements the same lookup as a Vite `resolve.alias`
// whose `replacement` is a FUNCTION. Vite 8 / Rolldown rejects function
// replacements on the native alias path (`Failed to convert builtin plugin
// 'ViteAlias' … function replacement into rust type String`), which breaks the
// NS production build under Vite 8. Implemented here as a proper `resolveId`
// plugin HOOK (not a `resolve.alias`), it works identically under Rolldown
// (the `gjsify build --app nativescript` CLI) AND under Vite 7/8 (the
// `gjsifyNativescript()` preset) — the function-alias limitation only affects
// the `resolve.alias` config shorthand, not plugin `resolveId` hooks.
//
// Reference: @nativescript/vite `helpers/package-platform-aliases.js`. Original
// Copyright (c) NativeScript contributors, Apache-2.0. Reimplemented for the
// gjsify Rolldown/Vite plugin pipeline.

import type { Plugin } from 'rolldown';

export type NativescriptPlatform = 'android' | 'ios' | 'visionos';

const PLATFORMS: readonly NativescriptPlatform[] = ['android', 'ios', 'visionos'];

// JS/TS extensions a source specifier may carry. Stripped so the platform
// suffix lands BEFORE the extension (`./foo.js` → `./foo.android`).
const KNOWN_EXT_RE = /\.(tsx?|jsx?|mts|cts|mjs|cjs)$/;

function isPlatform(value: string): value is NativescriptPlatform {
    return (PLATFORMS as readonly string[]).includes(value);
}

export interface PlatformResolvePluginOptions {
    /**
     * Target platform. When omitted, only `.native.*` variants are tried
     * (the platform-specific `.android.*` / `.ios.*` lookups are skipped).
     */
    platform?: NativescriptPlatform;
}

/**
 * Resolve platform-specific source-file variants (`*.android` / `*.ios` /
 * `*.native`) ahead of the base file. Relative imports only — bare/package
 * specifiers are left to the normal resolver chain (package platform-`main`
 * fields are a separate, rarer concern handled by the alias layer).
 */
export function platformResolvePlugin(options: PlatformResolvePluginOptions = {}): Plugin {
    const platform = options.platform;
    // Priority: platform-specific suffix first, then the platform-agnostic
    // `native` suffix. Without a known platform, only `native` applies.
    const suffixes = platform ? [platform, 'native'] : ['native'];

    return {
        name: 'gjsify-nativescript-platform-resolve',
        resolveId: {
            order: 'pre' as const,
            async handler(source, importer, extraOptions) {
                // Only relative source imports get platform variants.
                if (!importer) return null;
                if (!source.startsWith('./') && !source.startsWith('../')) return null;

                const extMatch = KNOWN_EXT_RE.exec(source);
                const origExt = extMatch ? extMatch[0] : '';
                const base = origExt ? source.slice(0, -origExt.length) : source;

                for (const suffix of suffixes) {
                    // Try the bare form first (the resolver extension-probes,
                    // so `./foo.android` finds `./foo.android.ts`), then the
                    // extension-preserving form as a fallback.
                    const candidates =
                        origExt && `${base}.${suffix}` !== `${base}.${suffix}${origExt}`
                            ? [`${base}.${suffix}`, `${base}.${suffix}${origExt}`]
                            : [`${base}.${suffix}`];

                    for (const candidate of candidates) {
                        if (candidate === source) continue;
                        // `skipSelf: true` re-runs the resolver chain WITHOUT
                        // this plugin → no recursion on the nested resolve.
                        const resolved = await this.resolve(candidate, importer, {
                            skipSelf: true,
                            ...(extraOptions?.kind ? { kind: extraOptions.kind } : {}),
                        });
                        if (resolved && !resolved.external) return resolved;
                    }
                }

                // No variant on disk → let the default chain resolve the base.
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
