// Inject a `#!/usr/bin/env -S gjs -m` shebang at byte 0 of entry chunks.
//
// Rolldown's `output.banner` would also work, but a renderChunk hook with
// `order: 'post'` makes ordering declarative — the shebang lands AFTER all
// other banner / process-stub plugins have run, which is required because
// the `#` character is only valid as the very first byte of the file under
// SpiderMonkey 128+.

import type { Plugin } from 'rolldown';

export const GJS_SHEBANG = '#!/usr/bin/env -S gjs -m';

export interface ShebangPluginOptions {
    enabled?: boolean;
    /** Override the shebang line. Defaults to `GJS_SHEBANG`. */
    line?: string;
}

export function shebangPlugin(options: ShebangPluginOptions = {}): Plugin | null {
    if (!options.enabled) return null;
    const line = options.line ?? GJS_SHEBANG;
    return {
        name: 'gjsify-shebang',
        renderChunk: {
            order: 'post' as const,
            handler(code, chunk) {
                if (!chunk.isEntry) return null;
                if (code.startsWith('#!')) return null;
                return { code: line + '\n' + code, map: null };
            },
        },
    };
}

/**
 * Expand `${env:NAME}` and `${env:NAME:-default}` placeholders against
 * `process.env`. Missing without default → `''`. Used to let the shebang
 * config field reference build-time env vars (e.g. `GJS_CONSOLE` set by
 * meson-driven Flatpak builds where the GJS interpreter lives at
 * `/usr/bin/gjs-console`).
 */
export function expandEnvTemplate(input: string, env: Record<string, string | undefined> = process.env): string {
    return input.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_match, name: string, fallback?: string) => {
        const value = env[name];
        if (value !== undefined && value !== '') return value;
        return fallback ?? '';
    });
}

/**
 * Normalize the user-facing `shebang` config value into the literal line
 * that should be prepended to the bundle (without trailing newline), or
 * `null` when shebang injection is disabled.
 *
 *   `true`            → default GJS shebang
 *   `false|undefined` → null (disabled)
 *   `"…"`             → string with `${env:NAME[:-default]}` expanded
 *
 * If the resolved string does not start with `#!`, it is prefixed
 * automatically so users can write `"shebang": "/usr/bin/gjs -m"` instead
 * of `"#!/usr/bin/gjs -m"`.
 */
export function resolveShebangLine(value: boolean | string | undefined): string | null {
    if (value === undefined || value === false) return null;
    if (value === true) return GJS_SHEBANG;
    const expanded = expandEnvTemplate(value);
    if (!expanded.trim()) return null;
    return expanded.startsWith('#!') ? expanded : '#!' + expanded;
}
