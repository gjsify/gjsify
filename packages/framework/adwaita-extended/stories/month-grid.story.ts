import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

import type { CalendarEvent } from '../src/calendar-event.js';
import { MonthGrid } from '../src/month-grid.js';
import { onSignal } from '../src/signals.js';
import type { SizeClass } from '../src/size-class.js';

const GREEN = '#2ec27e';
const BLUE = '#3584e4';
const ORANGE = '#e66100';
const PURPLE = '#9141ac';

/** Invented story data: a garden club's January, nothing real. */
export function sampleEvents(year = 2024, month = 1): CalendarEvent[] {
    const allDay = (id: string, day: number, days: number, title: string, colour: string): CalendarEvent => ({
        id,
        start: { year, month, day },
        end: { year, month, day: day + days },
        allDay: true,
        payload: { title, colour },
    });
    const timed = (
        id: string,
        day: number,
        from: [number, number],
        to: [number, number],
        title: string,
        colour: string,
        location?: string,
    ): CalendarEvent => ({
        id,
        start: { year, month, day, hour: from[0], minute: from[1] },
        end: { year, month, day, hour: to[0], minute: to[1] },
        allDay: false,
        payload: { title, colour, location },
    });

    return [
        allDay('seed-week', 3, 6, 'Seed swap week', GREEN),
        allDay('frost', 9, 1, 'Frost warning', BLUE),
        allDay('hall', 15, 3, 'Community hall booked', ORANGE),
        timed('standup', 8, [9, 0], [9, 30], 'Weekly planning', BLUE, 'Potting shed'),
        timed('compost', 8, [9, 15], [10, 45], 'Compost workshop', GREEN, 'Plot 4'),
        timed('tools', 8, [10, 0], [11, 0], 'Tool sharpening', ORANGE),
        timed('newsletter', 8, [14, 0], [15, 0], 'Newsletter layout', PURPLE),
        timed('visit', 11, [16, 30], [18, 0], 'Nursery visit', PURPLE, 'Greenhouse lane'),
        timed('talk', 17, [19, 0], [20, 30], 'Talk: winter pruning', GREEN, 'Community hall'),
        timed('market', 24, [8, 0], [12, 0], 'Farmers market stall', ORANGE, 'Market square'),
        timed('fees', 29, [11, 0], [11, 30], 'Collect membership fees', BLUE),
    ];
}

const META: StoryMeta = {
    title: 'Adwaita Extended/MonthGrid',
    description:
        'A month of days with the items on them: titled bars from medium up, one dot per item in compact where a cell is too narrow for a title. Geometry comes from @gjsify/calendar-layout.',
    controls: [
        {
            name: 'sizeClass',
            label: 'Size class',
            type: ControlType.SELECT,
            options: [
                { label: 'Compact', value: 'compact' },
                { label: 'Medium', value: 'medium' },
                { label: 'Wide', value: 'wide' },
            ],
            defaultValue: 'wide',
        },
        { name: 'weekNumbers', label: 'ISO week numbers', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'mondayFirst', label: 'Week starts on Monday', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'empty', label: 'No events', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};

export class MonthGridStory extends StoryWidget {
    private grid: MonthGrid | null = null;
    private readonly log = new Gtk.Label({ label: 'Nothing activated yet', xalign: 0 });

    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwStoryMonthGrid' }, MonthGridStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(MonthGridStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...META, component: MonthGrid.$gtype };
    }

    initialize(): void {
        this.grid = new MonthGrid();
        this.grid.set_size_request(320, 380);
        this.grid.set_vexpand(true);
        // A fixed month and a fixed "today", so the story looks the same every run.
        this.grid.setMonth(2024, 1);
        this.grid.setToday(new Date(2024, 0, 17));
        this.grid.setSelected('2024-01-17');
        onSignal(this.grid, 'day-activated', (date: string) => this.log.set_label(`day-activated(${date})`));
        onSignal(this.grid, 'item-activated', (id: string) => this.log.set_label(`item-activated(${id})`));
        this.log.add_css_class('dim-label');

        const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8 });
        box.append(this.grid);
        box.append(this.log);
        this.addContent(box);
        this.refresh();
    }

    updateArgs(_args: StoryArgs): void {
        this.refresh();
    }

    private refresh(): void {
        if (!this.grid) return;
        this.grid.setSizeClass(String(this.args.sizeClass) as SizeClass);
        this.grid.setShowWeekNumbers(Boolean(this.args.weekNumbers));
        this.grid.setFirstWeekday(this.args.mondayFirst === false ? 0 : 1);
        this.grid.setItems(this.args.empty === true ? [] : sampleEvents());
    }
}

GObject.type_ensure(MonthGridStory.$gtype);

export const MonthGridStories: StoryModule = { stories: [MonthGridStory] };
