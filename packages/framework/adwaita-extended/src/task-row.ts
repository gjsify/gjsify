import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { emitSignal, onSignal } from './signals.js';
import { ColorCheck } from './color-check.js';
import { DueChip } from './due-chip.js';
import { _ } from './i18n.js';
import { priorityLevel, priorityMarks, type PriorityLevel } from './priority-marks.js';
import { SourceBadge, SourceDot } from './source-badge.js';
import { ELLIPSIZE_END } from './styles.js';
import { SwipeRow } from './swipe-row.js';

export interface TaskRowData {
    title: string;
    listName: string;
    /** List colour as `#rgb` / `#rrggbb`. */
    colour: string;
    done: boolean;
    due: Date | null;
    /** iCalendar PRIORITY, 0–9. */
    priority: number | null;
}

const PRIORITY_CLASS: Record<PriorityLevel, string> = { high: 'error', medium: 'warning', low: 'dim-label', none: '' };

function priorityName(level: PriorityLevel): string {
    switch (level) {
        case 'high':
            return _('High priority');
        case 'medium':
            return _('Medium priority');
        case 'low':
            return _('Low priority');
        case 'none':
            return '';
    }
}

/**
 * One task:
 *
 *     ◯  Title, at most two lines
 *        ● List   <due chip>   !!
 *
 * The leading mark is a round check in the list colour — or, while the row is read-only
 * (`writable` = false), a plain filled dot, because a disabled button would read as "not yet".
 * Absent pieces are left out. Signals: `toggled(done)`, `postpone`, `activated`.
 */
export class TaskRow extends SwipeRow {
    static {
        GObject.registerClass(
            {
                GTypeName: 'GjsifyAdwTaskRow',
                Signals: { toggled: { param_types: [GObject.TYPE_BOOLEAN] }, postpone: {} },
            },
            TaskRow,
        );
    }

    private readonly lead = new Gtk.Box({ valign: Gtk.Align.CENTER, halign: Gtk.Align.CENTER });
    private readonly check = new ColorCheck(_('Mark as done'));
    private readonly dot = new SourceDot(true);
    private readonly title = new Gtk.Label({
        xalign: 0,
        wrap: true,
        lines: 2,
        ellipsize: ELLIPSIZE_END,
    });
    private readonly badge = new SourceBadge();
    private readonly chip = new DueChip();
    private readonly marks = new Gtk.Label({ valign: Gtk.Align.CENTER });
    private silent = false;
    private done = false;
    private heading = '';

    constructor() {
        super();
        this.build();
        this.connect('notify::writable', () => this.syncLead());
        onSignal(this, 'primary', () => this.check.set_active(!this.check.active));
        onSignal(this, 'secondary', () => emitSignal(this, 'postpone'));
        this.setActionLabels(_('Mark as done'), _('Postpone to tomorrow'));
        this.syncLead();
    }

    setTask(task: TaskRowData, now: Date = new Date()): void {
        this.done = task.done;
        this.heading = task.title;
        this.title.set_label(task.title);
        if (task.done) this.title.add_css_class('dim-label');
        else this.title.remove_css_class('dim-label');
        this.silent = true;
        this.check.set_active(task.done);
        this.silent = false;
        this.check.setColour(task.colour);
        this.dot.setColour(task.colour);
        this.badge.setSource(task.listName, task.colour);
        this.chip.setDue(task.due, now);

        const level = priorityLevel(task.priority);
        for (const c of Object.values(PRIORITY_CLASS)) if (c) this.marks.remove_css_class(c);
        if (PRIORITY_CLASS[level]) this.marks.add_css_class(PRIORITY_CLASS[level]);
        this.marks.set_label(priorityMarks(task.priority));
        this.marks.set_tooltip_text(priorityName(level) || null);
        this.marks.set_visible(level !== 'none');
        this.syncLabels();
    }

    private build(): void {
        this.title.add_css_class('body');
        this.marks.add_css_class('caption-heading');
        this.marks.set_visible(false);
        this.lead.append(this.check);

        const meta = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 });
        meta.append(this.badge);
        meta.append(this.chip);
        meta.append(this.marks);

        const text = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 2,
            hexpand: true,
            valign: Gtk.Align.CENTER,
        });
        text.append(this.title);
        text.append(meta);

        const row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12 });
        row.set_margin_start(12);
        row.set_margin_end(12);
        row.set_margin_top(6);
        row.set_margin_bottom(6);
        row.append(this.lead);
        row.append(text);
        this.setContent(row);

        this.check.connect('toggled', () => {
            this.done = this.check.active;
            this.syncLabels();
            if (!this.silent) emitSignal(this, 'toggled', this.check.active);
        });
    }

    private syncLead(): void {
        const child = this.lead.get_first_child();
        if (child) this.lead.remove(child);
        this.lead.append(this.writable ? this.check : this.dot);
    }

    private syncLabels(): void {
        this.check.setAccessibleLabel(
            (this.done ? _('Mark as not done: %s') : _('Mark as done: %s')).replace('%s', this.heading),
        );
        this.setActionLabels(this.done ? _('Mark as not done') : _('Mark as done'), _('Postpone to tomorrow'));
    }
}
