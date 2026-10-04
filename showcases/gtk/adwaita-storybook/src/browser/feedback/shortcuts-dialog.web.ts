// Browser port of the Shortcuts Dialog story. Shares metadata with shortcuts-dialog.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { shortcutsDialogMeta } from '../../feedback/shortcuts-dialog.meta.js';

/** Build one `<adw-shortcuts-item>`, the markup form of `new Adw.ShortcutsItem(…)`. */
function item(title: string, attrs: Record<string, string> = {}): HTMLElement {
    const el = document.createElement('adw-shortcuts-item');
    el.setAttribute('title', title);
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    return el;
}

/** Build one `<adw-shortcuts-section>`; omit the title for a continuation group. */
function section(title: string | null, items: HTMLElement[]): HTMLElement {
    const el = document.createElement('adw-shortcuts-section');
    if (title !== null) el.setAttribute('title', title);
    el.append(...items);
    return el;
}

/**
 * Story: adw-shortcuts-dialog presented from a button, with two sections of
 * shortcuts — a 1:1 port of the GTK ShortcutsDialogStory.
 */
export class ShortcutsDialogWebStory extends StoryElement {
    constructor() {
        super(ShortcutsDialogWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return shortcutsDialogMeta;
    }

    initialize(): void {
        const button = document.createElement('gtk-button');
        button.textContent = 'Show dialog';
        button.setAttribute('pill', '');
        button.setAttribute('suggested', '');
        button.addEventListener('click', () => this._present());

        // Centre the trigger button so the preview matches the GTK story's
        // centred halign/valign placement.
        const center = document.createElement('div');
        center.style.display = 'flex';
        center.style.alignItems = 'center';
        center.style.justifyContent = 'center';
        center.style.minHeight = '160px';
        center.append(button);

        this.addContent(center);
    }

    /** Build + present a fresh dialog, reading the latest args (as the GTK story does). */
    private _present(): void {
        const dialog = document.createElement('adw-shortcuts-dialog');
        dialog.setAttribute('title', this.args.title as string);

        // SECTIONS ARE CHILDREN here: `Adw.ShortcutsDialog`'s only method is `add()`, and
        // the class documents "add it as a child when using UI files" as the other route.
        dialog.append(
            section('General', [
                item('Open Menu', { accelerator: 'F10' }),
                // An accelerator for an action comes from a GtkApplication, which a
                // document has no way to ask — so the row stands for the action alone.
                item('Preferences', { 'action-name': 'app.preferences' }),
                item('Quit', { accelerator: '<Control>q' }),
            ]),
            // No title: the section below is a continuation of the one above, which is
            // what the class documents an untitled section for.
            section(null, [
                item('Move Tab Left', { accelerator: '<Shift><Control>Page_Up', direction: 'ltr' }),
                item('Move Tab Left', { accelerator: '<Shift><Control>Page_Up', direction: 'rtl' }),
            ]),
        );

        // A DISCONNECTED element is attached to `document.body` on present, the
        // `Adw.Dialog.present(parent)` idiom; one already in the DOM is revealed in
        // place and stays reusable.
        (dialog as HTMLElement & { present(): void }).present();

        dialog.addEventListener('closed', () => dialog.remove(), { once: true });
    }

    updateArgs(_args: StoryArgs): void {
        // The dialog reads the latest args each time it is presented; nothing to mutate live.
    }
}

export const ShortcutsDialogWebStories: WebStoryModule = { stories: [ShortcutsDialogWebStory] };
