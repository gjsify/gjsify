// <adw-shortcuts-dialog> — the window that shows an application's keyboard
// shortcuts, as `AdwShortcutsDialog` since libadwaita 1.8.
//
// IT IS THE GENERIC DIALOG plus a content model: the class is `final` and its parent
// is `Adw.Dialog` (Adw-1.gir), and upstream it declares no property and one method —
// `add(section)`. So this element EXTENDS <adw-dialog> and inherits the whole chrome
// (the scrim, the flat header with its close button, the focus trap, the bottom-sheet
// switch), and the only thing it adds is the sections.
//
// A browser document cannot call `add()`, so the sections are CHILDREN: one
// `<adw-shortcuts-section>` per group, each holding `<adw-shortcuts-item>` rows. That
// is `AdwShortcutsDialog`'s GtkBuildable form — the GIR documents "add it as a child
// when using UI files" — and it is the same mark-up-only-objection `GtkBuildable`
// answers for `<adw-sidebar-item>` and `<adw-toggle>`.
//
// The title is the DIALOG's, so it inherits from the base and is not re-observed.
// libadwaita spells the dialog's own class list `dialog.shortcuts`, and the stylesheet
// gives the rows their padding and the shortcut labels their keycaps
// (_shortcuts-dialog.scss:16-58) — the labels themselves are `<adw-shortcut-label>`,
// which already ports those rules.
//
// Reference: refs/libadwaita/src/adw-shortcuts-dialog.c (a final Adw.Dialog with `add`)
// Reference: refs/libadwaita/src/stylesheet/widgets/_shortcuts-dialog.scss
// Copyright (c) 2025 GNOME Foundation Inc. (libadwaita). LGPLv2.1+
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { AdwDialog } from './adw-dialog.js';

export class AdwShortcutsDialog extends AdwDialog {
    /**
     * The sections in this dialog, in document order (AdwShortcutsDialog:add, in markup).
     *
     * READ OFF THE CONTENT AREA rather than off a wrapper this class builds, because the
     * base routes every child there through its own LIVE `bindSlottedChildren` and a
     * wrapper of our own would be a second destination the routing knows nothing about:
     * a section appended after connect would land beside the wrapper, not inside it.
     */
    get sections(): readonly HTMLElement[] {
        return [...this.contentArea.children].filter((el) => el.localName === 'adw-shortcuts-section') as HTMLElement[];
    }

    connectedCallback() {
        // FIRST: the base builds its subtree here, and `contentArea` is one of the things
        // it builds — this class reads it on the line after.
        super.connectedCallback();
        // Once, and a re-attach must not throw the sections away: the base's
        // `_initialized` guard is what makes its subtree survive the move.
        this.classList.add('adw-shortcuts-dialog');
    }
}

customElements.define('adw-shortcuts-dialog', AdwShortcutsDialog);
