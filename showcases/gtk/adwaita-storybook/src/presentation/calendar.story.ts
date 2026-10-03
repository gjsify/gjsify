// Gtk.Calendar — the month grid, with the marks and the four arrows.
// original implementation.

import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { CALENDAR_STORY_DATE, CALENDAR_STORY_MARKS, calendarMeta } from './calendar.meta.js';

/** Story: a Gtk.Calendar on a fixed date, so a screenshot is the same on every machine. */
export class CalendarStory extends StoryWidget {
    private _calendar: Gtk.Calendar | null = null;
    private _marked = false;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookCalendar' }, CalendarStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(CalendarStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...calendarMeta, component: Gtk.Calendar.$gtype };
    }

    initialize(): void {
        this._calendar = new Gtk.Calendar({ hexpand: false });
        // `GtkCalendar:date` holds a GDateTime; the deprecated year/month/day halves are the
        // same write, and a template cannot construct one, so the story sets the object.
        this._calendar.date = parseIso(CALENDAR_STORY_DATE);
        this._apply();
        this.addContent(this._calendar);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._calendar) return;
        // Both default TRUE and one defaults FALSE (gtkcalendar.c:440-460), so the args write
        // the values rather than the absences.
        this._calendar.show_heading = this.args.showHeading as boolean;
        this._calendar.show_day_names = this.args.showDayNames as boolean;
        this._calendar.show_week_numbers = this.args.showWeekNumbers as boolean;

        // `mark_day()` is IDEMPOTENT and the table is 31 slots, so marking twice is silent
        // (gtkcalendar.c:1657) — but clearing first is what makes an arg change visible at all.
        if (this._marked) this._calendar.clear_marks();
        for (const day of CALENDAR_STORY_MARKS) this._calendar.mark_day(day);
        this._marked = true;
    }
}

/** `YYYY-MM-DD` → a local `GDateTime`, which is what `GtkCalendar:date` holds. */
function parseIso(iso: string): Gio.DateTime {
    const [year, month, day] = iso.split('-').map(Number);
    return new Gio.DateTime({ year: year!, month: month!, day: day! });
}

GObject.type_ensure(CalendarStory.$gtype);

export const CalendarStories: StoryModule = { stories: [CalendarStory] };
