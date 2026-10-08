// A portable menu on an Android `PopupMenu` — the driver half (ADR 0097 § 2).
//
// `planPopupMenu` (adwaita-core) decides what the menu IS in `PopupMenu` terms; this walks that
// plan onto the platform's `Menu` through a seam, so everything but the three platform calls is
// specced off a device. The seam is `PopupMenuSurface`: a real one wraps `android.widget.PopupMenu`
// anchored at the button, a spec wraps a recorder.
//
// Activation is the action resolution of ADR 0098: a tap hands back the model PATH and the caller
// fires the action through `activateMenuItem`, not through a second dispatch of its own.
//
// Free of `@nativescript/core` value imports so the spec suite can exercise the real code.
//
// Reference: android.widget.PopupMenu, android.view.Menu (add, addSubMenu, setGroupCheckable,
// setGroupDividerEnabled — API 28)

import { assertPopupMenuPlan, planPopupMenu } from '@gjsify/adwaita-core';
import type {
    AdwMenuActions,
    AdwMenuModel,
    AdwMenuPath,
    PopupMenuLevelPlan,
    PopupMenuPlan,
} from '@gjsify/adwaita-core';

/** The `MenuItem` calls the driver makes. */
export interface PopupMenuItemLike {
    setEnabled(enabled: boolean): unknown;
    setCheckable(checkable: boolean): unknown;
    setChecked(checked: boolean): unknown;
}

/** The `Menu` / `SubMenu` calls the driver makes. */
export interface PopupMenuLike {
    add(groupId: number, itemId: number, order: number, title: string): PopupMenuItemLike;
    addSubMenu(groupId: number, itemId: number, order: number, title: string): PopupMenuLike;
    setGroupCheckable(groupId: number, checkable: boolean, exclusive: boolean): void;
    /** API 28; absent below it, where sections are inlined without a rule. */
    setGroupDividerEnabled?(enabled: boolean): void;
}

/** What a platform gives the driver: the menu, a way to show it and the two events it reports. */
export interface PopupMenuSurface {
    readonly menu: PopupMenuLike;
    /** `Build.VERSION.SDK_INT`. */
    readonly apiLevel: number;
    show(): void;
    dismiss(): void;
    /** The tapped item's id; answer `true` when handled. */
    onItemClick(handler: (itemId: number) => boolean): void;
    onDismiss(handler: () => void): void;
}

/** `Build.VERSION_CODES.P`: the first level with `setGroupDividerEnabled`. */
export const GROUP_DIVIDER_API = 28;

/** Item ids are unique across the whole menu, so a tap maps back to exactly one model path. */
interface IdSource {
    next: number;
    readonly paths: Map<number, AdwMenuPath>;
}

/**
 * Write `level` onto `menu`. Group ids start at 1 (0 is `Menu.NONE`). A submenu row is not in the
 * path map: opening it is the platform's and activates nothing.
 */
export function fillPopupMenu(
    menu: PopupMenuLike,
    level: PopupMenuLevelPlan,
    apiLevel: number,
): Map<number, AdwMenuPath> {
    const source: IdSource = { next: 1, paths: new Map() };
    fillLevel(menu, level, apiLevel, source);
    return source.paths;
}

function fillLevel(menu: PopupMenuLike, level: PopupMenuLevelPlan, apiLevel: number, source: IdSource): void {
    let order = 0;
    level.groups.forEach((group, index) => {
        const groupId = index + 1;
        const radios: Array<[PopupMenuItemLike, boolean]> = [];
        for (const entry of group.entries) {
            const itemId = source.next++;
            if (entry.kind === 'submenu') {
                fillLevel(menu.addSubMenu(groupId, itemId, order++, entry.title), entry.level, apiLevel, source);
                continue;
            }
            const item = menu.add(groupId, itemId, order++, entry.title);
            source.paths.set(itemId, entry.path);
            if (!entry.enabled) item.setEnabled(false);
            if (entry.checkable) {
                item.setCheckable(true);
                item.setChecked(entry.checked);
            } else if (entry.role === 'radio') radios.push([item, entry.checked]);
        }
        // The group is made exclusive BEFORE a radio is checked: `setChecked` on an item of an
        // exclusive group is what unchecks its siblings.
        if (group.checkable === 'exclusive') menu.setGroupCheckable(groupId, true, true);
        for (const [item, checked] of radios) item.setChecked(checked);
    });
    if (level.groups.length > 1 && apiLevel >= GROUP_DIVIDER_API) menu.setGroupDividerEnabled?.(true);
}

export interface OpenPopupMenuOptions {
    readonly surface: PopupMenuSurface;
    readonly model: AdwMenuModel;
    /** What {@link resolveMenuItemState} reads; from `menuActionsFor` it is the registry's. */
    readonly actions?: AdwMenuActions;
    /** A tap on a leaf item, with its model path. Fire the action here (`activateMenuItem`). */
    readonly activate: (path: AdwMenuPath) => void;
    readonly onDismiss?: () => void;
}

/**
 * Plan, refuse what `PopupMenu` cannot draw, fill and show. A refusal throws BEFORE anything is
 * shown, naming it, so a bad menu fails when it is applied and not at the tap.
 */
export function openPopupMenu(options: OpenPopupMenuOptions): PopupMenuPlan {
    const { surface } = options;
    const plan = planPopupMenu(options.model, options.actions);
    assertPopupMenuPlan(plan);
    const paths = fillPopupMenu(surface.menu, plan.level, surface.apiLevel);
    surface.onItemClick((itemId) => {
        const path = paths.get(itemId);
        if (path === undefined) return false;
        options.activate(path);
        return true;
    });
    surface.onDismiss(() => options.onDismiss?.());
    surface.show();
    return plan;
}

/**
 * Throw if `model` holds what `PopupMenu` can never draw, at the ASSIGNMENT: a `custom` item or a
 * section label. A radio run that shares a group needs the actions to be known, so it throws when
 * the menu is opened.
 */
export function assertPopupMenuAssignable(model: AdwMenuModel): void {
    assertPopupMenuPlan(planPopupMenu(model));
}

/**
 * A JSON string is not a menu model here: NativeScript's XML Builder writes an attribute straight
 * onto the property, so accepting one would open an XML door nothing can prove, and
 * `normalizeMenuModel` would turn it into an EMPTY menu with nothing saying why.
 */
export function refuseMenuString(value: unknown, widget: string): void {
    if (typeof value !== 'string') return;
    throw new TypeError(
        `${widget}.menuModel takes a menu model, not the string ${JSON.stringify(value.slice(0, 40))}. ` +
            `NativeScript's XML Builder writes an attribute straight onto the property, so a ` +
            `menuModel="…" in a view file arrives here as text — which this port deliberately does not ` +
            `parse (ADR 0042). Assign the model from code, or keep this menu on a surface whose ` +
            `attribute door is open.`,
    );
}
