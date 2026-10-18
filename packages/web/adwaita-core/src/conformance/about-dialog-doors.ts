// The `Adw.AboutDialog` doors a GJS app fills its What's New, Troubleshooting and Details
// pages through — the `release-notes`, `release-notes-version` and `debug-info` properties
// and `add_link (title, url)` — against what each page then shows. The SAME vectors run on
// real `gi://Adw` (the ORACLE: a vector that fails there is wrong, never a port bug) and on
// each port.
//
// `RELEASE_NOTES_VECTORS` hold the What's New buffer: the AppStream markup in, the tagged
// runs out, or the GMarkup error the page prints instead. Positions count UTF-8 bytes,
// as GMarkup does. A subject hands over its own labels, so the oracle runs in any locale;
// a GLib scanner message (`Error on line …`) is compared only where the subject says GLib's
// catalogue is untranslated, while the handler messages from libadwaita never are.
//
// Reference: refs/libadwaita/src/adw-about-dialog.c (update_release_notes :1000,
// adw_about_dialog_add_link :2782, adw_about_dialog_set_debug_info :2845)
// Reference: refs/libadwaita/src/adw-about-dialog.ui (the whatsnew/troubleshooting/debuginfo pages)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { ConstructHarness } from './constructs.js';
import type { ReleaseNotesLabels, ReleaseNotesSegment, ReleaseNotesTag } from '../release-notes.js';

export interface AboutDialogDoorLike {
    releaseNotes: string;
    releaseNotesVersion: string;
    version: string;
    debugInfo: string;
    website: string;
    comments: string;
    add_link(title: string, url: string): void;
}

/** The labels a subject draws, in its own locale. */
export interface AboutDialogDoorLabels extends ReleaseNotesLabels {
    /** The Details-page website row, mnemonic stripped. */
    websiteRow: string;
}

export type AboutDialogDoorRow = 'whatsNewRow' | 'detailsRow' | 'troubleshootingRow';

export interface AboutDialogDoorSubject {
    readonly name: string;
    readonly isOracle: boolean;
    readonly labels: AboutDialogDoorLabels;
    /** Whether GLib's own messages are the English msgids here. */
    readonly isGLibUntranslated: boolean;
    makeDialog(): AboutDialogDoorLike;
    /** The What's New buffer as runs, adjacent same-tag runs merged, `section` dropped. */
    whatsNew(dialog: AboutDialogDoorLike): ReleaseNotesSegment[];
    isRowVisible(dialog: AboutDialogDoorLike, row: AboutDialogDoorRow): boolean;
    /** The text of the Debugging Information page. */
    debugInfoText(dialog: AboutDialogDoorLike): string;
    /** The Details-page link rows, in order, mnemonics stripped. */
    linkTitles(dialog: AboutDialogDoorLike): string[];
    dispose(): void;
}

export interface ReleaseNotesVector {
    readonly row: string;
    readonly rule: string;
    readonly releaseNotes: string;
    /** The runs after the `Version 1.0` heading and its `\n`. */
    readonly body?: readonly ReleaseNotesSegment[];
    readonly error?: { readonly message: string; readonly line: number; readonly character: number };
}

const run = (text: string, tag: ReleaseNotesTag = null): ReleaseNotesSegment => ({ text, tag });

