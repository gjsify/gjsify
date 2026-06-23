// Adw.Avatar — a circular avatar that renders generated initials, a symbolic
// icon, or a custom image. original implementation.

import Adw from '@girs/adw-1';
import GObject from '@girs/gobject-2.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

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
        return {
            title: 'Presentation/Avatar',
            description:
                'A circular avatar that derives initials (and a colour) from a name, or shows a symbolic icon.',
            component: Adw.Avatar.$gtype,
            controls: [
                { name: 'text', label: 'Name', type: ControlType.TEXT, defaultValue: 'Ada Lovelace' },
                { name: 'size', label: 'Size', type: ControlType.RANGE, min: 24, max: 160, step: 8, defaultValue: 96 },
                { name: 'showInitials', label: 'Show initials', type: ControlType.BOOLEAN, defaultValue: true },
                {
                    name: 'iconName',
                    label: 'Fallback icon',
                    type: ControlType.SELECT,
                    options: [
                        { label: 'Person', value: 'avatar-default-symbolic' },
                        { label: 'Contact', value: 'contact-new-symbolic' },
                        { label: 'Camera', value: 'camera-photo-symbolic' },
                    ],
                    defaultValue: 'avatar-default-symbolic',
                },
            ],
        };
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
