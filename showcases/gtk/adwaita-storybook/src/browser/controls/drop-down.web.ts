// Browser port of the Drop Down story. Shares metadata with drop-down.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { DROP_DOWN_OPTIONS, dropDownMeta } from '../../controls/drop-down.meta.js';

export class DropDownWebStory extends StoryElement {
    private _dropDown: HTMLElement | null = null;

    constructor() {
        super(DropDownWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return dropDownMeta;
    }

    initialize(): void {
        this._dropDown = document.createElement('gtk-drop-down');
        this._dropDown.setAttribute('model', JSON.stringify(DROP_DOWN_OPTIONS));
        this._apply();
        this.addContent(this._dropDown);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._dropDown) return;
        this._dropDown.setAttribute('selected', String(this.args.selected as number));
        if (this.args.enableSearch as boolean) this._dropDown.setAttribute('enable-search', '');
        else this._dropDown.removeAttribute('enable-search');
    }
}

export const DropDownWebStories: WebStoryModule = { stories: [DropDownWebStory] };