export const RELEASE_NOTES_VECTORS: readonly ReleaseNotesVector[] = [
    { row: 'paragraph', rule: 'a paragraph is its text', releaseNotes: '<p>Hello</p>', body: [run('Hello')] },
    {
        row: 'paragraphs',
        rule: 'paragraphs are separated by one newline, the last one is deleted',
        releaseNotes: '<p>One</p><p>Two</p>',
        body: [run('One\nTwo')],
    },
    {
        row: 'collapse',
        rule: 'white space runs collapse to one space and the run is stripped',
        releaseNotes: '<p>  a \n\t b  </p>',
        body: [run('a b')],
    },
    {
        row: 'collapse-unicode',
        rule: 'GRegex \\s is Unicode-aware: U+3000 and U+0085 collapse too',
        releaseNotes: '<p>a\u3000b\u0085c</p>',
        body: [run('a b c')],
    },
    {
        row: 'inline',
        rule: 'em and code are tagged runs, with a space kept from either side',
        releaseNotes: '<p>Use <code>make</code> or <em>not</em>.</p>',
        body: [run('Use '), run('make', 'code'), run(' or '), run('not', 'em'), run('.')],
    },
    {
        row: 'inline-space-only',
        rule: 'a white-space-only run still carries its trailing space to the next one',
        releaseNotes: '<p>a<code> </code>b</p>',
        body: [run('a b')],
    },
    {
        row: 'unordered',
        rule: 'an unordered item is a bullet run, items are separated by a newline',
        releaseNotes: '<ul><li>A</li><li>B</li></ul>',
        body: [run('• ', 'bullet'), run('A\n'), run('• ', 'bullet'), run('B')],
    },
    {
        row: 'ordered',
        rule: 'an ordered item is numbered from 1',
        releaseNotes: '<ol><li>A</li><li>B</li></ol>',
        body: [run('1. ', 'bullet'), run('A\n'), run('2. ', 'bullet'), run('B')],
    },
    {
        row: 'paragraph-then-list',
        rule: 'a list follows a paragraph on the next line',
        releaseNotes: '<p>New:</p>\n<ul>\n  <li>X</li>\n</ul>',
        body: [run('New:\n'), run('• ', 'bullet'), run('X')],
    },
    {
        row: 'list-stray-text',
        rule: 'text directly inside a list, outside an item, is dropped',
        releaseNotes: '<ul> stray <li>A</li></ul>',
        body: [run('• ', 'bullet'), run('A')],
    },
    {
        row: 'empty-paragraph',
        rule: 'an empty paragraph adds no newline',
        releaseNotes: '<p></p><p>X</p>',
        body: [run('X')],
    },
    {
        row: 'entities',
        rule: 'the five XML entities and character references are resolved',
        releaseNotes: '<p>a &amp; b &lt;c&gt; &quot;&apos; &#65;&#x42;</p>',
        body: [run('a & b <c> "\' AB')],
    },
    {
        row: 'tab-reference',
        rule: 'a character reference is collapsed like literal white space',
        releaseNotes: '<p>&#9;b</p>',
        body: [run('b')],
    },
    {
        row: 'comment',
        rule: 'comments and processing instructions are skipped',
        releaseNotes: '<?xml version="1.0"?><!-- c --><p>X</p>',
        body: [run('X')],
    },
    {
        row: 'unexpected-element',
        rule: 'an element outside the AppStream subset is an error at its closing angle',
        releaseNotes: '<p>Hi</p><div>x</div>',
        error: { message: "Unexpected element 'div'", line: 1, character: 15 },
    },
    {
        row: 'nested-paragraph',
        rule: 'a paragraph inside a paragraph is unexpected',
        releaseNotes: '<p><p>',
        error: { message: "Unexpected element 'p'", line: 1, character: 7 },
    },
    {
        row: 'item-outside-list',
        rule: 'a list item outside a list is unexpected',
        releaseNotes: '<li>A</li>',
        error: { message: "Unexpected element 'li'", line: 1, character: 5 },
    },
    {
        row: 'attribute',
        rule: 'any attribute is an error naming the first one',
        releaseNotes: '<p class="x" id="y">Hi</p>',
        error: { message: "attribute 'class' invalid for element 'p'", line: 1, character: 21 },
    },
    {
        row: 'mismatched-close',
        rule: 'a mismatched close tag is a GMarkup error at its closing angle',
        releaseNotes: '<p>Hi</ul>',
        error: {
            message: 'Error on line 1 char 10: Element “ul” was closed, but the currently open element is “p”',
            line: 1,
            character: 10,
        },
    },
    {
        row: 'unclosed',
        rule: 'an element left open is a GMarkup error at the end',
        releaseNotes: '<p>Hi',
        error: {
            message:
                'Error on line 1 char 6: Document ended unexpectedly with elements still open — “p” was the last element opened',
            line: 1,
            character: 6,
        },
    },
    {
        row: 'unknown-entity',
        rule: 'an unknown entity is reported at the angle that ends the text',
        releaseNotes: '<p>&nbsp;</p>',
        error: { message: 'Error on line 1: Entity name “nbsp” is not known', line: 1, character: 10 },
    },
    {
        row: 'position-multiline',
        rule: 'lines count from 1, columns are bytes from the line break',
        releaseNotes: '<p>\nHi\né</q>',
        error: {
            message: 'Error on line 3 char 7: Element “q” was closed, but the currently open element is “p”',
            line: 3,
            character: 7,
        },
    },
    {
        row: 'whitespace-only',
        rule: 'white space alone is an empty document',
        releaseNotes: '  ',
        error: {
            message: 'Error on line 1 char 3: Document was empty or contained only whitespace',
            line: 1,
            character: 3,
        },
    },
];

