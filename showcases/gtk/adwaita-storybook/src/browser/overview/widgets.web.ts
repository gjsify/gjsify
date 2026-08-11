// Browser port of the Overview story — the widget gallery. Shares metadata with
// widgets.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import {
    OVERVIEW_ACCENT_OPTIONS,
    OVERVIEW_ADVANCED_ROWS,
    OVERVIEW_SHORTCUTS,
    overviewWidgetsMeta,
} from '../../overview/widgets.meta.js';

/** A custom element with attributes set, since every row here is one. */
function el(tag: string, attributes: Record<string, string> = {}): HTMLElement {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
}

export class OverviewWidgetsWebStory extends StoryElement {
    private _banner: HTMLElement | null = null;

    constructor() {
        super(OverviewWidgetsWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return overviewWidgetsMeta;
    }

    initialize(): void {
        const host = document.createElement('div');
        host.style.display = 'flex';
        host.style.flexDirection = 'column';
        host.style.width = '100%';

        this._banner = el('adw-banner', { title: 'You have unsaved changes', 'button-label': 'Save' });
        this._syncBanner();
        host.append(this._banner);

        const page = el('adw-preferences-page');

        // --- Appearance: a widget demo only. The storybook's OWN appearance is in
        // the chrome, and wiring these to it would give one setting two controls
        // that disagree.
        const appearance = el('adw-preferences-group', { title: 'Appearance' });
        appearance.append(
            el('adw-switch-row', { title: 'Dark mode', subtitle: 'Use the dark Adwaita palette' }),
            el('adw-switch-row', { title: 'Notifications', subtitle: 'Show toasts for events', active: '' }),
            el('adw-combo-row', {
                title: 'Accent color',
                // `items` is JSON, not a comma list — the element parses it.
                items: JSON.stringify([...OVERVIEW_ACCENT_OPTIONS]),
                selected: '0',
            }),
        );
        page.append(appearance);

        // --- Account ---
        const account = el('adw-preferences-group', { title: 'Account' });
        account.append(
            el('adw-entry-row', { title: 'Name', text: 'Ada Lovelace' }),
            el('adw-entry-row', { title: 'Email', text: 'ada@example.com' }),
            el('adw-spin-row', { title: 'Devices', min: '1', max: '10', step: '1', value: '3' }),
        );

        const advanced = el('adw-expander-row', { title: 'Advanced', subtitle: 'More options' });
        advanced.toggleAttribute('expanded', true);
        for (const row of OVERVIEW_ADVANCED_ROWS) {
            advanced.append(
                row.kind === 'switch'
                    ? el('adw-switch-row', row.active ? { title: row.title, active: '' } : { title: row.title })
                    : el('adw-action-row', { title: row.title }),
            );
        }
        account.append(advanced);
        page.append(account);

        // --- Shortcuts: the newest widget, in context ---
        const shortcuts = el('adw-preferences-group', { title: 'Shortcuts' });
        for (const shortcut of OVERVIEW_SHORTCUTS) {
            const row = el('adw-action-row', { title: shortcut.title });
            const label = el('adw-shortcut-label', { accelerator: shortcut.accelerator, slot: 'suffix' });
            row.append(label);
            shortcuts.append(row);
        }
        page.append(shortcuts);

        // --- Actions ---
        const actions = el('adw-preferences-group', { title: 'Actions' });
        const buttons = document.createElement('div');
        buttons.style.display = 'flex';
        buttons.style.gap = '12px';
        buttons.style.margin = '6px 0';

        const save = document.createElement('button');
        save.className = 'adw-button suggested-action';
        save.textContent = 'Save changes';
        const remove = document.createElement('button');
        remove.className = 'adw-button destructive-action';
        remove.textContent = 'Delete account';
        buttons.append(save, remove);
        actions.append(buttons);
        page.append(actions);

        host.append(page);
        this.addContent(host);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncBanner();
    }

    private _syncBanner(): void {
        this._banner?.toggleAttribute('revealed', this.args.revealed as boolean);
    }
}

export const OverviewWidgetsWebStories: WebStoryModule = { stories: [OverviewWidgetsWebStory] };
