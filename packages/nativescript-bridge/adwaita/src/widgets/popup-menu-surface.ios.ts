// A `UIAlertController` action sheet as the surface of a portable menu (ADR 0097 § 2 on iOS).
// Rationale for the split: `popup-menu-surface.ts`.
//
// A sheet has no rule between groups, no check column and no nested popup, so the driver's
// plan is drawn as one flat list: a checked row gets a leading "✓", a submenu row a trailing "›"
// and opens its own sheet. A UIMenu hangs off a button and cannot be opened from code, which is
// why it is not the surface. Every way a sheet can go away (a row, Cancel on any level, a tap
// outside, the iPad popover, `dismiss()`) ends in ONE `SheetSession`, the UIKit-free half that is
// specced; here only the UIKit doors that feed it. UNVERIFIED on an iPad (the popover anchor and
// whether UIKit calls the cancel handler or only the delegate on an outside tap); iPhone verified on
// the simulator with Learn6502's header menu before the session was split out.
//
// Reference: UIAlertController, UIAlertAction, UIPopoverPresentationController

import type { PopupMenuSurface } from './popup-menu.js';
import { SheetMenu, SheetSession, sheetTitle } from './popup-menu-sheet.js';

interface UIViewController {
    presentedViewController: UIViewController | null;
    presentViewControllerAnimatedCompletion(controller: unknown, animated: boolean, completion: unknown): void;
    dismissViewControllerAnimatedCompletion(animated: boolean, completion: unknown): void;
}

interface UIAlertControllerLike extends UIViewController {
    addAction(action: unknown): void;
    popoverPresentationController: { sourceView: unknown; sourceRect: unknown } | null;
    presentationController: { delegate: unknown } | null;
}

/** The slice of Foundation's `NSArray` the lookups below read. */
interface ArrayLike_ {
    readonly count: number;
    objectAtIndex(index: number): unknown;
}

interface WindowLike {
    rootViewController: UIViewController | null;
    isKeyWindow?: boolean;
}

