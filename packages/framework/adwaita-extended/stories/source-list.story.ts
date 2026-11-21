import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

import { onSignal } from '../src/signals.js';
import { SourceList, type SourceSection } from '../src/source-list.js';

const META: StoryMeta = {
    title: 'Adwaita Extended/SourceList',
    description:
        'Sources in titled sections; a tap toggles visibility. Rows sharing a name get a dimmed account suffix.',
    controls: [
        { name: 'duplicates', label: 'Same name in two sections', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};

function sections(duplicates: boolean): SourceSection[] {
    return [
        {
            title: 'Calendars',
            sources: [
                { id: 'c1', name: 'Personal', colour: '#3584e4', visible: true, account: 'alex@example.org' },
                { id: 'c2', name: 'Birthdays', colour: '#c64600', visible: true, account: 'alex@example.org' },
            ],
        },
        {
            title: 'Task lists',
            sources: [
                {
                    id: 't1',
                    name: duplicates ? 'Personal' : 'Chores',
                    colour: '#33d17a',
                    visible: true,
                    account: 'sam@example.com',
                },
                { id: 't2', name: 'Groceries', colour: '#e5a50a', visible: false, account: 'sam@example.com' },
            ],
        },
        {
            title: 'Boards',
            sources: [{ id: 'b1', name: 'Roadmap', colour: '#9141ac', visible: true, account: 'sam@example.com' }],
        },
    ];
}

export class SourceListStory extends StoryWidget {
    private list: SourceList | null = null;
    private readonly status = new Gtk.Label({ label: 'Tap a row', xalign: 0 });

    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwStorySourceList' }, SourceListStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(SourceListStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...META, component: SourceList.$gtype };
    }

    initialize(): void {
        this.list = new SourceList();
        onSignal(this.list, 'source-toggled', (_l: SourceList, id: string, visible: boolean) => {
            this.status.set_label(`${id} → ${visible ? 'visible' : 'hidden'}`);
        });
        this.status.add_css_class('dim-label');
        const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12 });
        box.append(this.list);
        box.append(this.status);
        this.addContent(box);
        this.refresh();
    }

    updateArgs(_args: StoryArgs): void {
        this.refresh();
    }

    private refresh(): void {
        this.list?.setSections(sections(Boolean(this.args.duplicates)));
    }
}

GObject.type_ensure(SourceListStory.$gtype);

export const SourceListStories: StoryModule = { stories: [SourceListStory] };
