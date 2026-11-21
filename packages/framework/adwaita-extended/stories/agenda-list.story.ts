import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

import { AgendaList } from '../src/agenda-list.js';
import { sampleEvents } from './month-grid.story.js';
import { onSignal } from '../src/signals.js';

const META: StoryMeta = {
    title: 'Adwaita Extended/AgendaList',
    description:
        'What happens next, as a list: a heading per day, all-day items first, then the timed ones. A multi-day item appears under every day it touches, with an arrow saying where in it that day sits.',
    controls: [
        { name: 'window', label: 'Limit to one week', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'today', label: 'Mark a day as today', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'empty', label: 'No events', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};

export class AgendaListStory extends StoryWidget {
    private list: AgendaList | null = null;
    private readonly log = new Gtk.Label({ label: 'Nothing activated yet', xalign: 0 });

    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwStoryAgendaList' }, AgendaListStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(AgendaListStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...META, component: AgendaList.$gtype };
    }

    initialize(): void {
        this.list = new AgendaList();
        this.list.set_size_request(300, 420);
        this.list.set_vexpand(true);
        onSignal(this.list, 'item-activated', (id: string) => this.log.set_label(`item-activated(${id})`));
        this.log.add_css_class('dim-label');

        const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8 });
        box.append(this.list);
        box.append(this.log);
        this.addContent(box);
        this.refresh();
    }

    updateArgs(_args: StoryArgs): void {
        this.refresh();
    }

    private refresh(): void {
        if (!this.list) return;
        // A fixed month and a fixed "today", so the story looks the same every run.
        this.list.setToday(this.args.today === false ? null : new Date(2024, 0, 8));
        this.list.setWindow(this.args.window === true ? '2024-01-08' : null, this.args.window === true ? 7 : null);
        this.list.setItems(this.args.empty === true ? [] : sampleEvents());
    }
}

GObject.type_ensure(AgendaListStory.$gtype);

export const AgendaListStories: StoryModule = { stories: [AgendaListStory] };
