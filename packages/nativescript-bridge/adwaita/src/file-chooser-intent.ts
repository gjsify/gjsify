// What an Android Storage Access Framework intent carries for one `Gtk.FileDialog` request (ADR 0100
// § 2). Pure, so the mapping is specced without an Android runtime; `./file-chooser-source.android.ts`
// turns it into the real `Intent`.
//
// ANDROID FILTERS BY MIME TYPE. `ACTION_OPEN_DOCUMENT` takes MIME types only, and an `.asm` file has
// no registered one. So a filter that names only extensions, or accepts every file, opens `*/*`: the
// filter is a hint and any pick is accepted, the native Android convention. GTK lets the user switch
// between the filters; SAF has no switch, so the union of what they allow is what opens.

import type { FileChooserRequest } from '@gjsify/adwaita-core';

export interface SafIntentSpec {
    readonly action: 'ACTION_OPEN_DOCUMENT' | 'ACTION_CREATE_DOCUMENT';
    /** `Intent.setType`: one MIME type, or `*\/*`. */
    readonly type: string;
    /** `Intent.EXTRA_MIME_TYPES`, set only when more than one MIME type narrows the open. */
    readonly extraMimeTypes: readonly string[] | null;
    /** `Intent.EXTRA_TITLE`: the suggested name of a new document; open has none. */
    readonly title: string | null;
}

/** The type a new document is created with when no filter names one: it claims nothing about the content. */
export const SAF_UNTYPED = 'application/octet-stream';

export function safIntentSpec(kind: 'open' | 'save', request: FileChooserRequest): SafIntentSpec {
    if (kind === 'save') {
        const filter = request.defaultFilter ?? request.filters.find((spec) => spec.mimeTypes.length > 0) ?? null;
        return {
            action: 'ACTION_CREATE_DOCUMENT',
            type: filter?.mimeTypes[0] ?? SAF_UNTYPED,
            extraMimeTypes: null,
            title: request.initialName,
        };
    }
    const open = { action: 'ACTION_OPEN_DOCUMENT', title: null } as const;
    const hintOnly = request.filters.some(
        (spec) => spec.acceptAll || spec.mimeTypes.length === 0 || spec.mimeTypes.includes('*/*'),
    );
    const mimeTypes = [...new Set(request.filters.flatMap((spec) => spec.mimeTypes))];
    if (hintOnly || mimeTypes.length === 0) return { ...open, type: '*/*', extraMimeTypes: null };
    if (mimeTypes.length === 1) return { ...open, type: mimeTypes[0], extraMimeTypes: null };
    return { ...open, type: '*/*', extraMimeTypes: mimeTypes };
}
