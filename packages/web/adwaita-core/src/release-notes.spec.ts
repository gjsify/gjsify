// The release-notes buffer of the core against the shared vectors, through a stand-in
// dialog that rebuilds the buffer from the two release-notes setters only, as the C does.

import { describe, expect, it } from '@gjsify/unit';

import { RELEASE_NOTES_VECTORS, driveReleaseNotesVectors } from './conformance/about-dialog-doors.js';
import type { AboutDialogDoorLike } from './conformance/about-dialog-doors.js';
import { RELEASE_NOTES_LABELS, releaseNotesBuffer, type ReleaseNotesSegment } from './release-notes.js';

class NotesDialog implements AboutDialogDoorLike {
    segments: ReleaseNotesSegment[] = [];
    version = '';
    debugInfo = '';
    website = '';
    comments = '';
    private _releaseNotes = '';
    private _releaseNotesVersion = '';

    get releaseNotes(): string {
        return this._releaseNotes;
    }

    set releaseNotes(value: string) {
        this._releaseNotes = value;
        this._update();
    }

    get releaseNotesVersion(): string {
        return this._releaseNotesVersion;
    }

    set releaseNotesVersion(value: string) {
        this._releaseNotesVersion = value;
        this._update();
    }

    add_link(): void {}

    private _update(): void {
        this.segments = releaseNotesBuffer(this).segments;
    }
}

export default async () => {
    await driveReleaseNotesVectors(
        {
            name: 'adwaita-core',
            isOracle: false,
            labels: { ...RELEASE_NOTES_LABELS, websiteRow: 'Website' },
            isGLibUntranslated: true,
            makeDialog: () => new NotesDialog(),
            whatsNew: (dialog) => (dialog as NotesDialog).segments,
            isRowVisible: () => false,
            debugInfoText: () => '',
            linkTitles: () => [],
            dispose() {},
        },
        { describe, it, expect },
        RELEASE_NOTES_VECTORS,
    );

    await describe('adwaita-core: releaseNotesBuffer', async () => {
        await it('gives empty notes an empty buffer, heading or not', () => {
            expect(JSON.stringify(releaseNotesBuffer({ releaseNotes: '', version: '1.0' }))).toBe(
                JSON.stringify({ segments: [], error: null }),
            );
        });

        await it('reports the error position apart from the text', () => {
            expect(JSON.stringify(releaseNotesBuffer({ releaseNotes: '<p>\n<b>' }).error)).toBe(
                JSON.stringify({ message: "Unexpected element 'b'", line: 2, character: 5 }),
            );
        });

        await it('builds the heading and error from the labels it is given', () => {
            const labels = { releaseNotesHeading: 'V%s', releaseNotesError: 'E', releaseNotesErrorPosition: '%d/%d' };
            expect(
                JSON.stringify(releaseNotesBuffer({ releaseNotes: '<p>a</p>', version: '1' }, labels).segments),
            ).toBe(
                JSON.stringify([
                    { text: 'V1', tag: 'heading' },
                    { text: '\na', tag: null },
                ]),
            );
            expect(releaseNotesBuffer({ releaseNotes: '<x/>' }, labels).segments[0]!.text).toBe(
                "E\nUnexpected element 'x'\n1/4",
            );
        });
    });
};
