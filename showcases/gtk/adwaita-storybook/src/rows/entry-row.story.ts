// Adw.EntryRow — a boxed-list row with an embedded text entry and an optional
// apply button. original implementation.

import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { entryRowMeta } from './entry-row.meta.js';

/** Story: Adw.EntryRow inside a boxed list, with a toggleable apply button. */
export class EntryRowStory extends StoryWidget {
    private _row: Adw.EntryRow | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookEntryRow' }, EntryRowStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(EntryRowStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...entryRowMeta, component: Adw.EntryRow.$gtype };
    }

    initialize(): void {
        this._row = new Adw.EntryRow({
            title: this.args.title as string,
            text: this.args.text as string,
            showApplyButton: this.args.showApplyButton as boolean,
        });

        const group = new Adw.PreferencesGroup();
        group.add(this._row);

        const clamp = new Adw.Clamp({ maximumSize: 400, child: group });
        this.addContent(clamp);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._row) return;
        this._row.title = this.args.title as string;
        this._row.text = this.args.text as string;
        this._row.showApplyButton = this.args.showApplyButton as boolean;
    }
}

GObject.type_ensure(EntryRowStory.$gtype);

export const EntryRowStories: StoryModule = { stories: [EntryRowStory] };
