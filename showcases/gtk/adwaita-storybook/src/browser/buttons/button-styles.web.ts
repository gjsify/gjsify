// Browser port of the Button Styles story — gtk-button with Adwaita style
// variants. Shares its metadata/controls with the GTK twin (button-styles.story.ts).

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { buttonStylesMeta } from '../../buttons/button-styles.meta.js';

const VARIANT_ATTRS = ['pill', 'circular', 'suggested', 'destructive', 'flat'] as const;

/** Map the storybook `style` value to a <gtk-button> variant attribute. */
const VARIANT_BY_STYLE: Record<string, (typeof VARIANT_ATTRS)[number]> = {
    pill: 'pill',
    circular: 'circular',
    'suggested-action': 'suggested',
    'destructive-action': 'destructive',
    flat: 'flat',
};

function button(opts: { label?: string; icon?: string; variant?: (typeof VARIANT_ATTRS)[number] }): HTMLElement {
    const btn = document.createElement('gtk-button');
    if (opts.label) btn.setAttribute('label', opts.label);
    if (opts.icon) btn.setAttribute('icon', opts.icon);
    if (opts.variant) btn.setAttribute(opts.variant, '');
    return btn;
}

export class ButtonStylesWebStory extends StoryElement {
    private _demo: HTMLElement | null = null;

    constructor() {
        super(ButtonStylesWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return buttonStylesMeta;
    }

    initialize(): void {
        // A flex-wrap row mirrors the native Adw.WrapBox so the demo reflows
        // instead of overflowing in a narrow preview.
        const box = document.createElement('div');
        box.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;justify-content:center;align-items:center;';

        box.append(
            button({ label: 'Pill', variant: 'pill' }),
            button({ icon: 'list-add', variant: 'circular' }),
            button({ label: 'Suggested', variant: 'suggested' }),
            button({ label: 'Delete', variant: 'destructive' }),
            button({ label: 'Flat', variant: 'flat' }),
        );

        this._demo = button({ label: this.args.label as string });
        this._applyStyle(this.args.style as string);
        box.append(this._demo);

        this.addContent(box);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._demo) return;
        this._applyStyle(this.args.style as string);
    }

    private _applyStyle(style: string): void {
        if (!this._demo) return;
        for (const attr of VARIANT_ATTRS) this._demo.removeAttribute(attr);
        const variant = VARIANT_BY_STYLE[style];
        if (variant) this._demo.setAttribute(variant, '');
        // The circular variant is icon-only (no label), like the native demo.
        if (variant === 'circular') {
            this._demo.setAttribute('icon', 'list-add');
            this._demo.removeAttribute('label');
        } else {
            this._demo.removeAttribute('icon');
            this._demo.setAttribute('label', this.args.label as string);
        }
    }
}

export const ButtonStylesWebStories: WebStoryModule = { stories: [ButtonStylesWebStory] };
