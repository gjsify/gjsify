import Adw from '@girs/adw-1';
import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';

import { emitSignal } from './signals.js';
import { ColorCheck } from './color-check.js';
import { duplicateNameIds } from './source-names.js';

export interface SourceItem {
    id: string;
    name: string;
    /** Source colour as `#rgb` / `#rrggbb`. */
    colour: string;
    visible: boolean;
    /** Shown dimmed after the name, on rows whose name another row shares. */
    account?: string;
}

export interface SourceSection {
    /** Any title the caller likes ("Calendars", "Task lists", "Boards" …). */
    title: string;
    sources: SourceItem[];
}

interface RowRef {
    check: ColorCheck;
}

/**
 * A flat list in titled sections. Tapping a row flips its visibility at once and emits
 * `source-toggled(id, visible)`; `setVisible` changes a row from outside without emitting.
 */
export class SourceList extends Gtk.Box {
    static {
        GObject.registerClass(
            {
                GTypeName: 'GjsifyAdwSourceList',
                Signals: {
                    'source-toggled': { param_types: [GObject.TYPE_STRING, GObject.TYPE_BOOLEAN] },
                },
            },
            SourceList,
        );
    }

    private readonly rows = new Map<string, RowRef>();
    private silent = false;

    constructor() {
        super({ orientation: Gtk.Orientation.VERTICAL, spacing: 18 });
    }

    setSections(sections: readonly SourceSection[]): void {
        let child = this.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            this.remove(child);
            child = next;
        }
        this.rows.clear();

        const needSuffix = duplicateNameIds(sections.flatMap((s) => s.sources));
        for (const section of sections) {
            const heading = new Gtk.Label({ label: section.title, xalign: 0 });
            heading.add_css_class('heading');
            heading.add_css_class('dim-label');
            heading.set_margin_start(12);
            const list = new Gtk.ListBox({ selectionMode: Gtk.SelectionMode.NONE });
            list.add_css_class('background');
            for (const source of section.sources) list.append(this.buildRow(source, needSuffix.has(source.id)));

            const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6 });
            box.append(heading);
            box.append(list);
            this.append(box);
        }
    }

    setVisible(id: string, visible: boolean): void {
        const row = this.rows.get(id);
        if (!row || row.check.active === visible) return;
        this.silent = true;
        row.check.set_active(visible);
        this.silent = false;
    }

    private buildRow(source: SourceItem, suffix: boolean): Adw.ActionRow {
        const check = new ColorCheck(source.name, source.colour);
        // The row owns the tap, so the check is a mark here, not a second hit target.
        check.set_can_target(false);
        check.set_can_focus(false);
        check.set_active(source.visible);

        const row = new Adw.ActionRow({ title: source.name, activatable: true, useMarkup: false });
        row.add_prefix(check);
        if (suffix && source.account) {
            const account = new Gtk.Label({ label: source.account, valign: Gtk.Align.CENTER });
            account.add_css_class('dim-label');
            account.add_css_class('caption');
            row.add_suffix(account);
        }
        row.connect('activated', () => check.set_active(!check.active));
        check.connect('toggled', () => {
            if (!this.silent) emitSignal(this, 'source-toggled', source.id, check.active);
        });
        this.rows.set(source.id, { check });
        return row;
    }
}
