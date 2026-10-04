// Browser port of the Stack story. Shares metadata with stack.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
// TYPE-ONLY: the pages are declared in markup and driven through attributes, so nothing
// here needs the element's own API surface — and a hand-written structural type would be
// a second copy of it that nothing keeps in step. The import erases.
import type { Gtk } from '@gjsify/adwaita-web';
import { STACK_PAGES, stackMeta } from '../../view-switching/stack.meta.js';

export class StackWebStory extends StoryElement {
    private _stack: Gtk.Stack | null = null;

    constructor() {
        super(StackWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return stackMeta;
    }

    initialize(): void {
        const stack = document.createElement('gtk-stack') as Gtk.Stack;
        stack.style.flex = '1';

        // A GtkStackPage is a GObject, not a widget: its properties are ATTRIBUTES on the
        // page element, which is the mapping `<gtk-stack>`'s header records.
        for (const page of STACK_PAGES) {
            const child = document.createElement('div');
            child.setAttribute('name', page.name);
            child.setAttribute('title', page.title);
            child.setAttribute('use-underline', '');
            if (page.attn) child.setAttribute('needs-attention', '');
            child.style.cssText =
                'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;';
            const heading = document.createElement('div');
            heading.setAttribute('data-gtk-stack-story', 'heading');
            heading.textContent = page.title;
            const body = document.createElement('div');
            body.setAttribute('data-gtk-stack-story', 'body');
            body.textContent = page.body;
            child.append(heading, body);
            stack.appendChild(child);
        }

        const root = document.createElement('div');
        root.style.cssText = 'display:flex;flex-direction:column;gap:12px;width:480px;height:320px;';
        root.appendChild(stack);
        this.addContent(root);

        this._stack = stack;
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._stack) return;
        // The ORDER is the element's own: `transition-type` first, because a new type is
        // what a page change resolves a two-way nick against (gtkstack.c:1546-1561).
        this._stack.setAttribute('transition-type', this.args.transitionType as string);
        this._stack.setAttribute('transition-duration', String(this.args.transitionDuration as number));
        this._stack.toggleAttribute('interpolate-size', this.args.interpolateSize as boolean);
        // `hhomogeneous` / `vhomogeneous` default TRUE (gtkstack.c:981-995), so the false
        // case has to be spelled: an absent attribute already reads as true.
        this._stack.setAttribute('hhomogeneous', (this.args.hhomogeneous as boolean) ? '' : 'false');
        this._stack.setAttribute('vhomogeneous', (this.args.vhomogeneous as boolean) ? '' : 'false');
    }
}

export const StackWebStories: WebStoryModule = { stories: [StackWebStory] };
