// <gtk-calendar> — the month grid: a heading with four navigation arrows, the day-name row, an
// optional week-number column and 42 day cells, the web counterpart of `Gtk.Calendar`.
//
// THE GRID IS `calendarDays` AND FRIENDS, in `@gjsify/adwaita-core` (ADR 0004), because every
// part of it is arithmetic the C does in integers: which days lead the month, which trail it,
// what ISO week each row is, and what a month step lands on when the source day does not exist
// in the target. `calendar.ts` carries the derivations and the vectors; this element holds the
// marks, the focus cell and the date.
//
// `date` IS AN ISO `YYYY-MM-DD` STRING, which is what `GDateTime` is written as in every GTK
// binding and what `Date.parse` reads, so the markup door is the object's own ISO 8601
// serialisation rather than a port-specific encoding. The three DEPRECATED `year` / `month` /
// `day` properties are observed as attributes and kept in step with `date` exactly as
// upstream's setters do — `gtk_calendar_set_year` calls `calendar_select_day_internal` with
// the same day in the new year (gtkcalendar.c:860-880), so a write to `year` and a write to
// `date` are the same operation. They are deprecated in 4.20 in favour of `date` and this
// element says so rather than hiding them.
//
// `month` IS 0-11 HERE, because the attribute is the GIR property and GIR's property is
// 0-indexed — the ONE place this element departs from `GDateTime`'s own 1-12 numbering, and
// the property's own documentation states the range (:419-429). Core functions take 1-12 and
// say so; the boundary is exactly the two attribute readers below.
//
// SHOW-HEADING AND SHOW-DAY-NAMES DEFAULT TRUE, SHOW-WEEK-NUMBERS FALSE (:440-460), so the
// two are INVERTED flags read as `="false"`. The week-number column is a real grid COLUMN and
// not a decoration: upstream the day numbers are attached at column `1 + i` and the week
// numbers at column 0 (gtkcalendar.c:776-790), which is why turning the numbers on narrows
// the days rather than overlaying them.
//
// THE THREE ARROWS' SENSE. A cell belonging to the PREVIOUS month, activated with Space,
// pages BACK and selects that day (`calendar_set_month_prev`, gtkcalendar.c:1521-1534), and
// likewise forwards for the next month. The month and year arrows go through
// `calendar_select_day_internal` with `emit_day_signal = FALSE` (:868-919), so paging the
// calendar repaints without telling an application the user picked a day.
//
// WHAT IS NOT HERE: `gtk_calendar_select_day` is a deprecated METHOD in favour of the
// `date` property, so it is `date` here; `GtkDragSource` / `GtkDropTarget` (:543-560, :820-830)
// have no browser counterpart this element can reach for; and the `focus_row` / `focus_col`
// cursor is INTERNAL state upstream with no property, so it is the roving focus of the grid
// here — arrows move it, `Space` acts on the cell it is on, which is the C's `move_focus` +
// Space branch (gtkcalendar.c:1386-1534).
//
// Reference: refs/gtk/gtk/gtkcalendar.c:134-178 (the tables), :372-540 (properties, signals,
//   css name), :564-861 (the widget tree and the defaults), :923-1084 (the grid, the labels, the
//   navigation buttons), :1089-1192 (select_day_internal), :1311-1353 (the click), :1386-1534
//   (move_focus and the key table), :1564-1782 (the public API)
// Reference: refs/libadwaita/src/stylesheet/widgets/_calendar.scss:1-58
// Copyright (c) GNOME contributors (GTK/libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the date arithmetic
// composed from @gjsify/adwaita-core.

import {
    CALENDAR_YEAR_MAX,
    CALENDAR_YEAR_MIN,
    calendarClearMarks,
    calendarDayIsMarked,
    calendarDays,
    calendarMarkDay,
    calendarNavigationButtons,
    calendarSelectDay,
    calendarStep,
    calendarWeekNumber,
    calendarWeekStart,
    type AdwCalendarCell,
    type AdwCalendarSelectResult,
    type AdwCalendarDate,
    type AdwCalendarStep,
} from '@gjsify/adwaita-core';

