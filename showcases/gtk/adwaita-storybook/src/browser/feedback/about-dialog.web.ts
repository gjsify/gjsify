// Browser port of the About Dialog story. Shares metadata with about-dialog.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { aboutDialogMeta } from '../../feedback/about-dialog.meta.js';

/** Imperatively-set list/scalar properties on the <adw-about-dialog> element. */
interface AboutDialogElement extends HTMLElement {
    developers: string[];
    designers: string[];
    present(): void;
}

export class AboutDialogWebStory extends StoryElement {
    private _dialog: AboutDialogElement | null = null;

    constructor() {
        super(AboutDialogWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return aboutDialogMeta;
    }

    initialize(): void {
        // The persistent content — a centered pill button that presents the
        // dialog (mirrors the native story's "Show dialog" button).
        const center = document.createElement('div');
        center.style.display = 'flex';
        center.style.alignItems = 'center';
        center.style.justifyContent = 'center';
        center.style.minHeight = '160px';

        const button = document.createElement('gtk-button');
        button.textContent = 'Show dialog';
        button.setAttribute('pill', '');
        button.setAttribute('suggested', '');
        button.addEventListener('click', () => this._present());
        center.append(button);

        // The dialog is a fixed full-cover overlay — mount it on the body so the
        // scrim covers the whole viewport, not just the clamped story stage.
        this._dialog = document.createElement('adw-about-dialog') as AboutDialogElement;
        document.body.appendChild(this._dialog);

        this.addContent(center);
    }

    private _present(): void {
        if (!this._dialog) return;
        const dialog = this._dialog;
        dialog.setAttribute('application-name', (this.args.applicationName as string) ?? 'Adwaita Storybook');
        // The native story uses `application-x-executable-symbolic`; the web icon
        // set ships the same glyph under the unsuffixed name. It has to be named
        // here: GTK draws NO icon for an application that set none
        // (adw-about-dialog.c:2313-2314), so the element no longer invents one.
        dialog.setAttribute('application-icon', 'application-x-executable');
        dialog.setAttribute('developer-name', 'A GJSify Project');
        dialog.setAttribute('version', (this.args.version as string) ?? '0.11.0');
        dialog.setAttribute('comments', 'A live catalogue of native GTK and Adwaita widgets, rendered under GJS.');
        dialog.setAttribute('website', 'https://github.com/gjsify/gjsify');
        dialog.setAttribute('issue-url', 'https://github.com/gjsify/gjsify/issues');
        dialog.setAttribute('license', 'The MIT License (MIT)');
        dialog.setAttribute('license-url', 'https://opensource.org/licenses/mit-license.php');
        dialog.setAttribute('copyright', '© 2026 The GJSify Project');
        dialog.developers = ['Ada Lovelace', 'Grace Hopper'];
        dialog.designers = ['Margaret Hamilton'];
        dialog.present();
    }

    updateArgs(_args: StoryArgs): void {
        // The dialog reads the latest args each time it is presented; nothing to mutate live.
    }

    teardown(): void {
        // The dialog lives on the body, not the story stage — remove it when the
        // story is deselected so it does not leak across navigations.
        if (this._dialog && this._dialog.parentNode) {
            this._dialog.parentNode.removeChild(this._dialog);
        }
        this._dialog = null;
    }
}

export const AboutDialogWebStories: WebStoryModule = { stories: [AboutDialogWebStory] };
