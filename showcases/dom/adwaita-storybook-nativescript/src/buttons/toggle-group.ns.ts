// NativeScript port of the Toggle Group story. Shares metadata with the GTK
// toggle-group.story.ts and browser toggle-group.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).
//
// NS Adw.ToggleGroup is an Adwaita LINKED toggle group of icon+label segments with
// `selected` (index), matching the GTK/browser twins (icon + label per toggle).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw } from '@gjsify/adwaita-nativescript';
import { viewGridSymbolic, viewListSymbolic, viewPagedSymbolic } from '@gjsify/adwaita-icons/actions';
import { toggleGroupMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

// The three toggles, mirroring the native demo (icon + label).
const TOGGLES = [
    { label: 'List', icon: viewListSymbolic },
    { label: 'Grid', icon: viewGridSymbolic },
    { label: 'Columns', icon: viewPagedSymbolic },
];

export class ToggleGroupNsStory extends StoryView {
    private _group: Adw.ToggleGroup | null = null;

    constructor() {
        super(ToggleGroupNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return toggleGroupMeta;
    }

    initialize(): void {
        this._group = new Adw.ToggleGroup();
        this._group.setToggles(TOGGLES);
        this._syncGroup();
        this.addContent(this._group);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncGroup();
    }

    private _syncGroup(): void {
        if (!this._group) return;
        this._group.active = this.args.active as number;
        this._applyStyle(this.args.style as string);
    }

    private _applyStyle(style: string): void {
        if (!this._group) return;
        // Mirror the twins' add/remove of the `flat`/`round` style class while
        // preserving the base `adw-toggle-group` class.
        const classes = ['adw-toggle-group'];
        if (style !== 'default') classes.push(style);
        this._group.className = classes.join(' ');
    }
}

export const ToggleGroupNsStories: NsStoryModule = { stories: [ToggleGroupNsStory] };
