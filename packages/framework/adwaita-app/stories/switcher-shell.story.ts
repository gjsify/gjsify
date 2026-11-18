// Story: @gjsify/adwaita-app's createSwitcherShell — header ViewSwitcher on wide
// windows, bottom ViewSwitcherBar below the narrow width. original implementation.

import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { createSwitcherShell } from '../src/switcher-shell.js';

/** Story: the switcher shell with three placeholder pages, hosted in a throwaway window. */
export class SwitcherShellStory extends StoryWidget {
    static {
        GObject.registerClass({ GTypeName: 'AdwaitaAppSwitcherShellStory' }, SwitcherShellStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(SwitcherShellStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return {
            title: 'Adwaita App/SwitcherShell',
            description: 'Adw.ViewSwitcher in the header, Adw.ViewSwitcherBar at the bottom below 600sp.',
            controls: [],
        };
    }

    initialize(): void {
        const page = (label: string): Gtk.Widget => new Gtk.Label({ label, cssClasses: ['title-2'], vexpand: true });
        const shell = createSwitcherShell(new Adw.ApplicationWindow(), {
            pages: [
                { name: 'calendar', title: 'Calendar', icon: 'x-office-calendar-symbolic', widget: page('Calendar') },
                { name: 'tasks', title: 'Tasks', icon: 'object-select-symbolic', widget: page('Tasks') },
                { name: 'board', title: 'Board', icon: 'view-grid-symbolic', widget: page('Board') },
            ],
        });
        shell.widget.set_size_request(480, 300);
        this.addContent(shell.widget);
    }

    updateArgs(): void {}
}

GObject.type_ensure(SwitcherShellStory.$gtype);

export const SwitcherShellStories: StoryModule = { stories: [SwitcherShellStory] };
