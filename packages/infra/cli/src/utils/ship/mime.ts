// Defining a file type for the system — the half `MimeType=` cannot do on its own.
//
// A desktop entry's `MimeType=` says "I open this type". It does NOT say the type EXISTS. For a
// standard type that is fine, because the distribution's shared-mime-info already defines it; for a
// type of the project's own it is not, and the failure is the quietest kind there is: nothing knows
// what a `.bauplan` file is, so the file manager never assigns the type, `MimeType=` matches
// nothing, and a double-click does nothing at all. No error is printed and no log line is written —
// the association simply never fires, which is indistinguishable from "the app is not installed".
//
// So a project that invents a type also ships a shared-mime-info document, and the package refreshes
// the MIME cache on install (see `scripts.ts`) — an unrefreshed cache is the same silence again.

import type { ShipMimeType } from './types.js';

/** XML text escaping. Only the five that matter in element content and attributes. */
function esc(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

const TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

/**
 * Validate the declared types, throwing on anything that would install and then not work.
 *
 * Each refusal is a silent failure made loud:
 *  - a malformed type name is written into the XML and ignored by `update-mime-database`;
 *  - a glob without `*.` never matches (`bauplan` matches only a file called exactly that);
 *  - a type with no glob and no parent type can never be DETECTED, so it is registered and unused;
 *  - a duplicate definition makes which comment wins depend on document order.
 */
export function validateMimeTypes(types: readonly ShipMimeType[]): void {
    const seen = new Set<string>();
    for (const entry of types) {
        if (!TYPE_RE.test(entry.type)) {
            throw new Error(
                `gjsify ship: \`gjsify.ship.mimeTypes\` has an invalid type "${entry.type}". ` +
                    'Expected `<media>/<subtype>`, e.g. `application/x-bauplan` — update-mime-database ' +
                    'ignores a malformed name, so the type would install and never resolve.',
            );
        }
        if (seen.has(entry.type)) {
            throw new Error(
                `gjsify ship: \`gjsify.ship.mimeTypes\` defines ${entry.type} twice. ` +
                    'Which comment and glob set win would depend on document order.',
            );
        }
        seen.add(entry.type);
        if (entry.comment.trim() === '') {
            throw new Error(
                `gjsify ship: ${entry.type} has an empty \`comment\`. A file manager then shows the ` +
                    'user the raw type string instead of a name.',
            );
        }
        for (const glob of entry.globs ?? []) {
            if (!glob.includes('*') && !glob.includes('?') && !glob.includes('[')) {
                throw new Error(
                    `gjsify ship: ${entry.type} has the glob "${glob}", which matches only a file ` +
                        `named exactly that. A suffix pattern is written \`*.${glob.replace(/^\.+/, '')}\`.`,
                );
            }
        }
        if ((entry.globs ?? []).length === 0 && entry.subClassOf === undefined) {
            throw new Error(
                `gjsify ship: ${entry.type} declares neither \`globs\` nor \`subClassOf\`, so nothing ` +
                    'can ever match it. The type would be registered and then never assigned to a file.',
            );
        }
    }
}

/**
 * The shared-mime-info document for `types`.
 *
 * One file per package, named after the app id, because `share/mime/packages/` is shared: a generic
 * name is a collision with whatever another package put there — the same reason the schema staging
 * uses the app id.
 */
export function renderMimePackage(types: readonly ShipMimeType[]): string {
    const body = types
        .map((entry) => {
            const lines = [`  <mime-type type="${esc(entry.type)}">`, `    <comment>${esc(entry.comment)}</comment>`];
            if (entry.subClassOf !== undefined) {
                lines.push(`    <sub-class-of type="${esc(entry.subClassOf)}"/>`);
            }
            for (const glob of entry.globs ?? []) {
                lines.push(`    <glob pattern="${esc(glob)}"/>`);
            }
            if (entry.genericIcon !== undefined) {
                lines.push(`    <generic-icon name="${esc(entry.genericIcon)}"/>`);
            }
            lines.push('  </mime-type>');
            return lines.join('\n');
        })
        .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
${body}
</mime-info>
`;
}
