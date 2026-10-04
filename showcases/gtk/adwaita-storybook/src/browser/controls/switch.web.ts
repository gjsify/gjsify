// Browser port of the Switch story. Shares metadata with switch.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { switchMeta } from '../../controls/switch.meta.js';

export class SwitchWebStory extends StoryElement {
    private _switch: HTMLElement | null = null;

    constructor() {
        super(SwitchWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return switchMeta;
    }

    initialize(): void {
        this._switch = document.createElement('gtk-switch');
        this._apply();
        this.addContent(this._switch);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._switch) return;
        // `active` first: the element's setter writes `state` too, which is the default
        // `::state-set` handler, and a `state` written afterwards is the application's
        // half of the delayed change (gtkswitch.c:558, :637-654).
        this._switch.toggleAttribute('active', this.args.active as boolean);
        this._switch.toggleAttribute('state', this.args.state as boolean);
        this._switch.toggleAttribute('disabled', this.args.disabled as boolean);
    }
}

export const SwitchWebStories: WebStoryModule = { stories: [SwitchWebStory] };
