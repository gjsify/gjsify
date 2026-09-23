// What a `.blp`'s value-carrying extension blocks build into — ADR 0072.
//
// `Gtk.StringList { strings [ … ] }` and `Adw.AlertDialog { responses [ … ] }` are the two
// Blueprint extensions `SharedTreeNode.extensions` carries. Each row is a Blueprint source and
// what the BUILT widget hands back: the list model a combo row or drop-down shows, and the
// responses a dialog registered, with their appearance and enabled state. A renderer drives a
// row by projecting the source, building the tree and reading the widget, so a renderer that
// drops the items renders an empty list and fails here by name.
//
// MEASURED AGAINST GTK, not derived from the C: every row was compiled with
// `emitGtkBuilderXml`, loaded with `Gtk.Builder` under GJS (GTK 4.22.5, libadwaita 1.9.3) and
// read back through `Gtk.StringList.get_string` and `Adw.AlertDialog.get_response_label` /
// `get_response_appearance` / `get_response_enabled`. The translated strings read back
// untranslated because the process ran with no catalogue for them, which is also what a
// renderer that carries the marking without translating shows.
//
// Reference: refs/gtk/gtk/gtkstringlist.c (item_end_element)
// Reference: refs/libadwaita/src/adw-alert-dialog.c (adw_alert_dialog_buildable_custom_finished)
// Copyright (c) GNOME contributors (GTK, libadwaita). LGPLv2.1+.

import type { AdwResponseAppearance } from '../dialog.js';

/** One registered response, as the built dialog reports it. */
export interface ValueListResponse {
    readonly id: string;
    readonly label: string;
    readonly appearance: AdwResponseAppearance;
    readonly enabled: boolean;
}

/** One Blueprint source and what the widget it builds hands back. */
export interface ValueListVector {
    readonly rule: string;
    /** The object, written after `using Gtk 4.0; using Adw 1;`. */
    readonly blueprint: string;
    /** The labels of the root's list model, in order — a combo row or a drop-down. */
    readonly strings?: readonly string[];
    /** The root dialog's responses, in the order they were added. */
    readonly responses?: readonly ValueListResponse[];
}

export const VALUE_LIST_VECTORS: readonly ValueListVector[] = [
    {
        rule: '`strings [ ]` fills an `Adw.ComboRow` model in source order; a marked item keeps its text',
        blueprint:
            'Adw.ComboRow { title: "Colour"; model: Gtk.StringList { strings [ "Blue", _("Teal"), C_("colour", "Green") ] }; }',
        strings: ['Blue', 'Teal', 'Green'],
    },
    {
        rule: '`strings [ ]` fills a `Gtk.DropDown` model the same way',
        blueprint: 'Gtk.DropDown { model: Gtk.StringList { strings [ "Small", "Medium", "Large" ] }; }',
        strings: ['Small', 'Medium', 'Large'],
    },
    {
        rule: '`responses [ ]` adds each response in order; `destructive` and `suggested` are its appearance',
        blueprint:
            'Adw.AlertDialog { heading: "Delete?"; responses [ cancel: _("Cancel"), delete: _("Delete") destructive, keep: "Keep" suggested ] }',
        responses: [
            { id: 'cancel', label: 'Cancel', appearance: 'default', enabled: true },
            { id: 'delete', label: 'Delete', appearance: 'destructive', enabled: true },
            { id: 'keep', label: 'Keep', appearance: 'suggested', enabled: true },
        ],
    },
    {
        rule: '`disabled` is `enabled: false`, and it combines with an appearance rather than replacing it',
        blueprint:
            'Adw.AlertDialog { heading: "Save?"; responses [ save: C_("verb", "Save") suggested disabled, later: "Later" disabled ] }',
        responses: [
            { id: 'save', label: 'Save', appearance: 'suggested', enabled: false },
            { id: 'later', label: 'Later', appearance: 'default', enabled: false },
        ],
    },
];
