// Browser port of the Breakpoint Bin story. Shares metadata with breakpoint-bin.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { breakpointBinMeta } from '../../layout/breakpoint-bin.meta.js';

export class BreakpointBinWebStory extends StoryElement {
    private _bin: HTMLElement | null = null;
    private _label: HTMLElement | null = null;

    constructor() {
        super(BreakpointBinWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return breakpointBinMeta;
    }

    initialize(): void {
        this._bin = document.createElement('adw-breakpoint-bin');
        // The C's own advice: a bin carrying breakpoints has no minimum size, so the stage
        // is what decides how much room there is (adw-breakpoint-bin.c:57-61).
        this._bin.style.minWidth = '150px';
        this._bin.style.height = '60px';
        this._label = document.createElement('gtk-label');
        // The selector a `breakpoints` setter addresses its target by, so the id is the
        // contract between the attribute and this element.
        this._label.id = 'narrow';
        this._label.classList.add('title-1');
        this._bin.appendChild(this._label);

        this._apply();
        this.addContent(this._bin);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    /**
     * The `breakpoints` attribute, then the wide label.
     *
     * The attribute is written BEFORE the label's wide value so the setter registers
     * against the wide value as its original — the order the C gets for free, because
     * `add_setters` is called after the label was built.
     */
    private _apply(): void {
        if (!this._bin || !this._label) return;
        this._label.setAttribute('label', this.args.wideLabel as string);
        this._bin.setAttribute(
            'breakpoints',
            JSON.stringify([
                {
                    condition: this.args.condition as string,
                    setters: [{ target: '#narrow', property: 'label', value: this.args.narrowLabel as string }],
                },
            ]),
        );
    }
}

export const BreakpointBinWebStories: WebStoryModule = { stories: [BreakpointBinWebStory] };