import { createGtkImage } from './gtk-image.js';

/** The seven abbreviated day names, Sunday first — `default_abbreviated_dayname` (:745-757). */
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The twelve month names — `default_monthname` (:759-786), which strftime-falls-back to `%B`. */
const MONTH_NAMES = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];

/** The four arrows, in the order `gtk_calendar_init` appends them (:600-616). */
const ARROWS: readonly { step: AdwCalendarStep; icon: string; tooltip: string }[] = [
    { step: 'previous-month', icon: 'go-previous', tooltip: 'Previous Month' },
    { step: 'next-month', icon: 'go-next', tooltip: 'Next Month' },
    { step: 'previous-year', icon: 'go-up', tooltip: 'Previous Year' },
    { step: 'next-year', icon: 'go-down', tooltip: 'Next Year' },
];

/** The arrow a cell's disabled state keys off — `calendar_update_navigation_buttons` (:1055-1084). */
type ArrowName = 'previousMonth' | 'nextMonth' | 'previousYear' | 'nextYear';

export class GtkCalendar extends HTMLElement {
    private _headerEl!: HTMLDivElement;
    private _monthEl!: HTMLSpanElement;
    private _yearEl!: HTMLSpanElement;
    private _arrowEls: Record<ArrowName, HTMLButtonElement> = {} as Record<ArrowName, HTMLButtonElement>;
    private _gridEl!: HTMLDivElement;
    private _dayNameEls: HTMLSpanElement[] = [];
    private _weekNumberEls: HTMLSpanElement[] = [];
    private _cellEls: HTMLButtonElement[] = [];
    private _marked: boolean[] = calendarClearMarks();
    private _date: AdwCalendarDate;
    /** `focus_row` / `focus_col` collapsed into one index into the 42 cells, -1 for neither. */
    private _focus = -1;
    private _initialized = false;

    static get observedAttributes() {
        return ['date', 'year', 'month', 'day', 'show-heading', 'show-day-names', 'show-week-numbers', 'week-start'];
    }

    /**
     * `GtkCalendar:date` — the selected date as `YYYY-MM-DD`, `GDateTime`'s own ISO form.
     *
     * Unset means TODAY, which is what `gtk_calendar_init` seeds it with
     * (`g_date_time_new_now_local`, gtkcalendar.c:851) — so the getter answers today when no
     * attribute is present, rather than the epoch the C starts from before its first select.
     */
    get date(): string {
        return toIsoDate(this._date);
    }

    set date(value: string) {
        this.setAttribute('date', value);
    }

    /** `GtkCalendar:year` — DEPRECATED in 4.20 in favour of `date` (:396-403). */
    get year(): number {
        return this._date.year;
    }

    set year(value: number) {
        this.setAttribute('year', String(value));
    }

    /**
     * `GtkCalendar:month` — DEPRECATED in 4.20, and 0-11, not 1-12 (:405-417). The one place
     * this element is not in `GDateTime`'s own numbering, and it is the attribute that says so.
     */
    get month(): number {
        return this._date.month - 1;
    }

    set month(value: number) {
        this.setAttribute('month', String(value));
    }

    /** `GtkCalendar:day` — DEPRECATED in 4.20 in favour of `date` (:419-428). */
    get day(): number {
        return this._date.day;
    }

    set day(value: number) {
        this.setAttribute('day', String(value));
    }

    /** Default TRUE (:441-443), so the attribute is the OFF switch. */
    get showHeading(): boolean {
        return this.getAttribute('show-heading') !== 'false';
    }

    set showHeading(value: boolean) {
        this.setAttribute('show-heading', String(!!value));
    }

    /** Default TRUE (:450-452), read the same way. */
    get showDayNames(): boolean {
        return this.getAttribute('show-day-names') !== 'false';
    }

