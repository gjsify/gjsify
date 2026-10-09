// `android.widget.PopupMenu` as the surface of a portable menu (ADR 0097 § 2). Rationale for the
// split: `popup-menu-surface.ts`.
//
// Verified on the API 36 emulator (Learn6502's header menu, 2026-10-08): groups with a rule, a
// check, an exclusive radio group, a disabled row and a submenu draw as the plan says, and a tap
// activates its item once. That run found the radio rule `popup-menu.ts` now follows. Still
// UNVERIFIED below API 28, where sections are inlined without a rule.
//
// Reference: android.widget.PopupMenu (getMenu, setOnMenuItemClickListener, setOnDismissListener,
// show, dismiss), android.os.Build.VERSION.SDK_INT

import type { PopupMenuLike, PopupMenuSurface } from './popup-menu.js';

interface AndroidPopupMenu {
    getMenu(): PopupMenuLike;
    setOnMenuItemClickListener(listener: unknown): void;
    setOnDismissListener(listener: unknown): void;
    show(): void;
    dismiss(): void;
}

/** The slice of the `android` global this file reaches, optional so a missing runtime is a refusal and not a crash. */
declare const android:
    | {
          widget: {
              PopupMenu: {
                  new (context: unknown, anchor: unknown): AndroidPopupMenu;
                  OnMenuItemClickListener: new (impl: {
                      onMenuItemClick(item: { getItemId(): number }): boolean;
                  }) => unknown;
                  OnDismissListener: new (impl: { onDismiss(menu: unknown): void }) => unknown;
              };
          };
          os: { Build: { VERSION: { SDK_INT: number } } };
      }
    | undefined;

export function createPopupMenuSurface(anchor: object): PopupMenuSurface {
    const native = (anchor as { android?: { getContext(): unknown } }).android;
    if (native === undefined || android === undefined) {
        throw new Error(
            'A menu needs its button on screen: the PopupMenu is anchored at the native view, which ' +
                'does not exist before the button is loaded (ADR 0097 § 2).',
        );
    }
    const popup = new android.widget.PopupMenu(native.getContext(), native);
    return {
        menu: popup.getMenu(),
        apiLevel: android.os.Build.VERSION.SDK_INT,
        show: () => popup.show(),
        dismiss: () => popup.dismiss(),
        onItemClick(handler) {
            popup.setOnMenuItemClickListener(
                new android.widget.PopupMenu.OnMenuItemClickListener({
                    onMenuItemClick: (item) => handler(item.getItemId()),
                }),
            );
        },
        onDismiss(handler) {
            popup.setOnDismissListener(new android.widget.PopupMenu.OnDismissListener({ onDismiss: () => handler() }));
        },
    };
}
