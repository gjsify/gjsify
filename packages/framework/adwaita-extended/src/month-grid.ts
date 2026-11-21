import Gdk from 'gi://Gdk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import {
    dayNumber,
    itemDayRange,
    layoutMonthBars,
    monthGrid,
    type BarSegment,
    type MonthWeek,
    type Weekday,
} from '@gjsify/calendar-layout';

import type { CalendarEvent } from './calendar-event.js';
import { dayHeading, isoDate, monthTitle, parseIsoDate, weekdayNames } from './calendar-format.js';
import { _, _n } from './i18n.js';
import { barRows, dotsForDay, monthDensity, moveGridFocus, type GridMove } from './month-rules.js';
import { emitSignal } from './signals.js';
import type { SizeClass } from './size-class.js';
import { ELLIPSIZE_END, ensureStyles } from './styles.js';
import { Tint } from './tint.js';

/** Width of the ISO week column, px — wide enough for "52" and the padding around it. */
const WEEK_COLUMN_WIDTH = 28;

/**
 * A month as a grid of days, with the items that happen on them.
 *
 * All geometry comes from `@gjsify/calendar-layout`: which days are in which row, and which row
 * slot a multi-day bar takes. This widget only turns that into widgets, so a layout bug has one
 * place to be fixed and can be tested without a display.
 *
 * Below `medium` a cell is about 45 px across, where a bar holds two or three characters and reads
 * as noise. Compact therefore draws one dot per item (see `monthDensity`) and leaves the titles to
 * a day list beside the grid — `AdaptivePane` with an `AgendaList` for the selected day is the
 * pairing this was built for.
 *
 * Signals: `day-activated(date)` with a `YYYY-MM-DD` date, from a click on a day or on its
 * "+n more"; `item-activated(id)` from a click on a bar.
 */
export class MonthGrid extends Gtk.Box {
    static {
        GObject.registerClass(
            {
                GTypeName: 'GjsifyAdwMonthGrid',
                Signals: {
                    'day-activated': { param_types: [GObject.TYPE_STRING] },
                    'item-activated': { param_types: [GObject.TYPE_STRING] },
                },
            },
            MonthGrid,
        );
    }

    private year = new Date().getFullYear();
    private month = new Date().getMonth() + 1;
    private items: readonly CalendarEvent[] = [];
    private first: Weekday = 1;
    private weekNumbers = false;
    private sizeClass: SizeClass = 'wide';
    private localeName: string | undefined;
    private todayKey: number | null = null;
    private selectedKey: number | null = null;
    private rowOverride = 0;

