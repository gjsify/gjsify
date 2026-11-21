import GObject from 'gi://GObject?version=2.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

import { SourceBadge } from '../src/source-badge.js';

const META: StoryMeta = {
    title: 'Adwaita Extended/SourceBadge',
    description: "A coloured dot and the source name, dimmed: the marker in a task row's meta line.",
    controls: [
        { name: 'name', label: 'Name', type: ControlType.TEXT, defaultValue: 'Groceries' },
        { name: 'colour', label: 'Colour', type: ControlType.COLOR, defaultValue: '#e66100' },
    ],
};

export class SourceBadgeStory extends StoryWidget {
    private badge: SourceBadge | null = null;

    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwStorySourceBadge' }, SourceBadgeStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(SourceBadgeStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...META, component: SourceBadge.$gtype };
    }

    initialize(): void {
        this.badge = new SourceBadge();
        this.addContent(this.badge);
        this.refresh();
    }

    updateArgs(_args: StoryArgs): void {
        this.refresh();
    }

    private refresh(): void {
        this.badge?.setSource(String(this.args.name), String(this.args.colour));
    }
}

GObject.type_ensure(SourceBadgeStory.$gtype);

export const SourceBadgeStories: StoryModule = { stories: [SourceBadgeStory] };
