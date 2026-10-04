// Browser port of the Graphics Offload story. Shares metadata with
// graphics-offload.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { graphicsOffloadMeta } from '../../drawing/graphics-offload.meta.js';

export class GraphicsOffloadWebStory extends StoryElement {
    private _offload: HTMLElement | null = null;

    constructor() {
        super(GraphicsOffloadWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return graphicsOffloadMeta;
    }

    initialize(): void {
        this._offload = document.createElement('gtk-graphics-offload');
        this._offload.style.width = '280px';
        this._offload.style.height = '96px';
        this._apply();
        const box = document.createElement('div');
        box.style.display = 'flex';
        box.style.justifyContent = 'center';
        box.append(this._offload);
        this.addContent(box);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._offload) return;
        // `enabled` before `black-background`, the C's property order
        // (gtkgraphicsoffload.c:366-380, :423-437).
        this._offload.setAttribute('enabled', this.args.enabled as string);
        this._offload.setAttribute('black-background', String(this.args.blackBackground as boolean));
        // The wrapper holds ONE child, so changing it means replacing it — which is what
        // `set_child` does, unparenting the old one (gtkgraphicsoffload.c:317-336).
        let child: HTMLElement;
        switch (this.args.child) {
            case 'label': {
                const label = document.createElement('gtk-label');
                label.setAttribute('label', 'The child of an offloaded layer');
                child = label;
                break;
            }
            case 'box': {
                const row = document.createElement('gtk-box');
                row.setAttribute('orientation', 'horizontal');
                row.setAttribute('spacing', '12');
                for (const text of ['One', 'Two', 'Three']) {
                    const label = document.createElement('gtk-label');
                    label.setAttribute('label', text);
                    row.appendChild(label);
                }
                child = row;
                break;
            }
            default: {
                const image = document.createElement('gtk-image');
                image.setAttribute('icon-name', 'camera-photo');
                image.setAttribute('pixel-size', '48');
                child = image;
                break;
            }
        }
        this._offload.replaceChildren(child);
    }
}

export const GraphicsOffloadWebStories: WebStoryModule = { stories: [GraphicsOffloadWebStory] };
