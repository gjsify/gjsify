import GObject from 'gi://GObject?version=2.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

import { DueChip } from '../src/due-chip.js';

const META: StoryMeta = {
    title: 'Adwaita Extended/DueChip',
    description: 'A pill showing how close a due date is: overdue, today, soon, later; hidden without a date.',
    controls: [
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
    ],
};

export class DueChipStory extends StoryWidget {
    private chip: DueChip | null = null;

    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwStoryDueChip' }, DueChipStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(DueChipStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...META, component: DueChip.$gtype };
    }

    initialize(): void {
        this.chip = new DueChip();
        this.addContent(this.chip);
        this.refresh();
    }

    updateArgs(_args: StoryArgs): void {
        this.refresh();
    }

    private refresh(): void {
        if (!this.chip) return;
        const now = new Date();
        const due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + Number(this.args.daysFromNow));
        this.chip.setDue(this.args.hasDue ? due : null, now);
    }
}

GObject.type_ensure(DueChipStory.$gtype);

export const DueChipStories: StoryModule = { stories: [DueChipStory] };
