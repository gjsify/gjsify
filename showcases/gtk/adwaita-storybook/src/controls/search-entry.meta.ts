// Shared, renderer-agnostic metadata for the Search Entry story. Imported by the GTK
// renderer (search-entry.story.ts) and the browser renderer
// (browser/controls/search-entry.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const searchEntryMeta: StoryMeta = {
    title: 'Controls/Search Entry',
    description:
        'Gtk.SearchEntry — a field for typing a query. A search glyph leads while it is empty and a clear ' +
        'button follows once it is not, and search-changed waits out search-delay so a filter is not driven ' +
        'by every keystroke. Escape is stop-search, Ctrl+G is next-match.',
    controls: [
        { name: 'searchDelay', label: 'Search delay (ms)', type: ControlType.NUMBER, defaultValue: 150 },
        { name: 'placeholderText', label: 'Placeholder', type: ControlType.TEXT, defaultValue: 'Search…' },
        { name: 'disabled', label: 'Disabled', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
