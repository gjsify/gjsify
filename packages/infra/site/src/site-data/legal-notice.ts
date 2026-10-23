import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { SiteLegalNoticeConfig } from './types.js';

/**
 * Reads every language's Legal Notice / Impressum statement, verbatim — the same contract as
 * `loadPrivacyStatements`. A file that cannot be read fails the build naming the language and the
 * configured path.
 */
export async function loadLegalNoticeStatements(
    legalNotice: SiteLegalNoticeConfig,
    root: string,
): Promise<Record<string, string>> {
    const entries = await Promise.all(
        Object.entries(legalNotice.statements).map(async ([lang, path]) => {
            const file = resolve(root, path);
            try {
                return [lang, await readFile(file, 'utf8')] as const;
            } catch (cause) {
                throw new Error(
                    `gjsify.site.legalNotice.statements.${lang} points to "${path}", which could not be read`,
                    { cause },
                );
            }
        }),
    );
    return Object.fromEntries(entries);
}
