// A portable menu as the plan of an Android `PopupMenu` — the renderer-free half (ADR 0097 § 2).
//
// The model is lowered once, here, into what `PopupMenu` can say: GROUPS of items, a submenu that
// opens a nested level, and a checkable flag that is per GROUP. What it cannot say is refused by
// name in `refusals` and never drawn wrong, so a mixed radio section or a `custom` item fails when
// the menu is applied and not at the tap. The NativeScript driver only walks the plan.
//
// Reference: android.view.Menu (add, addSubMenu, setGroupCheckable, setGroupDividerEnabled);
// refs/gtk/gtk/gtkmenutrackeritem.c for the role of an item.

import { parseDetailedAction, resolveMenuItemState } from './menu.js';
import type { AdwMenuActions, AdwMenuModel, AdwMenuNode, AdwMenuPath } from './menu.js';

/** An item of the plan; `path` maps a tap back to the model. */
export interface PopupMenuItemPlan {
    readonly kind: 'item';
    readonly path: AdwMenuPath;
    readonly title: string;
    /** Shown disabled, not omitted: the dimmed row is the platform's own idiom (0097 § 2). */
    readonly enabled: boolean;
    /** CHECK items set it themselves; a RADIO item takes it from its exclusive group. */
    readonly checkable: boolean;
    readonly checked: boolean;
    readonly role: 'normal' | 'check' | 'radio';
    /** The action name without its target: the identity of a radio run. */
    readonly action?: string;
}

/** A submenu: `Menu.addSubMenu`, whose items are a level of their own. */
export interface PopupMenuSubmenuPlan {
    readonly kind: 'submenu';
    readonly path: AdwMenuPath;
    readonly title: string;
    readonly level: PopupMenuLevelPlan;
}

export type PopupMenuEntryPlan = PopupMenuItemPlan | PopupMenuSubmenuPlan;

/** One `groupId`: a section, or the run of items outside any section. */
export interface PopupMenuGroupPlan {
    /** `exclusive` is `setGroupCheckable(group, true, true)`; the flag is per group on Android. */
    readonly checkable: 'none' | 'exclusive';
    readonly entries: readonly PopupMenuEntryPlan[];
}

export interface PopupMenuLevelPlan {
    readonly groups: readonly PopupMenuGroupPlan[];
}

/** What `PopupMenu` cannot express, by the name the diagnostic uses. */
export interface PopupMenuRefusal {
    readonly what: 'custom' | 'section-label' | 'mixed-radio-section';
    /** The item for `custom`, the section (or the submenu / root holding the loose items) otherwise. */
    readonly path: AdwMenuPath;
    readonly message: string;
}

export interface PopupMenuPlan {
    readonly level: PopupMenuLevelPlan;
    readonly refusals: readonly PopupMenuRefusal[];
}

interface MutableGroup {
    entries: PopupMenuEntryPlan[];
    path: AdwMenuPath;
}

/** Lower `model` for `PopupMenu`. `actions` is what {@link resolveMenuItemState} reads. */
export function planPopupMenu(model: AdwMenuModel, actions?: AdwMenuActions): PopupMenuPlan {
    const refusals: PopupMenuRefusal[] = [];
    return { level: levelOf(model, [], actions, refusals), refusals };
}

function levelOf(
    nodes: readonly AdwMenuNode[],
    base: AdwMenuPath,
    actions: AdwMenuActions | undefined,
    refusals: PopupMenuRefusal[],
): PopupMenuLevelPlan {
    const groups: MutableGroup[] = [];

    const collect = (items: readonly AdwMenuNode[], prefix: AdwMenuPath, owner: AdwMenuPath): void => {
        let open: MutableGroup | null = null;
        const into = (): MutableGroup => {
            if (open === null) {
                open = { entries: [], path: owner };
                groups.push(open);
            }
            return open;
        };
        items.forEach((node, index) => {
            const path = [...prefix, index];
            if (node.kind === 'section') {
                open = null;
                if (node.label !== undefined) {
                    refusals.push({
                        what: 'section-label',
                        path,
                        message:
                            `menu section [${path.join('.')}] has the label ${JSON.stringify(node.label)}: PopupMenu has ` +
                            'no heading row, and a disabled first row would invent a widget GTK does not have.',
                    });
                }
                collect(node.items, path, path);
                open = null;
                return;
            }
            if (node.kind === 'submenu') {
                into().entries.push({
                    kind: 'submenu',
                    path,
                    title: node.label,
                    level: levelOf(node.items, path, actions, refusals),
                });
                return;
            }
            const state = resolveMenuItemState(node, actions);
            if (!state.visible) return;
            if (node.custom !== undefined) {
                refusals.push({
                    what: 'custom',
                    path,
                    message: `menu item custom="${node.custom}" names an application widget, which PopupMenu cannot host.`,
                });
                return;
            }
            into().entries.push({
                kind: 'item',
                path,
                title: node.label,
                enabled: state.sensitive,
                checkable: state.role === 'check',
                checked: state.toggled,
                role: state.role,
                action: parseDetailedAction(node.action)?.name,
            });
        });
    };
    collect(nodes, base, base);

    return {
        groups: groups.map((group) => ({ checkable: checkableOf(group, refusals), entries: group.entries })),
    };
}

/**
 * The checkable flag of a group, which is per group on Android: a RADIO run needs an exclusive
 * group, so anything else beside it (a CHECK item, a second run, a plain row) cannot share one.
 */
function checkableOf(group: MutableGroup, refusals: PopupMenuRefusal[]): 'none' | 'exclusive' {
    const radios = group.entries.filter(
        (entry): entry is PopupMenuItemPlan => entry.kind === 'item' && entry.role === 'radio',
    );
    if (radios.length === 0) return 'none';
    const runs = new Set(radios.map((entry) => entry.action));
    return radios.length === group.entries.length && runs.size === 1 ? 'exclusive' : mixed(group, refusals);
}

function mixed(group: MutableGroup, refusals: PopupMenuRefusal[]): 'none' {
    refusals.push({
        what: 'mixed-radio-section',
        path: group.path,
        message:
            `menu section [${group.path.join('.')}] mixes a radio run with other rows: PopupMenu's checkable flag ` +
            'is per group, so the section would draw wrong. Give each radio run a section of its own.',
    });
    return 'none';
}

/** Throw naming every refusal, as `assertMenuRenderable` does for the sheet. */
export function assertPopupMenuPlan(plan: PopupMenuPlan): void {
    if (plan.refusals.length === 0) return;
    const lines = plan.refusals.map((refusal) => `  [${refusal.what}] ${refusal.message}`);
    throw new Error(`nativescript PopupMenu cannot render this menu:\n${lines.join('\n')}`);
}