/** Append a run, merging it into the last one when the tags match. */
function pushRun(runs: ReleaseNotesSegment[], segment: ReleaseNotesSegment): void {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.tag === segment.tag) last.text += segment.text;
    else if (segment.text.length > 0) runs.push({ ...segment });
}

/** `body` behind a `heading` run and its newline, merged the way a buffer merges them. */
function withHeading(heading: string, body: readonly ReleaseNotesSegment[]): ReleaseNotesSegment[] {
    const runs: ReleaseNotesSegment[] = [{ text: heading, tag: 'heading' }];
    if (body.length === 0) return runs;
    pushRun(runs, run('\n'));
    for (const segment of body) pushRun(runs, segment);
    return runs;
}

const heading = (labels: AboutDialogDoorLabels, version: string): string =>
    labels.releaseNotesHeading.replace('%s', version);

export async function driveReleaseNotesVectors(
    subject: AboutDialogDoorSubject,
    harness: ConstructHarness,
    vectors: readonly ReleaseNotesVector[] = RELEASE_NOTES_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    const { labels } = subject;
    await describe(`${subject.name}: Adw.AboutDialog release-notes buffer`, async () => {
        for (const vector of vectors) {
            await it(`${vector.row}: ${vector.rule}`, () => {
                try {
                    const dialog = subject.makeDialog();
                    dialog.version = '1.0';
                    dialog.releaseNotes = vector.releaseNotes;
                    const observed = subject.whatsNew(dialog);
                    if (vector.body !== undefined) {
                        expect(JSON.stringify(observed)).toBe(
                            JSON.stringify(withHeading(heading(labels, '1.0'), vector.body)),
                        );
                        return;
                    }
                    const { message, line, character } = vector.error!;
                    const head = `${labels.releaseNotesError}\n`;
                    const tail = `\n${labels.releaseNotesErrorPosition.replace('%d', String(line)).replace('%d', String(character))}`;
                    const text = observed.length === 1 && observed[0]!.tag === null ? observed[0]!.text : '';
                    const isComparable = subject.isGLibUntranslated || !message.startsWith('Error on line');
                    expect(text.startsWith(head) && text.endsWith(tail)).toBe(true);
                    if (isComparable) expect(text.slice(head.length, text.length - tail.length)).toBe(message);
                } finally {
                    subject.dispose();
                }
            });
        }
    });
}

export interface AboutDialogDoorVector {
    readonly row: string;
    readonly rule: string;
    /** Reads a Details/What's New/Troubleshooting page or a main-page row, which a flat port has not got. */
    readonly isPaged: boolean;
    readonly observe: (subject: AboutDialogDoorSubject) => unknown;
    readonly shows: unknown | ((labels: AboutDialogDoorLabels) => unknown);
}

const NOTES = '<p>Hi</p>';

