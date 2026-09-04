// Browser port of the Split Button stories — adw-split-button, a primary action
// paired with a dropdown menu. Shares its metadata/controls with the GTK twins
// (split-button.story.ts). Their shared BEHAVIOUR is held by the
// @gjsify/adwaita-core/conformance split-button vectors; that they render
// identically is not measured anywhere (#1052).

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { splitButtonFlatMeta, splitButtonMeta } from '../../buttons/split-button.meta.js';

// The shared dropdown menu model used by both split-button variants — the web
// twin of buildMenu() in the GTK story.
const MENU = JSON.stringify([
    { label: 'Save as…', action: 'app.save-as' },
    { label: 'Export', action: 'app.export' },
    { label: 'Print', action: 'app.print' },
]);

/** Strip the libadwaita `-symbolic` suffix to the adwaita-web base icon name. */
function iconBaseName(symbolic: string): string {
    return symbolic.replace(/-symbolic$/, '');
}

/** Build an <adw-split-button> from the current story args. */
function splitButton(args: StoryArgs, opts: { flat?: boolean } = {}): HTMLElement {
    const el = document.createElement('adw-split-button');
    el.setAttribute('menu-model', MENU);
    el.setAttribute('label', args.label as string);
    const iconName = args.iconName as string;
    if (iconName) el.setAttribute('icon-name', iconBaseName(iconName));
    if (opts.flat) el.setAttribute('flat', '');
    return el;
}

abstract class SplitButtonWebStoryBase extends StoryElement {
    protected _widget: HTMLElement | null = null;
    protected abstract get flat(): boolean;

    initialize(): void {
        this._widget = splitButton(this.args, { flat: this.flat });
        this.addContent(this._widget);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._widget) return;
        const iconName = this.args.iconName as string;
        // Mirror the GTK story: with an icon set, only the icon is shown; without
        // one, the label drives the action half.
        if (iconName) {
            this._widget.setAttribute('icon-name', iconBaseName(iconName));
            this._widget.removeAttribute('label');
        } else {
            this._widget.removeAttribute('icon-name');
            this._widget.setAttribute('label', this.args.label as string);
        }
    }
}

/** Story: Adw.SplitButton with a primary action and a dropdown menu. */
export class SplitButtonWebStory extends SplitButtonWebStoryBase {
    protected get flat(): boolean {
        return false;
    }

    constructor() {
        super(SplitButtonWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return splitButtonMeta;
    }
}

/** Story: a flat-styled Adw.SplitButton, suited to header bars and toolbars. */
export class SplitButtonFlatWebStory extends SplitButtonWebStoryBase {
    protected get flat(): boolean {
        return true;
    }

    constructor() {
        super(SplitButtonFlatWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return splitButtonFlatMeta;
    }
}

export const SplitButtonWebStories: WebStoryModule = { stories: [SplitButtonWebStory, SplitButtonFlatWebStory] };
