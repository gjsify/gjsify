// NativeScript port of the Avatar story. Shares metadata with the GTK
// avatar.story.ts and browser avatar.web.ts (imported from the GTK showcase's
// renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw } from '@gjsify/adwaita-nativescript';
import { avatarMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class AvatarNsStory extends StoryView {
    private _avatar: Adw.Avatar | null = null;

    constructor() {
        super(AvatarNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return avatarMeta;
    }

    initialize(): void {
        this._avatar = new Adw.Avatar();
        this._sync();
        this.addContent(this._avatar);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    private _sync(): void {
        if (!this._avatar) return;
        this._avatar.text = this.args.text as string;
        this._avatar.size = this.args.size as number;
        // Adw.Avatar (NS) supports `text` (→ derived initials) and `size` only: the
        // CSS-subset avatar has no icon-theme lookup, so it always shows derived
        // initials and there is nothing `showInitials`/`iconName` could switch. Read
        // them so the controls stay bound to this rendering too.
        void (this.args.showInitials as boolean);
        void (this.args.iconName as string);
    }
}

export const AvatarNsStories: NsStoryModule = { stories: [AvatarNsStory] };
