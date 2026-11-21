import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';

import {
    dateFromDayNumber,
    dayNumber,
    isBarItem,
    itemDayRange,
    layoutTimeGrid,
    type LocalDate,
    type TimeGridDay,
    type TimePlacement,
} from '@gjsify/calendar-layout';

import type { CalendarEvent } from './calendar-event.js';
import { hourLabel, isoDate, parseIsoDate, shortDayHeading, timeRangeLabel } from './calendar-format.js';
import { _ } from './i18n.js';
import { emitSignal } from './signals.js';
import { ELLIPSIZE_END, ensureStyles } from './styles.js';
import { Tint } from './tint.js';
import {
    EVENT_GAP,
    GUTTER_WIDTH,
    HOUR_HEIGHT,
    MIN_DAY_WIDTH,
    clampDays,
    columnUnits,
    gridHeight,
    gridSlot,
    minuteAtOffset,
    nowOffset,
    offsetForMinute,
    scrollTarget,
    visibleRange,
} from './time-grid-rules.js';

/**
 * One to seven day columns over an hour gutter: the day, the week, or anything between.
 *
 * `@gjsify/calendar-layout` decides which item sits in which overlap column; `time-grid-rules`
 * turns minutes into pixels and an overlap column into grid slots. A day is a `Gtk.Overlay`: the
 * hour lines and every item lie over one canvas, each pushed down by its own `margin-top`, because
 * a timed grid has no row structure a box could express — two items at 09:00 and 09:15 overlap by
 * a quarter of their heights. Widths stay in GTK's hands rather than being measured here: a
 * `Gtk.Fixed` child cannot follow the column's width, and GTK4 has no `width` property to watch.
 *
 * All-day and multi-day items never reach the columns (`layoutTimeGrid` drops them); they go into
 * the strip above, which is why the strip exists rather than being the host's problem.
 *
 * Signals: `item-activated(id)` from a click on an item or the strip; `slot-activated(date, minute)`
 * from a click on free space, with a `YYYY-MM-DD` date and the minute of the day, snapped down to
 * a quarter of an hour.
 */
export class TimeGrid extends Gtk.Box {
    static {
        GObject.registerClass(
            {
                GTypeName: 'GjsifyAdwTimeGrid',
                Signals: {
                    'item-activated': { param_types: [GObject.TYPE_STRING] },
                    'slot-activated': { param_types: [GObject.TYPE_STRING, GObject.TYPE_INT] },
                },
            },
            TimeGrid,
        );
    }

    private firstDay: LocalDate = today();
    private dayCount = 7;
    private startHour = 0;
    private endHour = 24;
    private items: readonly CalendarEvent[] = [];
    private localeName: string | undefined;
    private todayKey: number | null = null;
    private nowMinute: number | null = null;

    // The three day rows are homogeneous: a header, an all-day bar and the column under it must
    // share one edge, and a plain box sizes each child by its own content instead — a long title in
    // the strip would push Monday's bar into Tuesday.
    private readonly headerDays = dayRow();
    private readonly stripDays = dayRow();
    private readonly columns = dayRow();

