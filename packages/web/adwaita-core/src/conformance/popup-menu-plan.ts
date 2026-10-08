// Menu → `PopupMenu` plan vectors (ADR 0097 § 2): the lowering every NativeScript menu goes through.
//
// The outline is the plan in one line per group, so a row reads as the menu a user sees:
// `none: Open, Save` is one group of two rows; `!` marks a disabled row, `✓` a checked one, `○` a
// radio row and `> Title (…)` a submenu holding its own groups. A group of radio rows is
// `exclusive`.
//
// Subset-only: GJS has no `PopupMenu`, so the refusal rows are not oracle rows. What the lowering
// reads from an item (`sensitive`, `role`, `toggled`) IS GTK's, and `MENU_ITEM_STATE_VECTORS`
// holds that half against GTK.

import type { AdwMenuActions, AdwMenuInput } from '../menu.js';

export interface PopupMenuPlanVector {
    readonly rule: string;
    readonly input: AdwMenuInput;
    readonly actions?: AdwMenuActions;
    /** The groups, in order, as {@link popupMenuOutline} writes them. */
    readonly outline: readonly string[];
    /** The refusals by name; empty when the menu is renderable. */
    readonly refused: readonly string[];
}

const RADIO = (name: string, target: string, label: string) => ({ label, action: `${name}::${target}` });

export const POPUP_MENU_PLAN_VECTORS: ReadonlyArray<PopupMenuPlanVector> = [
    {
        rule: 'loose items form one group; a section is a group of its own, so a rule is drawn between them',
        input: ['Open', { section: ['Save', 'Save as'] }, 'Quit'],
        outline: ['none: Open', 'none: Save, Save as', 'none: Quit'],
        refused: [],
    },
    {
        rule: 'a submenu is a nested level, not a group member',
        input: ['Open', { label: 'More', submenu: ['Deep'] }],
        outline: ['none: Open, > More (none: Deep)'],
        refused: [],
    },
    {
        rule: 'an insensitive item is shown disabled, not omitted (0097 § 2 replaces 0042 § 6 here)',
        input: [{ label: 'Paste', action: 'win.paste' }],
        actions: { 'win.paste': { enabled: false } },
        outline: ['none: !Paste'],
        refused: [],
    },
    {
        rule: 'hidden-when still omits: the item is not in the plan at all',
        input: [{ label: 'Paste', action: 'win.paste', hiddenWhen: 'action-disabled' }, 'Copy'],
        actions: { 'win.paste': { enabled: false } },
        outline: ['none: Copy'],
        refused: [],
    },
    {
        rule: 'a boolean action without a target is a CHECK item, checkable per item',
        input: [{ label: 'Wrap', action: 'win.wrap' }, 'Copy'],
        actions: { 'win.wrap': { state: 'true' } },
        outline: ['none: ✓Wrap, Copy'],
        refused: [],
    },
    {
        rule: 'a radio run in a section of its own is an exclusive group',
        input: [{ section: [RADIO('win.view', 'list', 'List'), RADIO('win.view', 'grid', 'Grid')] }],
        actions: { 'win.view': { state: 'grid' } },
        outline: ['exclusive: ○List, ✓Grid'],
        refused: [],
    },
    {
        rule: 'a radio run beside a CHECK item in one section is refused by name: the checkable flag is per group',
        input: [{ section: [RADIO('win.view', 'list', 'List'), { label: 'Wrap', action: 'win.wrap' }] }],
        actions: { 'win.view': { state: 'list' }, 'win.wrap': { state: 'false' } },
        outline: ['none: ✓List, Wrap'],
        refused: ['mixed-radio-section'],
    },
    {
        rule: 'two radio runs in one section are refused by name',
        input: [
            {
                section: [
                    RADIO('win.view', 'list', 'List'),
                    RADIO('win.view', 'grid', 'Grid'),
                    RADIO('win.sort', 'name', 'Name'),
                ],
            },
        ],
        actions: { 'win.view': { state: 'list' }, 'win.sort': { state: 'name' } },
        outline: ['none: ✓List, ○Grid, ✓Name'],
        refused: ['mixed-radio-section'],
    },
    {
        rule: 'a custom item is refused by name, at the item',
        input: [{ label: 'Zoom', custom: 'zoom-box' }],
        outline: [],
        refused: ['custom'],
    },
    {
        rule: 'a section label is refused by name: a heading row would invent a widget',
        input: [{ label: 'Edit', section: ['Cut'] }],
        outline: ['none: Cut'],
        refused: ['section-label'],
    },
];

interface OutlineLevel {
    groups: ReadonlyArray<{
        checkable: string;
        entries: ReadonlyArray<
            | { kind: 'item'; title: string; enabled: boolean; checked: boolean; role: string }
            | { kind: 'submenu'; title: string; level: OutlineLevel }
        >;
    }>;
}

/** The plan as the one-line-per-group text the vectors state. */
export function popupMenuOutline(level: OutlineLevel): string[] {
    return level.groups.map((group) => {
        const rows = group.entries.map((entry) => {
            if (entry.kind === 'submenu') return `> ${entry.title} (${popupMenuOutline(entry.level).join('; ')})`;
            const mark = entry.role === 'radio' ? (entry.checked ? '✓' : '○') : entry.checked ? '✓' : '';
            return `${entry.enabled ? '' : '!'}${mark}${entry.title}`;
        });
        return `${group.checkable}: ${rows.join(', ')}`;
    });
}
