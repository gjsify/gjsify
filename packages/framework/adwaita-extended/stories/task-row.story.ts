import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

import { onSignal } from '../src/signals.js';
import { TaskRow } from '../src/task-row.js';

const META: StoryMeta = {
    title: 'Adwaita Extended/TaskRow',
    description:
        'A task: check in the list colour, two-line title, meta line. Swipe right/left on touch, hover buttons with a pointer.',
    controls: [
        {
            name: 'title',
            label: 'Title',
            type: ControlType.TEXT,
            defaultValue: 'Plan the team offsite and book a room that fits everyone',
        },
        { name: 'listName', label: 'List', type: ControlType.TEXT, defaultValue: 'Work' },
        { name: 'colour', label: 'Colour', type: ControlType.COLOR, defaultValue: '#3584e4' },
        { name: 'writable', label: 'Writable', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'done', label: 'Done', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'hasDue', label: 'Has due date', type: ControlType.BOOLEAN, defaultValue: true },
        {
            name: 'daysFromNow',
            label: 'Days from today',
            type: ControlType.RANGE,
            min: -7,
            max: 14,
            step: 1,
            defaultValue: 0,
        },
        {
            name: 'priority',
            label: 'Priority (0–9)',
            type: ControlType.RANGE,
            min: 0,
            max: 9,
            step: 1,
            defaultValue: 5,
        },
    ],
};

export class TaskRowStory extends StoryWidget {
    private row: TaskRow | null = null;
    private readonly log = new Gtk.Label({ label: 'No events yet', xalign: 0 });

    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwStoryTaskRow' }, TaskRowStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(TaskRowStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...META, component: TaskRow.$gtype };
    }

    initialize(): void {
        this.row = new TaskRow();
        onSignal(this.row, 'toggled', (_r: TaskRow, done: boolean) => this.log.set_label(`toggled(${done})`));
        onSignal(this.row, 'postpone', () => this.log.set_label('postpone'));
        onSignal(this.row, 'activated', () => this.log.set_label('activated'));
        this.log.add_css_class('dim-label');
        const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12, widthRequest: 360 });
        box.append(this.row);
        box.append(this.log);
        this.addContent(box);
        this.refresh();
    }

    updateArgs(_args: StoryArgs): void {
        this.refresh();
    }

    private refresh(): void {
        if (!this.row) return;
        const now = new Date();
        const due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + Number(this.args.daysFromNow));
        this.row.writable = Boolean(this.args.writable);
        this.row.setTask(
            {
                title: String(this.args.title),
                listName: String(this.args.listName),
                colour: String(this.args.colour),
                done: Boolean(this.args.done),
                due: this.args.hasDue ? due : null,
                priority: Number(this.args.priority),
            },
            now,
        );
    }
}

GObject.type_ensure(TaskRowStory.$gtype);

export const TaskRowStories: StoryModule = { stories: [TaskRowStory] };