    private readonly headerRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 0 });
    private readonly stripRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 0 });
    private readonly stripLabel = new Gtk.Label({
        label: _('All day'),
        widthRequest: GUTTER_WIDTH,
        xalign: 1,
        valign: Gtk.Align.START,
    });
    private readonly gutter = new Gtk.Fixed({ widthRequest: GUTTER_WIDTH });
    private readonly body = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 0 });

    // One scroller per axis, and the three horizontal ones share an adjustment: below
    // {@link MIN_DAY_WIDTH} per day the columns scroll sideways, and the header and the strip have
    // to travel with them or they would label the wrong days.
    private readonly headerScroller = sideways();
    private readonly stripScroller = sideways();
    private readonly daysScroller = sideways();
    private readonly scroller = new Gtk.ScrolledWindow({ hscrollbarPolicy: Gtk.PolicyType.NEVER, vexpand: true });
    // The sideways scrollbar lives at the bottom of the widget, not inside the scroller: inside, it
    // would sit under thirteen hours of grid and only appear once you had scrolled past them.
    private readonly hscrollbar = new Gtk.Scrollbar({ orientation: Gtk.Orientation.HORIZONTAL, hexpand: true });
    private readonly hscrollRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 0 });
    /** An hour asked for before the scroller had a height; applied as soon as it has one. */
    private pendingHour: number | null = null;

    constructor() {
        super({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, hexpand: true, vexpand: true });
        ensureStyles();
        this.stripLabel.add_css_class('caption');
        this.stripLabel.add_css_class('dim-label');
        this.stripLabel.set_margin_end(6);
        this.stripLabel.set_margin_top(4);
        this.stripRow.add_css_class('gjsify-time-strip');

        this.headerScroller.set_child(this.headerDays);
        this.stripScroller.set_child(this.stripDays);
        this.daysScroller.set_child(this.columns);
        const sync = this.daysScroller.get_hadjustment();
        this.headerScroller.set_hadjustment(sync);
        this.stripScroller.set_hadjustment(sync);
        this.hscrollbar.set_adjustment(sync);
        const follow = (): void => this.hscrollbar.set_visible(sync.get_upper() > sync.get_page_size() + 1);
        sync.connect('changed', follow);
        follow();

        const headerSpacer = new Gtk.Box({ widthRequest: GUTTER_WIDTH });
        const scrollSpacer = new Gtk.Box({ widthRequest: GUTTER_WIDTH });
        this.headerRow.append(headerSpacer);
        this.headerRow.append(this.headerScroller);
        this.stripRow.append(this.stripLabel);
        this.stripRow.append(this.stripScroller);
        this.hscrollRow.append(scrollSpacer);
        this.hscrollRow.append(this.hscrollbar);
        // The strip label is the widest thing in the gutter in some languages ("Ganztägig"); the size
        // group lets the gutter grow to it everywhere at once, so the four rows stay aligned.
        const gutterWidth = new Gtk.SizeGroup({ mode: Gtk.SizeGroupMode.HORIZONTAL });
        for (const widget of [headerSpacer, this.stripLabel, scrollSpacer, this.gutter]) gutterWidth.add_widget(widget);
        // A gap after the last day, so its items do not run into the edge of the window.
        for (const row of [this.headerDays, this.stripDays, this.columns]) row.set_margin_end(6);
        this.body.append(this.gutter);
        this.body.append(this.daysScroller);
        this.scroller.set_child(this.body);
        this.scroller.get_vadjustment().connect('notify::page-size', () => {
            if (this.pendingHour === null) return;
            const hour = this.pendingHour;
            this.pendingHour = null;
            this.scrollToHour(hour);
        });
        this.append(this.headerRow);
        this.append(this.stripRow);
        this.append(this.scroller);
        this.append(this.hscrollRow);
        this.refresh();
    }

    /** The first day on screen, as `YYYY-MM-DD`. */
    get firstDate(): string {
        return isoDate(this.firstDay);
    }

    /** The days on screen, as `YYYY-MM-DD`; a host puts the ends of this in its header. */
    get dates(): string[] {
        const start = dayNumber(this.firstDay);
        return Array.from({ length: this.dayCount }, (_u, index) => isoDate(dateFromDayNumber(start + index)));
    }

    /** The first column and how many follow it, 1…7. */
    setRange(firstDay: string, days: number): void {
        const parsed = parseIsoDate(firstDay);
        if (parsed !== null) this.firstDay = parsed;
        this.dayCount = clampDays(days);
        this.refresh();
    }

    /** The hours the grid shows; outside them an item is clipped, not dropped. */
    setVisibleHours(startHour: number, endHour: number): void {
        const range = visibleRange(startHour, endHour);
        this.startHour = range.startHour;
        this.endHour = range.endHour;
        this.refresh();
    }

    /** Already-expanded occurrences; everything outside the range is ignored. */
    setItems(items: readonly CalendarEvent[]): void {
        this.items = items;
        this.refresh();
    }

    setLocale(locale: string | undefined): void {
        this.localeName = locale;
        this.refresh();
    }

    /**
     * Where the now line goes, or `null` for no line — a story and a screenshot pass `null` so they
     * do not depend on the clock. The widget never reads the clock itself: a line that moves on its
     * own would need a timer nobody can stop from outside.
     */
    setNow(now: Date | null): void {
        if (now === null) {
            this.todayKey = null;
            this.nowMinute = null;
        } else {
            this.todayKey = dayNumber({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
            this.nowMinute = now.getHours() * 60 + now.getMinutes();
        }
        this.refresh();
    }

    /**
     * Brings `hour` to the top of the viewport, as far as the content allows.
     *
     * Before the first allocation the viewport has no height, and every position is then clamped to
     * the top — so an hour asked for that early is kept and applied once the scroller is measured.
     */
    scrollToHour(hour: number): void {
        const adjustment = this.scroller.get_vadjustment();
        const viewport = adjustment.get_page_size();
        if (viewport <= 0) {
            this.pendingHour = hour;
            return;
        }
        adjustment.set_value(scrollTarget(hour, this.startHour, this.endHour, viewport));
    }

    private refresh(): void {
        const start = dayNumber(this.firstDay);
        const days = layoutTimeGrid(this.items, {
            firstDay: this.firstDay,
            days: this.dayCount,
            startHour: this.startHour,
            endHour: this.endHour,
        });
        const height = gridHeight(this.startHour, this.endHour);

        clear(this.headerDays);
        clear(this.stripDays);
        clear(this.columns);
        clearFixed(this.gutter);

        for (let hour = this.startHour; hour < this.endHour; hour++) {
            const label = new Gtk.Label({
                label: hourLabel(hour, this.localeName),
                xalign: 1,
                widthRequest: GUTTER_WIDTH - 6,
            });
            label.add_css_class('caption');
            label.add_css_class('dim-label');
            label.add_css_class('numeric');
            this.gutter.put(label, 0, offsetForMinute(hour * 60, this.startHour) - 1);
        }
        this.gutter.set_size_request(GUTTER_WIDTH, height);

        for (let index = 0; index < this.dayCount; index++) {
            const date = dateFromDayNumber(start + index);
            this.headerDays.append(this.buildHeader(date));
            this.stripDays.append(this.buildStrip(date));
            this.columns.append(this.buildColumn(date, days[index], height, index > 0));
        }
    }

    private buildHeader(date: LocalDate): Gtk.Widget {
        const label = new Gtk.Label({
            label: shortDayHeading(date, this.localeName),
            hexpand: true,
            singleLineMode: true,
            ellipsize: ELLIPSIZE_END,
            widthRequest: MIN_DAY_WIDTH,
        });
        label.add_css_class('caption-heading');
        label.set_margin_top(4);
        label.set_margin_bottom(4);
        if (dayNumber(date) === this.todayKey) label.add_css_class('accent');
        else label.add_css_class('dim-label');
        return label;
    }

    /** The all-day strip for one day: the items `layoutTimeGrid` does not place, stacked. */
    private buildStrip(date: LocalDate): Gtk.Widget {
        const key = dayNumber(date);
        const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2, hexpand: true });
        // The same floor as a day column, so the three rows ask for the same width and stay aligned.
        box.set_size_request(MIN_DAY_WIDTH, -1);
        box.set_margin_start(1);
        box.set_margin_end(1);
        box.set_margin_top(2);
        box.set_margin_bottom(2);
        for (const item of this.items) {
            if (!isBarItem(item)) continue;
            const range = itemDayRange(item);
            if (key < range.first || key > range.last) continue;
            box.append(
                this.buildItem(
                    item.id,
                    item.payload.title,
                    item.payload.colour ?? null,
                    item.payload.title,
                    'month-bar',
                ),
            );
        }
        return box;
    }

    private buildColumn(
        date: LocalDate,
        day: TimeGridDay<unknown> | undefined,
        height: number,
        border: boolean,
    ): Gtk.Widget {
        const column = new Gtk.Overlay({ hexpand: true });
        const canvas = new Gtk.Box({ hexpand: true });
        canvas.set_size_request(MIN_DAY_WIDTH, height);
        column.set_child(canvas);
        if (border) column.add_css_class('gjsify-time-column');

        for (let hour = this.startHour + 1; hour < this.endHour; hour++) {
            column.add_overlay(rule('gjsify-time-hour', 1, offsetForMinute(hour * 60, this.startHour)));
        }

        const placements = day?.placements ?? [];
        const units = columnUnits(placements.map((placement) => placement.columns));
        for (const placement of placements) column.add_overlay(this.buildPlacement(placement, units));

        if (this.nowMinute !== null && dayNumber(date) === this.todayKey) {
            const offset = nowOffset(this.nowMinute, this.startHour, this.endHour);
            if (offset !== null) column.add_overlay(rule('gjsify-time-now', 2, offset));
        }

        const click = new Gtk.GestureClick();
        click.connect('released', (_g: Gtk.GestureClick, _presses: number, x: number, y: number) => {
            if (hitsButton(column, x, y)) return;
            emitSignal(this, 'slot-activated', isoDate(date), minuteAtOffset(y, this.startHour));
        });
        column.add_controller(click);
        return column;
    }

    /**
     * One item as a band across the column: `margin-top` carries the minute, and a homogeneous
     * `Gtk.Grid` of `units` slots carries the overlap column, because a fraction of a width nobody
     * has measured yet is something only a layout can know. An empty slot needs a spacer that
     * expands, or the grid collapses it to nothing and the item takes the whole width.
     */
    private buildPlacement(placement: TimePlacement<unknown>, units: number): Gtk.Widget {
        const data = (placement.item as CalendarEvent).payload;
        const name = `${timeRangeLabel(placement.start, placement.end, this.localeName)} ${data.title}`;
        const button = this.buildItem(placement.id, data.title, data.colour ?? null, name, 'time-event');
        const top = offsetForMinute(placement.start, this.startHour);
        const height = Math.max(HOUR_HEIGHT / 4, offsetForMinute(placement.end, this.startHour) - top - 1);
        button.set_halign(Gtk.Align.FILL);
        button.set_valign(Gtk.Align.START);
        button.set_size_request(-1, height);
        if (placement.columns > 1) button.set_margin_end(EVENT_GAP);

        const band = new Gtk.Grid({ columnHomogeneous: true, halign: Gtk.Align.FILL, valign: Gtk.Align.START });
        band.set_margin_top(top);
        for (let unit = 0; unit < units; unit++) {
            const spacer = new Gtk.Box({ hexpand: true });
            spacer.set_can_target(false);
            band.attach(spacer, unit, 1, 1, 1);
        }
        const slot = gridSlot(placement.column, placement.columns, units);
        band.attach(button, slot.start, 0, slot.span, 1);
        return band;
    }

    private buildItem(id: string, title: string, colour: string | null, name: string, kind: string): Gtk.Button {
        const button = new Gtk.Button();
        button.add_css_class('flat');
        button.add_css_class(kind === 'time-event' ? 'gjsify-time-event' : 'gjsify-month-bar');
        const label = new Gtk.Label({
            label: title,
            xalign: 0,
            yalign: 0,
            hexpand: true,
            ellipsize: ELLIPSIZE_END,
            singleLineMode: true,
        });
        label.add_css_class('caption');
        button.set_child(label);
        button.update_property([Gtk.AccessibleProperty.LABEL], [name]);
        button.set_tooltip_text(name);
        const tint = new Tint(
            button,
            'cal-bar',
            (cls, c) => `.${cls} { background-color: color-mix(in srgb, ${c} 28%, @window_bg_color); }`,
        );
        tint.set(colour);
        button.connect('clicked', () => emitSignal(this, 'item-activated', id));
        return button;
    }
}

