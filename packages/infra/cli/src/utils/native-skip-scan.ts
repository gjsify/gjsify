// Scan for files the native oxfmt (GJS) cannot format.
//
// `@gjsify/oxfmt-native` wraps oxfmt's pure-Rust CLI core, which covers
// JS/TS/JSX only. Embedded CSS/HTML/Vue/Markdown formatting needs oxfmt's
// Node-API Prettier host — unavailable under GJS. Without this scan those
// files are skipped SILENTLY: `gjsify format --check` exits 0 under GJS
// (green check that checked nothing) but fails under Node in CI.
//
// The scan walks the given paths, collects files with extensions the native
// formatter cannot handle, and reports them so the user knows the check was
// partial.

import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

/**
 * Extensions the native oxfmt (GJS) cannot format.
 *
 * These require oxfmt's Node-API Prettier host (CSS/HTML/Vue/Markdown
 * embedded in JS/TS files, or standalone). The native bridge wraps only the
 * pure-Rust oxfmt CLI core.
 */
export const NATIVE_SKIP_EXTENSIONS = new Set([
    '.css',
    '.html',
    '.htm',
    '.vue',
    '.md',
    '.markdown',
    '.scss',
    '.sass',
    '.less',
]);

export interface NativeSkipScanResult {
    /** Files the native formatter will silently skip. */
    skipped: string[];
    /** Total files examined. */
    total: number;
}

/**
 * Walk paths and collect files whose extension the native oxfmt cannot
 * format. Directories are walked recursively. Symlinks are not followed.
 */
export function scanForNativeSkips(
    paths: string[],
    cwd: string = process.cwd(),
): NativeSkipScanResult {
    const skipped: string[] = [];
    let total = 0;

    const walk = (dir: string): void => {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile()) {
                total++;
                const ext = extname(entry.name).toLowerCase();
                if (NATIVE_SKIP_EXTENSIONS.has(ext)) {
                    skipped.push(full);
                }
            }
        }
    };

    for (const p of paths) {
        const abs = join(cwd, p);
        let st;
        try {
            st = statSync(abs);
        } catch {
            continue;
        }
        if (st.isDirectory()) {
            walk(abs);
        } else if (st.isFile()) {
            total++;
            const ext = extname(p).toLowerCase();
            if (NATIVE_SKIP_EXTENSIONS.has(ext)) {
                skipped.push(abs);
            }
        }
    }

    return { skipped, total };
}
