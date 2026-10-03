// Adw.PreferencesRow — the base row, shown inside a boxed list.
// original implementation.

import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { preferencesRowMeta } from './preferences-row.meta.js';

/** Story: a bare Adw.PreferencesRow inside an Adw.PreferencesGroup. */
export class PreferencesRowStory extends StoryWidget {
    private _row: Adw.PreferencesRow | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookPreferencesRow' }, PreferencesRowStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(PreferencesRowStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...preferencesRowMeta, component: Adw.PreferencesRow.$gtype };
    }

    initialize(): void {
        this._row = new Adw.PreferencesRow();
        this._apply();

        const group = new Adw.PreferencesGroup();
        group.add(this._row);

        const clamp = new Adw.Clamp({ maximumSize: 400, child: group });
        this.addContent(clamp);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._row) return;
        this._row.title = this.args.title as string;
        this._row.useMarkup = this.args.useMarkup as boolean;
        this._row.titleSelectable = this.args.titleSelectable as boolean;
    }
}

GObject.type_ensure(PreferencesRowStory.$gtype);

export const PreferencesRowStories: StoryModule = { stories: [PreferencesRowStory] };