export const ABOUT_DIALOG_DOOR_VECTORS: readonly AboutDialogDoorVector[] = [
    {
        row: 'defaults',
        rule: 'release-notes, release-notes-version and debug-info default to the empty string',
        isPaged: false,
        observe(s) {
            const d = s.makeDialog();
            return [d.releaseNotes, d.releaseNotesVersion, d.debugInfo];
        },
        shows: ['', '', ''],
    },
    {
        row: 'round-trip',
        rule: 'each property reads back what was set, markup and all',
        isPaged: false,
        observe(s) {
            const d = s.makeDialog();
            d.releaseNotes = '<p>Bad<p>';
            d.releaseNotesVersion = '2.0';
            d.debugInfo = 'GTK 4.20\n';
            return [d.releaseNotes, d.releaseNotesVersion, d.debugInfo];
        },
        shows: ['<p>Bad<p>', '2.0', 'GTK 4.20\n'],
    },
    {
        row: 'whats-new-row',
        rule: 'the What’s New row shows once release notes are set',
        isPaged: true,
        observe(s) {
            const d = s.makeDialog();
            const before = s.isRowVisible(d, 'whatsNewRow');
            d.releaseNotes = NOTES;
            return [before, s.isRowVisible(d, 'whatsNewRow')];
        },
        shows: [false, true],
    },
    {
        row: 'no-version',
        rule: 'with neither version set the buffer has no heading',
        isPaged: true,
        observe(s) {
            const d = s.makeDialog();
            d.releaseNotes = NOTES;
            return s.whatsNew(d);
        },
        shows: [run('Hi')],
    },
    {
        row: 'release-notes-version-wins',
        rule: 'release-notes-version names the heading over version',
        isPaged: true,
        observe(s) {
            const d = s.makeDialog();
            d.version = '1.0';
            d.releaseNotesVersion = '2.0';
            d.releaseNotes = NOTES;
            return s.whatsNew(d);
        },
        shows: (labels: AboutDialogDoorLabels) => [run(heading(labels, '2.0'), 'heading'), run('\nHi')],
    },
    {
        row: 'release-notes-version-rebuilds',
        rule: 'setting release-notes-version after the notes rebuilds the heading',
        isPaged: true,
        observe(s) {
            const d = s.makeDialog();
            d.releaseNotes = NOTES;
            d.releaseNotesVersion = '2.0';
            return s.whatsNew(d);
        },
        shows: (labels: AboutDialogDoorLabels) => [run(heading(labels, '2.0'), 'heading'), run('\nHi')],
    },
    {
        row: 'version-does-not-rebuild',
        rule: 'setting version after the notes leaves the buffer without a heading',
        isPaged: true,
        observe(s) {
            const d = s.makeDialog();
            d.releaseNotes = NOTES;
            d.version = '1.0';
            return s.whatsNew(d);
        },
        shows: [run('Hi')],
    },
    {
        row: 'troubleshooting-row',
        rule: 'the Troubleshooting row shows once debug-info is set, and the page holds it verbatim',
        isPaged: true,
        observe(s) {
            const d = s.makeDialog();
            const before = s.isRowVisible(d, 'troubleshootingRow');
            d.debugInfo = 'GTK 4.20\n  Wayland';
            return [before, s.isRowVisible(d, 'troubleshootingRow'), s.debugInfoText(d)];
        },
        shows: [false, true, 'GTK 4.20\n  Wayland'],
    },
    {
        row: 'add-link-details',
        rule: 'add_link alone opens the Details row',
        isPaged: true,
        observe(s) {
            const d = s.makeDialog();
            const before = s.isRowVisible(d, 'detailsRow');
            d.add_link('_Docs', 'https://example.org/docs');
            return [before, s.isRowVisible(d, 'detailsRow')];
        },
        shows: [false, true],
    },
    {
        row: 'add-link-order',
        rule: 'links follow the website row in the order added, mnemonics stripped',
        isPaged: true,
        observe(s) {
            const d = s.makeDialog();
            d.website = 'https://example.org';
            d.add_link('_Docs', 'https://example.org/docs');
            d.add_link('Chat', 'https://example.org/chat');
            return s.linkTitles(d);
        },
        shows: (labels: AboutDialogDoorLabels) => [labels.websiteRow, 'Docs', 'Chat'],
    },
];

export async function driveAboutDialogDoorVectors(
    subject: AboutDialogDoorSubject,
    harness: ConstructHarness,
    vectors: readonly AboutDialogDoorVector[] = ABOUT_DIALOG_DOOR_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: Adw.AboutDialog notes, debug and link doors`, async () => {
        for (const vector of vectors) {
            await it(`${vector.row}: ${vector.rule}`, () => {
                try {
                    const expected = typeof vector.shows === 'function' ? vector.shows(subject.labels) : vector.shows;
                    expect(JSON.stringify(vector.observe(subject))).toBe(JSON.stringify(expected));
                } finally {
                    subject.dispose();
                }
            });
        }
    });
}
