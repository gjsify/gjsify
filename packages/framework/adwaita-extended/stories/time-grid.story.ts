import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

import { sampleEvents } from './month-grid.story.js';
import { onSignal } from '../src/signals.js';
import { TimeGrid } from '../src/time-grid.js';

const META: StoryMeta = {
    title: 'Adwaita Extended/TimeGrid',
    description:
        'One to seven day columns over an hour gutter. Overlapping items share the width of their cluster; all-day and multi-day items go to the strip above. Clicking free space opens a quarter-hour slot.',
    controls: [
        {
            name: 'days',
            label: 'Day columns',
            type: ControlType.SELECT,
            options: [
                { label: '1 day', value: 1 },
                { label: '3 days', value: 3 },
                { label: '7 days', value: 7 },
            ],
            defaultValue: 7,
        },
        { name: 'startHour', label: 'First hour', type: ControlType.NUMBER, defaultValue: 7 },
        { name: 'endHour', label: 'Last hour', type: ControlType.NUMBER, defaultValue: 20 },
        { name: 'nowLine', label: 'Now line', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'empty', label: 'No events', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};

export class TimeGridStory extends StoryWidget {
    private grid: TimeGrid | null = null;
    private readonly log = new Gtk.Label({ label: 'Nothing activated yet', xalign: 0 });

    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwStoryTimeGrid' }, TimeGridStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(TimeGridStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...META, component: TimeGrid.$gtype };
    }

    initialize(): void {
        this.grid = new TimeGrid();
        this.grid.set_size_request(320, 420);
        this.grid.set_vexpand(true);
        onSignal(this.grid, 'item-activated', (id: string) => this.log.set_label(`item-activated(${id})`));
        onSignal(this.grid, 'slot-activated', (date: string, minute: number) =>
            this.log.set_label(`slot-activated(${date}, ${minute})`),
        );
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
        // A fixed week and a fixed "now", so the story looks the same every run.
        this.grid.setRange('2024-01-08', Number(this.args.days ?? 7));
        this.grid.setVisibleHours(Number(this.args.startHour ?? 7), Number(this.args.endHour ?? 20));
        this.grid.setNow(this.args.nowLine === false ? null : new Date(2024, 0, 10, 13, 20));
        this.grid.setItems(this.args.empty === true ? [] : sampleEvents());
        this.grid.scrollToHour(Number(this.args.startHour ?? 7));
    }
}

GObject.type_ensure(TimeGridStory.$gtype);

export const TimeGridStories: StoryModule = { stories: [TimeGridStory] };