    private readonly headerRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 0 });
    private readonly headerGrid = new Gtk.Grid({ columnHomogeneous: true, hexpand: true });
    private readonly headerSpacer = new Gtk.Box({ widthRequest: WEEK_COLUMN_WIDTH });
    private readonly weeksBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        homogeneous: true,
        vexpand: true,
    });
    private dayButtons: Gtk.Button[] = [];

    constructor() {
        super({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, hexpand: true, vexpand: true });
        ensureStyles();
        this.headerRow.append(this.headerSpacer);
        this.headerRow.append(this.headerGrid);
        this.append(this.headerRow);
        this.append(this.weeksBox);

        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_c: Gtk.EventControllerKey, keyval: number) => this.onKey(keyval));
        this.add_controller(keys);

        // The first refresh happens with no allocation yet, so the bar rows come from the size class;
        // once there is a measured cell height it may hold one row more or less.
        this.connect('map', () => this.refresh());
        this.refresh();
    }

    /** The month on screen, as "January 2024" — a host puts this in its header. */
    get title(): string {
        return monthTitle(this.year, this.month, this.localeName);
    }

    setMonth(year: number, month: number): void {
        this.year = year;
        this.month = month;
        this.refresh();
    }

    /** Already-expanded occurrences. Items outside the grid are ignored, so a whole month can go in. */
    setItems(items: readonly CalendarEvent[]): void {
        this.items = items;
        this.refresh();
    }

    /** The weekday the rows start on, 0 = Sunday. The host looks it up from the locale. */
    setFirstWeekday(weekday: Weekday): void {
        this.first = weekday;
        this.refresh();
    }

    setShowWeekNumbers(show: boolean): void {
        this.weekNumbers = show;
        this.refresh();
    }

    /** The day marked as today, or `null` in a story or a test that must not depend on the clock. */
    setToday(date: Date | null): void {
        this.todayKey =
            date === null
                ? null
                : dayNumber({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
        this.refresh();
    }

    /** The day a paired day list is showing, as `YYYY-MM-DD`; `null` for none. */
    setSelected(date: string | null): void {
        const parsed = date === null ? null : parseKey(date);
        this.selectedKey = parsed;
        this.refresh();
    }

    setSizeClass(sizeClass: SizeClass): void {
        this.sizeClass = sizeClass;
        this.refresh();
    }

    /** Locale for the weekday and month names; `undefined` follows the environment. */
    setLocale(locale: string | undefined): void {
        this.localeName = locale;
        this.refresh();
    }

    /** Bar rows per cell. 0 derives them from the size class and the measured cell height. */
    setMaxBarRows(rows: number): void {
        this.rowOverride = Math.max(0, Math.floor(rows));
        this.refresh();
    }

    private refresh(): void {
        const grid = monthGrid({ year: this.year, month: this.month, firstWeekday: this.first, sixRows: true });
        const density = monthDensity(this.sizeClass);
        const measured = this.weeksBox.get_height() / Math.max(1, grid.weeks.length);
        const rows =
            this.rowOverride > 0 ? this.rowOverride : barRows(this.sizeClass, measured > 0 ? measured : undefined);
        const names = weekdayNames(this.first, this.localeName, this.sizeClass === 'compact' ? 'narrow' : 'short');
        const counts = this.countByDay();
        const bars = density === 'bars' ? layoutMonthBars(grid, this.items, { maxRows: rows }) : [];

        this.headerSpacer.set_visible(this.weekNumbers);
        clear(this.headerGrid);
        names.forEach((name, column) => {
            const label = new Gtk.Label({ label: name, singleLineMode: true, ellipsize: ELLIPSIZE_END });
            label.add_css_class('caption-heading');
            label.add_css_class('dim-label');
            label.set_margin_bottom(4);
            this.headerGrid.attach(label, column, 0, 1, 1);
        });

        let child = this.weeksBox.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            this.weeksBox.remove(child);
            child = next;
        }
        this.dayButtons = [];
        grid.weeks.forEach((week, index) => {
            this.weeksBox.append(
                this.buildWeek(week, bars[index]?.segments ?? [], bars[index]?.overflow ?? [], rows, counts),
            );
        });
    }

    private buildWeek(
        week: MonthWeek,
        segments: readonly BarSegment<unknown>[],
        overflow: readonly number[],
        rows: number,
        counts: Map<number, number>,
    ): Gtk.Widget {
        const row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 0 });
        row.add_css_class('gjsify-month-week');
        if (this.weekNumbers) {
            const number = new Gtk.Label({
                label: String(week.isoWeek),
                widthRequest: WEEK_COLUMN_WIDTH,
                valign: Gtk.Align.START,
            });
            number.add_css_class('gjsify-week-number');
            number.add_css_class('caption');
            number.add_css_class('dim-label');
            number.add_css_class('numeric');
            number.update_property([Gtk.AccessibleProperty.LABEL], [weekText(week.isoWeek)]);
            row.append(number);
        }

        const cells = new Gtk.Grid({ columnHomogeneous: true, hexpand: true, rowSpacing: 2, columnSpacing: 2 });
        cells.set_margin_bottom(2);
        week.days.forEach((day, column) => {
            const key = dayNumber(day.date);
            const button = new Gtk.Button({
                label: String(day.date.day),
                halign: Gtk.Align.START,
                valign: Gtk.Align.START,
            });
            button.add_css_class('flat');
            button.add_css_class('gjsify-month-head');
            button.add_css_class('numeric');
            if (!day.inMonth) button.add_css_class('other-month');
            if (key === this.todayKey) button.add_css_class('today');
            if (key === this.selectedKey) button.add_css_class('selected');
            const count = counts.get(key) ?? 0;
            button.update_property(
                [Gtk.AccessibleProperty.LABEL],
                [`${dayHeading(day.date, this.localeName)}, ${eventCountText(count)}`],
            );
            button.connect('clicked', () => emitSignal(this, 'day-activated', isoDate(day.date)));
            cells.attach(button, column, 0, 1, 1);
            this.dayButtons.push(button);

            if (monthDensity(this.sizeClass) === 'dots') {
                const dots = dotsBox(count, this.items, key);
                cells.attach(dots, column, 1, 1, 1);
            }
        });

        for (const segment of segments) {
            cells.attach(this.buildBar(segment), segment.column, 1 + segment.row, segment.span, 1);
        }

        if (monthDensity(this.sizeClass) === 'bars') {
            overflow.forEach((count, column) => {
                if (count <= 0) return;
                const date = week.days[column]?.date;
                if (!date) return;
                const more = new Gtk.Button({ label: moreText(count), halign: Gtk.Align.START });
                more.add_css_class('flat');
                more.add_css_class('gjsify-month-more');
                more.add_css_class('caption');
                more.add_css_class('dim-label');
                more.connect('clicked', () => emitSignal(this, 'day-activated', isoDate(date)));
                cells.attach(more, column, 1 + rows, 1, 1);
            });
        }

        // A click on the empty part of a cell opens that day too, which is where a reader aims when
        // the day number is a small pill in the corner. Bars and buttons claim their own clicks first.
        const click = new Gtk.GestureClick();
        click.connect('released', (_g: Gtk.GestureClick, _presses: number, x: number) => {
            const width = cells.get_width();
            if (width <= 0) return;
            const column = Math.max(0, Math.min(6, Math.floor((x / width) * 7)));
            const date = week.days[column]?.date;
            if (date) emitSignal(this, 'day-activated', isoDate(date));
        });
        cells.add_controller(click);

        row.append(cells);
        return row;
    }

    private buildBar(segment: BarSegment<unknown>): Gtk.Widget {
        const data = (segment.item as CalendarEvent).payload;
        const button = new Gtk.Button({ hexpand: true });
        button.add_css_class('flat');
        button.add_css_class('gjsify-month-bar');
        if (segment.continuesLeft) button.add_css_class('continues-left');
        if (segment.continuesRight) button.add_css_class('continues-right');
        const label = new Gtk.Label({
            label: data.title,
            xalign: 0,
            hexpand: true,
            ellipsize: ELLIPSIZE_END,
            singleLineMode: true,
        });
        label.add_css_class('caption');
        button.set_child(label);
        // A squared edge says "this runs on" to the eye; the label has to say it to a screen reader.
        const name =
            segment.continuesLeft || segment.continuesRight
                ? `${data.title} — ${_('Continues on another day')}`
                : data.title;
        button.update_property([Gtk.AccessibleProperty.LABEL], [name]);
        button.set_tooltip_text(name);
        const tint = new Tint(
            button,
            'cal-bar',
            (cls, c) => `.${cls} { background-color: color-mix(in srgb, ${c} 28%, transparent); }`,
        );
        tint.set(data.colour ?? null);
        button.connect('clicked', () => emitSignal(this, 'item-activated', segment.id));
        return button;
    }

    /** How many items touch each day of the grid, for the dots and the accessible day names. */
    private countByDay(): Map<number, number> {
        const counts = new Map<number, number>();
        for (const item of this.items) {
            const range = itemDayRange(item);
            for (let day = range.first; day <= range.last; day++) counts.set(day, (counts.get(day) ?? 0) + 1);
        }
        return counts;
    }

    private onKey(keyval: number): boolean {
        const move = MOVES[keyval];
        if (move === undefined) return false;
        const index = this.dayButtons.findIndex((button) => button.hasFocus);
        if (index < 0) return false;
        const next = moveGridFocus(index, move, this.dayButtons.length);
        if (next < 0) return false;
        this.dayButtons[next]?.grab_focus();
        return true;
    }
}