    set showDayNames(value: boolean) {
        this.setAttribute('show-day-names', String(!!value));
    }

    /** Default FALSE (:458-460), read the same way. */
    get showWeekNumbers(): boolean {
        return this.hasAttribute('show-week-numbers');
    }

    set showWeekNumbers(value: boolean) {
        this.toggleAttribute('show-week-numbers', !!value);
    }

    /**
     * Which day the grid's first column is — `calendar->week_start`, PORT-ONLY.
     *
     * The C reads it out of the locale (`_NL_TIME_FIRST_WEEKDAY` plus `_NL_TIME_WEEK_1STDAY`,
     * gtkcalendar.c:700-718) and has no property for it, and this port does the same by
     * default through `Intl.Locale.getWeekInfo()`. The ATTRIBUTE is the addition, and it is
     * what makes a gallery preview reproducible: a grid whose leading blanks follow the
     * machine's locale is a screenshot that differs per reader, and the C's own
     * `calendar:week_start:0` translatable string (gtkcalendar.c:712-719) is the same
     * override upstream.
     *
     * 0 is Sunday and 6 is Saturday — `GDateTime`'s own numbering, so it is the value
     * `calendarDays` subtracts with and the value every vector table carries.
     */
    get weekStart(): number {
        const authored = this.getAttribute('week-start');
        if (authored !== null) {
            const parsed = Number.parseInt(authored, 10);
            if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 6) return parsed;
        }
        return localeWeekStart();
    }

    set weekStart(value: number) {
        this.setAttribute('week-start', String(value));
    }

    /** The 31-slot table — `gtk_calendar_get_day_is_marked`, so a mark does not change state. */
    get markedDays(): number[] {
        return this._marked.flatMap((mark, index) => (mark ? [index + 1] : []));
    }

    constructor() {
        super();
        this._date = today();
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._buildHeader();
        this._buildGrid();
        // The C parents the header and then the grid onto the widget itself
        // (gtkcalendar.c:620, :816) under a vertical `Gtk.BoxLayout` (:849-850), which is the
        // `flex-direction: column` in `_calendar.scss`.
        this.replaceChildren(this._headerEl, this._gridEl);

        this.addEventListener('keydown', (event) => this._onKeyDown(event));

        // Every write goes through `selectDay`, so the early return that makes a no-op write
        // silent (gtkcalendar.c:1103-1104) applies to the ATTRIBUTE door too.
        this._adoptAttributes();
        this._render();
    }

    attributeChangedCallback(name?: string) {
        if (!this._initialized) return;
        // The RESULT, not just the date: `calendar_select_day_internal` (:1103-1104) returns
        // EARLY when nothing changed, so the notify and the signal are gated on the three
        // booleans it computes — and an element UPGRADED with attributes already on it runs
        // through here for each of them, which is exactly that "nothing changed" case.
        const result = this._adoptAttributes(name);
        this._render();
        if (name === 'date' || name === 'year' || name === 'month' || name === 'day') {
            this._emitDaySelected(result);
        }
    }

    /** `gtk_calendar_mark_day` (:1650-1666). */
    markDay(day: number): void {
        const next = calendarMarkDay(this._marked, day, true);
        if (next === this._marked) return;
        this._marked = next;
        this._paintStates();
        this.dispatchEvent(
            new CustomEvent('notify::marked-days', { bubbles: true, detail: { markedDays: this.markedDays } }),
        );
    }

    /** `gtk_calendar_unmark_day` (:1686-1704). */
    unmarkDay(day: number): void {
        const next = calendarMarkDay(this._marked, day, false);
        if (next === this._marked) return;
        this._marked = next;
        this._paintStates();
        this.dispatchEvent(
            new CustomEvent('notify::marked-days', { bubbles: true, detail: { markedDays: this.markedDays } }),
        );
    }

    /** `gtk_calendar_get_day_is_marked` (:1668-1682). */
    dayIsMarked(day: number): boolean {
        return calendarDayIsMarked(this._marked, day);
    }

    /** `gtk_calendar_clear_marks` (:1589-1613). */
    clearMarks(): void {
        this._marked = calendarClearMarks();
        this._paintStates();
        this.dispatchEvent(new CustomEvent('notify::marked-days', { bubbles: true, detail: { markedDays: [] } }));
    }

    /** The six rows of seven, as the C's `day[row][col]` pair. */
    get cells(): readonly AdwCalendarCell[] {
        return calendarDays(this._date.year, this._date.month, this.weekStart);
    }

    /** The date every write resolves against. */
    get selectedDate(): AdwCalendarDate {
        return { ...this._date };
    }

    private _buildHeader(): void {
        this._headerEl = document.createElement('div');
        this._headerEl.className = 'adw-calendar-header';

        const names: Record<ArrowName, { icon: string; tooltip: string }> = {
            previousMonth: { icon: ARROWS[0]!.icon, tooltip: ARROWS[0]!.tooltip },
            nextMonth: { icon: ARROWS[1]!.icon, tooltip: ARROWS[1]!.tooltip },
            previousYear: { icon: ARROWS[2]!.icon, tooltip: ARROWS[2]!.tooltip },
            nextYear: { icon: ARROWS[3]!.icon, tooltip: ARROWS[3]!.tooltip },
        };

        const button = (name: ArrowName, expand: boolean, align: 'start' | 'center' | 'end') => {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'adw-calendar-nav-button flat';
            el.title = names[name].tooltip;
            el.setAttribute('aria-label', names[name].tooltip);
            if (expand) el.classList.add('expand');
            el.style.justifySelf = align;
            el.addEventListener('click', () => this._onArrow(name));
            el.appendChild(createGtkImage(names[name].icon, 'adw-calendar-nav-icon'));
            this._arrowEls[name] = el;
            return el;
        };

        this._monthEl = document.createElement('span');
        this._monthEl.className = 'adw-calendar-month';
        this._yearEl = document.createElement('span');
        this._yearEl.className = 'adw-calendar-year';

        // The C's order is prev-month, month-name, next-month, prev-year, year-label,
        // next-year (gtkcalendar.c:618-622), and the middle month name EXPANDS.
        this._headerEl.append(
            button('previousMonth', false, 'start'),
            this._monthEl,
            button('nextMonth', true, 'start'),
            button('previousYear', false, 'center'),
            this._yearEl,
            button('nextYear', false, 'end'),
        );
        // Only the month-name stack hexpands; the year label gets a fixed slot so changing the
        // year does not change the calendar's width (gtkcalendar.c:854-858).
        this._monthEl.style.flex = '1';
        this._yearEl.style.paddingInline = '6px';
    }

    private _buildGrid(): void {
        this._gridEl = document.createElement('div');
        this._gridEl.className = 'adw-calendar-grid';

        for (let index = 0; index < 7; index++) {
            const label = document.createElement('span');
            label.className = 'adw-calendar-day-name';
            this._dayNameEls.push(label);
            this._gridEl.appendChild(label);
        }
        // A leading spacer, so the week-number column exists even while the numbers are off:
        // upstream the week numbers are grid column 0 whether or not they are VISIBLE
        // (gtkcalendar.c:786-790), and the day numbers stay at `1 + i`.
        const spacer = document.createElement('span');
        spacer.className = 'adw-calendar-week-spacer';
        spacer.setAttribute('aria-hidden', 'true');
        this._gridEl.appendChild(spacer);

        for (let index = 0; index < 6; index++) {
            const week = document.createElement('span');
            week.className = 'adw-calendar-week-number';
            this._weekNumberEls.push(week);
            this._gridEl.appendChild(week);

            for (let column = 0; column < 7; column++) {
                const cell = document.createElement('button');
                cell.type = 'button';
                cell.className = 'adw-calendar-cell day-number';
                cell.addEventListener('click', () => this._onCellClick(Number(cell.dataset.index ?? '0')));
                this._cellEls.push(cell);
                this._gridEl.appendChild(cell);
            }
        }
    }

    /**
     * Resolve the attributes into the one date they all name.
     *
     * THE ATTRIBUTE THAT CHANGED WINS, which is the C's own rule:
     * `gtk_calendar_set_year` builds a new `GDateTime` from the same day in the new year and
     * hands it to the same `calendar_select_day_internal` (gtkcalendar.c:860-880), so a write
     * to a deprecated half AFTER a `date` write MOVES the date rather than being ignored for
     * one being on the element. Reading `date` unconditionally would pin the element to its
     * first write.
     *
     * At connect no attribute has "changed" and `date` wins, because it is the one the three
     * halves are deprecated IN FAVOUR of. With none of them the answer is today, which is what
     * `gtk_calendar_init` seeds (:849-851).
     */
    private _adoptAttributes(changed?: string): AdwCalendarSelectResult {
        const iso = this.getAttribute('date');
        const half = changed === 'year' || changed === 'month' || changed === 'day';
        if (iso !== null && !half) {
            const parsed = parseIsoDate(iso);
            if (parsed !== null) {
                const result = calendarSelectDay(this._date, parsed, false);
                this._date = result.date;
                return result;
            }
        }
        const target = {
            // Each half is read only when present, so `year` alone keeps the current month and
            // day — as `gtk_calendar_set_year` does.
            year: integer(this.getAttribute('year'), this._date.year),
            // The GIR property is 0-11 (gtkcalendar.c:419-429); the core functions are 1-12.
            month: integer(this.getAttribute('month'), this._date.month - 1) + 1,
            day: integer(this.getAttribute('day'), this._date.day),
        };
        const result = calendarSelectDay(this._date, target, false);
        this._date = result.date;
        return result;
    }

    /**
     * Repaint everything the date decides: the heading, the 42 cells' text and classes, the six
     * week numbers and the four arrows' sensitivity.
     *
     * The cells are NOT rebuilt — the same 42 buttons are reused and re-pointed, so a focus
     * cell and its scroll position survive a month change, which is what `calendar_queue_refresh`
     * gets from the widget layer upstream.
     */
    private _render(): void {
        this._monthEl.textContent = MONTH_NAMES[this._date.month - 1]!;
        this._yearEl.textContent = String(this._date.year);

        const cells = calendarDays(this._date.year, this._date.month, this.weekStart);
        cells.forEach((cell, index) => {
            const el = this._cellEls[index]!;
            el.dataset.index = String(index);
            el.textContent = String(cell.date.day);
            el.setAttribute('aria-label', `${MONTH_NAMES[cell.date.month - 1]} ${cell.date.day}, ${cell.date.year}`);
            el.classList.toggle('other-month', cell.month !== 'current');
        });

        this._paintWeekNumbers(cells);
        this._paintStates();
        this._paintArrows();
        this._paintDayNames();
        this._paintVisibility();
    }

    /**
     * The six week numbers — `week_of_year` of the LAST cell of each row, which is the C's own
     * rule (gtkcalendar.c:1143-1165): the row's week is the week its Sunday-through-Saturday
     * run belongs to, and the row's last cell is its Saturday.
     */
    private _paintWeekNumbers(cells: readonly AdwCalendarCell[]): void {
        for (let row = 0; row < 6; row++) {
            const last = cells[row * 7 + 6]!;
            this._weekNumberEls[row]!.textContent = String(calendarWeekNumber(last.date));
        }
    }

    /** The per-cell state flags `calendar_update_day_labels` raises (:979-1053). */
    private _paintStates(): void {
        const cells = calendarDays(this._date.year, this._date.month, this.weekStart);
        const now = today();
        const todayDay = now.year === this._date.year && now.month === this._date.month ? now.day : -1;
        cells.forEach((cell, index) => {
            const el = this._cellEls[index]!;
            const isSelected = cell.month === 'current' && cell.date.day === this._date.day;
            // `lower_limit_reached` / `upper_limit_reached` (:1002-1003) blank the cells that
            // would leave the supported year range entirely.
            const beyondRange =
                (cell.month === 'previous' && this._date.year === CALENDAR_YEAR_MIN && this._date.month === 1) ||
                (cell.month === 'next' && this._date.year === CALENDAR_YEAR_MAX && this._date.month === 12);
            el.classList.toggle('selected', isSelected);
            el.classList.toggle('marked', cell.month === 'current' && calendarDayIsMarked(this._marked, cell.date.day));
            el.classList.toggle('today', cell.date.day === todayDay && cell.month === 'current');
            el.classList.toggle('focused', index === this._focus);
            el.disabled = beyondRange;
            if (beyondRange) el.textContent = '';
            else el.textContent = String(cell.date.day);
        });
    }

    /** `calendar_update_navigation_buttons` (:1055-1084). */
    private _paintArrows(): void {
        const live = calendarNavigationButtons(this._date);
        for (const name of ['previousMonth', 'nextMonth', 'previousYear', 'nextYear'] as const) {
            this._arrowEls[name].disabled = !live[name];
        }
    }

    private _paintDayNames(): void {
        for (let index = 0; index < 7; index++) {
            // `day = (i + calendar->week_start) % 7` (gtkcalendar.c:773).
            this._dayNameEls[index]!.textContent = DAY_NAMES[(index + this.weekStart) % 7]!;
        }
    }

    /**
     * `show_heading`, `show_day_names` and `show_week_numbers` — the three visibility flags
     * `gtk_calendar_init` and the setters flip (gtkcalendar.c:815-816, :1690-1700,
     * :1756-1762). One of them hides the whole header BOX and the other two a row of labels,
     * which is why they are one method rather than three writes.
     */
    private _paintVisibility(): void {
        this._headerEl.hidden = !this.showHeading;
        for (const label of this._dayNameEls) label.hidden = !this.showDayNames;
        for (const label of this._weekNumberEls) label.hidden = !this.showWeekNumbers;
    }

    private _onArrow(name: ArrowName): void {
        const step = ARROWS.find((arrow) => arrowNameOf(arrow.step) === name)?.step;
        if (step === undefined || this._arrowEls[name].disabled) return;
        this._navigate(step);
    }

    /**
     * `calendar_set_month_prev` and its three siblings: step the date, select it WITHOUT
     * `emit_day_signal`, then emit the arrow's own signal (:868-919).
     */
    private _navigate(step: AdwCalendarStep): void {
        const before = this._date;
        this._date = calendarSelectDay(before, calendarStep(before, step), false).date;
        if (this._focus >= 0) {
            const cells = this.cells;
            const focus = cells[this._focus];
            // The cursor follows the month when the day it was on is still in the grid, which
            // upstream happens by the focus CELL surviving the repaint (gtkcalendar.c:1017-1020).
            const moved = cells.findIndex((cell) => cell.month === focus?.month && cell.date.day === focus.date.day);
            this._focus = moved >= 0 ? moved : -1;
        }
        this._render();
        this.dispatchEvent(new CustomEvent('notify::date', { bubbles: true, detail: { date: this.date } }));
        const signals: Record<AdwCalendarStep, string> = {
            'previous-month': 'prev-month',
            'next-month': 'next-month',
            'previous-year': 'prev-year',
            'next-year': 'next-year',
        };
        this.dispatchEvent(new CustomEvent(signals[step], { bubbles: true }));
    }

    /**
     * The C's tail, line for line (:1169-1190): `::day-selected` and the `day` notify INSIDE
     * `if (day_changed)`, the `month` and `year` notifies each inside its own, and `date`
     * unconditionally — because the function that got here changed something.
     */
    private _emitDaySelected(result: AdwCalendarSelectResult): void {
        const notify = (attribute: string, value: number | string) =>
            this.dispatchEvent(
                new CustomEvent(`notify::${attribute}`, { bubbles: true, detail: { [attribute]: value } }),
            );
        if (result.dayChanged) {
            this.dispatchEvent(new CustomEvent('day-selected', { bubbles: true }));
            notify('day', this._date.day);
        }
        if (result.monthChanged) notify('month', this._date.month - 1);
        if (result.yearChanged) notify('year', this._date.year);
        notify('date', this.date);
    }

    /**
     * A click on a cell — `calendar_select_and_focus_day` reached from
     * `gtk_calendar_button_press` (:1311-1353).
     *
     * A cell from another month PAGES first: that is the `MONTH_PREV` / `MONTH_NEXT` branch of
     * the Space handler (:1521-1534), and a click lands on the same cell either way.
     */
    private _onCellClick(index: number): void {
        const cell = this.cells[index];
        if (cell === undefined) return;
        this._focus = index;
        if (cell.month === 'previous') this._navigate('previous-month');
        else if (cell.month === 'next') this._navigate('next-month');
        this._selectDate(cell.date, true);
    }

    /**
     * `calendar_select_and_focus_day` (:1195-1213) — the date, WITH `::day-selected`, and the
     * cursor on it.
     */
    private _selectDate(date: AdwCalendarDate, interactive: boolean): void {
        const result = calendarSelectDay(this._date, date, interactive);
        if (!result.dayChanged && !result.monthChanged && !result.yearChanged) {
            this._render();
            return;
        }
        this._date = result.date;
        const cell = this.cells.findIndex(
            (candidate) => candidate.month === 'current' && candidate.date.day === this._date.day,
        );
        if (cell >= 0) this._focus = cell;
        this._render();
        this._emitDaySelected(result);
    }

    /**
     * The key table: arrows move the cursor (`move_focus`, :1386-1452) and Space selects the
     * cell it is on; `Ctrl` with any arrow is the MONTH and YEAR walk (:1454-1534).
     */
    private _onKeyDown(event: KeyboardEvent): void {
        const arrow: Record<string, [number, number]> = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, 1],
            ArrowDown: [0, -1],
        };
        if (event.ctrlKey) {
            const steps: Record<string, AdwCalendarStep> = {
                ArrowLeft: 'previous-month',
                ArrowRight: 'next-month',
                ArrowUp: 'previous-year',
                ArrowDown: 'next-year',
            };
            const step = steps[event.key];
            if (step === undefined) return;
            event.preventDefault();
            // The C refuses the keyboard when the MOUSE would be refused (:1492-1494).
            if (!calendarNavigationButtons(this._date)[arrowNameOf(step)]) return;
            this._navigate(step);
            return;
        }
        if (event.altKey || event.metaKey) return;

        if (event.key === ' ') {
            if (this._focus < 0) return;
            event.preventDefault();
            const cell = this.cells[this._focus];
            if (cell === undefined) return;
            if (cell.month === 'previous') this._navigate('previous-month');
            else if (cell.month === 'next') this._navigate('next-month');
            this._selectDate(cell.date, true);
            return;
        }

        const move = arrow[event.key];
        if (move === undefined) return;
        event.preventDefault();
        this._moveFocus(move[0], move[1]);
    }

    /**
     * `move_focus` (:1386-1452) over the 6x7 grid, wrapping at the edges exactly as the C does
     * (`focus_row < 0 → 5`, `focus_col < 0 → 6`).
     */
    private _moveFocus(direction: number, updown: number): void {
        const cells = this.cells;
        if (cells.length === 0) return;
        // `focus_row` / `focus_col` start at -1 (gtkcalendar.c:817-818), NOT at 0 — and the
        // difference is the only place the wrap branches are reachable: an ArrowUp from an
        // untouched cursor lands on row 5 column 6, the LAST cell, because of exactly those
        // two `if (focus_row < 0) focus_row = 5` / `focus_col < 0 → 6` lines.
        let row = this._focus < 0 ? -1 : Math.trunc(this._focus / 7);
        let column = this._focus < 0 ? -1 : this._focus % 7;

        if (updown === 1) {
            if (row > 0) row--;
            if (row < 0) row = 5;
            if (column < 0) column = 6;
        } else if (updown === -1) {
            if (row < 5) row++;
            if (column < 0) column = 0;
        } else if (direction === -1) {
            if (column > 0) column--;
            else if (row > 0) {
                column = 6;
                row--;
            }
            if (column < 0) column = 6;
            if (row < 0) row = 5;
        } else {
            if (column < 6) column++;
            else if (row < 5) {
                column = 0;
                row++;
            }
            if (column < 0) column = 0;
            if (row < 0) row = 0;
        }

        const next = row * 7 + column;
        // "Not sensitive, not reachable" (:1444-1445) — a cell past the year range is skipped.
        if (this._cellEls[next]?.disabled === true) return;
        this._focus = next;
        this._paintStates();
        this._cellEls[next]?.focus();
    }
}

