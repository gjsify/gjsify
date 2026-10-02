// Browser port of the Action Bar story. Shares metadata with action-bar.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { actionBarMeta } from '../../windows/action-bar.meta.js';

export class ActionBarWebStory extends StoryElement {
    private _bar: HTMLElement | null = null;

    constructor() {
        super(ActionBarWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return actionBarMeta;
    }

    initialize(): void {
        this._bar = document.createElement('gtk-action-bar');
        // The same three children in the same order as the GTK story — `pack_end` PREPENDS,
        // so the button added LAST sits nearest the edge (gtkactionbar.c:262-277).
        for (const [slot, icon] of [
            ['end', 'document-save-symbolic'],
            ['end', 'document-open-symbolic'],
            ['start', 'document-print-symbolic'],
        ] as const) {
            const button = document.createElement('gtk-button');
            button.setAttribute('slot', slot);
            button.setAttribute('icon-name', icon);
            button.setAttribute('flat', '');
            this._bar.appendChild(button);
        }

        const column = document.createElement('div');
        column.style.display = 'flex';
        column.style.flexDirection = 'column';
        column.style.gap = '8px';
        column.style.width = '420px';
        const note = document.createElement('span');
        note.textContent = 'The bar below is Gtk.ActionBar.';
        column.append(note, this._bar);

        this.addContent(column);
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._bar) return;
        this._bar.setAttribute('revealed', String(this.args.revealed as boolean));
        // `gtk_action_bar_set_center_widget` (:306-...) takes a widget or NULL, and NULL
        // clears the centre rather than replacing it with an empty label.
        const centre = this._bar.querySelector('[slot="center"]');
        if ((this.args.center as string) === 'label' && centre === null) {
            const label = document.createElement('span');
            label.setAttribute('slot', 'center');
            label.textContent = 'notes.md';
            this._bar.appendChild(label);
        }
        centre?.remove();
    }
}

export const ActionBarWebStories: WebStoryModule = { stories: [ActionBarWebStory] };
