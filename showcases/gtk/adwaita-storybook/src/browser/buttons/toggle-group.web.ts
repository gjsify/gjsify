// Browser port of the Toggle Group story — adw-toggle-group with three
// adw-toggle children and the Adwaita style variants. Shares its
// metadata/controls with the GTK twin (toggle-group.story.ts).

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { toggleGroupMeta } from '../../buttons/toggle-group.meta.js';

const STYLE_CLASSES = ['flat', 'round'] as const;

// The three toggles, mirroring the native demo. (`view-dual` stands in for the
// native `view-columns-symbolic` — the closest icon in @gjsify/adwaita-icons.)
const TOGGLES: ReadonlyArray<{ label: string; icon: string }> = [
    { label: 'List', icon: 'view-list' },
    { label: 'Grid', icon: 'view-grid' },
    { label: 'Columns', icon: 'view-dual' },
];

export class ToggleGroupWebStory extends StoryElement {
    private _group: HTMLElement | null = null;

    constructor() {
        super(ToggleGroupWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return toggleGroupMeta;
    }

    initialize(): void {
        const group = document.createElement('adw-toggle-group');
        for (const { label, icon } of TOGGLES) {
            const toggle = document.createElement('adw-toggle');
            toggle.setAttribute('label', label);
            toggle.setAttribute('icon-name', icon);
            group.appendChild(toggle);
        }
        group.setAttribute('active', String(this.args.active as number));
        this._group = group;
        this._applyStyle(this.args.style as string);
        this.addContent(group);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._group) return;
        this._group.setAttribute('active', String(this.args.active as number));
        this._applyStyle(this.args.style as string);
    }

    private _applyStyle(style: string): void {
        if (!this._group) return;
        for (const cls of STYLE_CLASSES) this._group.classList.remove(cls);
        if (style !== 'default') this._group.classList.add(style);
    }
}

export const ToggleGroupWebStories: WebStoryModule = { stories: [ToggleGroupWebStory] };
