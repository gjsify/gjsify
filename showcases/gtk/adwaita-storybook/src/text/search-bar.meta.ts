// Shared, renderer-agnostic metadata for the Search Bar story. Imported by the GTK
// renderer (search-bar.story.ts) and the browser renderer (browser/text/search-bar.web.ts),
// so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const searchBarMeta: StoryMeta = {
    title: 'Text/Search Bar',
    description:
        'Gtk.SearchBar — the strip that reveals a search entry when search starts. The property IS the ' +
        "revealer's reveal-child, so one boolean decides both whether the strip is shown and whether " +
        'the search is on; hiding it clears the entry.',
    controls: [
        { name: 'searchModeEnabled', label: 'Search mode', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'showCloseButton', label: 'Close button', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
