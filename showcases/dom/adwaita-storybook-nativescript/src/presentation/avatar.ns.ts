// NativeScript port of the Avatar story. Shares metadata with the GTK
// avatar.story.ts and browser avatar.web.ts (imported from the GTK showcase's
// renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw } from '@gjsify/adwaita-nativescript';
import { contactNewSymbolic } from '@gjsify/adwaita-icons/actions';
import { cameraPhotoSymbolic } from '@gjsify/adwaita-icons/devices';
import { avatarDefaultSymbolic } from '@gjsify/adwaita-icons/status';
import { avatarMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

/**
 * The `iconName` control's three theme names, mapped to the SVGs this renderer draws.
 *
 * The control is shared with the GTK and browser stories, where the value is an
 * icon-theme NAME and the toolkit resolves it. NativeScript resolves nothing — the SVG
 * source IS the icon identity here — so the story does for three known names what the
 * platform does for all of them. A name outside the map leaves `iconName` empty, which
 * falls back to the widget's own default rather than to a blank avatar.
 */
const ICON_SVGS: Readonly<Record<string, string>> = {
    'avatar-default-symbolic': avatarDefaultSymbolic,
    'contact-new-symbolic': contactNewSymbolic,
    'camera-photo-symbolic': cameraPhotoSymbolic,
};

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
        this._avatar.iconName = ICON_SVGS[this.args.iconName as string] ?? '';
    }
}

export const AvatarNsStories: NsStoryModule = { stories: [AvatarNsStory] };
