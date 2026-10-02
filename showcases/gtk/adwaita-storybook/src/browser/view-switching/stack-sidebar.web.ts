// Browser port of the Stack Sidebar story. Shares metadata with stack-sidebar.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
// TYPE-ONLY: the sidebar is bound by id attribute and the pages are declared in
// markup, so nothing here needs the element's API — and a hand-written structural type
// would be a second copy of it that nothing keeps in step. The import erases.
import type { Gtk } from '@gjsify/adwaita-web';
import { STACK_SIDEBAR_PAGES, stackSidebarMeta } from '../../view-switching/stack-sidebar.meta.js';

export class StackSidebarWebStory extends StoryElement {
    private _stack: Gtk.Stack | null = null;

    constructor() {
        super(StackSidebarWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return stackSidebarMeta;
    }

    initialize(): void {
        const stack = document.createElement('gtk-stack') as Gtk.Stack;
        stack.id = 'stack-sidebar-demo';
        stack.style.flex = '1';

        // A GtkStackPage is a GObject, not a widget: its properties are ATTRIBUTES on the
        // page element. The last page here has an icon and NO title on purpose — that is
        // the page a sidebar row cannot represent (gtkstacksidebar.c:186).
        for (const page of STACK_SIDEBAR_PAGES) {
            const child = document.createElement('div');
            child.setAttribute('name', page.name);
            if (page.title) child.setAttribute('title', page.title);
            if (page.icon) child.setAttribute('icon-name', page.icon);
            if (page.attn) child.setAttribute('needs-attention', '');
            child.style.cssText =
                'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;';
            const body = document.createElement('div');
            body.textContent = page.body;
            child.appendChild(body);
            stack.appendChild(child);
        }

        const sidebar = document.createElement('gtk-stack-sidebar') as Gtk.StackSidebar;
        // The `stack` property takes a Gtk.Widget, which no attribute can carry, so it is
        // spelled as an id reference — the same convention `<adw-view-switcher-bar>` uses.
        sidebar.setAttribute('stack', stack.id);
        sidebar.style.width = '180px';

        const root = document.createElement('div');
        root.style.cssText = 'display:flex;flex-direction:row;gap:12px;width:480px;height:320px;';
        root.append(sidebar, stack);
        this.addContent(root);

        this._stack = stack;
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._stack) return;
        this._stack.setAttribute('transition-type', this.args.transitionType as string);
    }
}

export const StackSidebarWebStories: WebStoryModule = { stories: [StackSidebarWebStory] };
