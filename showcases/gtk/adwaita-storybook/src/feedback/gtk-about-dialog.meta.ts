// Shared, renderer-agnostic metadata for the Gtk.AboutDialog story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const gtkAboutDialogMeta: StoryMeta = {
    title: 'Feedback/GTK About Dialog',
    description:
        "Gtk.AboutDialog — GTK's own about window: a dialog-size logo over the program name, with the Credits, License and System pages behind a stack switcher. NOT Adw.AboutDialog, which is a navigation view of preference rows.",
    controls: [
        { name: 'programName', label: 'Program name', type: ControlType.TEXT, defaultValue: 'Calculator' },
        { name: 'version', label: 'Version', type: ControlType.TEXT, defaultValue: '48.1' },
        {
            name: 'licenseType',
            label: 'License type',
            type: ControlType.SELECT,
            options: [
                { label: 'Unknown', value: 'unknown' },
                { label: 'Custom', value: 'custom' },
                { label: 'GPL 3.0', value: 'gpl-3-0' },
                { label: 'MIT', value: 'mit-x11' },
                { label: 'BSD 3-Clause', value: 'bsd-3' },
                { label: 'Apache 2.0', value: 'apache-2-0' },
                { label: '0BSD', value: '0bsd' },
            ],
            defaultValue: 'gpl-3-0',
        },
        { name: 'withCredits', label: 'With credits', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
