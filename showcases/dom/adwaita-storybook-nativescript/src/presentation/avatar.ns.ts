// NativeScript port of the Avatar story. Shares metadata with the GTK
// avatar.story.ts and browser avatar.web.ts (imported from the GTK showcase's
// renderer-agnostic *.meta.ts barrel).

// The story's `iconName` control offers THEME NAMES, and since `icon-theme.ts` the port
// resolves one — so the local name-to-SVG map that used to sit here is gone. Seven of
// these existed across this showcase, each re-implementing the `-symbolic` strip and a
// switch over three or four names, each with its own fallback.

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
        this._avatar.showInitials = this.args.showInitials as boolean;
        this._avatar.iconName = this.args.iconName as string;
    }
}

export const AvatarNsStories: NsStoryModule = { stories: [AvatarNsStory] };
