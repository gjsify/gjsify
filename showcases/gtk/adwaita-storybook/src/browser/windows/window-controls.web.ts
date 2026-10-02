// Browser port of the Window Controls story. Shares metadata with window-controls.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { windowControlsMeta } from '../../windows/window-controls.meta.js';

export class WindowControlsWebStory extends StoryElement {
    private _window: HTMLElement | null = null;
    private _controls: HTMLElement | null = null;

    constructor() {
        super(WindowControlsWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return windowControlsMeta;
    }

    initialize(): void {
        this._window = document.createElement('gtk-window');
        this._window.setAttribute('title', 'Documents');
        this._window.setAttribute('default-width', '420');
        this._window.setAttribute('default-height', '220');

        const note = document.createElement('span');
        note.textContent = 'A Gtk.WindowControls outside a window draws nothing — that is GTK, not this port.';
        this._window.appendChild(note);

        // A window with NO titlebar of its own, so these really are the titlebar, which is the
        // shape `update_window_buttons` reads its four window properties for. The frame draws
        // its own controls pair around them when there is nothing here — hence the slot.
        this._controls = document.createElement('gtk-window-controls');
        this._controls.setAttribute('slot', 'titlebar');
        this._window.appendChild(this._controls);

        this.addContent(this._window);
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._window || !this._controls) return;
        this._controls.setAttribute('side', (this.args.side as string) === 'end' ? 'end' : 'start');
        this._controls.setAttribute('decoration-layout', this.args.decorationLayout as string);
        // `update_window_buttons` (:270-274) reads exactly these four off the frame.
        this._window.setAttribute('resizable', String(this.args.resizable as boolean));
        this._window.setAttribute('maximized', String(this.args.maximized as boolean));
        this._window.setAttribute('modal', String(this.args.modal as boolean));
    }
}

export const WindowControlsWebStories: WebStoryModule = { stories: [WindowControlsWebStory] };
