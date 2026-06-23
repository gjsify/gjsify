// Shared, renderer-agnostic metadata for the Spinner story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const spinnerMeta: StoryMeta = {
    title: 'Presentation/Spinner',
    description: 'Adw.Spinner — a lightweight loading indicator that spins continuously while visible.',
    controls: [{ name: 'size', label: 'Size', type: ControlType.RANGE, min: 16, max: 64, step: 4, defaultValue: 48 }],
};
