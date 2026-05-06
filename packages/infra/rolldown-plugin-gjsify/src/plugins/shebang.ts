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
