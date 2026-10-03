// Browser port of the Gtk.AboutDialog story. Shares metadata with gtk-about-dialog.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { gtkAboutDialogMeta } from '../../feedback/gtk-about-dialog.meta.js';

/** The imperative half of the `<gtk-about-dialog>` element the markup cannot spell. */
interface AboutDialogElement extends HTMLElement {
    authors: string[];
    documenters: string[];
    artists: string[];
    translatorCredits: string;
    addCreditSection(name: string, people: readonly string[]): void;
    present(): void;
    set licenseType(value: string);
}

export class GtkAboutDialogWebStory extends StoryElement {
    private _dialog: AboutDialogElement | null = null;
    private _button: HTMLButtonElement | null = null;

    constructor() {
        super(GtkAboutDialogWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return gtkAboutDialogMeta;
    }

    initialize(): void {
        const center = document.createElement('div');
        center.style.display = 'flex';
        center.style.alignItems = 'center';
        center.style.justifyContent = 'center';
        center.style.minHeight = '160px';

        this._button = document.createElement('button');
        this._button.textContent = 'Show dialog';
        this._button.setAttribute('pill', '');
        this._button.setAttribute('suggested', '');
        this._button.addEventListener('click', () => this._present());
        center.appendChild(this._button);

        // The dialog is a fixed full-cover overlay — mount it on the body so the scrim
        // covers the whole viewport, not just the clamped story stage.
        this._dialog = document.createElement('gtk-about-dialog') as AboutDialogElement;
        document.body.appendChild(this._dialog);

        this.addContent(center);
    }

    private _present(): void {
        const dialog = this._dialog;
        if (dialog === null) return;
        // A fresh presentation, because `close()` resets the stack to the main page and
        // the credits page is populated lazily.
        dialog.setAttribute('program-name', (this.args.programName as string) ?? 'Calculator');
        dialog.setAttribute('version', (this.args.version as string) ?? '48.1');
        dialog.setAttribute('logo-icon-name', 'application-x-executable');
        dialog.setAttribute('comments', 'An arithmetic calculator for the GNOME desktop.');
        dialog.setAttribute('website', 'https://gitlab.gnome.org/World/gnome-calculator');
        dialog.setAttribute('website-label', 'GNOME Calculator');
        dialog.setAttribute('copyright', '© 2026 The GNOME Project');
        dialog.setAttribute('system-information', 'GTK 4.24.0\nglibc 2.42\nBuilt with meson 1.6');

        const type = (this.args.licenseType as string) ?? 'gpl-3-0';
        if (type === 'custom') {
            // A CUSTOM licence is the only one whose text `:license` supplies — every other
            // type overwrites it with the warranty preamble.
            dialog.setAttribute(
                'license',
                'Permission is hereby granted, free of charge, to any person obtaining a copy…',
            );
        } else {
            dialog.removeAttribute('license');
        }
        dialog.licenseType = type;

        dialog.authors = [];
        dialog.documenters = [];
        dialog.artists = [];
        dialog.removeAttribute('translator-credits');
        if (this.args.withCredits as boolean) {
            dialog.authors = ['Ada Lovelace <ada@example.org>', 'Grace Hopper'];
            dialog.documenters = ['Barbara Liskov'];
            dialog.artists = ['Margaret Hamilton'];
            dialog.translatorCredits = 'Alan Turing\nKatherine Johnson';
            dialog.addCreditSection('Reviewed by', ['Tony Hoare <tony@example.org>']);
        }
        dialog.present();
    }

    updateArgs(_args: StoryArgs): void {
        // The dialog reads the latest args each time it is presented; nothing to mutate live.
    }

    teardown(): void {
        // The dialog lives on the body, not the story stage — remove it when the story is
        // deselected so it does not leak across navigations.
        if (this._dialog?.parentNode) this._dialog.parentNode.removeChild(this._dialog);
        this._dialog = null;
        this._button = null;
    }
}

export const GtkAboutDialogWebStories: WebStoryModule = { stories: [GtkAboutDialogWebStory] };
