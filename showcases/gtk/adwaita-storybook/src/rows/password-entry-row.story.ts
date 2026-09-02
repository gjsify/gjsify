// Adw.PasswordEntryRow — a boxed-list entry row that masks its text and offers a
// peek toggle. original implementation.

import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { passwordEntryRowMeta } from './password-entry-row.meta.js';

/** Story: Adw.PasswordEntryRow inside a boxed list. */
export class PasswordEntryRowStory extends StoryWidget {
    private _row: Adw.PasswordEntryRow | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookPasswordEntryRow' }, PasswordEntryRowStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(PasswordEntryRowStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...passwordEntryRowMeta, component: Adw.PasswordEntryRow.$gtype };
    }

    initialize(): void {
        this._row = new Adw.PasswordEntryRow({
            title: this.args.title as string,
            text: this.args.text as string,
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
    }
}

GObject.type_ensure(PasswordEntryRowStory.$gtype);

export const PasswordEntryRowStories: StoryModule = { stories: [PasswordEntryRowStory] };
