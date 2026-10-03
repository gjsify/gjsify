// Browser port of the Paned story. Shares metadata with paned.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { panedMeta } from '../../layout/paned.meta.js';

function pane(label: string, request: number): HTMLElement {
    const box = document.createElement('gtk-box');
    box.setAttribute('orientation', 'vertical');
    box.setAttribute('spacing', '4');
    box.style.padding = '12px';

    const title = document.createElement('gtk-label');
    title.setAttribute('label', label);
    box.appendChild(title);

    const hint = document.createElement('gtk-label');
    hint.setAttribute('label', `${request}px of size request`);
    hint.classList.add('dimmed');
    box.appendChild(hint);
    return box;
}

export class PanedWebStory extends StoryElement {
    private _paned: HTMLElement | null = null;

    constructor() {
        super(PanedWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return panedMeta;
    }

    initialize(): void {
        this._paned = document.createElement('gtk-paned');
        this._paned.style.width = '400px';
        this._paned.style.height = '140px';
        this._paned.appendChild(pane('First child', 100));

        const end = pane('Second child', 300);
        end.setAttribute('slot', 'end');
        this._paned.appendChild(end);

        this._apply();
        this.addContent(this._paned);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._paned) return;
        this._paned.setAttribute('orientation', String(this.args.orientation));
        this._paned.toggleAttribute('wide-handle', this.args.wideHandle as boolean);
        // All four of these default to TRUE in the pspec, so `"false"` is how one is turned
        // off — the same rule `<adw-navigation-view can-pop>` reads. The END child's shrink
        // is not a control: GTK's GtkBuildable sets it alongside the child and there is no
        // second thing to compare it against here.
        this._paned.setAttribute('resize-start-child', this.args.resizeStartChild ? 'true' : 'false');
        this._paned.setAttribute('resize-end-child', this.args.resizeEndChild ? 'true' : 'false');
        this._paned.setAttribute('shrink-start-child', this.args.shrinkStartChild ? 'true' : 'false');
        // `position = -1` is the C's "let the size requests decide" (gtkpaned.c:1874), which
        // is why the control's floor is -1 rather than 0.
        this._paned.setAttribute('position', String(this.args.position));
    }
}

export const PanedWebStories: WebStoryModule = { stories: [PanedWebStory] };
