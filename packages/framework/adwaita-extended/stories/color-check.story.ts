import GObject from '@girs/gobject-2.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

import { ColorCheck } from '../src/color-check.js';

const META: StoryMeta = {
    title: 'Adwaita Extended/ColorCheck',
    description: 'A round check button tinted with a source colour; follows dark mode.',
    controls: [
        { name: 'colour', label: 'Colour', type: ControlType.COLOR, defaultValue: '#3584e4' },
        { name: 'active', label: 'Checked', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};

export class ColorCheckStory extends StoryWidget {
    private check: ColorCheck | null = null;

    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwStoryColorCheck' }, ColorCheckStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ColorCheckStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...META, component: ColorCheck.$gtype };
    }

    initialize(): void {
        this.check = new ColorCheck('Example');
        this.addContent(this.check);
        this.refresh();
    }

    updateArgs(_args: StoryArgs): void {
        this.refresh();
    }

    private refresh(): void {
        if (!this.check) return;
        this.check.setColour(String(this.args.colour));
        this.check.set_active(Boolean(this.args.active));
    }
}

GObject.type_ensure(ColorCheckStory.$gtype);

export const ColorCheckStories: StoryModule = { stories: [ColorCheckStory] };
