// THE ORACLE: the RELEASE_NOTES_VECTORS and ABOUT_DIALOG_DOOR_VECTORS run against a real
// `gi://Adw` about dialog. A vector that fails here is a wrong vector; fix the vector. Run it
// under `scripts/headless-run`. `.gjs.spec.ts` is skipped by `audit-runtimes.mjs`.
//
// Malformed notes make libadwaita print an `Adwaita-CRITICAL` (`update_release_notes`
// :1044); that line in the log is expected.

import { describe, expect, it, on } from '@gjsify/unit';

import {
    ABOUT_DIALOG_DOOR_VECTORS,
    RELEASE_NOTES_VECTORS,
    driveAboutDialogDoorVectors,
    driveReleaseNotesVectors,
    type AboutDialogDoorLike,
    type AboutDialogDoorSubject,
} from './conformance/about-dialog-doors.js';
import type { ReleaseNotesSegment, ReleaseNotesTag } from './release-notes.js';

type Obj = Record<string, (...args: unknown[]) => unknown>;
interface Widget {
    get_first_child(): Widget | null;
    get_next_sibling(): Widget | null;
    get_parent(): Widget | null;
    get_visible(): boolean;
}
interface TextIter {
    copy(): TextIter;
    is_end(): boolean;
    get_tags(): { name: string | null }[];
    forward_to_tag_toggle(tag: null): boolean;
}
interface TextBuffer {
    get_start_iter(): TextIter;
    get_end_iter(): TextIter;
    get_text(start: TextIter, end: TextIter, hidden: boolean): string;
}
interface GtkModule {
    init_check(): boolean;
    TextView: abstract new () => { get_buffer(): TextBuffer };
}
interface AdwModule {
    init(): void;
    AboutDialog: new () => AboutDialogDoorLike;
    NavigationView: abstract new () => { find_page(tag: string): Widget | null };
    ActionRow: abstract new () => { get_title(): string };
}
interface GLibModule {
    dgettext(domain: string, msgid: string): string;
}

/** What a renderer without an accelerator layer paints: `_x` is `x`, `__` is `_`. */
const stripMnemonic = (text: string): string => text.replace(/_(.)/g, '$1');

export default async () => {
    await on('Gjs', async () => {
        const Gtk = (await import('gi://Gtk?version=4.0' as string)).default as GtkModule;
        const GLib = (await import('gi://GLib?version=2.0' as string)).default as GLibModule;
        const Adw = (await import('gi://Adw?version=1' as string)).default as AdwModule;
        if (!Gtk.init_check()) return;
        Adw.init();

        const adw = (msgid: string) => GLib.dgettext('libadwaita', msgid);
        const emptyDocument = 'Document was empty or contained only whitespace';

        const find = (root: Widget, test: (w: Widget) => boolean, out: Widget[] = []): Widget[] => {
            if (test(root)) out.push(root);
            for (let child = root.get_first_child(); child; child = child.get_next_sibling()) find(child, test, out);
            return out;
        };
        const page = (dialog: AboutDialogDoorLike, tag: string): Widget => {
            const root = (dialog as unknown as Obj).get_child!() as Widget;
            const nav = find(root, (w) => w instanceof Adw.NavigationView)[0] as unknown as InstanceType<
                AdwModule['NavigationView']
            >;
            return nav.find_page(tag)!;
        };
        /** Visible along the whole chain up to the page `top`. */
        const isShown = (widget: Widget, top: Widget): boolean => {
            for (let w: Widget | null = widget; w && w !== top; w = w.get_parent()) if (!w.get_visible()) return false;
            return true;
        };
        const rows = (root: Widget) =>
            find(root, (w) => w instanceof Adw.ActionRow) as unknown as (Widget & { get_title(): string })[];
        const buffer = (dialog: AboutDialogDoorLike, tag: string): TextBuffer =>
            (
                find(page(dialog, tag), (w) => w instanceof Gtk.TextView)[0] as unknown as { get_buffer(): TextBuffer }
            ).get_buffer();

        const ROW_TITLES = {
            whatsNewRow: 'What’s _New',
            detailsRow: '_Details',
            troubleshootingRow: '_Troubleshooting',
        } as const;

        let dialogs: AboutDialogDoorLike[] = [];
        const subject: AboutDialogDoorSubject = {
            name: 'GJS (real Adw.AboutDialog)',
            isOracle: true,
            labels: {
                releaseNotesHeading: adw('Version %s'),
                releaseNotesError: adw('Unable to parse release notes:'),
                releaseNotesErrorPosition: adw('Line: %d, character: %d'),
                websiteRow: stripMnemonic(adw('_Website')),
            },
            isGLibUntranslated: GLib.dgettext('glib20', emptyDocument) === emptyDocument,
            makeDialog() {
                const dialog = new Adw.AboutDialog();
                dialogs.push(dialog);
                return dialog;
            },
            whatsNew(dialog) {
                const text = buffer(dialog, 'whatsnew');
                const runs: ReleaseNotesSegment[] = [];
                const iter = text.get_start_iter();
                while (!iter.is_end()) {
                    const start = iter.copy();
                    const names = start
                        .get_tags()
                        .map((tag) => tag.name)
                        .filter((name) => name !== 'section');
                    iter.forward_to_tag_toggle(null);
                    const segment = {
                        text: text.get_text(start, iter, true),
                        tag: (names[0] ?? null) as ReleaseNotesTag,
                    };
                    const last = runs[runs.length - 1];
                    if (last !== undefined && last.tag === segment.tag) last.text += segment.text;
                    else runs.push(segment);
                }
                return runs;
            },
            isRowVisible(dialog, row) {
                // The main page has no tag; the three row titles are unique in the template.
                const root = (dialog as unknown as Obj).get_child!() as Widget;
                const match = rows(root).find((r) => r.get_title() === adw(ROW_TITLES[row]));
                return match !== undefined && isShown(match, root);
            },
            debugInfoText(dialog) {
                const text = buffer(dialog, 'debuginfo');
                return text.get_text(text.get_start_iter(), text.get_end_iter(), true);
            },
            linkTitles(dialog) {
                const details = page(dialog, 'details');
                return rows(details)
                    .filter((r) => isShown(r, details))
                    .map((r) => stripMnemonic(r.get_title()));
            },
            dispose() {
                dialogs = [];
            },
        };
        await driveReleaseNotesVectors(subject, { describe, it, expect }, RELEASE_NOTES_VECTORS);
        await driveAboutDialogDoorVectors(subject, { describe, it, expect }, ABOUT_DIALOG_DOOR_VECTORS);
    });
};
