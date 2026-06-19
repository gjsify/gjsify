import type Gtk from '@girs/gtk-4.0';
import type { StoryWidget } from './story-widget.js';

/** A sidebar row that remembers which story widget it selects. */
export interface StoryRow extends Gtk.ListBoxRow {
    storyWidget: StoryWidget;
}
