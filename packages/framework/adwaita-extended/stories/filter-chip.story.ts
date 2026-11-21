import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

import { FilterChip } from '../src/filter-chip.js';
import { onSignal } from '../src/signals.js';

const META: StoryMeta = {
    title: 'Adwaita Extended/FilterChip',
    description: 'A pill for one narrowing that is in force, with a cross that removes just that one.',
    controls: [
        { name: 'text', label: 'Filter', type: ControlType.TEXT, defaultValue: 'Assigned to me' },
        { name: 'second', label: 'Second chip', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};

export class FilterChipStory extends StoryWidget {
    private row: Gtk.Box | null = null;

    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwStoryFilterChip' }, FilterChipStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(FilterChipStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...META, component: FilterChip.$gtype };
    }

    initialize(): void {
        this.row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6, halign: Gtk.Align.CENTER });
        this.addContent(this.row);
        this.refresh();
    }

    updateArgs(_args: StoryArgs): void {
        this.refresh();
    }

    private refresh(): void {
        const row = this.row;
        if (!row) return;
        let child = row.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            row.remove(child);
            child = next;
        }
        const texts = [String(this.args.text)];
        if (this.args.second) texts.push('Without done');
        for (const text of texts) {
            const chip = new FilterChip(text);
            // A removed chip simply leaves the row — the view that owns the filters decides the rest.
            onSignal(chip, 'removed', () => row.remove(chip));
            row.append(chip);
        }
    }
}

GObject.type_ensure(FilterChipStory.$gtype);

export const FilterChipStories: StoryModule = { stories: [FilterChipStory] };
