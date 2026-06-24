// Browser port of the Spin Row story. Shares metadata with spin-row.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { spinRowMeta } from '../../rows/spin-row.meta.js';

export class SpinRowWebStory extends StoryElement {
    private _row: HTMLElement | null = null;

    constructor() {
        super(SpinRowWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return spinRowMeta;
    }

    initialize(): void {
        this._row = document.createElement('adw-spin-row');
        this._row.setAttribute('min', '0');
        this._row.setAttribute('max', '100');
        this._syncRow();

        const group = document.createElement('adw-preferences-group');
        group.append(this._row);

        const clamp = document.createElement('adw-clamp');
        clamp.setAttribute('maximum-size', '400');
        clamp.append(group);

        this.addContent(clamp);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncRow();
    }

    private _syncRow(): void {
        if (!this._row) return;
        this._row.setAttribute('title', this.args.title as string);
        // Mirror Adw.SpinRow.digits via the step's decimal precision.
        const digits = this.args.digits as number;
        this._row.setAttribute('step', String(10 ** -digits));
        this._row.setAttribute('value', String(this.args.value as number));
    }
}

export const SpinRowWebStories: WebStoryModule = { stories: [SpinRowWebStory] };
