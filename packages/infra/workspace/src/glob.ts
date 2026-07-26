// The minimal glob dialect the workspace patterns need: `*` within a single
// path segment, expanded against the on-disk tree. Internal to the package.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function expandPattern(root: string, pattern: string): string[] {
    // Only the limited form yarn projects use in practice:
    //   `<segment>/*`           → all immediate children of segment
    //   `<segment>`             → single literal path
    //   `<segment>/*/*`         → two levels (`packages/infra/*`)
    // Any deeper nesting is rejected — there's no recursive `**` in our
    // monorepo or ts-for-gir's, so we don't accept it.
    const segments = pattern.split('/').filter(Boolean);
    let current: string[] = [resolve(root)];
    for (const seg of segments) {
        const next: string[] = [];
        for (const dir of current) {
            if (seg === '*') {
                let entries: string[] = [];
                try {
                    entries = readdirSync(dir);
                } catch {
                    continue;
                }
                for (const entry of entries) {
                    if (entry.startsWith('.')) continue;
                    const candidate = join(dir, entry);
                    try {
                        if (statSync(candidate).isDirectory()) next.push(candidate);
                    } catch {
                        /* dead symlink etc. */
                    }
                }
            } else if (seg.includes('*')) {
                // `pkg-*` style pattern: glob within a single segment.
                const re = globToRegex(seg);
                let entries: string[] = [];
                try {
                    entries = readdirSync(dir);
                } catch {
                    continue;
                }
                for (const entry of entries) {
                    if (entry.startsWith('.')) continue;
                    if (!re.test(entry)) continue;
                    const candidate = join(dir, entry);
                    try {
                        if (statSync(candidate).isDirectory()) next.push(candidate);
                    } catch {
                        /* skip */
                    }
                }
            } else {
                const candidate = join(dir, seg);
                if (existsSync(candidate)) {
                    try {
                        if (statSync(candidate).isDirectory()) next.push(candidate);
                    } catch {
                        /* skip */
                    }
                }
            }
        }
        current = next;
    }
    return current;
}

export function globToRegex(pattern: string): RegExp {
    // Escape regex specials EXCEPT `*`, then map `*` → `[^/]*`.
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    return new RegExp(`^${escaped}$`);
}
