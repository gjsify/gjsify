// NativeScript port of the Toggle Group story. Shares metadata with the GTK
// toggle-group.story.ts and browser toggle-group.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).
//
// NS AdwToggleGroup extends SegmentedBar: a mutually-exclusive segment set with
// `options` (labels) + `selected` (index). FIDELITY: SegmentedBarItem is
// title-only, so the three toggles are labels (List/Grid/Columns) without the
// per-toggle icons the GTK/browser twins carry.

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { AdwToggleGroup } from '@gjsify/adwaita-nativescript';
import { toggleGroupMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

// The three toggles, mirroring the native demo (label-only on NS).
const TOGGLES = ['List', 'Grid', 'Columns'];

export class ToggleGroupNsStory extends StoryView {
    private _group: AdwToggleGroup | null = null;

    constructor() {
        super(ToggleGroupNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return toggleGroupMeta;
    }

    initialize(): void {
        this._group = new AdwToggleGroup();
        this._group.options = TOGGLES;
        this._syncGroup();
        this.addContent(this._group);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncGroup();
    }

    private _syncGroup(): void {
        if (!this._group) return;
        this._group.selected = this.args.active as number;
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