const MOVES: Record<number, GridMove> = {
    [Gdk.KEY_Left]: 'left',
    [Gdk.KEY_KP_Left]: 'left',
    [Gdk.KEY_Right]: 'right',
    [Gdk.KEY_KP_Right]: 'right',
    [Gdk.KEY_Up]: 'up',
    [Gdk.KEY_KP_Up]: 'up',
    [Gdk.KEY_Down]: 'down',
    [Gdk.KEY_KP_Down]: 'down',
    [Gdk.KEY_Home]: 'home',
    [Gdk.KEY_KP_Home]: 'home',
    [Gdk.KEY_End]: 'end',
    [Gdk.KEY_KP_End]: 'end',
};

/** "3 events", the part of a day's accessible name that says what is on it. */
export function eventCountText(count: number): string {
    return _n('%d event', '%d events', count).replace('%d', String(count));
}

/** "+2 more", under the bars a cell had no room for. */
export function moreText(count: number): string {
    return _n('+%d more', '+%d more', count).replace('%d', String(count));
}

/** "Week 3", the accessible name of the ISO week column. */
export function weekText(week: number): string {
    return _('Week %d').replace('%d', String(week));
}

function dotsBox(count: number, items: readonly CalendarEvent[], key: number): Gtk.Widget {
    const box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 2, halign: Gtk.Align.CENTER });
    // The gesture on the week row answers for the whole cell, so the dots stay out of the way.
    box.set_can_target(false);
    const { dots, more } = dotsForDay(count);
    const onDay = items.filter((item) => {
        const range = itemDayRange(item);
        return range.first <= key && key <= range.last;
    });
    for (let index = 0; index < dots; index++) {
        const dot = new Gtk.Box({ valign: Gtk.Align.CENTER });
        dot.add_css_class('gjsify-source-dot');
        const tint = new Tint(dot, 'dot', (cls, c) => `.${cls} { background-color: ${c}; }`);
        tint.set(onDay[index]?.payload.colour ?? null);
        box.append(dot);
    }
    if (more > 0) {
        const label = new Gtk.Label({ label: `+${more}` });
        label.add_css_class('caption');
        label.add_css_class('dim-label');
        label.add_css_class('numeric');
        box.append(label);
    }
    return box;
}

function clear(widget: Gtk.Grid): void {
    let child = widget.get_first_child();
    while (child) {
        const next = child.get_next_sibling();
        widget.remove(child);
        child = next;
    }
}

function parseKey(date: string): number | null {
    const parsed = parseIsoDate(date);
    return parsed === null ? null : dayNumber(parsed);
}