/** Which of the four arrows a step names — the order `gtk_calendar_init` appends them in (:618-622). */
function arrowNameOf(step: AdwCalendarStep): ArrowName {
    switch (step) {
        case 'previous-month':
            return 'previousMonth';
        case 'next-month':
            return 'nextMonth';
        case 'previous-year':
            return 'previousYear';
        default:
            return 'nextYear';
    }
}

/**
 * The locale's first day of the week — `calendar->week_start`, from `Intl`.
 *
 * `Intl.Locale.prototype.getWeekInfo()` reports `firstDay` as 1 (Monday) through 7 (Sunday),
 * which is exactly the numbering `_NL_TIME_FIRST_WEEKDAY` uses, so `calendarWeekStart`'s own
 * formula applies to it unchanged — there is no second arithmetic here on purpose. A runtime
 * without `getWeekInfo` answers 0 (Sunday), which is what the C's fallback lands on too
 * (gtkcalendar.c:716-718).
 */
function localeWeekStart(): number {
    const language = globalThis.navigator?.language;
    if (typeof language !== 'string') return calendarWeekStart(0, 0);
    const Locale = (Intl as { Locale?: { new (tag: string): { getWeekInfo?: () => { firstDay: number } } } }).Locale;
    if (Locale === undefined) return calendarWeekStart(0, 0);
    const weekInfo = new Locale(language).getWeekInfo?.();
    if (weekInfo === undefined) return calendarWeekStart(0, 0);
    // `firstDay` is 1-7 Monday-to-Sunday; `_NL_TIME_FIRST_WEEKDAY` is 0-6 Sunday-first, and
    // `7 % 7` is the Sunday the two numberings disagree about.
    return calendarWeekStart(weekInfo.firstDay % 7, weekInfo.firstDay === 7 ? 0 : 1);
}

/** Today's date in the local zone — `g_date_time_new_now_local` (:851). */
function today(): AdwCalendarDate {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function toIsoDate(date: AdwCalendarDate): string {
    return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` → a date, or null. A malformed attribute leaves the widget where it was. */
function parseIsoDate(raw: string): AdwCalendarDate | null {
    const match = /^(-?\d{1,6})-(\d{1,2})-(\d{1,2})$/.exec(raw.trim());
    if (match === null) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (year < CALENDAR_YEAR_MIN || year > CALENDAR_YEAR_MAX) return null;
    return { year, month, day };
}

/** A `gint` property read, with the caller's own value standing in for an absent attribute. */
function integer(raw: string | null, fallback: number): number {
    const parsed = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

customElements.define('gtk-calendar', GtkCalendar);
