// Browser port of the Overview story — the widget gallery. Shares metadata with
// widgets.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import {
    OVERVIEW_ACCENT_OPTIONS,
    OVERVIEW_ADVANCED_ROWS,
    OVERVIEW_DEVICES,
    OVERVIEW_GROUP_TITLES,
    OVERVIEW_SHORTCUTS,
    OVERVIEW_TEXT,
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

        this._banner = el('adw-banner', {
            title: OVERVIEW_TEXT.bannerTitle,
            'button-label': OVERVIEW_TEXT.bannerButton,
        });
        this._syncBanner();
        host.append(this._banner);

        const page = el('adw-preferences-page');

        // --- Appearance: a widget demo only. The storybook's OWN appearance is in
        // the chrome, and wiring these to it would give one setting two controls
        // that disagree.
        const appearance = el('adw-preferences-group', { title: OVERVIEW_GROUP_TITLES.appearance });
        appearance.append(
            el('adw-switch-row', { title: OVERVIEW_TEXT.darkMode, subtitle: OVERVIEW_TEXT.darkModeSubtitle }),
            el('adw-switch-row', {
                title: OVERVIEW_TEXT.notifications,
                subtitle: OVERVIEW_TEXT.notificationsSubtitle,
                active: '',
            }),
            el('adw-combo-row', {
                title: OVERVIEW_TEXT.accentColor,
                // `model` is JSON, not a comma list — the element parses it.
                model: JSON.stringify([...OVERVIEW_ACCENT_OPTIONS]),
                selected: '0',
            }),
        );
        page.append(appearance);

        // --- Account ---
        const account = el('adw-preferences-group', { title: OVERVIEW_GROUP_TITLES.account });
        account.append(
            el('adw-entry-row', { title: OVERVIEW_TEXT.name, text: OVERVIEW_TEXT.nameValue }),
            el('adw-entry-row', { title: OVERVIEW_TEXT.email, text: OVERVIEW_TEXT.emailValue }),
            el('adw-spin-row', {
                title: OVERVIEW_TEXT.devices,
                min: String(OVERVIEW_DEVICES.lower),
                max: String(OVERVIEW_DEVICES.upper),
                step: String(OVERVIEW_DEVICES.step),
                value: String(OVERVIEW_DEVICES.value),
            }),
        );

        const advanced = el('adw-expander-row', {
            title: OVERVIEW_TEXT.advanced,
            subtitle: OVERVIEW_TEXT.advancedSubtitle,
        });
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
        const shortcuts = el('adw-preferences-group', { title: OVERVIEW_GROUP_TITLES.shortcuts });
        for (const shortcut of OVERVIEW_SHORTCUTS) {
            const row = el('adw-action-row', { title: shortcut.title });
            const label = el('adw-shortcut-label', { accelerator: shortcut.accelerator, slot: 'suffix' });
            row.append(label);
            shortcuts.append(row);
        }
        page.append(shortcuts);

        // --- Actions ---
        const actions = el('adw-preferences-group', { title: OVERVIEW_GROUP_TITLES.actions });
        const buttons = document.createElement('div');
        buttons.style.display = 'flex';
        buttons.style.gap = '12px';
        buttons.style.margin = '6px 0';

        const save = document.createElement('button');
        save.className = 'adw-button suggested-action';
        save.textContent = OVERVIEW_TEXT.save;
        const remove = document.createElement('button');
        remove.className = 'adw-button destructive-action';
        remove.textContent = OVERVIEW_TEXT.delete;
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