function today(): LocalDate {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/** One cell per day, every cell the same width — the row header, strip and columns all use it. */
function dayRow(): Gtk.Box {
    return new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 0, homogeneous: true, hexpand: true });
}

/**
 * A scroller that only ever moves sideways. It reports its child's natural height so the header
 * and the strip keep the height of what is in them, and it shows no scrollbar of its own — the
 * three share one, below the grid.
 */
function sideways(): Gtk.ScrolledWindow {
    return new Gtk.ScrolledWindow({
        hscrollbarPolicy: Gtk.PolicyType.EXTERNAL,
        vscrollbarPolicy: Gtk.PolicyType.NEVER,
        propagateNaturalHeight: true,
        hexpand: true,
    });
}

/** A full-width line at `top` px, out of the way of the pointer so it never eats a slot click. */
function rule(cssClass: string, thickness: number, top: number): Gtk.Widget {
    const line = new Gtk.Box({ halign: Gtk.Align.FILL, valign: Gtk.Align.START, heightRequest: thickness });
    line.add_css_class(cssClass);
    line.set_margin_top(top);
    line.set_can_target(false);
    return line;
}

/**
 * Whether the pointer is over an item rather than free space. A button handles its own click, but
 * the empty slots of its band are widgets too, and those must still open a slot.
 */
function hitsButton(column: Gtk.Widget, x: number, y: number): boolean {
    let target = column.pick(x, y, Gtk.PickFlags.DEFAULT);
    while (target !== null && target !== column) {
        if (target instanceof Gtk.Button) return true;
        target = target.get_parent();
    }
    return false;
}

function clear(widget: Gtk.Box): void {
    let child = widget.get_first_child();
    while (child) {
        const next = child.get_next_sibling();
        widget.remove(child);
        child = next;
    }
}

function clearFixed(widget: Gtk.Fixed): void {
    let child = widget.get_first_child();
    while (child) {
        const next = child.get_next_sibling();
        widget.remove(child);
        child = next;
    }
}

/** Re-exported so a host can size its own header beside the grid without the rules module. */
export { GUTTER_WIDTH, HOUR_HEIGHT };
