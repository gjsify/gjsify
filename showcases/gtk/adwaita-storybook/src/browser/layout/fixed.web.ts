// Browser port of the Fixed story. Shares metadata with fixed.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { fixedMeta } from '../../layout/fixed.meta.js';

/** What `move()` is on `<gtk-fixed>`, and the only reason this story casts. */
type MovableFixed = HTMLElement & { move(child: HTMLElement, x: number, y: number): void };

export class FixedWebStory extends StoryElement {
    private _fixed: MovableFixed | null = null;
    private _cells: HTMLElement[] = [];

    constructor() {
        super(FixedWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return fixedMeta;
    }

    initialize(): void {
        const fixed = document.createElement('gtk-fixed') as MovableFixed;
        this._fixed = fixed;
        for (const text of ['at (x, y)', 'at (x + 96, y + 40)']) {
            const cell = document.createElement('gtk-label');
            cell.setAttribute('label', text);
            this._cells.push(cell);
            fixed.append(cell);
        }
        this._apply();
        this.addContent(fixed);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        const fixed = this._fixed;
        if (fixed === null) return;
        const x = this.args.offsetX as number;
        const y = this.args.offsetY as number;
        const [first, second] = this._cells;
        // The two offsets the GTK story hands to `gtk_fixed_move`, through `move()` — the
        // markup form of the same numbers is the child's own CSS position.
        if (first !== undefined) fixed.move(first, x, y);
        if (second !== undefined) fixed.move(second, x + 96, y + 40);
    }
}

export const FixedWebStories: WebStoryModule = { stories: [FixedWebStory] };
