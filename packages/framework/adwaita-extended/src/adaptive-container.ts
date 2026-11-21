import type { SizeClass } from './size-class.js';

/** Where an {@link AdaptivePane} shows its content. */
export type PaneContainer = 'inspector' | 'dialog' | 'sheet';

/** Pure: wide has room for a side inspector, medium a dialog, compact a bottom sheet. */
export function containerFor(sizeClass: SizeClass): PaneContainer {
    switch (sizeClass) {
        case 'wide':
            return 'inspector';
        case 'medium':
            return 'dialog';
        case 'compact':
            return 'sheet';
    }
}
