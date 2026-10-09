// The iOS answer to `PopupMenu`: none, by name. Rationale for the split: `popup-menu-surface.ts`.
//
// iOS is outside ADR 0097 (its non-goals say so), and UIKit's `UIMenu` is a different surface with
// different rules for sections, checks and submenus that nobody has mapped or run. A refusal names
// that instead of drawing a sheet the menu model cannot be trusted on.

import type { PopupMenuSurface } from './popup-menu.js';

export function createPopupMenuSurface(_anchor: object): PopupMenuSurface {
    throw new Error('Menus have no iOS surface yet: ADR 0097 maps them to android.widget.PopupMenu only.');
}
