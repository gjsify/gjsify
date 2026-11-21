import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { dayNumber, type LocalDate } from '@gjsify/calendar-layout';

import { groupByDay, type AgendaDay, type AgendaEntry } from './agenda-rules.js';
import type { CalendarEvent } from './calendar-event.js';
import { dayHeading, isoDate, parseIsoDate, timeRangeLabel } from './calendar-format.js';
import { _ } from './i18n.js';
import { emitSignal } from './signals.js';
import { ELLIPSIZE_END, ensureStyles } from './styles.js';
import { Tint } from './tint.js';

/**
 * What happens next, as a list: one heading per day, then its items.
 *
 * The grouping is `agenda-rules.groupByDay`, so an item that spans days appears under each day it
 * touches, clipped there — a reader scrolling past Wednesday sees the trip that started on Monday.
 * Days with nothing on them are left out rather than printed as empty headings.
 *
 * The headings scroll with the list rather than sticking: GTK has no sticky header for a plain
 * `Gtk.ListBox`, and a `Gtk.ListView` section header costs the widget a model it would otherwise
 * not need. The headings are small, flat and repeated often enough that the position stays clear.
 *
 * Signal: `item-activated(id)`.
 */
export class AgendaList extends Gtk.Box {
    static {
        GObject.registerClass(
            {
                GTypeName: 'GjsifyAdwAgendaList',
                Signals: { 'item-activated': { param_types: [GObject.TYPE_STRING] } },
            },
            AgendaList,
        );
    }

    private items: readonly CalendarEvent[] = [];
    private localeName: string | undefined;
    private todayKey: number | null = null;
    private first: LocalDate | null = null;
    private dayCount: number | null = null;
    private emptyText = _('Nothing scheduled');

