// Adw.Avatar — a circular avatar that renders generated initials, a symbolic
// icon, or a custom image. original implementation.

import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { avatarMeta } from './avatar.meta.js';

/** Story: Adw.Avatar with live text / size / icon controls. */
export class AvatarStory extends StoryWidget {
    private _avatar: Adw.Avatar | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookAvatar' }, AvatarStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(AvatarStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...avatarMeta, component: Adw.Avatar.$gtype };
    }

    initialize(): void {
        this._avatar = new Adw.Avatar({
            size: this.args.size as number,
            text: this.args.text as string,
            showInitials: this.args.showInitials as boolean,
            iconName: this.args.iconName as string,
        });
        this.addContent(this._avatar);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._avatar) return;
        this._avatar.size = this.args.size as number;
        this._avatar.text = this.args.text as string;
        this._avatar.showInitials = this.args.showInitials as boolean;
        this._avatar.iconName = this.args.iconName as string;
    }
}

GObject.type_ensure(AvatarStory.$gtype);

export const AvatarStories: StoryModule = { stories: [AvatarStory] };
