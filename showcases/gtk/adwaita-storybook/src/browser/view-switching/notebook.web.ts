// Browser port of the Notebook story. Shares metadata with notebook.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
// TYPE-ONLY: the pages are declared in markup and driven through attributes, so nothing
// here needs the element's own API surface — and a hand-written structural type would be a
// second copy of it that nothing keeps in step. The import erases.
import type { Gtk } from '@gjsify/adwaita-web';
import { NOTEBOOK_PAGES, notebookMeta } from '../../view-switching/notebook.meta.js';

export class NotebookWebStory extends StoryElement {
    private _notebook: Gtk.Notebook | null = null;

    constructor() {
        super(NotebookWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return notebookMeta;
    }

    initialize(): void {
        const notebook = document.createElement('gtk-notebook') as Gtk.Notebook;
        notebook.style.cssText = 'width:480px;height:320px;';

        // A GtkNotebookPage is a GObject, not a widget: its properties are ATTRIBUTES on
        // the page element. The third page carries no tab-label on purpose — that is the
        // page the element labels "Page 3" from `gtk_notebook_update_labels`
        // (gtknotebook.c:4353-4373).
        for (const page of NOTEBOOK_PAGES) {
            const child = document.createElement('div');
            if (page.label) child.setAttribute('tab-label', page.label);
            child.setAttribute('menu-label', page.label || page.name);
            child.style.cssText =
                'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;';
            const heading = document.createElement('div');
            heading.setAttribute('data-gtk-notebook-story', 'heading');
            heading.textContent = page.label || page.name;
            const body = document.createElement('div');
            body.setAttribute('data-gtk-notebook-story', 'body');
            body.textContent = page.body;
            child.append(heading, body);
            notebook.appendChild(child);
        }

        this.addContent(notebook);
        this._notebook = notebook;
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._notebook) return;
        // The ORDER is the element's own: `tab-pos` decides the edge the layout is read at,
        // so it goes first, and `show-border` — the `.frame` class in C — last.
        this._notebook.setAttribute('tab-pos', this.args.tabPos as string);
        // `show-tabs` and `show-border` both default TRUE (gtknotebook.c:1124, :1134), so
        // the false case has to be spelled: an absent attribute already reads as true.
        this._notebook.setAttribute('show-tabs', (this.args.showTabs as boolean) ? '' : 'false');
        this._notebook.setAttribute('show-border', (this.args.showBorder as boolean) ? '' : 'false');
        this._notebook.toggleAttribute('enable-popup', this.args.enablePopup as boolean);
    }
}

export const NotebookWebStories: WebStoryModule = { stories: [NotebookWebStory] };
