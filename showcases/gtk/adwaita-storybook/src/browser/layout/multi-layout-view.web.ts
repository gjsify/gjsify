// Browser port of the Multi Layout View story. Shares metadata with multi-layout-view.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { multiLayoutViewMeta } from '../../layout/multi-layout-view.meta.js';

/** The two ids every layout here carries: the content, and the secondary pane. */
const PRIMARY = 'primary';
const SECONDARY = 'secondary';

/** One arrangement: a split view whose two panes are slots, so the children land by id. */
function arrangement(collapsed: boolean): Element {
    const view = document.createElement('adw-navigation-split-view');
    if (collapsed) view.setAttribute('collapsed', '');
    view.setAttribute('min-sidebar-width', '160');
    view.style.width = '420px';
    view.style.height = '220px';
    for (const [slot, id] of [
        ['sidebar', SECONDARY],
        ['content', PRIMARY],
    ] as const) {
        const hole = document.createElement('adw-layout-slot');
        hole.setAttribute('id', id);
        hole.setAttribute('slot', slot);
        view.appendChild(hole);
    }
    return view;
}

export class MultiLayoutViewWebStory extends StoryElement {
    private _view: HTMLElement | null = null;
    private _details: Element | null = null;

    constructor() {
        super(MultiLayoutViewWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return multiLayoutViewMeta;
    }

    initialize(): void {
        this._view = document.createElement('adw-multi-layout-view');
        this._view.style.width = '420px';
        this._view.style.height = '220px';
        // The FIRST declared layout is the one made current, the way `add_layout` does it.
        for (const [name, collapsed] of [
            ['wide', false],
            ['narrow', true],
        ] as const) {
            const layout = arrangement(collapsed);
            layout.setAttribute('name', name);
            this._view.appendChild(layout);
        }

        const inbox = page('Inbox', '12 unread');
        inbox.setAttribute('slot', PRIMARY);
        this._details = page('Message');
        this._details.setAttribute('slot', SECONDARY);
        this._view.appendChild(inbox);
        this._view.appendChild(this._details);

        this._apply();
        this.addContent(this._view);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._view || !this._details) return;
        // `visible` is bound one way, child to slot, so hiding the CHILD is what takes the
        // hole with it.
        this._details.toggleAttribute('hidden', !(this.args.showDetails as boolean));
        this._view.setAttribute('layout-name', this.args.layoutName as string);
    }
}

/** A page with a title and a line of text — a stand-in for the GTK list the story builds. */
function page(title: string, subtitle = ''): HTMLElement {
    const el = document.createElement('adw-navigation-page');
    el.setAttribute('title', title);
    el.setAttribute('tag', title.toLowerCase());
    const box = document.createElement('gtk-box');
    box.setAttribute('orientation', 'vertical');
    const row = document.createElement('adw-action-row');
    row.setAttribute('title', title);
    if (subtitle !== '') row.setAttribute('subtitle', subtitle);
    box.appendChild(row);
    el.appendChild(box);
    return el;
}

export const MultiLayoutViewWebStories: WebStoryModule = { stories: [MultiLayoutViewWebStory] };
