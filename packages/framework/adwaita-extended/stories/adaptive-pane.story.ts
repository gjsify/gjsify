import Adw from '@girs/adw-1';
import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

import { AdaptivePane } from '../src/adaptive-pane.js';
import type { SizeClass } from '../src/size-class.js';

const META: StoryMeta = {
    title: 'Adwaita Extended/AdaptivePane',
    description:
        'One content widget: inspector when wide, dialog when medium, bottom sheet when compact. Change the size class while open; the entry keeps its text.',
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
        { name: 'open', label: 'Open', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};

export class AdaptivePaneStory extends StoryWidget {
    private pane: AdaptivePane | null = null;
    private content: Gtk.Widget | null = null;

    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwStoryAdaptivePane' }, AdaptivePaneStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(AdaptivePaneStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...META, component: AdaptivePane.$gtype };
    }

    initialize(): void {
        this.pane = new AdaptivePane();
        this.pane.set_size_request(560, 320);
        this.pane.setMain(new Adw.StatusPage({ title: 'Main content', iconName: 'view-list-symbolic' }));
        const entry = new Gtk.Entry({
            placeholderText: 'Type here, then resize',
            margin_top: 12,
            margin_start: 12,
            margin_end: 12,
        });
        this.content = entry;
        this.addContent(this.pane);
        this.refresh();
    }

    updateArgs(_args: StoryArgs): void {
        this.refresh();
    }

    teardown(): void {
        this.pane?.close();
    }

    private refresh(): void {
        if (!this.pane || !this.content) return;
        this.pane.setSizeClass(String(this.args.sizeClass) as SizeClass);
        if (this.args.open) {
            if (this.pane.container === null) this.pane.present(this.content, 'Details');
        } else {
            this.pane.close();
        }
    }
}

GObject.type_ensure(AdaptivePaneStory.$gtype);

export const AdaptivePaneStories: StoryModule = { stories: [AdaptivePaneStory] };
