// Browser port of the Stack Switcher story. Shares metadata with stack-switcher.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
// TYPE-ONLY: the switcher is bound by id attribute and the pages are declared in
// markup, so nothing here needs the element's API — and a hand-written structural type
// would be a second copy of it that nothing keeps in step. The import erases.
import type { Gtk } from '@gjsify/adwaita-web';
import { STACK_SWITCHER_PAGES, stackSwitcherMeta } from '../../view-switching/stack-switcher.meta.js';

export class StackSwitcherWebStory extends StoryElement {
    private _switcher: Gtk.StackSwitcher | null = null;

    constructor() {
        super(StackSwitcherWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return stackSwitcherMeta;
    }

    initialize(): void {
        const stack = document.createElement('gtk-stack') as Gtk.Stack;
        stack.id = 'stack-switcher-demo';
        stack.style.flex = '1';

        // A GtkStackPage is a GObject, not a widget: its properties are ATTRIBUTES on the
        // page element. An absent title stays ABSENT, because `rebuild_child` builds no
        // label for a page with neither title nor icon (gtkstackswitcher.c:158-176).
        for (const page of STACK_SWITCHER_PAGES) {
            const child = document.createElement('div');
            child.setAttribute('name', page.name);
            if (page.title) child.setAttribute('title', page.title);
            if (page.icon) child.setAttribute('icon-name', page.icon);
            child.setAttribute('use-underline', '');
            if (page.attn) child.setAttribute('needs-attention', '');
            child.style.cssText =
                'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;';
            const body = document.createElement('div');
            body.textContent = page.body;
            child.appendChild(body);
            stack.appendChild(child);
        }

        const switcher = document.createElement('gtk-stack-switcher') as Gtk.StackSwitcher;
        // The `stack` property takes a Gtk.Widget, which no attribute can carry, so it is
        // spelled as an id reference — the same convention `<adw-view-switcher-bar>` uses.
        switcher.setAttribute('stack', stack.id);

        const root = document.createElement('div');
        root.style.cssText = 'display:flex;flex-direction:column;gap:12px;width:480px;height:320px;';
        root.append(switcher, stack);
        this.addContent(root);

        this._switcher = switcher;
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._switcher) return;
        this._switcher.setAttribute('orientation', this.args.orientation as string);
        const stack = document.getElementById('stack-switcher-demo');
        if (stack) stack.setAttribute('transition-type', this.args.transitionType as string);
    }
}

export const StackSwitcherWebStories: WebStoryModule = { stories: [StackSwitcherWebStory] };
