import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { SitePrivacyConfig } from './types.js';

/**
 * Reads every language's statement file, verbatim — never parsed beyond what the renderer's
 * Markdown subset does at render time, never translated by this package. A file that cannot be
 * read fails the build naming the language and the configured path, the same way a missing
 * `gjsify.site.metainfo` does.
 */
export async function loadPrivacyStatements(privacy: SitePrivacyConfig, root: string): Promise<Record<string, string>> {
    const entries = await Promise.all(
        Object.entries(privacy.statements).map(async ([lang, path]) => {
            const file = resolve(root, path);
            try {
                return [lang, await readFile(file, 'utf8')] as const;
            } catch (cause) {
                throw new Error(`gjsify.site.privacy.statements.${lang} points to "${path}", which could not be read`, {
                    cause,
                });
            }
        }),
    );
    return Object.fromEntries(entries);
}
