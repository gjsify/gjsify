// `gjsify webext submit --store amo --listing-only`: send the texts `webext listing` wrote to AMO's
// listing endpoints, then report per field what a READ-BACK found (the publish-readback.ts rule:
// never claim what was not read). `--dry-run` prints lengths per field and locale and touches
// neither credentials nor network.

import { resolve } from 'node:path';

import { readAmoListing } from './stores/amo-listing.js';
import type { StoreBackend, StoreListingInput } from './stores/index.js';

export interface ListingUploadInput {
    readonly listingRoot: string;
    readonly dryRun: boolean;
    /** Send the reviewer notes to this version (id or number); without it they are not sent. */
    readonly notesVersion?: string;
    /** Called only for a real send, so a dry run never builds a backend or reads credentials. */
    readonly backend: () => StoreBackend;
    readonly out: (line: string) => void;
}

/** Returns the exit code: 0 only when every field was read back and matches. */
export async function runListingUpload(input: ListingUploadInput): Promise<number> {
    const files = readAmoListing(resolve(input.listingRoot));
    const { approvalNotesText, ...texts } = files.input;
    if (input.notesVersion !== undefined && approvalNotesText === undefined) {
        throw new Error('--notes-version is set but no amo/<lang>/reviewer-notes.txt exists.');
    }
    const listing: StoreListingInput = {
        ...texts,
        ...(input.notesVersion !== undefined && approvalNotesText !== undefined
            ? { approvalNotes: { version: input.notesVersion, text: approvalNotesText } }
            : {}),
    };

    if (input.dryRun) {
        input.out('addons.mozilla.org listing: dry run — nothing is sent, no request is made.');
        const lines = (field: string, values: Readonly<Record<string, string>>): void => {
            for (const [locale, text] of Object.entries(values)) {
                input.out(`  would send ${field} [${locale}]: ${text.length} chars`);
            }
        };
        lines('description', listing.description);
        if (listing.privacyPolicy !== undefined) lines('privacy_policy (eula_policy)', listing.privacyPolicy);
        if (listing.approvalNotes !== undefined) {
            input.out(
                `  would send approval_notes (version ${listing.approvalNotes.version}): ${listing.approvalNotes.text.length} chars`,
            );
        }
        input.out(
            '  name and summary are never sent: AMO takes the name from the manifest, and the store summary is the manifest description.',
        );
        return 0;
    }

    const backend = input.backend();
    if (backend.updateListing === undefined) {
        throw new Error('this store has no listing API; only AMO takes listing texts.');
    }
    const result = await backend.updateListing(listing);
    let failed = 0;
    for (const f of result.fields) {
        if (f.verdict !== 'match') failed += 1;
        input.out(`  ${f.field}${f.locale === undefined ? '' : ` [${f.locale}]`}: ${f.verdict} — ${f.detail}`);
    }
    input.out(
        failed === 0
            ? `addons.mozilla.org listing: ${result.fields.length} field(s) written and read back, all match.`
            : `addons.mozilla.org listing: ${failed} of ${result.fields.length} field(s) NOT confirmed by the read-back.`,
    );
    return failed === 0 ? 0 : 1;
}
