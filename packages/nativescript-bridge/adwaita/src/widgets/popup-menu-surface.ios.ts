// A `UIAlertController` action sheet as the surface of a portable menu (ADR 0097 § 2 on iOS).
// Rationale for the split: `popup-menu-surface.ts`.
//
// A sheet has no rule between groups, no check column and no nested popup, so the driver's
// plan is drawn as one flat list: a checked row gets a leading "✓", a submenu row a trailing "›"
// and opens its own sheet. A UIMenu hangs off a button and cannot be opened from code, which is
// why it is not the surface. UNVERIFIED on an iPad (the popover anchor); iPhone verified on the
// simulator with Learn6502's header menu.
//
// Reference: UIAlertController, UIAlertAction, UIPopoverPresentationController

import type { PopupMenuSurface } from './popup-menu.js';
import { SheetMenu, sheetTitle } from './popup-menu-sheet.js';

interface UIViewController {
    presentedViewController: UIViewController | null;
    presentViewControllerAnimatedCompletion(controller: unknown, animated: boolean, completion: unknown): void;
    dismissViewControllerAnimatedCompletion(animated: boolean, completion: unknown): void;
}

interface UIAlertControllerLike extends UIViewController {
    addAction(action: unknown): void;
    popoverPresentationController: { sourceView: unknown; sourceRect: unknown } | null;
}

declare const UIAlertController:
    | {
          alertControllerWithTitleMessagePreferredStyle(
              title: string | null,
              message: string | null,
              style: number,
          ): UIAlertControllerLike;
      }
    | undefined;
declare const UIAlertAction:
    | {
          actionWithTitleStyleHandler(
              title: string,
              style: number,
              handler: ((action: unknown) => void) | null,
          ): { enabled: boolean };
      }
    | undefined;
declare const UIApplication:
    | { sharedApplication: { windows: { objectAtIndex(index: number): { rootViewController: UIViewController } } } }
    | undefined;
declare const NSBundle:
    | {
          bundleWithIdentifier(id: string): {
              localizedStringForKeyValueTable(key: string, value: string, table: string | null): string;
          } | null;
      }
    | undefined;

/** `UIAlertControllerStyleActionSheet`, `UIAlertActionStyleDefault`, `UIAlertActionStyleCancel`. */
const ACTION_SHEET = 0;
const ACTION_DEFAULT = 0;
const ACTION_CANCEL = 1;

function cancelTitle(): string {
    // UIKit's own catalogue, so the row speaks the device language without a catalogue of ours
    return NSBundle?.bundleWithIdentifier('com.apple.UIKit')?.localizedStringForKeyValueTable('Cancel', 'Cancel', null) ?? 'Cancel';
}

function frontmost(): UIViewController {
    let top = UIApplication!.sharedApplication.windows.objectAtIndex(0).rootViewController;
    while (top.presentedViewController) top = top.presentedViewController;
    return top;
}

export function createPopupMenuSurface(anchor: object): PopupMenuSurface {
    const view = (anchor as { ios?: unknown }).ios;
    if (view === undefined || UIAlertController === undefined || UIAlertAction === undefined || UIApplication === undefined) {
        throw new Error(
            'A menu needs its button on screen: the sheet is anchored at the native view, which ' +
                'does not exist before the button is loaded (ADR 0097 § 2).',
        );
    }
    const menu = new SheetMenu();
    let onClick: (itemId: number) => boolean = () => false;
    let onDismiss: () => void = () => {};
    let shown: UIAlertControllerLike | null = null;

    const sheetFor = (level: SheetMenu, isRoot: boolean): UIAlertControllerLike => {
        const sheet = UIAlertController!.alertControllerWithTitleMessagePreferredStyle(null, null, ACTION_SHEET);
        for (const entry of level.entries) {
            const action = UIAlertAction!.actionWithTitleStyleHandler(sheetTitle(entry), ACTION_DEFAULT, () => {
                if (entry.children !== undefined) {
                    shown = sheetFor(entry.children, false);
                    frontmost().presentViewControllerAnimatedCompletion(shown, true, null);
                    return;
                }
                onClick(entry.itemId);
                onDismiss();
            });
            action.enabled = entry.enabled;
            sheet.addAction(action);
        }
        sheet.addAction(UIAlertAction!.actionWithTitleStyleHandler(cancelTitle(), ACTION_CANCEL, isRoot ? () => onDismiss() : null));
        const popover = sheet.popoverPresentationController;
        if (popover !== null) {
            popover.sourceView = view;
            popover.sourceRect = (view as { bounds: unknown }).bounds;
        }
        return sheet;
    };

    return {
        menu,
        apiLevel: 0,
        show() {
            shown = sheetFor(menu, true);
            frontmost().presentViewControllerAnimatedCompletion(shown, true, null);
        },
        dismiss() {
            shown?.dismissViewControllerAnimatedCompletion(true, null);
            shown = null;
        },
        onItemClick(handler) {
            onClick = handler;
        },
        onDismiss(handler) {
            onDismiss = handler;
        },
    };
}
