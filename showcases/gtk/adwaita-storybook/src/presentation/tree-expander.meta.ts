// Shared, renderer-agnostic metadata for the Tree Expander story. Imported by the GTK
// renderer (tree-expander.story.ts) and the browser renderer
// (browser/presentation/tree-expander.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

/** One small tree, as parent labels to their children — enough for two levels of depth. */
export const TREE_EXPANDER_TREE: Readonly<Record<string, readonly string[]>> = {
    Pictures: ['Holiday', 'Screenshots'],
    Music: ['Albums'],
    Notes: [],
};

export const treeExpanderMeta: StoryMeta = {
    title: 'Presentation/Tree Expander',
    description:
        'Gtk.TreeExpander — the indent and the disclosure arrow a tree row wears in front of its contents. ' +
        'A leaf takes one indent in place of the arrow, so its text lines up with its siblings.',
    controls: [
        { name: 'expanded', label: 'Expanded', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'hideExpander', label: 'Hide the arrow', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'indentForIcon', label: 'Indent leaves by an arrow', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
