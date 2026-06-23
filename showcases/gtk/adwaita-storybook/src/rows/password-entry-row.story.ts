// Adw.PasswordEntryRow — a boxed-list entry row that masks its text and offers a
// peek toggle. original implementation.

import Adw from '@girs/adw-1';
import GObject from '@girs/gobject-2.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

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
        return {
            title: 'Boxed Lists/Password Entry Row',
            description: 'Adw.PasswordEntryRow — an entry row that masks its contents and shows a peek toggle.',
            component: Adw.PasswordEntryRow.$gtype,
            controls: [
                { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'Password' },
                { name: 'text', label: 'Text', type: ControlType.TEXT, defaultValue: 'correct-horse-battery' },
            ],
        };
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