    private readonly list = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, valign: Gtk.Align.START });
    private readonly empty = new AgendaEmpty();
    private readonly scroller = new Gtk.ScrolledWindow({ hscrollbarPolicy: Gtk.PolicyType.NEVER, vexpand: true });

    constructor() {
        super({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, hexpand: true, vexpand: true });
        ensureStyles();
        this.list.set_margin_bottom(12);
        this.scroller.set_child(this.list);
        this.append(this.scroller);
        this.append(this.empty);
        this.refresh();
    }

    /** Already-expanded occurrences, in any order. */
    setItems(items: readonly CalendarEvent[]): void {
        this.items = items;
        this.refresh();
    }

    /**
     * Limits the list to `days` days from `firstDay` (`YYYY-MM-DD`). Both `null` lists everything the
     * items cover, which is what an "upcoming" list wants.
     */
    setWindow(firstDay: string | null, days: number | null): void {
        this.first = firstDay === null ? null : parseIsoDate(firstDay);
        this.dayCount = days === null ? null : Math.max(0, Math.floor(days));
        this.refresh();
    }

    /** The day whose heading reads "Today"; `null` in a story that must not depend on the clock. */
    setToday(date: Date | null): void {
        this.todayKey =
            date === null
                ? null
                : dayNumber({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
        this.refresh();
    }

    setLocale(locale: string | undefined): void {
        this.localeName = locale;
        this.refresh();
    }

    /** What an empty list says — "Nothing scheduled" unless the host knows something better. */
    setEmptyText(text: string): void {
        this.emptyText = text;
        this.refresh();
    }

    private refresh(): void {
        clear(this.list);
        const days =
            this.first === null || this.dayCount === null
                ? groupByDay(this.items)
                : groupByDay(this.items, { first: this.first, days: this.dayCount });

        for (const day of days) this.list.append(this.buildDay(day));

        this.empty.setText(this.emptyText);
        this.empty.set_visible(days.length === 0);
        this.scroller.set_visible(days.length > 0);
    }

    private buildDay(day: AgendaDay<unknown>): Gtk.Widget {
        const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2 });
        const heading = new Gtk.Label({
            label: day.day === this.todayKey ? _('Today') : dayHeading(day.date, this.localeName),
            xalign: 0,
            singleLineMode: true,
            ellipsize: ELLIPSIZE_END,
        });
        heading.add_css_class('gjsify-agenda-header');
        heading.add_css_class('caption-heading');
        heading.add_css_class(day.day === this.todayKey ? 'accent' : 'dim-label');
        box.append(heading);

        const rows = new Gtk.ListBox({ selectionMode: Gtk.SelectionMode.NONE });
        rows.add_css_class('boxed-list');
        rows.set_margin_start(12);
        rows.set_margin_end(12);
        rows.connect('row-activated', (_l: Gtk.ListBox, row: Gtk.ListBoxRow) => {
            const id = row.get_name();
            if (id !== '') emitSignal(this, 'item-activated', id);
        });
        for (const entry of day.entries) rows.append(this.buildRow(entry, day.date));
        box.append(rows);
        return box;
    }

    private buildRow(entry: AgendaEntry<unknown>, date: LocalDate): Gtk.ListBoxRow {
        const data = (entry.item as CalendarEvent).payload;
        const row = new Gtk.ListBoxRow({ activatable: true, name: entry.id });

        const line = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 10 });
        line.set_margin_start(12);
        line.set_margin_end(12);
        line.set_margin_top(8);
        line.set_margin_bottom(8);

        const dot = new Gtk.Box({ valign: Gtk.Align.CENTER });
        dot.add_css_class('gjsify-source-dot');
        const tint = new Tint(dot, 'dot', (cls, c) => `.${cls} { background-color: ${c}; }`);
        tint.set(data.colour ?? null);
        line.append(dot);

        const when =
            entry.start === null
                ? _('All day')
                : timeRangeLabel(entry.start, entry.end ?? entry.start, this.localeName);
        const time = new Gtk.Label({ label: when, xalign: 0, valign: Gtk.Align.START, singleLineMode: true });
        time.add_css_class('caption');
        time.add_css_class('dim-label');
        time.add_css_class('numeric');
        time.set_width_chars(entry.start === null ? 8 : 11);
        line.append(time);

        const text = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, hexpand: true });
        const title = new Gtk.Label({
            label: data.title,
            xalign: 0,
            hexpand: true,
            ellipsize: ELLIPSIZE_END,
            singleLineMode: true,
        });
        text.append(title);
        if (data.location !== undefined && data.location !== '') {
            const place = new Gtk.Label({
                label: data.location,
                xalign: 0,
                hexpand: true,
                ellipsize: ELLIPSIZE_END,
                singleLineMode: true,
            });
            place.add_css_class('caption');
            place.add_css_class('dim-label');
            text.append(place);
        }
        line.append(text);

        // A span says where in the item this day sits, so a reader does not read it as a second event.
        if (entry.continuesBefore || entry.continuesAfter) {
            const span = new Gtk.Label({ label: entry.continuesBefore ? (entry.continuesAfter ? '↕' : '↑') : '↓' });
            span.add_css_class('dim-label');
            span.set_tooltip_text(_('Continues on another day'));
            line.append(span);
        }

        row.set_child(line);
        row.update_property(
            [Gtk.AccessibleProperty.LABEL],
            [`${dayHeading(date, this.localeName)}, ${when}, ${data.title}`],
        );
        return row;
    }
}

/**
 * The empty state. `Adw.StatusPage` would be the obvious widget, but it fills whatever it is given
 * and a sidebar-sized agenda is not the place for a full page; this is the quiet line instead.
 */
class AgendaEmpty extends Gtk.Box {
    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwAgendaEmpty' }, AgendaEmpty);
    }

    private readonly label = new Gtk.Label({ wrap: true, justify: Gtk.Justification.CENTER });

    constructor() {
        super({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, valign: Gtk.Align.CENTER, vexpand: true });
        const icon = Gtk.Image.new_from_icon_name('x-office-calendar-symbolic');
        icon.set_pixel_size(48);
        icon.add_css_class('dim-label');
        this.label.add_css_class('dim-label');
        this.append(icon);
        this.append(this.label);
    }

    setText(text: string): void {
        this.label.set_label(text);
    }
}

/** The date of the first day the list shows, as `YYYY-MM-DD`, or `null` for an empty list. */
export function firstAgendaDate(items: readonly CalendarEvent[]): string | null {
    const days = groupByDay(items);
    const first = days[0];
    return first === undefined ? null : isoDate(first.date);
}

function clear(widget: Gtk.Box): void {
    let child = widget.get_first_child();
    while (child) {
        const next = child.get_next_sibling();
        widget.remove(child);
        child = next;
    }
}
