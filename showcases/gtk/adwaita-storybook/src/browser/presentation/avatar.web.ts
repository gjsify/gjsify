// Browser port of the Avatar story. Shares metadata with avatar.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { avatarMeta } from '../../presentation/avatar.meta.js';

export class AvatarWebStory extends StoryElement {
    private _avatar: HTMLElement | null = null;

    constructor() {
        super(AvatarWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return avatarMeta;
    }

    initialize(): void {
        this._avatar = document.createElement('adw-avatar');
        this._sync();
        this.addContent(this._avatar);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    private _sync(): void {
        if (!this._avatar) return;
        this._avatar.setAttribute('text', this.args.text as string);
        this._avatar.setAttribute('size', String(this.args.size as number));
        this._avatar.toggleAttribute('show-initials', this.args.showInitials as boolean);
        this._avatar.setAttribute('icon', (this.args.iconName as string).replace(/-symbolic$/, ''));
    }
}

export const AvatarWebStories: WebStoryModule = { stories: [AvatarWebStory] };
