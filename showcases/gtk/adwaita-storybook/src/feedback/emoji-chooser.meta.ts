// Shared, renderer-agnostic metadata for the Gtk.EmojiChooser story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const emojiChooserMeta: StoryMeta = {
    title: 'Feedback/Emoji Chooser',
    description:
        'Gtk.EmojiChooser — the popover a text widget opens to insert an emoji: a search entry over nine named sections, a toolbar that follows the scroll position, and an emoji-picked signal.',
    controls: [{ name: 'search', label: 'Search', type: ControlType.TEXT, defaultValue: 'smile' }],
};
