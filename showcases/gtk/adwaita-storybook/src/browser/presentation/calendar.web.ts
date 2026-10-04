// Browser port of the Calendar story. Shares metadata with calendar.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { CALENDAR_STORY_DATE, CALENDAR_STORY_MARKS, calendarMeta } from '../../presentation/calendar.meta.js';

export class CalendarWebStory extends StoryElement {
    private _calendar: HTMLElement | null = null;
    private _marked = false;

    constructor() {
        super(CalendarWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return calendarMeta;
    }

    initialize(): void {
        this._calendar = document.createElement('gtk-calendar');
        // The ISO form `GDateTime` serialises to, which is what the element's `date` door
        // reads — so the GTK story's GDateTime and this string are the same write.
        this._calendar.setAttribute('date', CALENDAR_STORY_DATE);
        this._apply();
        this.addContent(this._calendar);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._calendar) return;
        // Two of the three default TRUE and one defaults FALSE (gtkcalendar.c:440-460), so
        // all three are written as explicit values.
        this._calendar.setAttribute('show-heading', String(this.args.showHeading as boolean));
        this._calendar.setAttribute('show-day-names', String(this.args.showDayNames as boolean));
        this._calendar.toggleAttribute('show-week-numbers', this.args.showWeekNumbers as boolean);

        const calendar = this._calendar as HTMLElement & {
            markDay(day: number): void;
            clearMarks(): void;
        };
        if (this._marked) calendar.clearMarks();
        for (const day of CALENDAR_STORY_MARKS) calendar.markDay(day);
        this._marked = true;
    }
}

export const CalendarWebStories: WebStoryModule = { stories: [CalendarWebStory] };
