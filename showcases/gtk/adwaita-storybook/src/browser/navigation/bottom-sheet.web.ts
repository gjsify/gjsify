// Browser port of the Bottom Sheet story. Shares metadata with bottom-sheet.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { bottomSheetMeta } from '../../navigation/bottom-sheet.meta.js';

/** GTK symbolic name (e.g. "list-add-symbolic") → adwaita-web icon class. */
function iconClass(gtkName: string): string {
    return `gtk-image adw-icon--${gtkName.replace(/-symbolic$/, '')}`;
}

export class BottomSheetWebStory extends StoryElement {
    private _sheet: HTMLElement | null = null;

    constructor() {
        super(BottomSheetWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return bottomSheetMeta;
    }

    /** The persistent content — a centered pill button that toggles the sheet. */
    private _buildContent(): HTMLElement {
        const content = document.createElement('adw-bottom-sheet-content');

        const center = document.createElement('div');
        center.style.display = 'flex';
        center.style.alignItems = 'center';
        center.style.justifyContent = 'center';
        center.style.width = '100%';
        center.style.height = '100%';

        const toggle = document.createElement('gtk-button');
        toggle.textContent = 'Toggle sheet';
        toggle.setAttribute('pill', '');
        toggle.setAttribute('suggested', '');
        toggle.addEventListener('click', () => {
            if (this._sheet) this._sheet.toggleAttribute('open');
        });

        center.append(toggle);
        content.append(center);
        return content;
    }

    /** The sheet — a title above a preferences group of share actions. */
    private _buildSheet(): HTMLElement {
        const sheet = document.createElement('adw-bottom-sheet-sheet');

        const box = document.createElement('div');
        box.style.display = 'flex';
        box.style.flexDirection = 'column';
        box.style.gap = '12px';
        box.style.margin = '18px 18px 24px';

        // Match the GTK .title-2 typography style (bold heading) inline — the
        // adwaita-web skin has no typography utility class for it.
        const title = document.createElement('span');
        title.textContent = 'Share track';
        title.style.fontSize = '15pt';
        title.style.fontWeight = '800';
        box.append(title);

        const group = document.createElement('adw-preferences-group');
        for (const [rowTitle, icon] of [
            ['Copy link', 'edit-copy-symbolic'],
            ['Send to a friend', 'mail-send-symbolic'],
            ['Add to playlist', 'list-add-symbolic'],
        ] as const) {
            const row = document.createElement('adw-action-row');
            row.setAttribute('title', rowTitle);
            row.setAttribute('activatable', '');

            const prefix = document.createElement('span');
            prefix.setAttribute('slot', 'prefix');
            prefix.className = iconClass(icon);
            row.append(prefix);

            group.append(row);
        }
        box.append(group);

        sheet.append(box);
        return sheet;
    }

    initialize(): void {
        this._sheet = document.createElement('adw-bottom-sheet');
        // Match the native story's fixed 480×340 viewport so the sheet has a
        // bounded content area to slide over.
        this._sheet.style.width = '480px';
        this._sheet.style.height = '340px';

        this._sheet.append(this._buildContent(), this._buildSheet());

        this._sync();
        this.addContent(this._sheet);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    private _sync(): void {
        if (!this._sheet) return;
        this._sheet.toggleAttribute('open', this.args.open as boolean);
        this._setBool('modal', this.args.modal as boolean);
        this._setBool('can-close', this.args.canClose as boolean);
    }

    /** Boolean attributes that default on are encoded as `="false"` when off. */
    private _setBool(name: string, value: boolean): void {
        if (!this._sheet) return;
        if (value) this._sheet.setAttribute(name, '');
        else this._sheet.setAttribute(name, 'false');
    }
}

export const BottomSheetWebStories: WebStoryModule = { stories: [BottomSheetWebStory] };