interface SceneLike {
    /** `UISceneActivationStateForegroundActive` is 0. */
    activationState?: number;
    keyWindow?: WindowLike | null;
    windows?: ArrayLike_;
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
    | { sharedApplication: { connectedScenes?: { allObjects: ArrayLike_ }; windows?: ArrayLike_ } }
    | undefined;
declare const NSObject:
    | {
          extend(
              implementation: object,
              options?: { name?: string; protocols?: readonly unknown[] },
          ): { new (): object };
      }
    | undefined;
declare const UIAdaptivePresentationControllerDelegate: unknown;
declare const UIPopoverPresentationControllerDelegate: unknown;
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
const SCENE_FOREGROUND_ACTIVE = 0;

function cancelTitle(): string {
    // UIKit's own catalogue, so the row speaks the device language without a catalogue of ours
    return (
        NSBundle?.bundleWithIdentifier('com.apple.UIKit')?.localizedStringForKeyValueTable('Cancel', 'Cancel', null) ??
        'Cancel'
    );
}

function each<T>(list: ArrayLike_ | undefined, visit: (item: T) => void): void {
    if (list === undefined) return;
    for (let index = 0; index < list.count; index++) visit(list.objectAtIndex(index) as T);
}

/**
 * The controller a sheet is presented from: the anchor's own window first (the menu belongs to it),
 * then the key window of a foreground scene, then any key window. Never `windows[0]`: that is not
 * guaranteed to be the app's window, and `rootViewController` can be nil.
 */
function frontmost(view: { window?: WindowLike | null }): UIViewController {
    let root: UIViewController | null = view.window?.rootViewController ?? null;
    if (root === null) {
        const candidates: WindowLike[] = [];
        each<SceneLike>(UIApplication!.sharedApplication.connectedScenes?.allObjects, (scene) => {
            if (scene.activationState !== undefined && scene.activationState !== SCENE_FOREGROUND_ACTIVE) return;
            if (scene.keyWindow) candidates.push(scene.keyWindow);
            each<WindowLike>(scene.windows, (window) => {
                if (window.isKeyWindow) candidates.push(window);
            });
        });
        each<WindowLike>(UIApplication!.sharedApplication.windows, (window) => {
            if (window.isKeyWindow) candidates.push(window);
        });
        root = candidates.find((window) => window.rootViewController)?.rootViewController ?? null;
    }
    if (root === null) {
        throw new Error(
            'A menu needs a window to present its sheet from, and neither the button nor the active ' +
                'scene has one with a root view controller (ADR 0097 § 2).',
        );
    }
    let top = root;
    while (top.presentedViewController) top = top.presentedViewController;
    return top;
}

let delegateClass: { new (): object } | undefined;

/**
 * A delegate that reports a sheet UIKit took down by itself (a tap outside, the iPad popover, which
 * has no Cancel row). UIKit keeps its delegate WEAK, so the caller holds the instance.
 */
function dismissDelegate(onDismissed: () => void): object {
    delegateClass ??= NSObject!.extend(
        {
            presentationControllerDidDismiss(this: { onDismissed?: () => void }) {
                this.onDismissed?.();
            },
            popoverPresentationControllerDidDismissPopover(this: { onDismissed?: () => void }) {
                this.onDismissed?.();
            },
        },
        {
            name: 'GjsifyMenuSheetDelegate',
            protocols: [UIAdaptivePresentationControllerDelegate, UIPopoverPresentationControllerDelegate],
        },
    );
    const delegate = new delegateClass() as { onDismissed?: () => void };
    delegate.onDismissed = onDismissed;
    return delegate;
}

export function createPopupMenuSurface(anchor: object): PopupMenuSurface {
    const view = (anchor as { ios?: unknown }).ios;
    if (
        view === undefined ||
        UIAlertController === undefined ||
        UIAlertAction === undefined ||
        UIApplication === undefined ||
        NSObject === undefined
    ) {
        throw new Error(
            'A menu needs its button on screen: the sheet is anchored at the native view, which ' +
                'does not exist before the button is loaded (ADR 0097 § 2).',
        );
    }
    const menu = new SheetMenu();
    let onClick: (itemId: number) => boolean = () => false;
    let onDismiss: () => void = () => {};
    let shown: UIAlertControllerLike | null = null;
    // UIKit's delegate property is weak: these are what keeps the delegates alive while the menu is open
    let delegates: object[] = [];
    const session = new SheetSession({
        click: (itemId) => void onClick(itemId),
        dismissed: () => {
            shown = null;
            delegates = [];
            onDismiss();
        },
    });

    const present = (level: SheetMenu): void => {
        shown = sheetFor(level);
        frontmost(view as { window?: WindowLike | null }).presentViewControllerAnimatedCompletion(shown, true, null);
    };

    const sheetFor = (level: SheetMenu): UIAlertControllerLike => {
        const sheet = UIAlertController!.alertControllerWithTitleMessagePreferredStyle(null, null, ACTION_SHEET);
        for (const entry of level.entries) {
            const action = UIAlertAction!.actionWithTitleStyleHandler(sheetTitle(entry), ACTION_DEFAULT, () => {
                const next = session.choose(entry);
                if (next !== null) present(next);
            });
            action.enabled = entry.enabled;
            sheet.addAction(action);
        }
        sheet.addAction(
            UIAlertAction!.actionWithTitleStyleHandler(cancelTitle(), ACTION_CANCEL, () => session.cancel()),
        );
        const popover = sheet.popoverPresentationController;
        if (popover !== null) {
            popover.sourceView = view;
            popover.sourceRect = (view as { bounds: unknown }).bounds;
        }
        if (sheet.presentationController !== null) {
            const delegate = dismissDelegate(() => session.uikitDismissed(level));
            delegates.push(delegate);
            sheet.presentationController.delegate = delegate;
        }
        return sheet;
    };

    return {
        menu,
        apiLevel: 0,
        show() {
            if (!session.open(menu)) return;
            try {
                present(menu);
            } catch (error) {
                session.close();
                throw error;
            }
        },
        dismiss() {
            const top = shown;
            session.close();
            top?.dismissViewControllerAnimatedCompletion(true, null);
        },
        onItemClick(handler) {
            onClick = handler;
        },
        onDismiss(handler) {
            onDismiss = handler;
        },
    };
}
