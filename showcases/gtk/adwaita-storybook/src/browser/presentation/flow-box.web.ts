// Browser port of the Flow Box story. Shares metadata with flow-box.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { FLOW_BOX_CELLS, flowBoxMeta } from '../../presentation/flow-box.meta.js';

export class FlowBoxWebStory extends StoryElement {
    private _box: HTMLElement | null = null;

    constructor() {
        super(FlowBoxWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return flowBoxMeta;
    }

    initialize(): void {
        this._box = document.createElement('gtk-flow-box');
        this._box.style.width = '100%';
        for (const name of FLOW_BOX_CELLS) {
            const cell = document.createElement('gtk-flow-box-child');
            const label = document.createElement('gtk-label');
            label.setAttribute('label', name);
            cell.appendChild(label);
            this._box.appendChild(cell);
        }
        this._apply();
        this.addContent(this._box);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._box) return;
        this._box.setAttribute('selection-mode', this.args.selectionMode as string);
        // HORIZONTAL is the default here, so `horizontal` is the bare attribute's meaning and
        // only the vertical arg has to write.
        this._box.setAttribute('orientation', this.args.orientation as string);
        // Clamped to the ParamSpec minimum of 1 (gtkflowbox.c:3767-3770), the same clamp the
        // setter applies to a 0.
        this._box.setAttribute(
            'max-children-per-line',
            String(Math.max(1, Math.trunc(this.args.maxChildrenPerLine as number))),
        );
        this._box.toggleAttribute('homogeneous', this.args.homogeneous as boolean);
        this._box.setAttribute('row-spacing', String(Math.max(0, Math.trunc(this.args.rowSpacing as number))));
    }
}

export const FlowBoxWebStories: WebStoryModule = { stories: [FlowBoxWebStory] };
