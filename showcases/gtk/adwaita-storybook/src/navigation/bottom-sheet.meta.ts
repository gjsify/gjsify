// Shared, renderer-agnostic metadata for the Bottom Sheet story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const bottomSheetMeta: StoryMeta = {
    title: 'Navigation/Bottom Sheet',
    description: 'Adw.BottomSheet — a sheet that slides up over the content. Toggle "Open" to reveal it.',
    controls: [
        { name: 'open', label: 'Open', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'modal', label: 'Modal', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'canClose', label: 'Can close', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
